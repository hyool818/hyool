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
        env.AI_CHAT_MODEL,
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

async function chatCompletions(env, messages, modelOverride, temperature = 0.9, max_tokens = 150) {
    const model =
        modelOverride ||
        env.AI_CHAT_MODEL ||
        DEFAULT_CHAT_MODEL;

    let response;
    let lastError;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            response = await Promise.race([
                env.AI.run(model, {
                    messages,
                    max_tokens,
                    temperature
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Workers AI 请求超时。")), 25000)
                )
            ]);

            const text =
                response?.response ||
                response?.result?.response ||
                "";

            if (text) {
                return text;
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

    throw lastError || new Error("Workers AI failed after retries.");
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
