/**
 * 小说生成 + 剧情提取 → make 镜头 JSON
 * LLM 只产文本；分支结构由提取结果给出，运行时仍不由 AI 选路。
 */
import { chatCompletions } from "../ai/gateway.js";
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

  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await chatCompletions(env, messages, null, 0.75, 4200, 55000);
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

/** POST /api/hub/novel-extract */
export async function extractNovelToMake(body, env) {
  const text = clampText(body.text || "", 14000);
  if (text.length < 80) throw new Error("正文太短，请粘贴至少一小段完整情节。");
  const titleHint = clampText(body.title || "", 60);
  const orientation = body.orientation === "portrait" ? "portrait" : "landscape";

  const messages = [
    {
      role: "system",
      content:
        "你是 HYOOL 的剧情提取器。把小说正文改编成互动视觉小说镜头表。" +
        "只输出严格 JSON，不要 markdown。" +
        "结构：{\"title\":\"作品名\",\"cast\":[\"角色A\",\"角色B\"],\"blocks\":[" +
        "{\"type\":\"scene\",\"content\":\"画面氛围描述\"}," +
        "{\"type\":\"dialogue\",\"speaker\":\"角色名\",\"content\":\"台词\"}," +
        "{\"type\":\"choice\",\"content\":\"抉择提示\",\"choices\":[" +
        "{\"label\":\"选项A\",\"branch\":\"选后一句对白\",\"end\":false}," +
        "{\"label\":\"选项B\",\"branch\":\"选后一句\",\"end\":true,\"endText\":\"短结局\"}" +
        "]}]}" +
        "约束：8~16 个镜头；scene/dialogue/choice 混用；至少 1 个 choice 且含 2 选项；" +
        "一个选项可 end:true 作为坏结局；台词口语化 15~50 字；scene 要有画面感；" +
        "保留原作核心冲突；不新增色情暴力政治敏感内容。",
    },
    {
      role: "user",
      content:
        (titleHint ? `建议标题：${titleHint}\n` : "") +
        "小说正文：\n" +
        text.slice(0, 10000) +
        "\n\n请输出镜头 JSON。",
    },
  ];

  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await chatCompletions(env, messages, null, 0.45, 3800, 55000);
    const parsed = parseJSON(String(raw || ""));
    if (!parsed || !Array.isArray(parsed.blocks)) {
      lastErr = "模型未返回镜头 JSON";
      messages.push({ role: "user", content: "请严格输出含 blocks 数组的 JSON。" });
      continue;
    }
    const blocks = normalizeMakeBlocks(parsed.blocks);
    const title = clampText(parsed.title || titleHint || "互动改编", 60) || "互动改编";
    const castNames = Array.isArray(parsed.cast)
      ? parsed.cast.map((n) => clampText(n, 24)).filter(Boolean).slice(0, 12)
      : [];
    const cast = {};
    castNames.forEach((name) => {
      cast[name] = { kind: "tts", voice: "zh-CN-XiaoxiaoNeural" };
    });
    if (!cast["旁白"]) cast["旁白"] = { kind: "tts", voice: "zh-CN-YunxiNeural" };
    if (!cast["你"]) cast["你"] = { kind: "tts", voice: "zh-CN-YunxiNeural" };

    return {
      work: {
        title,
        orientation,
        kind: "story",
        imgQuality: "standard",
        cast,
        chapters: [
          {
            id: uid("ch"),
            title: "第一章",
            blocks,
          },
        ],
      },
      attempts: attempt,
    };
  }
  throw new Error(lastErr || "剧情提取失败");
}
