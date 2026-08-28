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
 */
function normalizeMakeBlocks(rawBlocks) {
  const out = [];
  const list = Array.isArray(rawBlocks) ? rawBlocks : [];
  for (const raw of list.slice(0, 24)) {
    if (!raw || typeof raw !== "object") continue;
    let type = String(raw.type || "").toLowerCase();
    if (type !== "scene" && type !== "dialogue" && type !== "choice") {
      type = raw.speaker ? "dialogue" : "scene";
    }
    const id = uid("b");
    if (type === "scene") {
      out.push({ id, type: "scene", content: clampText(raw.content || raw.text || "……", 200) });
      continue;
    }
    if (type === "dialogue") {
      out.push({
        id,
        type: "dialogue",
        speaker: clampText(raw.speaker || "旁白", 24) || "旁白",
        content: clampText(raw.content || raw.text || "……", 160),
      });
      continue;
    }
    const opts = Array.isArray(raw.choices)
      ? raw.choices
      : Array.isArray(raw.options)
        ? raw.options
        : [];
    const choices = opts.slice(0, 4).map((o) => {
      const label = clampText(o.label || o.text || "继续", 40) || "继续";
      const branchText = clampText(o.branch || o.reply || o.result || "", 160);
      const endBad = !!(o.end || o.ending || o.jump === "end");
      const branch = branchText
        ? [{ id: uid("br"), type: "dialogue", speaker: clampText(o.speaker || "你", 24), content: branchText }]
        : [];
      if (endBad) {
        return {
          id: uid("c"),
          label,
          jump: "end",
          branchEnd: "shot",
          branch,
          endShot: {
            id: uid("end"),
            type: "scene",
            content: clampText(o.endText || o.ending || "故事在此告一段落。", 120),
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
    out.push({
      id,
      type: "choice",
      content: clampText(raw.content || raw.prompt || "你要怎么做？", 80),
      choices,
    });
  }
  if (!out.length) {
    out.push({ id: uid("b"), type: "scene", content: "故事从这里开始。" });
    out.push({ id: uid("b"), type: "dialogue", speaker: "旁白", content: "（请在编辑器里继续完善）" });
  }
  // 保证至少有一个 choice，方便互动感
  if (!out.some((b) => b.type === "choice")) {
    out.splice(Math.min(3, out.length), 0, {
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
  return out;
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
 * 规则兜底：不依赖模型也能产出可玩镜头
 * - 引号对白 → dialogue
 * - 其余段落 → scene
 * - 中段插入 choice
 */
function fallbackExtractFromText(text, titleHint) {
  const cleaned = String(text || "")
    .replace(/\r/g, "")
    .replace(/^【[^】]{1,40}】\s*/gm, "")
    .trim();
  const paras = cleaned
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 8)
    .slice(0, 20);

  const blocks = [];
  const dialogueRe = /^(?:([\u4e00-\u9fffA-Za-z·]{1,12})[：:]\s*)?[「\"“]([^」\"”]{2,80})[」\"”]/;
  const colonRe = /^([\u4e00-\u9fffA-Za-z·]{1,12})[：:](.+)$/;

  paras.forEach((p) => {
    const dm = p.match(dialogueRe);
    if (dm) {
      blocks.push({
        type: "dialogue",
        speaker: clampText(dm[1] || "旁白", 24) || "旁白",
        content: clampText(dm[2], 120),
      });
      return;
    }
    const cm = p.match(colonRe);
    if (cm && cm[2].trim().length >= 4 && cm[2].trim().length <= 80) {
      blocks.push({
        type: "dialogue",
        speaker: clampText(cm[1], 24),
        content: clampText(cm[2].trim(), 120),
      });
      return;
    }
    // 长段拆短
    const chunk = clampText(p, 90);
    blocks.push({ type: "scene", content: chunk });
  });

  if (blocks.length < 3) {
    const plain = clampText(cleaned.replace(/\s+/g, " "), 600);
    for (let i = 0; i < plain.length; i += 70) {
      blocks.push({ type: "scene", content: plain.slice(i, i + 70) });
      if (blocks.length >= 8) break;
    }
  }

  const mid = Math.min(Math.max(2, Math.floor(blocks.length / 2)), blocks.length);
  blocks.splice(mid, 0, {
    type: "choice",
    content: "此刻你要怎么做？",
    choices: [
      { label: "继续往下走", branch: "你深吸一口气，决定继续。", end: false },
      { label: "先离开这里", branch: "你转身离开。", end: true, endText: "你离开了这里。故事暂时落下帷幕。" },
    ],
  });

  const title =
    titleHint ||
    (cleaned.match(/【([^】]{1,20})】/) || [])[1] ||
    clampText(cleaned.slice(0, 12).replace(/\s/g, ""), 20) ||
    "互动改编";

  return {
    title,
    cast: [],
    blocks: blocks.slice(0, 16),
    fallback: true,
  };
}

/** POST /api/hub/novel-extract */
export async function extractNovelToMake(body, env) {
  const text = clampText(body.text || "", 14000);
  if (text.length < 80) throw new Error("正文太短，请粘贴至少一小段完整情节。");
  const titleHint = clampText(body.title || "", 60);
  const orientation = body.orientation === "portrait" ? "portrait" : "landscape";
  const modelRef = resolveNovelModelRef(env);
  const provider = modelRef ? "deepseek" : "workers-ai";
  // DeepSeek 可喂更长；Workers AI 对超长上下文 + 大 JSON 不稳定
  const maxExcerpt = modelRef ? 9000 : 3200;
  const keep = modelRef ? 8500 : 2800;
  const excerpt = text.length > maxExcerpt
    ? text.slice(0, keep) + "\n……（后文已省略，请根据以上情节改编）"
    : text;

  const system =
    "你是视觉小说镜头提取器。把小说改成短镜头表。只输出一行 JSON 对象，不要代码块，不要解释。" +
    "字段：title(string), cast(string[]), blocks(array)。" +
    "blocks 每项 type 只能是 scene|dialogue|choice。" +
    "scene:{type,content} dialogue:{type,speaker,content} " +
    "choice:{type,content,choices:[{label,branch,end,endText?}]}。" +
    "只要 6 到 10 个镜头，必须含 1 个 choice（2 个选项，其中一个 end:true）。" +
    "content/台词尽量短（不超过 40 字）。";

  const messages = [
    { role: "system", content: system },
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
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await chatCompletions(env, messages, modelRef, 0.2, modelRef ? 2800 : 1800, 45000);
      const parsed = parseExtractPayload(raw);
      if (!parsed || !Array.isArray(parsed.blocks) || !parsed.blocks.length) {
        lastErr = "模型未返回镜头 JSON";
        messages.push({
          role: "assistant",
          content: String(raw || "").slice(0, 500),
        });
        messages.push({
          role: "user",
          content:
            "无效。请重新输出完整 JSON，以 { 开头以 } 结尾，且包含非空 blocks 数组。示例：" +
            '{"title":"落霞镇","cast":["吴银"],"blocks":[{"type":"scene","content":"落霞镇雨巷"},{"type":"dialogue","speaker":"掌柜","content":"银子呢？"},{"type":"choice","content":"你怎么回应？","choices":[{"label":"先答应","branch":"好，我今晚就还。","end":false},{"label":"转身就走","branch":"……","end":true,"endText":"你没还上债。"}]}]}',
        });
        continue;
      }
      const blocks = normalizeMakeBlocks(parsed.blocks);
      return wrapMakeWork(
        parsed.title || titleHint || "互动改编",
        orientation,
        blocks,
        parsed.cast,
        { attempts: attempt, source: "llm", provider }
      );
    } catch (e) {
      lastErr = e.message || String(e);
      console.error("NOVEL EXTRACT attempt", attempt, e);
    }
  }

  // 兜底：规则切分，保证用户总能打开可玩草稿
  console.warn("NOVEL EXTRACT fallback:", lastErr);
  const fb = fallbackExtractFromText(text, titleHint);
  const blocks = normalizeMakeBlocks(fb.blocks);
  return wrapMakeWork(fb.title, orientation, blocks, fb.cast, {
    attempts: 3,
    source: "fallback",
    provider,
    warning: "AI 提取不稳定，已用规则切成镜头，可在编辑器里改。",
  });
}
