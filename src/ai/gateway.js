/**
 * HYOOL AI Gateway
 *
 * Env (Worker secrets / .dev.vars):
 *   GEMINI_API_KEY or AI_API_KEY  API key — set either to enable real Gemini
 *   AI_CHAT_MODEL    optional, defaults to gemini-flash-latest
 *   AI_CREATE_MODEL  optional, model for character JSON
 *   IMAGE_PROVIDER   mock | openai
 *   IMAGE_MODEL      e.g. dall-e-3
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

function getApiKey(env) {
    return env.GEMINI_API_KEY || env.AI_API_KEY || "";
}

export async function generateCharacterFromIdea(idea, env) {
    if (!getApiKey(env)) {
        return mockGenerateCharacter(idea);
    }

    return callCreateModel(idea, env);
}

export async function chatWithCharacter(
    { character, memories, recentMessages, userMessage },
    env
) {
    if (!getApiKey(env)) {
        return mockChat(character, memories, userMessage);
    }

    return callChatModel(
        { character, memories, recentMessages, userMessage },
        env
    );
}

export async function generateCharacterImage(character, env) {
    const provider = (env.IMAGE_PROVIDER || "mock").toLowerCase();

    if (provider === "mock") {
        return {
            url: `/api/characters/${character.id}/portrait`,
            provider: "mock",
            asset_meta: { note: "Placeholder portrait; set IMAGE_PROVIDER to enable real generation." }
        };
    }

    return callImageModel(character, env);
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
        `（当前为 mock 对话模式。配置 GEMINI_API_KEY 后可接入真实大模型。）`;

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
        env.AI_CREATE_MODEL || env.AI_CHAT_MODEL
    );

    return parseCharacterJson(content, idea);
}

async function callChatModel(
    { character, memories, recentMessages, userMessage },
    env
) {
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
        env.AI_CHAT_MODEL
    );

    return {
        reply: String(reply || "").trim(),
        memory_note: `用户说：${userMessage.slice(0, 160)}`
    };
}

async function callImageModel(character, env) {
    const apiKey = getApiKey(env) || env.IMAGE_API_KEY;
    if (!apiKey) {
        throw new Error("IMAGE API key not configured.");
    }

    const baseUrl = normalizeBaseUrl(env.AI_BASE_URL);
    const model = env.IMAGE_MODEL || "dall-e-3";

    const prompt = [
        "character portrait, digital art, cinematic lighting,",
        character.appearance || "",
        character.name || ""
    ].join(" ");

    const response = await fetch(`${baseUrl}/images/generations`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model,
            prompt: prompt.slice(0, 900),
            n: 1,
            size: "1024x1024"
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data?.error?.message || "Image API failed.");
    }

    const url = data?.data?.[0]?.url || "";

    return {
        url,
        provider: env.IMAGE_PROVIDER || "openai",
        asset_meta: { model, prompt: prompt.slice(0, 200) }
    };
}

function toGeminiMessages(messages) {
    const systemText = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n");

    const rawContents = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }]
        }));

    const contents = [];
    for (const msg of rawContents) {
        const last = contents[contents.length - 1];
        if (last && last.role === msg.role) {
            last.parts[0].text += "\n" + msg.parts[0].text;
        } else {
            contents.push({ ...msg, parts: [{ text: msg.parts[0].text }] });
        }
    }

    while (contents.length > 0 && contents[0].role !== "user") {
        contents.shift();
    }

    return {
        systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
        contents
    };
}

async function chatCompletions(env, messages, modelOverride) {
    const apiKey = getApiKey(env);
    if (!apiKey) {
        throw new Error("AI API key not configured.");
    }

    const model = modelOverride || env.AI_CHAT_MODEL || env.AI_CREATE_MODEL || "gemini-flash-latest";
    const { systemInstruction, contents } = toGeminiMessages(messages);

    const body = {
        contents,
        generationConfig: {
            temperature: 0.9,
            maxOutputTokens: 300,
            topP: 0.95
        },
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
        ]
    };
    if (systemInstruction) {
        body.systemInstruction = systemInstruction;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    let lastError;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey
                },
                body: JSON.stringify(body)
            });

            const data = await response.json();

            if (!response.ok) {
                const errMsg = data?.error?.message || `Gemini API HTTP ${response.status}`;
                lastError = new Error(errMsg);
                if (response.status === 400) {
                    throw lastError;
                }
                if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
                    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1) * 2));
                    continue;
                }
                throw lastError;
            }

            const candidate = data?.candidates?.[0];
            const finishReason = candidate?.finishReason;

            const text = candidate?.content?.parts?.map((p) => p.text).filter(Boolean).join("");
            if (text) {
                return text;
            }

            if (finishReason === "SAFETY" || finishReason === "RECITATION") {
                return "（……似乎触发了安全过滤，换个话题聊聊吧。）";
            }
            return "（我一时不知该说什么……）";
        } catch (e) {
            lastError = e;
            if (attempt < 2) {
                await new Promise((r) => setTimeout(r, 1000 * (attempt + 1) * 2));
                continue;
            }
            throw e;
        }
    }

    throw lastError || new Error("Gemini API failed after retries.");
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

function normalizeBaseUrl(url) {
    const base = (url || "https://api.openai.com/v1").replace(/\/$/, "");
    return base.endsWith("/v1") ? base : `${base}/v1`;
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
