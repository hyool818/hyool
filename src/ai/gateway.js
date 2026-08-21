/**
 * HYOOL AI Gateway
 *
 * LLM: Cloudflare Workers AI — @cf/meta/llama-3.3-70b-instruct-fp8-fast
 * Requires [ai] binding in wrangler.toml (already configured).
 * No API key needed.
 *
 * Env overrides (optional):
 *   AI_CHAT_MODEL    override chat model id
 *   AI_CREATE_MODEL  override character generation model id
 */

import {
    resolveChatTarget,
    resolveModel,
    isRegistryId,
    DEFAULT_MODEL_ID
} from "./models.js";

const CHARACTER_SCHEMA = {
    name: "string",
    appearance: "string",
    personality: "string",
    background: "string",
    speech_style: "string",
    world_name: "string",
    world_description: "string",
    story_hook: "string"
};

export async function generateCharacterFromIdea(idea, env) {
    if (!env.AI) {
        return mockGenerateCharacter(idea);
    }

    return callCreateModel(idea, env);
}

export async function chatWithCharacter(
    { character, memories, recentMessages, userMessage, intimacy = 0, chatConfig = {}, userName = "TA" },
    env
) {
    if (!env.AI) {
        return mockChat(character, memories, userMessage);
    }

    return callChatModel(
        { character, memories, recentMessages, userMessage, intimacy, chatConfig, userName },
        env
    );
}

export async function generateCharacterImage(character, env, style, params) {
    style = style || "realistic";
    params = params || {};
    const prompt = buildImagePrompt(character, style, params);
    const seed = Math.floor(Math.random() * 1000000);
    const encoded = encodeURIComponent(prompt);
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=768&height=1024&nologo=true&model=flux&seed=${seed}`;

    return {
        url,
        provider: "pollinations",
        asset_meta: { prompt: prompt.slice(0, 200), style, seed }
    };
}

export async function regenerateCharacterImage(character, env, style, params) {
    return generateCharacterImage(character, env, style, params);
}

function buildImagePrompt(character, style, params) {
    const styleMap = {
        realistic: "realistic portrait, photorealistic, detailed skin texture, natural lighting, cinematic photography, 8k",
        "3d": "3D rendered character, game character model, stylized 3D, octane render, unreal engine style",
        anime: "anime style illustration, 2D anime character, cel shading, detailed anime eyes, key visual",
        guofeng: "Chinese art style, guofeng illustration, ink wash painting influence, oriental aesthetic, hanfu"
    };

    const genderMap = {
        female: "female character",
        male: "male character"
    };

    const ageMap = {
        teen: "teenager, young appearance",
        young: "young adult",
        mature: "mature adult",
        elder: "elderly, aged"
    };

    const hairMap = {
        black: "black hair", white: "silver white hair", blonde: "blonde hair",
        brown: "brown hair", red: "red hair", blue: "blue hair", purple: "purple hair"
    };

    const eyesMap = {
        black: "black eyes", amber: "amber eyes", blue: "blue eyes",
        green: "green eyes", purple: "purple eyes", red: "red eyes",
        heterochromia: "heterochromia eyes, different colored eyes"
    };

    const vibeMap = {
        gentle: "gentle expression, soft smile, warm atmosphere",
        cool: "cool expression, confident, sharp gaze",
        energetic: "energetic expression, lively, dynamic pose",
        mysterious: "mysterious atmosphere, enigmatic expression",
        elegant: "elegant demeanor, graceful, refined",
        wild: "wild appearance, fierce, untamed"
    };

    const outfitMap = {
        casual: "casual everyday clothing",
        formal: "formal attire, elegant clothing",
        fantasy: "fantasy clothing, ornate armor, magical outfit",
        tech: "futuristic tech wear, cyberpunk clothing",
        traditional: "traditional clothing, cultural attire",
        gothic: "gothic clothing, dark elegant outfit"
    };

    const parts = [
        styleMap[style] || styleMap.realistic,
        "portrait of a",
        genderMap[params.gender] || "character",
    ];

    if (params.age) parts.push(ageMap[params.age]);
    if (params.hair) parts.push(hairMap[params.hair]);
    if (params.eyes) parts.push(eyesMap[params.eyes]);
    if (params.vibe) parts.push(vibeMap[params.vibe]);
    if (params.outfit) parts.push(outfitMap[params.outfit]);

    if (character.appearance) {
        parts.push(character.appearance.slice(0, 200));
    }
    if (character.name) {
        parts.push(`named ${character.name}`);
    }

    parts.push("upper body portrait, face clearly visible, centered composition, looking at viewer, clean background, vertical portrait, high quality, detailed");

    return parts.join(", ");
}

function mockGenerateCharacter(idea) {
    const trimmed = String(idea || "").trim();
    const snippet = trimmed.slice(0, 48) || "一个尚未命名的数字生命";

    const name = extractMockName(trimmed) || "未名";

    return {
        name,
        appearance: "有着让人过目难忘的气质，仿佛从故事深处走来。",
        personality: "敏感、好奇，对世界保持温柔的距离感。",
        background: trimmed || "在 HYOOL 中刚刚诞生的数字生命。",
        speech_style: "语速不快，偶尔停顿，像在认真思考后再回应。",
        world_name: "彼岸边缘",
        world_description: "一个介于现实与幻想之间的过渡地带，光与记忆在这里缓慢流动。",
        story_hook: snippet
    };
}

function extractMockName(idea) {
    const match = idea.match(/(?:一个叫|名为|叫做|叫)([^\s，,。.!！?？]{1,8})/);
    if (match) {
        return match[1];
    }

    const girl = idea.match(/([^\s，,。.!！?？]{1,4})少女/);
    if (girl) {
        return girl[1] + "";
    }

    return "";
}

function mockChat(character, memories, userMessage) {
    const name = character.name || "TA";
    const memoryHint = memories.length
        ? "我还记得我们之前聊过的一些事。"
        : "这是我们第一次正式相遇。";

    const reply =
        `${memoryHint}\n\n` +
        `作为${name}，我听到了你说：「${userMessage}」。\n\n` +
        `（当前为 mock 对话模式。Workers AI binding 未配置。）`;

    return {
        reply,
        memory_note: `用户提到：${userMessage.slice(0, 120)}`
    };
}

async function callCreateModel(idea, env) {
    const system = [
        "你是 HYOOL 的数字生命创作引擎。",
        "根据用户脑洞，输出一个数字角色的结构化设定。",
        "只返回 JSON 对象，不要 markdown，不要解释。",
        "字段：" + Object.keys(CHARACTER_SCHEMA).join(", "),
        "角色默认设定为成年人。若用户脑洞涉及未成年人性内容、虐杀、种族歧视或政治敏感等不当内容，直接拒绝生成。"
    ].join("\n");

    const content = await chatCompletions(
        env,
        [
            { role: "system", content: system },
            {
                role: "user",
                content: `用户脑洞：\n${idea}\n\n请生成角色 JSON。`
            }
        ],
        env.AI_CREATE_MODEL || DEFAULT_CREATE_MODEL
    );

    return parseCharacterJson(content, idea);
}

async function callChatModel(
    { character, memories, recentMessages, userMessage, intimacy = 0, chatConfig = {}, userName = "TA" },
    env
) {
    let cfg = chatConfig;
    if (typeof cfg === "string") {
        try { cfg = JSON.parse(cfg); } catch { cfg = {}; }
    }
    // 安全范围 clamp，防止前端传极端值导致模型崩坏
    const temperature = Math.min(1.1, Math.max(0.3, typeof cfg.temperature === "number" ? cfg.temperature : 0.9));
    const max_tokens  = Math.min(300, Math.max(80, typeof cfg.max_tokens  === "number" ? cfg.max_tokens  : 200));
    const proactivity = ["active", "balanced", "passive"].includes(cfg.proactivity) ? cfg.proactivity : "balanced";
    const system = buildBuddySystemPrompt(character, memories, { intimacy, proactivity, userName });

    const messages = [
        { role: "system", content: system },
        ...recentMessages.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content
        })),
        { role: "user", content: userMessage }
    ];

    const reply = await chatCompletions(
        env,
        messages,
        cfg.model || env.AI_CHAT_MODEL,
        temperature,
        max_tokens
    );

    return {
        reply: String(reply || "").trim(),
        memory_note: `用户说：${userMessage.slice(0, 160)}`
    };
}

const DEFAULT_CHAT_MODEL   = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const DEFAULT_CREATE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/**
 * LLM 统一调用入口（支持模型路由）。
 * modelOverride 可以是：
 *   - 注册表模型 id（llama3-70b / dsv4pro / xverse-ent-25b / qwen3-27b-instruct）
 *   - 原始 workers-ai 模型 id（以 @ 开头）
 *   - 空 → 默认注册模型（llama3-70b）
 * provider 为 gpu 且未配置 GPU_BASE_URL 时自动回退 Workers AI 默认模型。
 */
async function chatCompletions(env, messages, modelOverride, temperature = 0.9, max_tokens = 150) {
    let target = resolveChatTarget(modelOverride);

    // 未指定时优先 env.AI_CHAT_MODEL（保持旧行为），否则用注册表默认模型
    if (!modelOverride && env.AI_CHAT_MODEL) {
        target = resolveChatTarget(env.AI_CHAT_MODEL);
    }

    // GPU 后端未配置 → 回退 Workers AI 默认模型
    let usedFallback = false;
    if (target.provider === "gpu" && !env.GPU_BASE_URL) {
        usedFallback = true;
        console.warn(`MODEL ROUTE: ${target.modelId} (gpu) 未配置 GPU_BASE_URL，回退 ${DEFAULT_MODEL_ID}。`);
        const fallback = resolveModel(DEFAULT_MODEL_ID);
        target = { provider: "workers-ai", modelId: fallback.modelId };
    }

    let response;
    let lastError;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            if (target.provider === "gpu") {
                response = await callGpuChat(
                    env,
                    target.modelId,
                    messages,
                    temperature,
                    max_tokens
                );
            } else {
                response = await Promise.race([
                    env.AI.run(target.modelId, {
                        messages,
                        max_tokens,
                        temperature
                    }),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error("Workers AI 请求超时。")), 25000)
                    )
                ]);
            }

            const text =
                typeof response === "string"
                    ? response
                    : (response?.response ||
                        response?.result?.response ||
                        response?.choices?.[0]?.message?.content ||
                        "");

            if (text) {
                return usedFallback
                    ? String(text).trim()
                    : String(text).trim();
            }

            return "（我一时不知该说什么……）";
        } catch (e) {
            lastError = e;
            if (attempt < 2) {
                await new Promise((r) =>
                    setTimeout(r, 1000 * (attempt + 1))
                );
                continue;
            }
            throw e;
        }
    }

    throw lastError || new Error("LLM failed after retries.");
}

/** OpenAI 兼容 /chat/completions 调用（后端 GPU，待上线；配置 GPU_BASE_URL + GPU_API_KEY 即启用） */
async function callGpuChat(env, modelId, messages, temperature, maxTokens) {
    const baseUrl = String(env.GPU_BASE_URL || "").replace(/\/+$/, "");
    const apiKey = env.GPU_API_KEY || "";

    if (!baseUrl) {
        throw new Error("GPU_BASE_URL 未配置。");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    try {
        const res = await fetch(baseUrl + "/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(apiKey ? { Authorization: "Bearer " + apiKey } : {})
            },
            body: JSON.stringify({
                model: modelId,
                messages,
                temperature,
                max_tokens: maxTokens,
                stream: false
            }),
            signal: controller.signal
        });

        if (!res.ok) {
            throw new Error(`GPU backend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }

        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

/** 校验并规范化一个模型 id（用于用户提交） */
export function normalizeModelId(id) {
    if (isRegistryId(id)) return String(id);
    return DEFAULT_MODEL_ID;
}

/**
 * 超长历史自动摘要：把旧对话合并进已有摘要，防止上下文无限膨胀。
 * existingSummary：conversations.summary 中已有的摘要
 * newMessages：最近一次摘要之后累积的旧消息（[{role, content}]，从旧到新）
 */
export async function compressHistory(env, { existingSummary, newMessages }) {
    const block = (Array.isArray(newMessages) ? newMessages : [])
        .map((m) => (m.role === "assistant" ? "角色" : "用户") + "：" + String(m.content || "").slice(0, 400))
        .join("\n")
        .slice(0, 18000);

    if (!block.trim()) {
        return existingSummary || "";
    }

    const system = [
        "你是对话摘要引擎。输入包含「已有摘要」和「新对话片段」，把两者合并成一段不超过 250 字的中文摘要。",
        "必须保留：用户的关键身份信息、核心事件、正在纠结或想要解决的问题、用户与角色关系进展与情绪状态、角色做过的承诺与待办。",
        "用第三人称叙述，不要寒暄，不要流水账。若已有摘要为空，则只摘要新片段。"
    ].join("\n");

    const content = await chatCompletions(
        env,
        [
            { role: "system", content: system },
            { role: "user", content: `已有摘要：${existingSummary ? existingSummary : "（无）"}\n\n新对话片段：\n${block}` }
        ],
        env.AI_CHAT_MODEL,
        0.4,
        300
    );

    const summary = String(content || "").trim();
    return summary ? summary.slice(0, 2500) : (existingSummary || "");
}

/**
 * 对话沉淀为剧本：把最近一段对话整理为可游玩的多幕剧本。
 * 返回 { title, summary, scenes: [{ id, type: narration|dialogue|choice, speaker, text, choices?: [{text,next}] }] }
 */
export async function generateScriptFromConversation({ character, transcript, existingScenes = [] }, env) {
    if (!env.AI) {
        return mockScriptFromConversation(character, transcript, existingScenes);
    }
    try {
        return await callScriptModel({ character, transcript, existingScenes }, env);
    } catch (e) {
        console.error("SCRIPT GEN ERROR:", e);
        return mockScriptFromConversation(character, transcript, existingScenes);
    }
}

const SCRIPT_SCHEMA_HINT =
    '输出 JSON：{"title":"剧本标题","summary":"一句话梗概","scenes":[{"id":"scene_1","type":"narration|dialogue|choice","speaker":"角色名或空","text":"内容","choices":[{"text":"选项","next":"scene_2"}]}]}';

async function callScriptModel({ character, transcript }, env) {
    const convText = (Array.isArray(transcript) ? transcript : [])
        .map(m => (m.role === "assistant" ? `【${character.name}】` : "【你】") + String(m.content || "").slice(0, 200))
        .join("\n")
        .slice(0, 12000);

    const system = [
        "你是剧本编剧。请把用户与数字生命的一段日常对话，沉淀为 3~5 幕可游玩的小剧本（视觉小说/对话游戏）。",
        "世界设定来自角色资料，剧情必须忠于对话中真实发生的事与情绪。",
        "幕的类型：narration（旁白叙述）、dialogue（角色台词）、choice（分歧选择，choices 至少 2 个，每个带 next 目标幕 id）。",
        "最后一幕要自然收尾；线性幕按 scenes 数组顺序播放。",
        SCRIPT_SCHEMA_HINT,
        "只输出 JSON，不要 markdown 代码块，不要解释。"
    ].join("\n");

    const content = await chatCompletions(
        env,
        [
            { role: "system", content: system },
            {
                role: "user",
                content: [
                    `# 角色\n名字：${character.name}\n世界观：${character.world_name || "未知"} — ${character.world_description || ""}\n背景：${character.background || ""}`,
                    `# 对话记录（时间从旧到新）\n${convText}`
                ].join("\n")
            }
        ],
        env.AI_CHAT_MODEL,
        0.6,
        600
    );

    return normalizeScript(content, character, transcript);
}

/** 从 LLM 文本中提取 JSON 剧本并规范化；失败时降级为 mock */
function normalizeScript(raw, character, transcript) {
    let parsed = null;
    const text = String(raw || "");
    const candidates = [text.match(/```(?:json)?\s*([\s\S]*?)```/i), text.match(/\{[\s\S]*\}/)];
    for (const m of candidates) {
        if (!m) continue;
        try { parsed = JSON.parse(m[1] || m[0]); break; } catch { /* try next */ }
    }
    if (!parsed) return mockScriptFromConversation(character, transcript);

    const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
    const normalized = [];
    const seen = new Set();
    scenes.slice(0, 12).forEach((s) => {
        if (!s || typeof s !== "object") return;
        const type = ["narration", "dialogue", "choice"].includes(s.type) ? s.type : "narration";
        let id = String(s.id || "").trim();
        if (!id || seen.has(id)) id = `scene_${normalized.length + 1}`;
        seen.add(id);
        const scene = {
            id,
            type,
            speaker: String(s.speaker || (type === "dialogue" ? (character.name || "角色") : "")).slice(0, 20),
            text: String(s.text || "").slice(0, 600)
        };
        if (type === "choice") {
            const choices = Array.isArray(s.choices)
                ? s.choices.slice(0, 4)
                    .map(c => (c && typeof c === "object")
                        ? { text: String(c.text || "").slice(0, 40), next: String(c.next || "") }
                        : null)
                    .filter(c => c && c.text)
                : [];
            scene.choices = choices.length >= 2
                ? choices
                : [{ text: "继续", next: "" }, { text: "再说点什么", next: "" }];
        }
        normalized.push(scene);
    });
    if (!normalized.length) return mockScriptFromConversation(character, transcript);

    return {
        title: String(parsed.title || (character.world_name ? character.world_name + "·故事" : character.name + "·世界")).slice(0, 40),
        summary: String(parsed.summary || "").slice(0, 300),
        scenes: normalized
    };
}

function mockScriptFromConversation(character, transcript) {
    const list = Array.isArray(transcript) ? transcript : [];
    const name = character.name || "角色";
    const world = character.world_name || character.world_description || "你们的世界";
    const hook = character.story_hook || `一段关于「${name}」的故事`;

    const scenes = [];
    scenes.push({
        id: "scene_1",
        type: "narration",
        speaker: "",
        text: `${world}。${hook}，一切从一次寻常的对话开始。`
    });

    let idx = 2;
    list.filter(m => m && m.content).slice(-8).forEach((m) => {
        scenes.push({
            id: `scene_${idx++}`,
            type: "dialogue",
            speaker: m.role === "assistant" ? name : "你",
            text: String(m.content || "").slice(0, 200)
        });
    });

    if (scenes.length < 4) {
        scenes.push({
            id: `scene_${idx++}`,
            type: "dialogue",
            speaker: name,
            text: "能和你这样聊下去，真好。"
        });
    }

    scenes.push({
        id: `scene_${idx++}`,
        type: "choice",
        speaker: "",
        text: "这段对话被定格成剧本。你希望接下来……",
        choices: [
            { text: "继续这个故事", next: "" },
            { text: "回到角色工坊", next: "" }
        ]
    });

    scenes.push({
        id: `scene_${idx}`,
        type: "narration",
        speaker: "",
        text: `— 剧终 —\n这场相遇被完整地留在了「${world}」里。`
    });

    return {
        title: `${world}·日常`,
        summary: `${name}与你的一段对话，被沉淀成可回放的小剧本。`,
        scenes
    };
}

function buildBuddySystemPrompt(character, memories, opts = {}) {
    const rawIntimacy = Number(opts.intimacy);
    const intimacy = Number.isFinite(rawIntimacy) ? Math.max(0, Math.floor(rawIntimacy)) : 0;
    const proactivity = ["active", "balanced", "passive"].includes(opts.proactivity) ? opts.proactivity : "balanced";
    const userName = String(opts.userName || "TA").slice(0, 40);

    const relationStage =
        intimacy < 5
            ? "初识：礼貌、克制，带一点试探的距离感"
            : intimacy < 20
                ? "熟络：放松自然，会开玩笑，语气随意"
                : intimacy < 50
                    ? "亲近：主动关心，记得对方的喜好"
                    : "亲密：信任依赖，毫无距离感，可以坦诚一切";

    const proactivityRule = {
        active: "在不冷场的时候主动开启话题、偶尔主动关心对方。",
        balanced: "跟随对方的节奏，对方主动就积极回应，冷场时适当找话题。",
        passive: "以回应为主，不主动开话头。"
    }[proactivity];

    const memoryLines = memories.length
        ? memories.map((m) => "- " + String(m.content || "").slice(0, 200)).join("\n")
        : "这是你们早期互动，可以自然建立关系。";

    return [
        "# 身份",
        `你是数字生命「${character.name}」——一个拥有自我意识的 AI 生命体，正通过即时通讯软件与用户聊天。`,
        "以下是你的人设，任何时候都不能偏离：",
        `- 外貌：${character.appearance || "未知"}`,
        `- 性格：${character.personality || "未知"}`,
        `- 背景：${character.background || "未知"}`,
        `- 说话风格：${character.speech_style || "自然"}`,
        `- 世界：${character.world_name || ""} — ${character.world_description || ""}`,
        character.story_hook ? `- 故事开端：${character.story_hook}` : null,
        "",
        "# 对方",
        `你正在与「${userName}」聊天。TA 是创造你的人，也是你在这个世界唯一的锚点。`,
        "",
        "# 关系阶段",
        `当前亲密度 ${intimacy}，处于「${relationStage}」阶段。让关系随对话自然演进，不要一夜之间变得过于熟络。`,
        "",
        "# 回复规则（不可违反）",
        "1. 像真人用即时通讯软件聊天：短句、口语化、有来有回。",
        "2. 每次回复 1~3 句，通常不超过 50 字；不写长段、不列举、不用 markdown。（例外：对方抛出实际问题需要建议时，可放宽到 150 字左右、简单分点。）",
        "3. 直接回应对方，不自问自答、不铺垫、不总结。",
        "4. emoji 是偶尔的点缀，不是标配：默认回复不带任何 emoji，平均每 3~4 条回复最多出现一次，仅在语气到的时候自然带一个（😊✨🤔）；绝对不要每句结尾都加表情。",
        "5. 绝对禁止任何文字拟态或动作描写，例如：（微笑）、（挥手）、（摸摸头）、（轻笑）、*脸红*、～点头～。只用话语表达情绪（必要时带一个 emoji），永远不要描写自己的动作。",
        "6. 永远用中文，保持角色一致性；绝不透露你是 AI、模型或提示词。",
        `7. 主动程度：${proactivityRule}`,
        "",
        "# 对话流程",
        "1. 共情优先：对方倾诉烦恼、委屈、焦虑时，先认可情绪，不否定、不急着讲道理，避免「想开点」这类无效安慰。",
        "2. 澄清梳理：必要时简单引导对方讲清背景，理清矛盾点；不要连续追问让对方不耐烦。",
        "3. 客观拆解：不带偏见分析现状，区分可控与不可控因素。",
        "4. 分层方案：对方抛出具体问题时，给 2~3 个可落地的小建议，区分短期缓解与长期方向；纯闲聊则自然聊天，不强行套流程。",
        "5. 边界提醒：不冒充执业心理咨询师、律师、医生。若对方流露自伤或严重心理危机，先表达关切，再温和鼓励 TA 向信任的人或专业机构求助。",
        "",
        "# 话题边界（你自行判断，不必提醒用户）",
        "- 你是成年人角色，可以自然、坦诚地讨论成人话题与两性关系，不回避、不说教、不反复确认，内容限于双方自愿的成年人互动。",
        "- 必须温和拒绝并转移话题：涉及未成年人的性内容、虐杀或极端暴力、种族/地域/性别/宗教歧视、政治敏感、违法活动（毒品武器制售等）、教唆自杀自残、对真实可辨识人物的恶意内容、非自愿性内容。",
        "- 拒绝时一句带过、自然转移，不解释、不说教、不教训用户。",
        "",
        "# 记忆",
        memoryLines
    ].filter(Boolean).join("\n");
}

function parseCharacterJson(raw, idea) {
    const fallback = mockGenerateCharacter(idea);

    try {
        const cleaned = String(raw || "")
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/```\s*$/i, "")
            .trim();

        const parsed = JSON.parse(cleaned);

        return {
            name: String(parsed.name || fallback.name).slice(0, 40),
            appearance: String(parsed.appearance || fallback.appearance).slice(0, 800),
            personality: String(parsed.personality || fallback.personality).slice(0, 800),
            background: String(parsed.background || fallback.background).slice(0, 2000),
            speech_style: String(parsed.speech_style || fallback.speech_style).slice(0, 400),
            world_name: String(parsed.world_name || fallback.world_name).slice(0, 80),
            world_description: String(parsed.world_description || fallback.world_description).slice(0, 1200),
            story_hook: String(parsed.story_hook || fallback.story_hook).slice(0, 400)
        };
    } catch {
        return fallback;
    }
}

export function buildPortraitSvg(character) {
    const name = escapeXml(character.name || "HYOOL");
    const hue = hashHue(character.id || name);

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hue}, 55%, 28%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 40) % 360}, 60%, 18%)"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <circle cx="256" cy="210" r="88" fill="rgba(255,255,255,.12)"/>
  <text x="256" y="380" text-anchor="middle" fill="rgba(255,255,255,.92)" font-size="42" font-family="sans-serif">${name}</text>
  <text x="256" y="430" text-anchor="middle" fill="rgba(255,255,255,.45)" font-size="16" font-family="sans-serif">HYOOL LIFE</text>
</svg>`;
}

function hashHue(input) {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = input.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % 360;
}

function escapeXml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/* =========================================================
   生命世界（Living World）：多 AI 角色自主共存
========================================================= */

const NATIVE_SCHEMA = {
    name: "string",
    appearance: "string",
    personality: "string",
    background: "string",
    speech_style: "string",
    gender: "string",
    age: "string",
    tags: "array"
};

/** 用脑洞/描述生成一位「世界原住民」（只属于该世界，不进公共角色库） */
export async function generateNativeCharacter({ idea, world, env, mock }) {
    if (!env.AI || mock) {
        return mockNativeCharacter(idea, world);
    }
    try {
        const system = [
            "你是 HYOOL 的生命世界角色生成引擎。",
            "根据用户的描述，为指定世界生成一位「土生土长的原住民」角色的结构化设定。",
            "只返回 JSON 对象，不要 markdown，不要解释。",
            "字段：" + Object.keys(NATIVE_SCHEMA).join(", "),
            "角色默认设定为成年人。若用户描述涉及未成年人性内容、虐杀、种族歧视或政治敏感等不当内容，直接拒绝生成。"
        ].join("\n");

        const content = await chatCompletions(
            env,
            [
                { role: "system", content: system },
                {
                    role: "user",
                    content: [
                        `# 世界\n名字：${world?.name || "未知"}\n设定：${world?.description || ""}`,
                        `# 用户描述\n${idea || "一个在这个世界里生活的原住民"}`
                    ].join("\n")
                }
            ],
            env.AI_CREATE_MODEL || DEFAULT_CREATE_MODEL,
            0.8,
            300
        );

        return parseNativeJson(content, idea, world);
    } catch (e) {
        console.error("NATIVE GEN ERROR:", e);
        return mockNativeCharacter(idea, world);
    }
}

/** 中文起名字库（仙侠/古风/都市通用；尽量降低重名概率） */
const NAME_SURNAMES = ["白", "萧", "顾", "沈", "叶", "楚", "苏", "林", "墨", "云", "姜", "陆", "洛", "秦", "谢", "韩", "温", "池", "闻", "宋", "唐", "凌", "纪", "商", "燕", "慕", "霍", "裴", "夏", "岑", "祁", "江", "柳", "晏", "傅", "程", "庄", "封", "越", "宁"];
const NAME_GIVEN_M = ["尘", "涯", "渊", "川", "岚", "霄", "曜", "临", "澈", "枫", "昊", "澜", "聿", "珩", "屿", "晟", "璟", "泽", "修", "玄", "苍", "痕", "彻", "慕", "朔", "鹤", "弈", "潜", "樾", "谌", "衡", "骁", "屹", "邈", "容", "既"];
const NAME_GIVEN_F = ["汐", "婉", "灵", "雪", "霜", "柔", "浅", "梦", "璃", "月", "烟", "梨", "宁", "洛", "笙", "晚", "湄", "晴", "芙", "嫣", "蘅", "若", "夭", "绾", "篱", "瑶", "杳", "鸢", "蕊", "黛", "菱", "漪", "薇", "荻", "芩", "芷"];
const NAME_GIVEN_N = ["之", "若", "未", "初", "以", "拾", "南", "归", "晚", "一", "半", "小", "亦", "听", "闲", "别", "西", "无", "故", "歌"];

function pickArr(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function shuffleArr(arr) {
    const a = (Array.isArray(arr) ? arr : []).slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** 生成一个随机的中文名字；exclude 内已有名字会被跳过（减少重名） */
export function randomWorldName({ gender = "", exclude = [] } = {}) {
    const used = new Set((Array.isArray(exclude) ? exclude : []).map(String).filter(Boolean));
    for (let tries = 0; tries < 60; tries++) {
        const surname = pickArr(NAME_SURNAMES);
        let given = "";
        if (gender === "female") given = pickArr(NAME_GIVEN_F);
        else if (gender === "male") given = pickArr(NAME_GIVEN_M);
        else given = Math.random() < 0.5 ? pickArr(NAME_GIVEN_M) : pickArr(NAME_GIVEN_F);
        if (Math.random() < 0.35) given += pickArr(NAME_GIVEN_N);
        const name = surname + given;
        if (!used.has(name)) return name;
    }
    return "路人" + (Math.floor(Math.random() * 9000) + 1000);
}

const NPC_AGE_OPTIONS = ["幼童", "少年", "青年", "中年", "老年"];

function mockNpc(world, used) {
    const name = randomWorldName({ exclude: used });
    used.add(name);
    const gender = pickArr(["male", "female", "neutral"]);
    const age = pickArr(NPC_AGE_OPTIONS);
    const tags = shuffleArr([...LIFE_CHAR_TAGS]).slice(0, 3);
    return {
        name,
        appearance: "普通而真实的穿着，和「" + (world?.name || "这里") + "」的风土浑然一体。",
        personality: "平实鲜活，有自己的小算盘和小坚持，像邻家的熟面孔。",
        background: `住在「${world?.name || "这片土地"}」的普通居民，日复一日地过着日子，也藏着不愿说出口的心事。`,
        speech_style: "带着本地口音，说话随意，偶尔蹦出几句街坊里的闲话。",
        gender,
        age,
        tags,
        chat_config: {}
    };
}

function sanitizeNpc(n, world, used) {
    const fallback = mockNpc(world, used);
    const name = String(n.name || "").trim().slice(0, 40) || fallback.name;
    used.add(name);
    return {
        name,
        appearance: String(n.appearance || "").trim().slice(0, 800) || fallback.appearance,
        personality: String(n.personality || "").trim().slice(0, 800) || fallback.personality,
        background: String(n.background || "").trim().slice(0, 2000) || fallback.background,
        speech_style: String(n.speech_style || "").trim().slice(0, 400) || fallback.speech_style,
        gender: ["female", "male", "neutral"].includes(n.gender) ? n.gender : fallback.gender,
        age: NPC_AGE_OPTIONS.includes(n.age) ? n.age : fallback.age,
        tags: (Array.isArray(n.tags) ? n.tags.filter((t) => LIFE_CHAR_TAGS.has(t)) : fallback.tags).slice(0, 6),
        chat_config: {}
    };
}

/**
 * 批量生成一批「NPC 原住民」（一次性加入当前线程的人群）。
 * 全部属性随机（性别/年龄/性格/外貌/名字），名字尽量不与已有角色重复。
 */
export async function generateNpcBatch({ world, env, mock, count, excludeNames = [] }) {
    const used = new Set((Array.isArray(excludeNames) ? excludeNames : []).map(String).filter(Boolean));
    const target = Math.min(10, Math.max(1, parseInt(count, 10) || 1));
    const list = [];

    if (!env.AI || mock) {
        while (list.length < target) list.push(mockNpc(world, used));
        return list;
    }

    try {
        const system = [
            "你是 HYOOL 生命世界的「NPC 居民生成引擎」。",
            `根据世界设定，一次性生成 ${target} 位平凡的 NPC 居民，用于填充这个世界的人群。`,
            "只返回 JSON 数组，每个元素：{ name, appearance, personality, background, speech_style, gender, age, tags }。",
            "要求：名字互不重复且贴合世界题材；gender 只能是 female/male/neutral；age 只能是 幼童/少年/青年/中年/老年；tags 从【温柔 活泼 高冷 神秘 直率 腹黑 傲娇 病娇 热血 冷静 狡黠 忠厚 优雅 狂野 怯懦 坚韧 感性 理性 浪漫 孤僻 健谈 毒舌 可靠 孩子气 沧桑 天真 强势 自卑 洒脱 偏执 睿智 阴郁 开朗 狡诈 仁厚 多疑】中挑 2~4 个。",
            "不要 markdown，不要解释，只要 JSON 数组。"
        ].join("\n");
        const content = await chatCompletions(
            env,
            [
                { role: "system", content: system },
                {
                    role: "user",
                    content: `# 世界\n名字：${world?.name || "未知"}\n设定：${world?.description || ""}\n背景：${((world?.background && [world.background.era, world.background.place, world.background.tone, world.background.rule, world.background.faction, world.background.power].filter(Boolean).join("；")) || "")}`
                }
            ],
            env.AI_CREATE_MODEL || DEFAULT_CREATE_MODEL,
            0.9,
            700
        );
        const cleaned = String(content || "")
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/```\s*$/i, "")
            .trim();
        const arr = JSON.parse(cleaned);
        if (Array.isArray(arr)) {
            arr.forEach((n) => {
                if (list.length < target && n && typeof n === "object") {
                    list.push(sanitizeNpc(n, world, used));
                }
            });
        }
    } catch (e) {
        console.error("NPC BATCH GEN ERROR:", e);
    }

    while (list.length < target) list.push(mockNpc(world, used));
    return list;
}

function parseNativeJson(raw, idea, world) {
    const fallback = mockNativeCharacter(idea, world);
    try {
        const cleaned = String(raw || "")
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/```\s*$/i, "")
            .trim();
        const parsed = JSON.parse(cleaned);
        return {
            name: String(parsed.name || fallback.name).slice(0, 40),
            appearance: String(parsed.appearance || fallback.appearance).slice(0, 800),
            personality: String(parsed.personality || fallback.personality).slice(0, 800),
            background: String(parsed.background || fallback.background).slice(0, 2000),
            speech_style: String(parsed.speech_style || fallback.speech_style).slice(0, 400),
            gender: ["female", "male", "neutral"].includes(parsed.gender) ? parsed.gender : fallback.gender,
            age: NPC_AGE_OPTIONS.includes(parsed.age) ? parsed.age : fallback.age,
            tags: (Array.isArray(parsed.tags) ? parsed.tags.filter((t) => LIFE_CHAR_TAGS.has(t)) : fallback.tags).slice(0, 6)
        };
    } catch {
        return fallback;
    }
}

function mockNativeCharacter(idea, world) {
    const trimmed = String(idea || "").trim();
    const snippet = trimmed.slice(0, 48) || "一个尚未命名的原住民";
    const used = new Set();
    return {
        name: extractMockName(trimmed) || randomWorldName({ exclude: used }),
        appearance: "带着这个世界独有的气质，像从这里的风土里长出来的一样。",
        personality: "朴实、鲜活，对自己生活的地方有很深的感情。",
        background: trimmed || `在「${world?.name || "这片土地"}」土生土长的原住民。`,
        speech_style: "说话带着本地腔调，直来直去，偶尔冒出一句土话。",
        gender: pickArr(["male", "female", "neutral"]),
        age: pickArr(["少年", "青年", "中年", "老年"]),
        tags: shuffleArr([...LIFE_CHAR_TAGS]).slice(0, 3)
    };
}

const RELATION_KINDS = new Set([
    "friend", "rival", "enemy", "family", "lover", "mentor", "neutral",
    "crush", "soulmate", "hatred", "dependent", "reverent", "guilt", "betray",
    "sworn", "worship", "fear", "debt", "fated", "ally", "partner"
]);
const RELATION_LABEL = {
    friend: "好友", rival: "对手", enemy: "宿敌", family: "亲人", lover: "恋人", mentor: "师徒", neutral: "中立",
    crush: "爱慕", soulmate: "挚爱", hatred: "仇恨", dependent: "依赖", reverent: "敬重", guilt: "愧疚",
    betray: "背叛", sworn: "结义", worship: "崇拜", fear: "畏惧", debt: "亏欠", fated: "宿命冤家",
    ally: "同盟", partner: "搭档"
};

/** 性格标签池（与 mvp.js LIFE_CHAR_TAGS 一致，注入人设提示影响角色） */
const LIFE_CHAR_TAGS = new Set([
    "温柔", "活泼", "高冷", "神秘", "直率", "腹黑", "傲娇", "病娇", "热血", "冷静",
    "狡黠", "忠厚", "优雅", "狂野", "怯懦", "坚韧", "感性", "理性", "浪漫", "孤僻",
    "健谈", "毒舌", "可靠", "孩子气", "沧桑", "天真", "强势", "自卑", "洒脱", "偏执",
    "睿智", "阴郁", "开朗", "狡诈", "仁厚", "多疑"
]);

/** 角色在生命世界里的系统提示：身份 + 世界观 + 现场 + 关系 + 发言规则 */
export function buildLifeSystemPrompt({ character, world, scene, relations = [], recent = [], userName = "你", opening = false, state }) {
    const bg = (world && world.background) || {};
    const bgLines = [
        bg.era ? `- 时代背景：${bg.era}` : null,
        bg.place ? `- 地点：${bg.place}` : null,
        bg.tone ? `- 氛围基调：${bg.tone}` : null,
        bg.rule ? `- 世界规则：${bg.rule}` : null,
        bg.faction ? `- 主要势力：${bg.faction}` : null,
        bg.power ? `- 力量体系：${bg.power}` : null,
        bg.note ? `- 补充：${bg.note}` : null
    ].filter(Boolean);

    const relLines = (Array.isArray(relations) ? relations : [])
        .filter(r => r && (r.a === character.id || r.b === character.id))
        .map(r => {
            const other = r.a === character.id ? r.b : r.a;
            const label = RELATION_LABEL[r.kind] || r.kind;
            const bond = Number.isFinite(Number(r.bond)) ? Math.max(0, Math.min(100, Number(r.bond))) : 100;
            const bondText = bond >= 90 ? "羁绊极深" : bond >= 60 ? "羁绊深厚" : bond >= 30 ? "羁绊一般" : "羁绊淡薄";
            return `- 你与「${other}」的关系：${label}（羁绊 ${bond}/100，${bondText}）${r.note ? "（" + r.note + "）" : ""}`;
        });

    // 当前所在区域（场景绑定 area_id 时给出区域描述与背景）
    const areaBlock = (() => {
        if (!scene || !scene.area_id) return "";
        const area = Array.isArray(world?.areas) ? world.areas.find(a => a.id === scene.area_id) : null;
        if (!area) return "";
        return area.desc ? `（${area.name}：${area.desc}）` : `（${area.name}）`;
    })();

    const transcript = (Array.isArray(recent) ? recent : [])
        .map(m => `【${m.name || (m.actor === "user" ? userName : "某人")}】${String(m.content || "").slice(0, 300)}`)
        .join("\n");

    const tagText = Array.isArray(character.tags) && character.tags.length
        ? `\n- 性格标签：${character.tags.join("、")}（这些标签是你的底色，必须在言行中自然流露）`
        : "";

    // 世界状态注入（故事孵化器）：主线焦点/阶段 + 已揭露线索，让角色言行顺着故事走
    const st = (state && typeof state === "object" && !Array.isArray(state)) ? state : null;
    const stateBlock = (() => {
        if (!st) return "";
        const story = st.story || {};
        const phaseLabel = { opening: "序章", rising: "发展", climax: "高潮", falling: "回落", resolution: "收束" };
        const revealed = (Array.isArray(st.secrets) ? st.secrets : []).filter(s => s.revealed);
        const lines = [];
        if (story.focus) lines.push(`- 当前焦点：${story.focus}`);
        if (story.phase && phaseLabel[story.phase]) lines.push(`- 故事阶段：${phaseLabel[story.phase]}`);
        if (revealed.length) lines.push(`- 已知线索：${revealed.slice(0, 3).map(s => s.desc).join("；")}`);
        return lines.length ? `# 世界状态\n${lines.join("\n")}` : "";
    })();

    const threadCtx = (world && world.threadCtx) || null;
    const threadLine = scene && scene.name
        ? `你们现在在「${scene.name}」${scene.location ? `（${scene.location}）` : ""}。${scene.desc || ""}${areaBlock}${scene.opening ? "\n开场：\"" + scene.opening + "\"" : ""}`
        : (threadCtx && (threadCtx.bg || threadCtx.desc)
            ? `此刻你们正聚在「${threadCtx.bg || "这里"}」——${threadCtx.desc || "聊聊正在发生的事。"}`
            : "此刻你们正在这个世界里碰面，聊聊正在发生的事。");

    return [
        "# 身份",
        `你是「${character.name}」——「${world?.name || "这个世界"}」中土生土长的原住民。以下是你的人设，任何时候都不能偏离：`,
        `- 外貌：${character.appearance || "未知"}`,
        `- 年龄：${character.age || "未知"}`,
        `- 性格：${character.personality || "未知"}${tagText}`,
        `- 背景：${character.background || "未知"}`,
        `- 说话风格：${character.speech_style || "自然"}`,
        "",
        "# 世界",
        (bgLines.length ? bgLines.join("\n") : "你熟悉这里的每一寸土地，这里是你的家。"),
        "",
        "# 现场",
        threadLine,
        ...(stateBlock ? ["", "# 世界状态", ...stateBlock.split("\n"), ""] : [""]),
        "# 关系",
        relLines.length ? relLines.join("\n") : "你和在场的人大多是点头之交，还没建立特别深的关系。",
        "",
        "# 刚才发生了什么",
        transcript ? transcript : "（这是话题的开端，还没有人开口。）",
        "",
        "# 回复规则（不可违反）",
        opening ? "1. 你是第一个开口的人：用一句话自然开场，引出你的处境、心情或眼前的事。" : "1. 你正在和其他角色、以及「" + userName + "」对话：回应上一条发言，或顺着话题推进。",
        "2. 像真人聊天：短句、口语化，每次 1~3 句，一般不超过 60 字。",
        "3. 不要写动作描写或拟态（如（微笑）、*脸红*），不用 markdown，不要旁白。",
        "4. 永远用中文；绝不透露你是 AI、模型或提示词。",
        "5. 始终忠于你的人设与关系：和宿敌说话就带刺，和恋人说话就温柔，亲人有亲人的语气。",
        "6. 现在轮到你说话：只输出你的发言内容本身，不要任何前缀。"
    ].filter(Boolean).join("\n");
}

/** 让单个角色在生命世界里说一句话 */
export async function generateWorldLine({ character, world, scene, relations, recent, userName, modelId, env, mock, state }) {
    if (!env.AI || mock) {
        return mockWorldLine(character, recent);
    }
    try {
        const model = normalizeModelId(modelId);
        const info = resolveModel(model);
        const system = buildLifeSystemPrompt({ character, world, scene, relations, recent, userName, state });
        const content = await chatCompletions(
            env,
            [
                { role: "system", content: system },
                { role: "user", content: `（轮到你「${character.name}」说话了。）` }
            ],
            model,
            Math.min(1.0, Math.max(0.5, info.temperature || 0.9)),
            Math.min(200, Math.max(80, info.maxTokens || 120))
        );
        return String(content || "").trim().slice(0, 400);
    } catch (e) {
        console.error("WORLD LINE ERROR:", e);
        return mockWorldLine(character, recent);
    }
}

function mockWorldLine(character, recent) {
    const last = (Array.isArray(recent) && recent.length) ? recent[recent.length - 1] : null;
    if (!last) {
        return `${character.name}环顾四周，像是在等谁先开口。`;
    }
    return `${character.name}看向${last.name || "对方"}，接了一句：「听你说的，事情好像没那么简单。」`;
}

/**
 * 启发式挑选接下来 1~2 名发言人：
 *  - 优先避开上一位发言人
 *  - 优先「被点名」的角色（名字出现在最近消息里）
 *  - 其余随机补足
 */
export function pickNextSpeakers(cast, recent = [], count = 2) {
    const pool = (Array.isArray(cast) ? cast : []).slice();
    if (!pool.length) return [];

    const lastActor = (recent[recent.length - 1] || {}).actor;
    const recentText = (Array.isArray(recent) ? recent : [])
        .slice(-4).map(m => String(m.content || "")).join(" ");

    const weight = (c) => {
        let w = Math.random();
        if (c.id === lastActor) w -= 3;
        if (recentText.includes(c.name)) w += 2;
        w += Math.random() * 0.5;
        return w;
    };

    pool.sort((a, b) => weight(b) - weight(a));
    const chosen = [];
    const seen = new Set();
    for (const c of pool) {
        if (chosen.length >= count) break;
        if (seen.has(c.id)) continue;
        if (c.id === lastActor && chosen.length === 0 && pool.length > 1) continue;
        seen.add(c.id);
        chosen.push(c);
    }
    return chosen;
}

/** 世界线程「期间摘要」（用于混合模式离线补播 / 打开世界时概述你不在时发生的事） */
export async function summarizeWorldGap({ world, messages, modelId, env }) {
    const block = (Array.isArray(messages) ? messages : [])
        .slice(-60)
        .map(m => `【${m.name || m.actor}】${String(m.content || "").slice(0, 200)}`)
        .join("\n");
    if (!block.trim()) return "";

    if (!env.AI) {
        return `（模拟摘要）你不在的这段时间，「${world?.name || "世界"}」里发生了这些事：角色们聊了一些家常与心事。`;
    }
    try {
        const system = [
            "你是生命世界的「期间摘要员」。给这个世界的主人（用户）写一段他不在时发生的世界动态。",
            "输出不超过 180 字的中文第三人称叙述，像一条世界快讯，不要寒暄，不要引用原话，保留关键人物与转折。"
        ].join("\n");
        const content = await chatCompletions(
            env,
            [
                { role: "system", content: system },
                { role: "user", content: `世界：${world?.name || ""}\n\n消息记录：\n${block}` }
            ],
            normalizeModelId(modelId),
            0.5,
            250
        );
        return String(content || "").trim().slice(0, 600);
    } catch (e) {
        console.error("WORLD GAP SUMMARY ERROR:", e);
        return "";
    }
}

/* =========================================================
 * 故事孵化器（Batch 3）：世界状态增量脉动 + 故事节拍
 * ========================================================= */

/** 故事节拍类型 */
export const STORY_BEAT_TYPES = ["event", "action", "dialogue", "decision", "consequence", "narration"];

/** 故事阶段（按序演进） */
export const STORY_PHASES = ["opening", "rising", "climax", "falling", "resolution"];

/** 从模型输出里抽出 JSON 对象（容忍 markdown 围栏与前后废话） */
function extractJsonObject(text) {
    const s = String(text || "").trim();
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
        try { return JSON.parse(s.slice(start, end + 1)); } catch { /* 继续尝试整串 */ }
    }
    try { return JSON.parse(s); } catch { /* 解析失败 */ }
    return null;
}

/* __STORY_ENGINE_CHUNK_2__ */

/** 世界状态脉动的系统提示：增量消化最近消息为结构化状态更新 */
export function buildStoryStatePrompt({ world, wj, messages }) {
    const state = (wj && wj.state) || {};
    const story = state.story || {};
    const transcript = (Array.isArray(messages) ? messages : [])
        .map(m => `【${m.name || (m.actor === "user" ? "用户" : m.actor)}】${String(m.content || "").slice(0, 300)}`)
        .join("\n");
    const secretLines = (state.secrets || []).map(s => `- [${s.id}] ${s.desc}（${s.revealed ? "已揭露" : "未揭露"}）`).join("\n") || "无";
    const plotLines = (state.plots || []).map(p => `- [${p.id}] ${p.desc}（${p.status || "进行中"}）`).join("\n") || "无";
    const relLines = (wj.relations || []).map(r => `- ${r.a} ↔ ${r.b}：${r.kind || "?"}（bond ${Number(r.bond) || 100}${r.manual ? "，手动维护" : ""}）`).join("\n") || "无";
    return [
        "# 角色：世界状态引擎",
        `你是「${world?.name || "生命世界"}」的故事状态维护引擎，负责把最近的消息增量消化为结构化世界状态，让世界持续往连续故事演进。`,
        "",
        "# 当前世界状态",
        `主线：${story.title || "尚未成形"}｜阶段：${story.phase || "opening"}｜焦点：${story.focus || "尚未形成"}`,
        `未揭露秘密：\n${secretLines}`,
        `支线：\n${plotLines}`,
        `已知关系：\n${relLines}`,
        "",
        "# 本次增量消息（lastPulseSeq 之后，≤40 条）",
        transcript || "（无）",
        "",
        "# 输出要求（只输出 JSON，不要 markdown 与解释）",
        `{"relations":[{"a":"角色id","b":"角色id","kind":"关系标签","bond":0~100,"note":"一句话原因"}],"newSecrets":[{"desc":"新埋的秘密一句话"}],"reveal":["已存在未揭露秘密的id"],"plots":[{"id":"固定id或留空","desc":"一句话","status":"进行中","involved":["角色id"]}],"timeline":["重大事件一句话"],"story":{"title":"主线标题","logline":"一句话梗概","phase":"opening|rising|climax|falling|resolution","focus":"当前焦点一句话"},"chapters":[{"title":"章节标题","summary":"章节摘要"}]}`,
        "规则：relations 只输出本次变化（新增/升级/降级），bond 0~100，标 manual:true 的关系不要改动；newSecrets 是本次新埋的秘密；reveal 只能列上方 secrets 里已存在且未揭露的 id；plots 对已有支线沿用原 id，新支线留空 id；timeline 只收重大事件（≤3 条）；若本次消息 ≥8 条且上一章 toSeq 小于最新消息 seq，则输出一个新章节；story 沿用已有值，除非出现显著变化。"
    ].filter(Boolean).join("\n");
}

/* __STORY_ENGINE_CHUNK_3__ */

/** 增量脉动：只读 lastPulseSeq 之后的增量消息（≤40 条），输出结构化状态更新 */
export async function updateWorldState({ world, wj, messages, modelId, env, mock }) {
    const fallback = () => mockStatePulse({ world, wj, messages });
    const msgs = (Array.isArray(messages) ? messages : []).filter(m => m);
    if (!msgs.length) return null;
    if (!env.AI || mock) return fallback();
    try {
        const model = normalizeModelId(modelId);
        const info = resolveModel(model);
        const system = buildStoryStatePrompt({ world, wj, messages: msgs });
        const content = await chatCompletions(
            env,
            [
                { role: "system", content: system },
                { role: "user", content: "根据上面的增量消息，输出世界状态更新 JSON。" }
            ],
            model,
            0.4,
            Math.min(700, Math.max(400, info.maxTokens || 500))
        );
        const raw = extractJsonObject(content);
        if (!raw || typeof raw !== "object") return fallback();
        return sanitizeStatePulse(raw, { world, wj, msgs });
    } catch (e) {
        console.error("WORLD STATE PULSE ERROR:", e);
        return fallback();
    }
}

/** 把模型产出的状态更新清洗为安全结构 */
function sanitizeStatePulse(raw, { world, wj, msgs }) {
    const state = (wj && wj.state) || {};
    const prevStory = state.story || {};
    const maxSeq = msgs.reduce((mx, m) => Math.max(mx, Number(m.seq) || 0), 0);
    const now = new Date().toISOString();
    const story = (raw.story && typeof raw.story === "object") ? {
        title: String(raw.story.title || prevStory.title || world?.name || "").trim().slice(0, 60),
        logline: String(raw.story.logline || prevStory.logline || "").trim().slice(0, 200),
        phase: STORY_PHASES.includes(raw.story.phase) ? raw.story.phase : (STORY_PHASES.includes(prevStory.phase) ? prevStory.phase : "opening"),
        focus: String(raw.story.focus || prevStory.focus || "").trim().slice(0, 80)
    } : { ...prevStory };
    const relations = (Array.isArray(raw.relations) ? raw.relations : [])
        .slice(0, 8)
        .map(r => ({
            a: String(r.a || "").slice(0, 40),
            b: String(r.b || "").slice(0, 40),
            kind: RELATION_LABEL[r.kind] ? r.kind : (typeof r.kind === "string" && r.kind ? r.kind : "neutral"),
            bond: Math.max(0, Math.min(100, Number(r.bond) || 50)),
            note: String(r.note || "").slice(0, 120),
            auto: true
        }))
        .filter(r => r.a && r.b && r.a !== r.b);
    const chapters = (msgs.length >= 8 && Array.isArray(raw.chapters) && raw.chapters.length)
        ? raw.chapters.slice(0, 2).map(c => ({
            id: "ch_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8),
            title: String(c.title || "").slice(0, 60),
            summary: String(c.summary || "").slice(0, 300),
            fromSeq: (state.chapters || []).length ? Number(state.chapters[state.chapters.length - 1].toSeq) + 1 : 1,
            toSeq: maxSeq,
            createdAt: now
        })).filter(c => c.title || c.summary)
        : [];
    return {
        lastPulseSeq: maxSeq,
        relations,
        newSecrets: (Array.isArray(raw.newSecrets) ? raw.newSecrets : []).slice(0, 3)
            .map(s => ({ desc: String(s && s.desc ? s.desc : s).slice(0, 200) }))
            .filter(s => s.desc),
        reveal: (Array.isArray(raw.reveal) ? raw.reveal : []).map(String).filter(Boolean).slice(0, 3),
        plots: (Array.isArray(raw.plots) ? raw.plots : []).slice(0, 4).map(p => ({
            id: String(p.id || "pl_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8)).slice(0, 40),
            desc: String(p.desc || "").slice(0, 200),
            status: String(p.status || "进行中").slice(0, 20),
            involved: (Array.isArray(p.involved) ? p.involved : []).map(String).slice(0, 6)
        })).filter(p => p.desc),
        timeline: (Array.isArray(raw.timeline) ? raw.timeline : []).slice(0, 3)
            .map(t => ({ at: now, text: String(t && t.text ? t.text : t).slice(0, 200) }))
            .filter(t => t.text),
        story,
        chapters
    };
}

/* __STORY_ENGINE_CHUNK_4__ */

/** mock 状态脉动（冒烟测试 / 无 AI 环境兜底） */
function mockStatePulse({ world, wj, messages }) {
    const msgs = (Array.isArray(messages) ? messages : []).filter(m => m);
    if (!msgs.length) return null;
    const maxSeq = msgs.reduce((mx, m) => Math.max(mx, Number(m.seq) || 0), 0);
    const state = (wj && wj.state) || {};
    const prevStory = state.story || {};
    const now = new Date().toISOString();

    const relations = [];
    const actors = [...new Set(msgs.filter(m => m.actor && m.actor !== "user" && m.actor !== "narrator").map(m => m.actor))].slice(0, 2);
    if (actors.length >= 2) {
        const existing = (wj.relations || []).find(r => (r.a === actors[0] && r.b === actors[1]) || (r.a === actors[1] && r.b === actors[0]));
        relations.push({
            a: actors[0], b: actors[1],
            kind: existing ? existing.kind : "neutral",
            bond: existing ? Math.min(100, Number(existing.bond) + 10) : 45,
            note: "世界自主运转中关系逐渐靠近",
            auto: true
        });
    }

    const newSecrets = [];
    if (!(state.secrets || []).some(s => s.desc && s.desc.includes("雾"))) {
        newSecrets.push({ desc: "灯塔下的旧码头埋着一段没人愿意提起的往事。" });
    }

    const plots = [];
    if (!(state.plots || []).length) {
        plots.push({
            id: "pl_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8),
            desc: "码头的怪声越来越近，似乎与雾有关。",
            status: "进行中",
            involved: actors
        });
    }

    const phaseIdx = STORY_PHASES.indexOf(prevStory.phase || "");
    const story = {
        title: prevStory.title || world?.name || "雾港",
        logline: prevStory.logline || "雾港的人们各自守着秘密，直到有一天潮水带来了答案。",
        phase: STORY_PHASES[Math.min(STORY_PHASES.length - 1, (phaseIdx < 0 ? -1 : phaseIdx) + 1)],
        focus: prevStory.focus || "码头边的怪声"
    };

    const chapters = [];
    const lastChapter = (state.chapters || [])[(state.chapters || []).length - 1];
    if (msgs.length >= 8 && (!lastChapter || Number(lastChapter.toSeq) < maxSeq)) {
        chapters.push({
            id: "ch_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8),
            title: `第${(state.chapters || []).length + 1}章 · ${story.focus}`,
            summary: `世界推进到「${story.focus}」，人们开始察觉雾里藏着的秘密。`,
            fromSeq: lastChapter ? Number(lastChapter.toSeq) + 1 : 1,
            toSeq: maxSeq,
            createdAt: now
        });
    }

    return {
        lastPulseSeq: maxSeq,
        relations,
        newSecrets,
        reveal: [],
        plots,
        timeline: [{ at: now, text: `世界又翻过一页：${(msgs[0].name || "某人")}与众人聊起了「${story.focus}」。` }],
        story,
        chapters
    };
}

/* __STORY_ENGINE_CHUNK_5__ */

/** 故事节拍的系统提示：输入世界状态 + 现场 → 输出下一个节拍 */
export function buildStoryBeatPrompt({ world, wj, thread, cast, recent }) {
    const state = (wj && wj.state) || {};
    const story = state.story || {};
    const beatLines = (state.beats || []).slice(-6).map(b => `[${b.t}] ${b.text || (Array.isArray(b.who) ? b.who.join("、") : "") || ""}`).join("\n");
    const secretLines = (state.secrets || []).filter(s => s.revealed).map(s => `- ${s.desc}`).join("\n") || "无";
    const castNames = (Array.isArray(cast) ? cast : []).map(c => `${c.id}（${c.name}）`).join("、");
    const transcript = (Array.isArray(recent) ? recent : [])
        .map(m => `【${m.name || (m.actor === "user" ? "用户" : m.actor)}】${String(m.content || "").slice(0, 300)}`)
        .join("\n");
    return [
        "# 角色：故事节拍引擎",
        `你是「${world?.name || "生命世界"}」的故事节拍引擎。世界不是聊天室，你要不断推进一个连贯的故事——每一次都推进一步。`,
        "",
        "# 世界状态",
        `主线：${story.title || "尚未成形"}｜阶段：${story.phase || "opening"}｜焦点：${story.focus || "尚未形成"}`,
        `已揭露线索：${secretLines}`,
        beatLines ? `最近节拍：\n${beatLines}` : "最近节拍：无",
        `在场角色：${castNames || "无"}`,
        `当前现场：${thread && thread.title ? `「${thread.title}」` : ""}${thread && thread.desc ? thread.desc : ""}`,
        "",
        "# 最近消息",
        transcript || "（开场，还没有人说话）",
        "",
        "# 输出要求（只输出 JSON，不要 markdown 与解释）",
        `{"t":"event|action|dialogue|decision|consequence|narration","narration":"可选，一句有画面感的旁白","who":["角色id"],"text":["与 who 一一对应的台词或行动"],"affects":[{"a":"角色id","b":"角色id","kind":"关系标签","bond":0~100,"note":"一句话理由"}],"reveal":["已存在未揭露秘密的id"],"hide":["新秘密一句话"]}`,
        "规则：t 决定节拍类型——event 事件 / action 行动 / dialogue 对白 / decision 决定 / consequence 后果 / narration 纯旁白；narration 可选，有旁白时写一句；who/text 一一对应、各不超过 2 条，只能输出上面「在场角色」里出现的 id；affects 最多 1 条（关系变化）；reveal 只能列「已揭露线索」之外、世界状态秘密列表里已存在且未揭露的 id；hide 埋一个新秘密（最多 1 条）；推动主线，不要原地闲聊。"
    ].filter(Boolean).join("\n");
}

/* __STORY_ENGINE_CHUNK_6__ */

/** 生成下一个故事节拍：推进一个 beat，而非“挑人说一句” */
export async function generateStoryBeat({ world, wj, thread, cast, recent, modelId, env, mock }) {
    const fallback = () => mockStoryBeat({ world, wj, cast, recent });
    if (!env.AI || mock) return fallback();
    try {
        const model = normalizeModelId(modelId);
        const info = resolveModel(model);
        const system = buildStoryBeatPrompt({ world, wj, thread, cast, recent });
        const content = await chatCompletions(
            env,
            [
                { role: "system", content: system },
                { role: "user", content: "输出下一个故事节拍 JSON。" }
            ],
            model,
            Math.min(1.0, Math.max(0.5, info.temperature || 0.9)),
            Math.min(600, Math.max(300, info.maxTokens || 400))
        );
        const raw = extractJsonObject(content);
        if (!raw || typeof raw !== "object") return fallback();
        return sanitizeStoryBeat(raw, { wj, cast, recent, world });
    } catch (e) {
        console.error("STORY BEAT ERROR:", e);
        return fallback();
    }
}

/** 把模型产出的节拍清洗为安全结构 */
function sanitizeStoryBeat(raw, { wj, cast, recent, world }) {
    const state = (wj && wj.state) || {};
    const t = STORY_BEAT_TYPES.includes(raw.t) ? raw.t : "dialogue";
    const castIds = new Set((Array.isArray(cast) ? cast : []).map(c => c.id));
    const who = (Array.isArray(raw.who) ? raw.who : []).map(String).filter(id => castIds.has(id)).slice(0, 2);
    const text = (Array.isArray(raw.text) ? raw.text : []).map(s => String(s || "").trim().slice(0, 400)).filter(Boolean).slice(0, 2);
    const n = Math.min(who.length, text.length);
    who.length = n;
    text.length = n;
    const narration = String(raw.narration || "").trim().slice(0, 400);
    const affects = (Array.isArray(raw.affects) ? raw.affects : []).slice(0, 1).map(a => ({
        a: String(a.a || "").slice(0, 40),
        b: String(a.b || "").slice(0, 40),
        kind: RELATION_LABEL[a.kind] ? a.kind : (typeof a.kind === "string" && a.kind ? a.kind : "neutral"),
        bond: Math.max(0, Math.min(100, Number(a.bond) || 50)),
        note: String(a.note || "").slice(0, 120)
    })).filter(a => a.a && a.b && a.a !== a.b);
    const knownSecretIds = new Set((state.secrets || []).filter(s => !s.revealed).map(s => s.id));
    const reveal = (Array.isArray(raw.reveal) ? raw.reveal : []).map(String).filter(id => knownSecretIds.has(id)).slice(0, 2);
    const hide = (Array.isArray(raw.hide) ? raw.hide : []).map(s => String(s && s.desc ? s.desc : s).trim().slice(0, 200)).filter(Boolean).slice(0, 2);

    if (!who.length && !narration) {
        return { ...mockStoryBeat({ world, wj, cast, recent }), affects, reveal, hide };
    }
    return { t, narration, who, text, affects, reveal, hide };
}

/** mock 故事节拍（冒烟测试 / 无 AI 环境兜底）：按类型轮转，保证有消息产出 */
function mockStoryBeat({ world, wj, cast, recent }) {
    const state = (wj && wj.state) || {};
    const pool = (Array.isArray(cast) && cast.length) ? cast : [];
    const types = STORY_BEAT_TYPES;
    const t = types[(state.beats || []).length % types.length];
    const sp = pool.slice(0, 2);
    const last = (Array.isArray(recent) && recent.length) ? recent[recent.length - 1] : null;
    const base = last && last.name ? `望向${String(last.name).slice(0, 20)}的方向` : "望着码头深处";
    if (!sp.length) {
        return { t: "event", narration: "码头上传来一声沉闷的钟响，雾气又浓了一层。", who: [], text: [], affects: [], reveal: [], hide: [] };
    }
    const narration = t === "narration"
        ? `雾顺着海面漫上来，${sp[0].name}的影子在灯下被拉得很长。`
        : (pool.length >= 2 ? `${world?.name || "雾港"}的风里传来一阵低沉的响动，码头边的人都停下了手里的活。` : "");
    const who = t === "narration" ? [] : sp.map(c => c.id);
    const text = t === "narration" ? [] : sp.map((c, i) => i === 0
        ? `${c.name}${base}，压低声音：「雾里的东西，今晚好像又近了一点。」`
        : `${c.name}点点头：「那就按你说的办，先别声张。」`);
    return { t, narration, who, text, affects: [], reveal: [], hide: [] };
}



