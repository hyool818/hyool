/**
 * 小说生成 + 剧情提取 → make 镜头 JSON
 * LLM 只产文本；分支结构由提取结果给出，运行时仍不由 AI 选路。
 */
import { chatCompletions } from "../ai/gateway.js";
import { resolveNovelModelRef } from "../ai/models.js";
import { parseJSON } from "./planner.js";

function uid(prefix = "b") {
  return prefix + "_" + Math.random().toString(36).slice(2, 10);
}

function clampText(s, n) {
  return String(s || "").trim().slice(0, n);
}

/** 按标点拆成多句短镜头，避免半截截断、字幕占满屏 */
function splitSpeech(text, maxLen) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return [];
  if (s.length <= maxLen) return [s];
  const parts = [];
  const tokens = s.split(/(?<=[。！？；…\n])/);
  let buf = "";
  const flush = () => {
    const t = buf.trim();
    if (t) parts.push(t);
    buf = "";
  };
  for (const tok of tokens) {
    const t = tok.trim();
    if (!t) continue;
    if (!buf) {
      if (t.length <= maxLen) {
        buf = t;
      } else {
        for (let i = 0; i < t.length; i += maxLen) parts.push(t.slice(i, i + maxLen));
      }
      continue;
    }
    if ((buf + t).length <= maxLen) {
      buf += t;
    } else {
      flush();
      if (t.length <= maxLen) buf = t;
      else {
        for (let i = 0; i < t.length; i += maxLen) parts.push(t.slice(i, i + maxLen));
      }
    }
  }
  flush();
  return parts.length ? parts : [s.slice(0, maxLen)];
}

/** 正文按段落打包，便于分段提取、覆盖全章 */
function packTextChunks(text, target = 1600, maxChunks = 5) {
  const cleaned = String(text || "").replace(/\r/g, "").trim();
  if (!cleaned) return [];
  if (cleaned.length <= target) return [cleaned];

  const chunks = [];
  let i = 0;
  while (i < cleaned.length && chunks.length < maxChunks) {
    const remaining = cleaned.length - i;
    const isLastSlot = chunks.length === maxChunks - 1;
    let take = isLastSlot ? remaining : Math.min(target, remaining);
    if (!isLastSlot && remaining > target) {
      // 尽量在句号/换行处切开，避免半句
      const window = cleaned.slice(i, i + target + 80);
      let cut = -1;
      for (const re of [/\n\n/g, /\n/g, /[。！？]/g]) {
        let m;
        while ((m = re.exec(window))) {
          if (m.index >= Math.floor(target * 0.55)) cut = m.index + m[0].length;
        }
        if (cut > 0) break;
      }
      if (cut > 0) take = cut;
    }
    const piece = cleaned.slice(i, i + take).trim();
    if (piece) chunks.push(piece);
    i += take;
  }
  return chunks.length ? chunks : [cleaned.slice(0, target)];
}

/** POST /api/hub/novel-generate */
export async function generateNovel(body, env) {
  const premise = clampText(body.premise || body.request || "", 1200);
  if (!premise) throw new Error("请填写故事想法或大纲。");
  const genre = clampText(body.genre || "都市奇幻", 40) || "都市奇幻";
  let chapterCount = Math.round(Number(body.chapterCount) || 2);
  if (chapterCount < 1) chapterCount = 1;
  if (chapterCount > 3) chapterCount = 3;
  const continueFrom = clampText(body.continueFrom || "", 6000);

  const messages = [
    {
      role: "system",
      content:
        "你是 HYOOL 的小说助手。根据用户需求写短篇连载正文，适合后续改编成互动视觉小说。" +
        "只输出严格 JSON，不要 markdown，不要解释。" +
        "结构：{\"title\":\"书名\",\"synopsis\":\"一句话梗概\",\"chapters\":[{\"title\":\"章名\",\"content\":\"正文\"}]}" +
        "约束：共 " +
        chapterCount +
        " 章；每章 400~900 字中文；有人物对话与场景；结尾留一点钩子；" +
        "不写色情、血腥、政治敏感、歧视内容；不要选项列表，写连贯叙事。",
    },
    {
      role: "user",
      content:
        `题材：${genre}\n想法：${premise}\n` +
        (continueFrom ? `前文摘要（请接着写）：\n${continueFrom.slice(0, 2500)}\n` : "") +
        "请输出完整 JSON。",
    },
  ];

  const modelRef = resolveNovelModelRef(env);
  const provider = modelRef ? "deepseek" : "workers-ai";
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await chatCompletions(env, messages, modelRef, 0.75, 4200, 55000);
    const parsed = parseJSON(String(raw || ""));
    if (!parsed || !Array.isArray(parsed.chapters) || !parsed.chapters.length) {
      lastErr = "模型未返回合格章节 JSON";
      messages.push({
        role: "user",
        content: "上次输出无效。请只输出含 title 与 chapters[].content 的 JSON。",
      });
      continue;
    }
    const chapters = parsed.chapters.slice(0, chapterCount).map((ch, i) => ({
      title: clampText(ch.title || `第${i + 1}章`, 40) || `第${i + 1}章`,
      content: clampText(ch.content || "", 4000),
    })).filter((ch) => ch.content);
    if (!chapters.length) {
      lastErr = "章节正文为空";
      continue;
    }
    const title = clampText(parsed.title || premise.slice(0, 20), 60) || "未命名小说";
    const text = chapters.map((c) => `【${c.title}】\n${c.content}`).join("\n\n");
    return {
      title,
      synopsis: clampText(parsed.synopsis || "", 200),
      chapters,
      text,
      attempts: attempt,
      provider,
    };
  }
  throw new Error(lastErr || "小说生成失败");
}

/** 从字幕抽地点/氛围，绝不整句照抄字幕 */
function synthesizeImagePrompts(content) {
  const raw = String(content || "")
    .replace(/[「」『』""]/g, "")
    .replace(/\s+/g, "")
    .trim();
  const placeMatch = raw.match(
    /([\u4e00-\u9fffA-Za-z·]{2,12}(?:岭|山|峰|崖|谷|渊|漠|泽|林|原|关|渡|城|镇|村|寺|庙|宫|府|街|巷|桥|港|湾|岛|塔|殿|院|门|楼|穴|洞|湖|海|河|江|堡|寨|坡|岗|滩|野|墓|坟|骨))/
  );
  const place = (placeMatch && placeMatch[1]) || "";
  const gloomy = /不|没|阴|恐|荒|死|枯|禁|险|惧|冷|黑|血|尸|骨|想进去|可怕|无人/.test(raw);

  let zhCore;
  if (place && gloomy) {
    zhCore = `${place}，荒凉险峻，乱石枯木，冷风低云，无人通行，阴森压抑`;
  } else if (place) {
    zhCore = `${place}，环境开阔，光影层次，氛围沉静`;
  } else if (gloomy) {
    zhCore = "荒凉险地，枯木乱石，冷风低云，无人，阴森压抑";
  } else {
    zhCore = "空镜氛围场景，环境层次，光影分明";
  }
  const zh =
    zhCore + "，电影感宽景，暗黑奇幻视觉小说背景，动漫插画风，无文字，无水印，无界面";

  const enFocus = place || "desolate highland pass";
  const en = gloomy
    ? `ominous ${enFocus}, barren rocky terrain, sparse dead trees, cold wind under low clouds, deserted path, oppressive gloomy atmosphere, cinematic wide shot, dark fantasy visual novel background, anime illustration style, no text, no watermark, no UI`
    : `scenic ${enFocus}, clear atmosphere, layered environment, cinematic lighting, visual novel background, anime illustration style, no text, no watermark, no UI`;

  return { imagePrompt: clampText(en, 700), imagePromptZh: clampText(zh, 400) };
}

function normalizePromptCmp(s) {
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/[。！？，、；：""''…\.\!\?\,\;\:]/g, "");
}

/** 把字幕原句套进模板 / 过短 / 几乎照抄 → 弱提示，需要改写 */
function isWeakImagePrompt(prompt, content) {
  const p = normalizePromptCmp(prompt);
  const c = normalizePromptCmp(content);
  if (!p || p.length < 24) return true;
  if (c.length >= 6 && p.includes(c)) return true;
  if (c.length >= 8) {
    const core = c.slice(0, Math.min(14, c.length));
    if (core.length >= 6 && p.includes(core)) return true;
  }
  if (/^visualnovelbackground/i.test(p) && c.length >= 6 && p.includes(c.slice(0, 8))) return true;
  if (p.startsWith("视觉小说背景") && c.length >= 6 && p.includes(c.slice(0, 8))) return true;
  return false;
}

function pickImagePrompts(raw, content) {
  const en = clampText(
    (raw && (raw.imagePrompt || raw.visualPrompt || raw.bgPrompt || raw.imgPrompt || raw.imagePromptEn)) || "",
    700
  );
  const zh = clampText(
    (raw && (raw.imagePromptZh || raw.visualPromptZh || raw.bgPromptZh || raw.imgPromptZh)) || "",
    400
  );
  const fallback = synthesizeImagePrompts(content);
  return {
    imagePrompt: !isWeakImagePrompt(en, content) ? en : fallback.imagePrompt,
    imagePromptZh: !isWeakImagePrompt(zh, content) ? zh : fallback.imagePromptZh,
  };
}

/**
 * DeepSeek/LLM：把字幕改写成中英生图词（禁止照抄）
 * items: [{ id?, content }]
 */
export async function rewriteCaptionPrompts(items, env, modelRef) {
  const list = (Array.isArray(items) ? items : [])
    .map((it, i) => ({
      id: String(it.id || i),
      content: clampText(it.content || "", 80),
    }))
    .filter((it) => it.content);
  if (!list.length) return [];

  const outMap = new Map();
  const batchSize = 10;
  for (let start = 0; start < list.length; start += batchSize) {
    const batch = list.slice(start, start + batchSize);
    const messages = [
      {
        role: "system",
        content:
          "你是视觉小说文生图提示词专家。把每条「字幕」改写成可直接投喂文生图的画面描写。" +
          "只输出 JSON：{\"items\":[{\"id\":\"...\",\"imagePrompt\":\"英文\",\"imagePromptZh\":\"中文\"}]}" +
          "硬性规则：禁止照抄或夹带字幕原句；写地点/地貌/天气/时间/光影/氛围/构图/画风；" +
          "中文 40~120 字，英文 40~110 词；不要人名对白、不要文字/UI/水印。" +
          "示例：字幕「枯骨岭不是一个让人想进去的地方。」→" +
          "imagePromptZh「枯骨嶙峋的荒岭关隘，黄昏冷风，枯树稀疏，无人通行，阴森压抑，电影感宽景，暗黑奇幻视觉小说背景，无文字」；" +
          "imagePrompt「ominous bone-strewn mountain ridge pass at dusk, cold wind, sparse dead trees, deserted path, gloomy oppressive atmosphere, cinematic wide shot, dark fantasy visual novel background, no text」。",
      },
      {
        role: "user",
        content: "请改写：\n" + JSON.stringify({ items: batch }),
      },
    ];
    try {
      const raw = await chatCompletions(env, messages, modelRef, 0.35, 3500, 55000);
      const parsed = parseJSON(String(raw || ""));
      const rows = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];
      rows.forEach((row) => {
        if (!row) return;
        const id = String(row.id ?? "");
        const src = batch.find((b) => b.id === id);
        const content = src?.content || "";
        const picked = pickImagePrompts(row, content);
        const fb = synthesizeImagePrompts(content);
        const en = isWeakImagePrompt(picked.imagePrompt, content) ? fb.imagePrompt : picked.imagePrompt;
        const zh = isWeakImagePrompt(picked.imagePromptZh, content) ? fb.imagePromptZh : picked.imagePromptZh;
        if (id) outMap.set(id, { imagePrompt: en, imagePromptZh: zh });
      });
    } catch (e) {
      console.warn("rewriteCaptionPrompts batch failed:", e.message || e);
    }
    batch.forEach((b) => {
      if (!outMap.has(b.id)) outMap.set(b.id, synthesizeImagePrompts(b.content));
    });
  }

  return list.map((it) => ({ id: it.id, content: it.content, ...outMap.get(it.id) }));
}

/** 有 DeepSeek 时：给每条 scene 专改中英生图词（禁止照抄字幕） */
async function enrichBlocksImagePrompts(env, modelRef, blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return { rewritten: 0 };

  if (!modelRef) {
    fillInheritedImagePrompts(blocks);
    return { rewritten: 0 };
  }

  const jobs = [];
  const keyToIdx = new Map();
  blocks.forEach((b, i) => {
    if (!b || b.type !== "scene") return;
    const key = normalizePromptCmp(b.content) || "scene_" + i;
    if (!keyToIdx.has(key)) {
      keyToIdx.set(key, []);
      jobs.push({ id: String(jobs.length), content: b.content, key });
    }
    keyToIdx.get(key).push(i);
  });

  if (!jobs.length) {
    fillInheritedImagePrompts(blocks);
    return { rewritten: 0 };
  }

  const rewritten = await rewriteCaptionPrompts(
    jobs.map((j) => ({ id: j.id, content: j.content })),
    env,
    modelRef
  );
  rewritten.forEach((row) => {
    const job = jobs.find((j) => j.id === row.id);
    if (!job) return;
    (keyToIdx.get(job.key) || []).forEach((idx) => {
      blocks[idx].imagePrompt = row.imagePrompt;
      blocks[idx].imagePromptZh = row.imagePromptZh;
    });
  });

  fillInheritedImagePrompts(blocks);
  return { rewritten: jobs.length };
}

function fillInheritedImagePrompts(blocks) {
  let lastEn = "";
  let lastZh = "";
  for (const b of blocks) {
    if (!b || b.type === "choice") continue;
    if (b.type === "scene") {
      if (isWeakImagePrompt(b.imagePrompt, b.content) || isWeakImagePrompt(b.imagePromptZh, b.content)) {
        const imgs = synthesizeImagePrompts(b.content);
        if (isWeakImagePrompt(b.imagePrompt, b.content)) b.imagePrompt = imgs.imagePrompt;
        if (isWeakImagePrompt(b.imagePromptZh, b.content)) b.imagePromptZh = imgs.imagePromptZh;
      }
      lastEn = b.imagePrompt || lastEn;
      lastZh = b.imagePromptZh || lastZh;
      continue;
    }
    if (b.type === "dialogue") {
      if (!b.imagePrompt && lastEn) b.imagePrompt = lastEn;
      if (!b.imagePromptZh && lastZh) b.imagePromptZh = lastZh;
      if (b.content && isWeakImagePrompt(b.imagePrompt, b.content) && lastEn) b.imagePrompt = lastEn;
      if (b.content && isWeakImagePrompt(b.imagePromptZh, b.content) && lastZh) b.imagePromptZh = lastZh;
    }
  }
}

/**
 * 将模型块规范成 make 可用的 blocks
 * choice: content + choices[{label, jump, branch, branchEnd, endShot?}]
 * 长句拆成多镜；scene 带 imagePrompt（生图用，与字幕 content 分离）。
 */
function normalizeMakeBlocks(rawBlocks, opts = {}) {
  const out = [];
  const maxBlocks = Math.min(80, Math.max(2, Number(opts.maxBlocks) || 60));
  const sceneMax = Math.max(24, Math.min(72, Number(opts.sceneMax) || 42));
  const dialogueMax = Math.max(20, Math.min(56, Number(opts.dialogueMax) || 32));
  const ensureChoice = opts.ensureChoice !== false;
  const list = Array.isArray(rawBlocks) ? rawBlocks : [];

  for (const raw of list) {
    if (out.length >= maxBlocks) break;
    if (!raw || typeof raw !== "object") continue;
    let type = String(raw.type || "").toLowerCase();
    if (type !== "scene" && type !== "dialogue" && type !== "choice") {
      type = raw.speaker ? "dialogue" : "scene";
    }

    if (type === "scene") {
      const pieces = splitSpeech(raw.content || raw.text || "……", sceneMax);
      const imgs = pickImagePrompts(raw, pieces[0] || "");
      for (const content of pieces) {
        if (out.length >= maxBlocks) break;
        out.push({
          id: uid("b"),
          type: "scene",
          content,
          imagePrompt: imgs.imagePrompt,
          imagePromptZh: imgs.imagePromptZh,
        });
      }
      continue;
    }

    if (type === "dialogue") {
      const speaker = clampText(raw.speaker || "旁白", 24) || "旁白";
      const pieces = splitSpeech(raw.content || raw.text || "……", dialogueMax);
      const imgs = pickImagePrompts(raw, pieces[0] || "");
      const hasOwn =
        clampText(raw.imagePrompt || raw.visualPrompt || raw.bgPrompt || "", 700).length >= 16 ||
        clampText(raw.imagePromptZh || "", 400).length >= 8;
      for (const content of pieces) {
        if (out.length >= maxBlocks) break;
        const block = { id: uid("b"), type: "dialogue", speaker, content };
        if (hasOwn) {
          block.imagePrompt = imgs.imagePrompt;
          block.imagePromptZh = imgs.imagePromptZh;
        }
        out.push(block);
      }
      continue;
    }

    // choice：只保留一个，放在末尾附近处理时再保证
    const optsChoices = Array.isArray(raw.choices)
      ? raw.choices
      : Array.isArray(raw.options)
        ? raw.options
        : [];
    const choices = optsChoices.slice(0, 4).map((o) => {
      const label = clampText(o.label || o.text || "继续", 24) || "继续";
      const branchPieces = splitSpeech(o.branch || o.reply || o.result || "", dialogueMax);
      const endBad = !!(o.end || o.ending || o.jump === "end");
      const branch = branchPieces.slice(0, 3).map((content) => ({
        id: uid("br"),
        type: "dialogue",
        speaker: clampText(o.speaker || "你", 24),
        content,
      }));
      if (endBad) {
        const endPieces = splitSpeech(o.endText || o.ending || "故事在此告一段落。", sceneMax);
        const endContent = endPieces[0] || "故事在此告一段落。";
        const endImgs = pickImagePrompts(o, endContent);
        return {
          id: uid("c"),
          label,
          jump: "end",
          branchEnd: "shot",
          branch,
          endShot: {
            id: uid("end"),
            type: "scene",
            content: endContent,
            imagePrompt: endImgs.imagePrompt,
            imagePromptZh: endImgs.imagePromptZh,
          },
        };
      }
      return {
        id: uid("c"),
        label,
        jump: "next",
        branchEnd: "main",
        branch: branch.length
          ? branch
          : [{ id: uid("br"), type: "dialogue", speaker: "你", content: "（你选择了「" + label + "」）" }],
      };
    });
    while (choices.length < 2) {
      choices.push({
        id: uid("c"),
        label: choices.length ? "离开" : "继续",
        jump: choices.length ? "end" : "next",
        branchEnd: choices.length ? "shot" : "main",
        branch: [],
        endShot: choices.length
          ? {
              id: uid("end"),
              type: "scene",
              content: "……你转身离开。",
              ...synthesizeImagePrompts("character walking away, empty street at dusk"),
            }
          : undefined,
      });
    }
    out.push({
      id: uid("b"),
      type: "choice",
      content: clampText(raw.content || raw.prompt || "你要怎么做？", 36),
      choices,
    });
  }

  // 只保留最后一个 choice，其余 choice 降级为旁白提示，避免中途卡死
  const choiceIdxs = [];
  out.forEach((b, i) => {
    if (b.type === "choice") choiceIdxs.push(i);
  });
  if (choiceIdxs.length > 1) {
    for (let k = 0; k < choiceIdxs.length - 1; k++) {
      const i = choiceIdxs[k];
      const c = out[i];
      out[i] = {
        id: c.id || uid("b"),
        type: "dialogue",
        speaker: "旁白",
        content: clampText(c.content || "你犹豫了一下。", dialogueMax),
      };
    }
  }

  if (!out.length) {
    out.push({
      id: uid("b"),
      type: "scene",
      content: "故事从这里开始。",
      ...synthesizeImagePrompts("story beginning, quiet atmosphere"),
    });
    out.push({ id: uid("b"), type: "dialogue", speaker: "旁白", content: "（请在编辑器里继续完善）" });
  }

  if (ensureChoice && !out.some((b) => b.type === "choice")) {
    const insertAt = Math.min(Math.max(4, Math.floor(out.length * 0.55)), out.length);
    out.splice(insertAt, 0, {
      id: uid("b"),
      type: "choice",
      content: "你要怎么做？",
      choices: [
        {
          id: uid("c"),
          label: "继续前进",
          jump: "next",
          branchEnd: "main",
          branch: [{ id: uid("br"), type: "dialogue", speaker: "你", content: "……走吧。" }],
        },
        {
          id: uid("c"),
          label: "先停下观察",
          jump: "end",
          branchEnd: "shot",
          branch: [{ id: uid("br"), type: "dialogue", speaker: "你", content: "还是再看看。" }],
          endShot: {
            id: uid("end"),
            type: "scene",
            content: "你错过了时机。故事在此告一段落。",
            ...synthesizeImagePrompts("empty path, missed chance, melancholic light"),
          },
        },
      ],
    });
  }

  fillInheritedImagePrompts(out);
  return out.slice(0, maxBlocks);
}

function buildCastFromBlocks(blocks, castNames) {
  const cast = {};
  (castNames || []).forEach((name) => {
    cast[clampText(name, 24)] = { kind: "tts", voice: "zh-CN-XiaoxiaoNeural" };
  });
  blocks.forEach((b) => {
    if (b.type === "dialogue" && b.speaker) {
      const n = clampText(b.speaker, 24);
      if (n && !cast[n]) cast[n] = { kind: "tts", voice: "zh-CN-XiaoxiaoNeural" };
    }
  });
  if (!cast["旁白"]) cast["旁白"] = { kind: "tts", voice: "zh-CN-YunxiNeural" };
  if (!cast["你"]) cast["你"] = { kind: "tts", voice: "zh-CN-YunxiNeural" };
  return cast;
}

function wrapMakeWork(title, orientation, blocks, castNames, meta = {}) {
  return {
    work: {
      title: clampText(title || "互动改编", 60) || "互动改编",
      orientation: orientation === "portrait" ? "portrait" : "landscape",
      kind: "story",
      imgQuality: "standard",
      cast: buildCastFromBlocks(blocks, castNames),
      chapters: [{ id: uid("ch"), title: "第一章", blocks }],
    },
    ...meta,
  };
}

/** 从模型杂音里尽量抠出 {title, cast, blocks} */
function parseExtractPayload(raw) {
  let parsed = parseJSON(String(raw || ""));
  if (parsed && Array.isArray(parsed.blocks)) return parsed;
  if (Array.isArray(parsed)) return { title: "互动改编", cast: [], blocks: parsed };

  const text = String(raw || "");
  // 直接找 "blocks" 数组
  const key = text.search(/"blocks"\s*:/);
  if (key >= 0) {
    const after = text.slice(key);
    const arrStart = after.indexOf("[");
    if (arrStart >= 0) {
      const arr = extractBalancedArray(after.slice(arrStart));
      if (arr) {
        try {
          const blocks = JSON.parse(arr);
          if (Array.isArray(blocks) && blocks.length) {
            let title = "互动改编";
            const tm = text.match(/"title"\s*:\s*"([^"]{1,60})"/);
            if (tm) title = tm[1];
            return { title, cast: [], blocks };
          }
        } catch { /* ignore */ }
      }
    }
  }
  return null;
}

function extractBalancedArray(src) {
  if (!src || src[0] !== "[") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") { inStr = true; continue; }
    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      if (depth === 0) return src.slice(0, i + 1);
    }
  }
  // 截断：尝试补全
  let repaired = src;
  if (inStr) repaired += "\"";
  while (depth > 0) {
    repaired += "]";
    depth--;
  }
  // 去掉末尾残缺对象
  repaired = repaired.replace(/,\s*\{[^]*$/, "]");
  if (!repaired.endsWith("]")) repaired += "]";
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}

/**
 * 规则兜底：不依赖模型也能产出可玩镜头（短句多镜，尽量覆盖正文）
 */
function fallbackExtractFromText(text, titleHint) {
  const cleaned = String(text || "")
    .replace(/\r/g, "")
    .replace(/^【[^】]{1,40}】\s*/gm, "")
    .trim();
  const paras = cleaned
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 4)
    .slice(0, 80);

  const blocks = [];
  const dialogueRe = /^(?:([\u4e00-\u9fffA-Za-z·]{1,12})[：:]\s*)?[「\"“]([^」\"”]{1,120})[」\"”]/;
  const colonRe = /^([\u4e00-\u9fffA-Za-z·]{1,12})[：:](.+)$/;

  paras.forEach((p) => {
    if (blocks.length >= 70) return;
    const dm = p.match(dialogueRe);
    if (dm) {
      splitSpeech(dm[2], 32).forEach((content) => {
        if (blocks.length >= 70) return;
        blocks.push({
          type: "dialogue",
          speaker: clampText(dm[1] || "旁白", 24) || "旁白",
          content,
        });
      });
      return;
    }
    const cm = p.match(colonRe);
    if (cm && cm[2].trim().length >= 2) {
      splitSpeech(cm[2].trim(), 32).forEach((content) => {
        if (blocks.length >= 70) return;
        blocks.push({
          type: "dialogue",
          speaker: clampText(cm[1], 24),
          content,
        });
      });
      return;
    }
    splitSpeech(p, 42).forEach((content) => {
      if (blocks.length >= 70) return;
      blocks.push({ type: "scene", content, ...synthesizeImagePrompts(content) });
    });
  });

  if (blocks.length < 4) {
    splitSpeech(cleaned.replace(/\s+/g, " "), 42).slice(0, 40).forEach((content) => {
      blocks.push({ type: "scene", content, ...synthesizeImagePrompts(content) });
    });
  }

  const title =
    titleHint ||
    (cleaned.match(/【([^】]{1,20})】/) || [])[1] ||
    clampText(cleaned.slice(0, 12).replace(/\s/g, ""), 20) ||
    "互动改编";

  return {
    title,
    cast: [],
    blocks,
    fallback: true,
  };
}

function buildExtractSystem({ minShots, maxShots, withChoice, partHint }) {
  return (
    "你是视觉小说镜头提取器。按时间顺序把小说改成短镜头表。只输出 JSON 对象，不要 markdown，不要解释。" +
    "字段：title(string), cast(string[]), blocks(array)。" +
    "blocks 每项 type 只能是 scene|dialogue|choice。" +
    "scene:{type,content,imagePrompt,imagePromptZh} dialogue:{type,speaker,content} " +
    "choice:{type,content,choices:[{label,branch,end,endText?}]}。" +
    (partHint || "") +
    `要求：${minShots}~${maxShots} 个镜头；严格覆盖本段情节，不要跳过关键转折与对话；` +
    "每条 content 不超过 28 个汉字（给玩家看的字幕，不是生图词）；长段落拆成多条；" +
    "每个 scene 必须同时给两版生图词：" +
    "imagePrompt=英文文生图提示（40~110词），imagePromptZh=中文文生图提示（40~120字）；" +
    "两版都写画面（地点/地貌/天气/时间/光影/氛围/构图/画风），禁止照抄字幕原句，禁止出现文字/UI/水印/对白人名；" +
    "例：字幕「枯骨岭不是一个让人想进去的地方。」→ imagePromptZh「枯骨嶙峋的荒岭关隘，黄昏冷风，枯树稀疏，无人，阴森压抑，电影感宽景，暗黑奇幻视觉小说背景，无文字」" +
    "→ imagePrompt「ominous bone-strewn mountain ridge pass at dusk, cold wind, sparse dead trees, no people, gloomy dark fantasy VN background, cinematic wide shot, no text」；" +
    "地点未变时可复用相近提示词；" +
    (withChoice
      ? "本段末尾必须含 1 个 choice（2 个选项，其中一个 end:true）。"
      : "本段不要输出 choice，只输出 scene 与 dialogue。")
  );
}

async function llmExtractSegment(env, modelRef, excerpt, opts) {
  const {
    titleHint = "",
    withChoice = true,
    minShots = 10,
    maxShots = 22,
    partHint = "",
    maxTokens = 3500,
  } = opts || {};

  const messages = [
    {
      role: "system",
      content: buildExtractSystem({ minShots, maxShots, withChoice, partHint }),
    },
    {
      role: "user",
      content:
        (titleHint ? `标题建议：${titleHint}\n` : "") +
        "正文：\n" +
        excerpt +
        "\n\n只输出 JSON。",
    },
  ];

  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await chatCompletions(env, messages, modelRef, 0.15, maxTokens, 60000);
    const parsed = parseExtractPayload(raw);
    if (!parsed || !Array.isArray(parsed.blocks) || !parsed.blocks.length) {
      lastErr = "模型未返回镜头 JSON";
      messages.push({ role: "assistant", content: String(raw || "").slice(0, 400) });
      messages.push({
        role: "user",
        content:
          "无效。请重新输出完整 JSON（含非空 blocks）。每条台词≤28字，按情节顺序多拆镜头。",
      });
      continue;
    }
    return { parsed, attempts: attempt };
  }
  throw new Error(lastErr || "分段提取失败");
}

function buildCompressSystem({ minShots, maxShots, withChoice }) {
  return (
    "你是视觉小说压缩编剧。用户给出一段「选中的小说原文」，请在保留核心意思的前提下压缩成少量短镜头。" +
    "硬性禁止：逐句切碎、复述每一句原文、把长段拆成十几条碎镜头。" +
    "只输出 JSON：{\"title\":\"...\",\"cast\":[\"角色名\"],\"blocks\":[...]}。" +
    "blocks 仅 scene|dialogue|choice。" +
    "scene:{type,content,imagePrompt,imagePromptZh} dialogue:{type,speaker,content} " +
    "choice:{type,content,choices:[{label,branch,end,endText?}] }。" +
    `镜头数量 ${minShots}~${maxShots}（宜少不宜多）；` +
    "content 是压缩后的旁白或对白，≤28 个汉字，是改写不是摘抄；对白保留关键说话人与语气；" +
    "旁白只交代必要场景/动作/情绪，删掉铺陈与重复；" +
    "每个 scene 必须带 imagePrompt（英文画面词）与 imagePromptZh（中文画面词），禁止照抄 content；" +
    (withChoice
      ? "末尾可加 1 个 choice（2 选项，其中一个 end:true）；若选段没有抉择点也可不加 choice。"
      : "不要输出 choice。")
  );
}

function compressShotBudget(len) {
  if (len < 180) return { minShots: 2, maxShots: 4 };
  if (len < 500) return { minShots: 3, maxShots: 6 };
  if (len < 1200) return { minShots: 4, maxShots: 8 };
  return { minShots: 5, maxShots: 10 };
}

async function llmCompressPassage(env, modelRef, excerpt, opts) {
  const {
    titleHint = "",
    withChoice = true,
    minShots = 3,
    maxShots = 8,
    maxTokens = 2800,
  } = opts || {};

  const messages = [
    {
      role: "system",
      content: buildCompressSystem({ minShots, maxShots, withChoice }),
    },
    {
      role: "user",
      content:
        (titleHint ? `标题建议：${titleHint}\n` : "") +
        "请压缩下面这段选中原文（保留意思，改成短旁白/对白镜头）：\n\n" +
        excerpt +
        "\n\n只输出 JSON。",
    },
  ];

  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await chatCompletions(env, messages, modelRef, 0.25, maxTokens, 60000);
    const parsed = parseExtractPayload(raw);
    if (!parsed || !Array.isArray(parsed.blocks) || !parsed.blocks.length) {
      lastErr = "模型未返回镜头 JSON";
      messages.push({ role: "assistant", content: String(raw || "").slice(0, 400) });
      messages.push({
        role: "user",
        content:
          "无效。请重新输出 JSON。记住：少量镜头、压缩改写、每条 content≤28 字，不要逐句切碎。",
      });
      continue;
    }
    return { parsed, attempts: attempt };
  }
  throw new Error(lastErr || "压缩提取失败");
}

/** 选段压缩兜底：少镜头，不整章切碎 */
function fallbackCompressFromText(text, titleHint) {
  const cleaned = String(text || "").replace(/\r/g, "").trim();
  const chunks = cleaned
    .split(/\n{2,}|(?<=[。！？])/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 8)
    .slice(0, 6);

  const blocks = [];
  const dialogueRe = /^(?:([\u4e00-\u9fffA-Za-z·]{1,12})[：:]\s*)?[「\"“]([^」\"”]{1,80})[」\"”]/;
  chunks.forEach((p) => {
    if (blocks.length >= 8) return;
    const dm = p.match(dialogueRe);
    if (dm) {
      blocks.push({
        type: "dialogue",
        speaker: clampText(dm[1] || "旁白", 24) || "旁白",
        content: clampText(dm[2], 28),
      });
      return;
    }
    // 压缩感：取关键语义短句，不整段照搬
    let short = p.replace(/\s+/g, "");
    if (short.length > 28) {
      const cut = short.slice(0, 28);
      const punct = Math.max(cut.lastIndexOf("，"), cut.lastIndexOf("。"), cut.lastIndexOf("；"));
      short = punct >= 12 ? cut.slice(0, punct) : cut;
    }
    blocks.push({ type: "scene", content: short || "……", ...synthesizeImagePrompts(short) });
  });

  if (blocks.length < 2) {
    const one = clampText(cleaned.replace(/\s+/g, ""), 28) || "故事继续。";
    blocks.push({ type: "scene", content: one, ...synthesizeImagePrompts(one) });
  }

  return {
    title: titleHint || clampText(cleaned.slice(0, 12).replace(/\s/g, ""), 20) || "互动改编",
    cast: [],
    blocks,
    fallback: true,
  };
}

/** POST /api/hub/novel-extract — 默认 compress：选段压缩成短旁白/对白 */
export async function extractNovelToMake(body, env) {
  const mode = body.mode === "cover" ? "cover" : "compress";
  const rawText = String(body.text || "");
  const text =
    mode === "compress"
      ? clampText(rawText, 2500)
      : clampText(rawText, 14000);

  if (mode === "compress") {
    if (text.length < 40) throw new Error("请先选中或粘贴一段要改编的文字（至少约 40 字）。");
  } else if (text.length < 80) {
    throw new Error("正文太短，请粘贴至少一小段完整情节。");
  }

  const titleHint = clampText(body.title || "", 60);
  const orientation = body.orientation === "portrait" ? "portrait" : "landscape";
  const withChoice = body.withChoice !== false && body.withChoice !== 0;
  const modelRef = resolveNovelModelRef(env);
  const provider = modelRef ? "deepseek" : "workers-ai";

  if (mode === "compress") {
    const budget = compressShotBudget(text.length);
    try {
      const { parsed, attempts } = await llmCompressPassage(env, modelRef, text, {
        titleHint,
        withChoice,
        ...budget,
        maxTokens: modelRef ? 3200 : 2200,
      });
      let rawBlocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
      if (!withChoice) rawBlocks = rawBlocks.filter((b) => String(b?.type || "").toLowerCase() !== "choice");
      const blocks = normalizeMakeBlocks(rawBlocks, {
        maxBlocks: budget.maxShots + (withChoice ? 2 : 0),
        sceneMax: 32,
        dialogueMax: 28,
        ensureChoice: withChoice,
      });
      const enrich = await enrichBlocksImagePrompts(env, modelRef, blocks);
      return wrapMakeWork(
        parsed.title || titleHint || "互动改编",
        orientation,
        blocks,
        parsed.cast,
        {
          attempts,
          source: "llm",
          provider,
          mode: "compress",
          selectedChars: text.length,
          promptsRewritten: enrich.rewritten,
        }
      );
    } catch (e) {
      console.warn("NOVEL COMPRESS fallback:", e.message || e);
      const fb = fallbackCompressFromText(text, titleHint);
      const blocks = normalizeMakeBlocks(fb.blocks, { maxBlocks: 12, sceneMax: 32, dialogueMax: 28 });
      let promptsRewritten = 0;
      try {
        const enrich = await enrichBlocksImagePrompts(env, modelRef, blocks);
        promptsRewritten = enrich.rewritten;
      } catch (_) { /* ignore */ }
      return wrapMakeWork(fb.title, orientation, blocks, fb.cast, {
        attempts: 0,
        source: "fallback",
        provider,
        mode: "compress",
        promptsRewritten,
        warning: "AI 压缩不稳定，已用简规则压成短镜头，可在编辑器里改。",
      });
    }
  }

  // mode=cover：旧「尽量覆盖全文」路径（一般不用）
  try {
    if (modelRef) {
      const chunks = packTextChunks(text, 2000, 5);
      const merged = [];
      let title = titleHint || "互动改编";
      let cast = [];
      let attempts = 0;

      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        const { parsed, attempts: a } = await llmExtractSegment(env, modelRef, chunks[i], {
          titleHint: i === 0 ? titleHint : "",
          withChoice: isLast,
          minShots: chunks.length === 1 ? 14 : 10,
          maxShots: chunks.length === 1 ? 36 : 20,
          partHint: `这是第${i + 1}/${chunks.length}段正文；`,
          maxTokens: 5200,
        });
        attempts += a;
        if (parsed.title && i === 0) title = clampText(parsed.title, 60) || title;
        if (Array.isArray(parsed.cast) && parsed.cast.length) cast = parsed.cast;
        const partBlocks = (parsed.blocks || []).filter((b) => {
          if (!b) return false;
          if (!isLast && String(b.type).toLowerCase() === "choice") return false;
          return true;
        });
        merged.push(...partBlocks);
      }

      const blocks = normalizeMakeBlocks(merged, { maxBlocks: 72, sceneMax: 42, dialogueMax: 32 });
      const enrich = await enrichBlocksImagePrompts(env, modelRef, blocks);
      return wrapMakeWork(title, orientation, blocks, cast, {
        attempts,
        source: "llm",
        provider,
        mode: "cover",
        chunks: chunks.length,
        coveredChars: chunks.reduce((n, c) => n + c.length, 0),
        promptsRewritten: enrich.rewritten,
      });
    }

    const excerpt =
      text.length > 3200
        ? text.slice(0, 2800) + "\n……（后文已省略，请根据以上情节改编）"
        : text;
    const { parsed, attempts } = await llmExtractSegment(env, null, excerpt, {
      titleHint,
      withChoice: true,
      minShots: 10,
      maxShots: 18,
      maxTokens: 2200,
    });
    const blocks = normalizeMakeBlocks(parsed.blocks, { maxBlocks: 36, sceneMax: 42, dialogueMax: 32 });
    await enrichBlocksImagePrompts(env, null, blocks);
    return wrapMakeWork(
      parsed.title || titleHint || "互动改编",
      orientation,
      blocks,
      parsed.cast,
      { attempts, source: "llm", provider, mode: "cover" }
    );
  } catch (e) {
    console.warn("NOVEL EXTRACT fallback:", e.message || e);
    const fb = fallbackExtractFromText(text, titleHint);
    const blocks = normalizeMakeBlocks(fb.blocks, { maxBlocks: 72, sceneMax: 42, dialogueMax: 32 });
    let promptsRewritten = 0;
    try {
      const enrich = await enrichBlocksImagePrompts(env, modelRef, blocks);
      promptsRewritten = enrich.rewritten;
    } catch (_) { /* ignore */ }
    return wrapMakeWork(fb.title, orientation, blocks, fb.cast, {
      attempts: 0,
      source: "fallback",
      provider,
      mode: "cover",
      promptsRewritten,
      warning: "AI 提取不稳定，已用规则切成短镜头；生图词已尽量改写，可在编辑器里再改。",
    });
  }
}
