/**
 * HYOOL 中枢 · 规划层：用户一句话 → Project Blueprint
 *
 * 策略（规避 LLM 自由发挥漂移）：
 *   1. 单轮一次 LLM 调用产出完整 Blueprint JSON（meta/cast/chapters/logic）
 *   2. normalizeBlueprint 容错补齐默认值
 *   3. validateBlueprint 结构校验；失败则把具体错误反馈给 LLM 修正重试（最多 maxAttempts 次）
 *
 * 分阶段生成（长剧本先出大纲、逐章展开）为后续优化项，接口已预留：
 * planProject(userRequest, env, { multiStep: true })。
 */
import { chatCompletions } from "../ai/gateway.js";
import {
    STYLE_PRESETS,
    normalizeBlueprint,
    validateBlueprint,
    voiceCatalogForPrompt
} from "./blueprint.js";

/** 供提示词的紧凑 Blueprint 示例（不含资产：素材由代码派生） */
const BLUEPRINT_HINT = {
    schema: "hyool.brain.v1",
    meta: {
        title: "水墨·夜雨听剑",
        concept: "一句话概念：江南雨夜的少年剑客",
        logline: "青灯古寺，一柄旧剑，一场未了的江湖约",
        style: "shuimo",
        orientation: "landscape"
    },
    cast: [
        {
            id: "cast_yun",
            name: "云眠",
            gender: "female",
            age: "young",
            role: "女主角·剑侍",
            appearance: "一袭青衫，墨色长发，眉间一点朱砂，执伞而立",
            personality: "清冷寡言，外冷内热",
            voiceId: "zh-CN-XiaoxiaoNeural"
        }
    ],
    chapters: [
        {
            id: "ch_1",
            title: "第一章 夜雨",
            blocks: [
                { id: "b_1", type: "scene", content: "烟雨迷蒙的江南古寺，檐角风铃在雨中轻响" },
                { id: "b_2", type: "dialogue", speaker: "cast_yun", content: "雨快来了，你还要站在檐下看么？" },
                { id: "b_3", type: "choice", prompt: "面对云眠的询问，你如何回应？", options: [
                    { label: "接伞随她入寺", target: "b_4", require: [], effect: [{ var: "trust", op: "+", val: 2 }] },
                    { label: "反问她的来意", target: "b_5", require: [], effect: [] }
                ] },
                { id: "b_4", type: "dialogue", speaker: "cast_yun", content: "很好，随我来，寺后有你要找的答案。" },
                { id: "b_5", type: "dialogue", speaker: "cast_yun", content: "我的来意？等你淋够这场雨，自然明白。" }
            ]
        }
    ],
    logic: { state: { trust: 0 }, rules: {} }
};

export async function planProject(userRequest, env, opts = {}) {
    const {
        maxAttempts = 3,
        temperature = 0.7,
        maxTokens = 3200,
        model = null,
        multiStep = false
    } = opts;

    if (multiStep) {
        throw new Error("multiStep 分阶段生成尚未实现（Phase 1 优化项）。");
    }

    const attempts = [];
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const messages = buildMessages(userRequest, lastError);
        const content = await chatCompletions(env, messages, model, temperature, maxTokens, 60000);
        const parsed = parseJSON(String(content || ""));

        if (!parsed) {
            lastError = "输出不是合法 JSON（可能被 markdown 代码块包裹或字段损坏）。请严格只输出 JSON。";
            attempts.push({ attempt, status: "parse-failed", preview: String(content || "").slice(0, 160) });
            continue;
        }

        const bp = normalizeBlueprint(parsed);
        const errors = validateBlueprint(bp);

        if (!errors.length) {
            attempts.push({ attempt, status: "ok" });
            return { blueprint: bp, attemptsUsed: attempt, attempts };
        }

        lastError =
            "蓝图校验失败：" +
            errors.slice(0, 6).map((e) => `${e.path}：${e.msg}`).join("；");
        attempts.push({ attempt, status: "invalid", errors: errors.slice(0, 10) });
    }

    const err = new Error("规划失败：" + (lastError || "多次尝试后仍无法产出合格企划书。"));
    err.attempts = attempts;
    throw err;
}

function buildMessages(userRequest, feedback) {
    const system = [
        "你是「HYOOL 中枢」的主编剧。根据用户的一句话需求，设计一部可自动制作成水墨风互动游戏（文字视觉小说）的完整企划书（Blueprint）。",
        "产出必须是严格 JSON，不要 markdown 代码块，不要任何解释，只输出 JSON 本身。",
        "Blueprint 结构（注意：不要输出 assets 字段，素材任务由系统自动派生）：",
        JSON.stringify(BLUEPRINT_HINT, null, 2),
        "约束：",
        "- schema 恒为 hyool.brain.v1；style 必须是 " + Object.keys(STYLE_PRESETS).join("/"),
        "- 章节 2~3 章，每章 6~12 个积木；积木与角色 id 全局唯一，用小写字母数字下划线，符合 ^[a-z][a-z0-9_]{1,31}$",
        "- scene 积木：content 是「画面与氛围描述」，既是背景图提示词也是场景文字，要有画面感（20~60 字）",
        "- dialogue 积木：speaker 必须是 cast 中的角色 id，content 是 20~60 字台词，符合角色性格",
        "- choice 积木：options 至少 2 个；target 指向本章内后续积木的 id；require/effect 操作的状态变量必须先声明在 logic.state",
        "- 角色卡：appearance 写清发型、衣着、气质，供生成立绘；voiceId 必须从音色表按性别挑选",
        "- 内容安全红线：不生成色情、血腥暴力、政治敏感、歧视性内容",
        "- 角色音色表：" + voiceCatalogForPrompt()
    ].join("\n");

    const user = feedback
        ? `用户需求：${userRequest}\n\n上次输出存在问题：${feedback}\n\n请修正后重新输出完整 Blueprint JSON。`
        : `用户需求：${userRequest}\n\n请输出完整 Blueprint JSON。`;

    return [
        { role: "system", content: system },
        { role: "user", content: user }
    ];
}

/** 从 LLM 文本中稳健提取 JSON（支持去 markdown 代码块 / 首尾杂物） */
export function parseJSON(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return null;
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fenced ? fenced[1] : trimmed;
    try {
        return JSON.parse(body);
    } catch {
        /* fallthrough */
    }
    try {
        const start = body.indexOf("{");
        const end = body.lastIndexOf("}");
        if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
    } catch {
        /* fallthrough */
    }
    return null;
}
