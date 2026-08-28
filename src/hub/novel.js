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

/**
 * 将模型块规范成 make 可用的 blocks
 * choice: content + choices[{label, jump, branch, branchEnd, endShot?}]
 * 长句拆成多镜，单镜控制在字幕可读长度，避免占满屏 / 半截截断。
 */
function normalizeMakeBlocks(rawBlocks, opts = {}) {
  const out = [];
  const maxBlocks = Math.max(8, Math.min(80, Number(opts.maxBlocks) || 60));
  const sceneMax = Math.max(24, Math.min(72, Number(opts.sceneMax) || 42));
  const dialogueMax = Math.max(20, Math.min(56, Number(opts.dialogueMax) || 32));
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
      for (const content of pieces) {
        if (out.length >= maxBlocks) break;
        out.push({ id: uid("b"), type: "scene", content });
      }
      continue;
    }

    if (type === "dialogue") {
      const speaker = clampText(raw.speaker || "旁白", 24) || "旁白";
      const pieces = splitSpeech(raw.content || raw.text || "……", dialogueMax);
      for (const content of pieces) {
        if (out.length >= maxBlocks) break;
        out.push({ id: uid("b"), type: "dialogue", speaker, content });
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
        return {
          id: uid("c"),
          label,
          jump: "end",
          branchEnd: "shot",
          branch,
          endShot: {
            id: uid("end"),
            type: "scene",
            content: endPieces[0] || "故事在此告一段落。",
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
          ? { id: uid("end"), type: "scene", content: "……你转身离开。" }
          : undefined,
      });
    }
    // 去掉已有 choice，稍后只在合适位置插一个
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
    out.push({ id: uid("b"), type: "scene", content: "故事从这里开始。" });
    out.push({ id: uid("b"), type: "dialogue", speaker: "旁白", content: "（请在编辑器里继续完善）" });
  }

  if (!out.some((b) => b.type === "choice")) {
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
          endShot: { id: uid("end"), type: "scene", content: "你错过了时机。故事在此告一段落。" },
        },
      ],
    });
  }

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
      blocks.push({ type: "scene", content });
    });
  });

  if (blocks.length < 4) {
    splitSpeech(cleaned.replace(/\s+/g, " "), 42).slice(0, 40).forEach((content) => {
      blocks.push({ type: "scene", content });
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
    "scene:{type,content} dialogue:{type,speaker,content} " +
    "choice:{type,content,choices:[{label,branch,end,endText?}]}。" +
    (partHint || "") +
    `要求：${minShots}~${maxShots} 个镜头；严格覆盖本段情节，不要跳过关键转折与对话；` +
    "每条 content 不超过 28 个汉字；长段落必须拆成多条 scene/dialogue；" +
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

/** POST /api/hub/novel-extract */
export async function extractNovelToMake(body, env) {
  const text = clampText(body.text || "", 14000);
  if (text.length < 80) throw new Error("正文太短，请粘贴至少一小段完整情节。");
  const titleHint = clampText(body.title || "", 60);
  const orientation = body.orientation === "portrait" ? "portrait" : "landscape";
  const modelRef = resolveNovelModelRef(env);
  const provider = modelRef ? "deepseek" : "workers-ai";

  try {
    // DeepSeek：分段提取，覆盖整章；Workers AI：单段短摘
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
          maxTokens: 4500,
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
      return wrapMakeWork(title, orientation, blocks, cast, {
        attempts,
        source: "llm",
        provider,
        chunks: chunks.length,
        coveredChars: chunks.reduce((n, c) => n + c.length, 0),
      });
    }

    // Workers AI：短摘 + 少镜头
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
    return wrapMakeWork(
      parsed.title || titleHint || "互动改编",
      orientation,
      blocks,
      parsed.cast,
      { attempts, source: "llm", provider }
    );
  } catch (e) {
    console.warn("NOVEL EXTRACT fallback:", e.message || e);
    const fb = fallbackExtractFromText(text, titleHint);
    const blocks = normalizeMakeBlocks(fb.blocks, { maxBlocks: 72, sceneMax: 42, dialogueMax: 32 });
    return wrapMakeWork(fb.title, orientation, blocks, fb.cast, {
      attempts: 0,
      source: "fallback",
      provider,
      warning: "AI 提取不稳定，已用规则切成短镜头，可在编辑器里改。",
    });
  }
}
