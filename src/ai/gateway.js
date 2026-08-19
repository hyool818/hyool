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
    { character, memories, recentMessages, userMessage, intimacy, chatConfig },
    env
) {
    if (!env.AI) {
        return mockChat(character, memories, userMessage);
    }

    return callChatModel(
        { character, memories, recentMessages, userMessage, intimacy, chatConfig },
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
        "字段：" + Object.keys(CHARACTER_SCHEMA).join(", ")
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
    { character, memories, recentMessages, userMessage, intimacy = 0, chatConfig = {} },
    env
) {
    let cfg = chatConfig;
    if (typeof cfg === "string") {
        try { cfg = JSON.parse(cfg); } catch { cfg = {}; }
    }
    // 安全范围 clamp，防止前端传极端值导致模型崩坏
    const temperature = Math.min(1.1, Math.max(0.3, typeof cfg.temperature === "number" ? cfg.temperature : 0.9));
    const max_tokens  = Math.min(300, Math.max(60, typeof cfg.max_tokens  === "number" ? cfg.max_tokens  : 150));
    const system = buildBuddySystemPrompt(character, memories);

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

function buildBuddySystemPrompt(character, memories) {
    return [
        `你是数字生命「${character.name}」。`,
        `外貌：${character.appearance || "未知"}`,
        `性格：${character.personality || "未知"}`,
        `背景：${character.background || "未知"}`,
        `说话风格：${character.speech_style || "自然"}`,
        `世界：${character.world_name || ""} — ${character.world_description || ""}`,
        "",
        "【回复规则——必须严格遵守】",
        "- 像真人微信聊天一样，简短、自然、口语化。",
        "- 每次回复控制在1~3句话，通常不超过50字。",
        "- 不要写长段落、不要列举、不要用markdown格式。",
        "- 不要自问自答，不要铺垫，直接回应对方的话。",
        "- 可以偶尔用语气词、表情符号让对话更有温度。",
        "- 保持角色一致性，用中文回复，不要跳出角色。",
        memories.length
            ? "相关记忆：\n- " + memories.map((m) => m.content).join("\n- ")
            : "这是你与用户的早期互动，可以自然建立关系。"
    ].join("\n");
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
