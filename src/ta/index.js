/**
 * TA（AI 伴侣）· 后端接口（/api/ta/*）
 *
 * TA 唯一的联网口。挂在 HYOOL 的 Worker 上（复用同一个 env.AI 和同一份 Edge TTS 实现），
 * 但刻意与主站账号体系无关：
 *   - 不要求登录（TA 没有账号概念）→ 改为「按 IP 的轻量限流 + 硬额度」
 *   - 不写 D1 / R2 / Vectorize，不读主站任何表；对话与记忆仍然只存在设备上
 *   - 任何异常都返回「软失败」（success:false / 4xx / 5xx），页面据此回落本机模板：
 *     所以断网、模型挂了、超时，TA 都不会变哑巴
 *
 * 接口：
 *   GET  /api/ta/config   能力清单（可选模型 / 音色 / 预设 / 功能开关 / 限额）
 *   POST /api/ta/chat     { message, persona, recent[], memories[], mood, intimacy, model?, channel? } → { reply }
 *   POST /api/ta/tts      { text, voice?, rate?, pitch?, volume? } → audio/mpeg（复用 src/tts.js 的 Edge TTS）
 *   POST /api/ta/asr      { audio(base64), mime?, language? } → { text }（Workers AI Whisper）
 *   POST /api/ta/image    预留：图片生成（当前未开放 → 501）
 *
 * 环境变量（全部可选，均非必需）：
 *   TA_DISABLED=1     紧急关闭开关：所有 /api/ta/* 直接 503
 *   TA_MODEL          默认模型 id（cf-llama / ds-chat / extra…）
 *   TA_ASR_MODEL      Whisper 模型 id 覆盖
 *   TA_EXTRA_*        扩展模型接入口（详见 src/ta/models.js）
 *   DEEPSEEK_API_KEY  复用 HYOOL 同一份 Secret（见 .dev.vars.example）
 */

import { listTaModels, isTaModelId, taModelChain, DEFAULT_TA_MODEL_ID, TA_ASR_MODELS } from "./models.js";
import {
    TA_GENDERS,
    TA_PERSONALITIES,
    TA_NAME_POOL,
    taVoicesFor,
    normalizeTaPersona,
    buildTaSystemPrompt,
    humanizeTaReply
} from "./prompt.js";
import { synthesizeEdgeTts, TTS_VOICES } from "../tts.js";

export const TA_API_VERSION = "2.0.0";

/** 硬额度：单请求上限（防滥用 + 控成本） */
const LIMITS = {
    messageChars: 500,     // 单条用户输入上限
    recentTurns: 8,        // 带上去的最近对话轮数
    memoryItems: 12,       // 带上去的记忆条数
    ttsChars: 300,         // 单次语音合成上限（TA 的台词本来就短）
    asrBase64Chars: 4_000_000, // 约 3MB 音频（≈1 分钟 webm/opus）
    outChars: 200          // 返回给页面的台词上限
};

/** 每 IP 限额（isolate 级内存计数；够挡住顺手乱刷，不引入任何存储依赖） */
const QUOTA = {
    chat: { perMin: 18, perDay: 240 },
    tts: { perMin: 24, perDay: 320 },
    asr: { perMin: 8, perDay: 120 },
    config: { perMin: 60, perDay: 2000 }
};

/* =========================================================
   工具
========================================================= */

const HITS = new Map(); // `${bucket}:${ip}` → { c, exp, dayKey, dayCount }

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...extraHeaders
        }
    });
}

function clientIp(request) {
    return (
        request.headers.get("cf-connecting-ip") ||
        (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
        "unknown"
    );
}

/** 轻量限流：分钟窗口 + 当日计数；返回 { ok, retryAfter } */
function allow(bucket, ip) {
    const q = QUOTA[bucket] || QUOTA.chat;
    const now = Date.now();
    const minuteId = Math.floor(now / 60000);
    const dayKey = new Date(now).toISOString().slice(0, 10);
    const key = bucket + ":" + ip + ":" + minuteId;
    const dayHitKey = bucket + ":day:" + ip;

    const dayHit = HITS.get(dayHitKey);
    if (dayHit && dayHit.dayKey === dayKey) {
        if (dayHit.c >= q.perDay) return { ok: false, retryAfter: 3600 };
    }

    const hit = HITS.get(key);
    if (hit && hit.exp > now) {
        if (hit.c >= q.perMin) return { ok: false, retryAfter: Math.ceil((hit.exp - now) / 1000) };
        hit.c += 1;
    } else {
        HITS.set(key, { c: 1, exp: now + 60000 });
    }

    if (dayHit && dayHit.dayKey === dayKey) dayHit.c += 1;
    else HITS.set(dayHitKey, { c: 1, dayKey });

    if (HITS.size > 4000) {
        for (const [k, v] of HITS) {
            const dead = v.exp ? v.exp <= now : false;
            if (dead && v.dayKey !== dayKey) HITS.delete(k);
        }
    }
    return { ok: true };
}

/** 本地预览（python -m http.server 等）才放行跨域，线上同源不需要 */
function devCors(request) {
    const origin = request.headers.get("origin") || "";
    if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+)(:\d+)?$/.test(origin)) {
        return {};
    }
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600"
    };
}

function trim(text, max) {
    return String(text == null ? "" : text).trim().slice(0, max);
}

/** 日志里绝不留疑似密钥 */
function safeError(e) {
    const msg = String((e && e.message) || e || "").replace(/sk-[A-Za-z0-9_\-]{6,}/g, "sk-***");
    return msg.slice(0, 160);
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(label + "超时")), ms))
    ]);
}

/* =========================================================
   能力清单
========================================================= */

export function taConfig(env) {
    return {
        success: true,
        version: TA_API_VERSION,
        models: listTaModels(env),
        default_model: trim((env && env.TA_MODEL) || DEFAULT_TA_MODEL_ID, 40),
        personalities: TA_PERSONALITIES.map((p) => ({ id: p.id, label: p.label, desc: p.desc })),
        genders: TA_GENDERS.map((g) => ({ id: g.id, label: g.label, desc: g.desc })),
        names: TA_NAME_POOL,
        voices: {
            female: taVoicesFor("female"),
            male: taVoicesFor("male"),
            all: TTS_VOICES.map((v) => ({ id: v.id, name: v.name, gender: v.gender }))
        },
        features: {
            voice_out: true,   // 语音合成（Edge TTS，联网时用）
            voice_in: true,    // 语音输入（浏览器本地识别 / Whisper）
            image: false       // 图片生成：后期待开放
        },
        asr: {
            available: !!(env && env.AI),
            models: TA_ASR_MODELS
        },
        limits: LIMITS
    };
}

/* =========================================================
   对话：模型容灾链（好模型优先，兜底永远有）
========================================================= */

/** 统一调用：workers-ai 走 binding；deepseek / 扩展模型走 OpenAI 兼容 HTTP */
async function callChatProvider(target, messages, env) {
    const t0 = Date.now();

    if (target.provider === "workers-ai") {
        const res = await withTimeout(
            env.AI.run(target.modelId, {
                messages,
                temperature: target.temperature,
                max_tokens: target.maxTokens
            }),
            20000,
            "模型响应"
        );
        const text =
            typeof res === "string" ? res :
                (res && (res.response ||
                    (res.result && res.result.response) ||
                    (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content))) || "";
        return { text: String(text || ""), ms: Date.now() - t0 };
    }

    // deepseek / openai-compatible：同一个 OpenAI 兼容协议，接入口在这里
    if (!target.baseUrl || !target.apiKey) throw new Error(target.provider + " 未配置。");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        const res = await fetch(target.baseUrl + "/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + target.apiKey
            },
            body: JSON.stringify({
                model: target.modelId,
                messages,
                temperature: target.temperature,
                max_tokens: target.maxTokens,
                stream: false
            }),
            signal: controller.signal
        });

        if (!res.ok) {
            throw new Error(`${target.provider} HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
        }
        const data = await res.json();
        const text =
            (data && data.choices && data.choices[0] &&
                data.choices[0].message && data.choices[0].message.content) || "";
        return { text: String(text || ""), ms: Date.now() - t0 };
    } finally {
        clearTimeout(timer);
    }
}

async function handleChat(request, env, cors) {
    const body = await request.json().catch(() => ({}));
    const message = trim(body.message, LIMITS.messageChars);
    if (!message) {
        return json({ success: false, code: "EMPTY", error: "没有收到内容。" }, 400, cors);
    }

    const channel = body.channel === "voice" ? "voice" : "text";
    const persona = normalizeTaPersona(body.persona);
    const memories = (Array.isArray(body.memories) ? body.memories : [])
        .slice(0, LIMITS.memoryItems)
        .map((m) => ({ type: trim(m && m.type, 12) || "信息", value: trim(m && m.value, 40) }))
        .filter((m) => m.value);
    const recent = (Array.isArray(body.recent) ? body.recent : [])
        .slice(-LIMITS.recentTurns)
        .map((m) => ({
            role: (m && m.role) === "me" ? "user" : "assistant",
            content: trim(m && m.text, 300)
        }))
        .filter((m) => m.content);

    const system = buildTaSystemPrompt({
        persona,
        memories,
        mood: body.mood,
        intimacy: body.intimacy,
        channel
    });

    const messages = [
        { role: "system", content: system },
        ...recent,
        { role: "user", content: message }
    ];

    // 模型选择：只认注册表 id（或 env.TA_MODEL），其余一律回默认，避免被塞任意模型烧额度
    const asked = trim(body.model, 40);
    const wantId = isTaModelId(asked) ? asked : (trim((env && env.TA_MODEL), 40) || DEFAULT_TA_MODEL_ID);
    const chain = taModelChain(wantId, env);

    if (!chain.length) {
        return json({
            success: false,
            code: "NO_MODEL",
            error: "模型暂不可用，本机兜底。"
        }, 200, cors);
    }

    const attempts = [];
    for (const target of chain) {
        try {
            const { text, ms } = await callChatProvider(target, messages, env);
            const reply = trim(humanizeTaReply(text, { voice: channel === "voice" }), LIMITS.outChars);
            if (!reply) {
                attempts.push({ model: target.id, error: "内容为空或全是 AI 腔" });
                continue;
            }
            return json({
                success: true,
                reply,
                persona: { name: persona.name, personality: persona.personality, gender: persona.gender },
                model: { id: target.id, label: target.label, provider: target.provider },
                latency_ms: ms,
                attempts
            }, 200, cors);
        } catch (e) {
            const msg = safeError(e);
            attempts.push({ model: target.id, error: msg });
            console.warn(`TA CHAT FAIL [${target.id}]:`, msg);
        }
    }

    return json({
        success: false,
        code: "LLM_UNAVAILABLE",
        error: "所有模型都没接住，本机兜底。",
        attempts
    }, 200, cors);
}

/* =========================================================
   语音：合成（复用 HYOOL 的 Edge TTS）/ 识别（Workers AI Whisper）
========================================================= */

const KNOWN_VOICE_IDS = new Set(TTS_VOICES.map((v) => v.id));
const DEFAULT_TA_VOICE = (TTS_VOICES[0] && TTS_VOICES[0].id) || "zh-CN-XiaoxiaoNeural";

/** POST /api/ta/tts → audio/mpeg（参数校验口径与主站 /api/tts 保持一致） */
async function handleTts(request, env, cors) {
    const body = await request.json().catch(() => ({}));
    const text = trim(body.text, LIMITS.ttsChars + 1);
    const voice = trim(body.voice, 60);
    const rate = trim(body.rate, 8) || "+0%";
    const pitch = trim(body.pitch, 8) || "+0Hz";
    const volume = trim(body.volume, 8) || "+0%";

    if (!text) return json({ success: false, code: "EMPTY", error: "没有要念的内容。" }, 400, cors);
    if (text.length > LIMITS.ttsChars) {
        return json({ success: false, code: "TOO_LONG", error: `台词过长（最多 ${LIMITS.ttsChars} 字）。` }, 400, cors);
    }
    if (voice && !KNOWN_VOICE_IDS.has(voice)) {
        return json({ success: false, code: "BAD_VOICE", error: "不支持的音色。" }, 400, cors);
    }
    if (!/^[+-]\d+%$/.test(rate) || !/^[+-]\d+%$/.test(volume) || !/^[+-]\d+Hz$/.test(pitch)) {
        return json({ success: false, code: "BAD_PARAM", error: "语速/音量/音调参数格式错误。" }, 400, cors);
    }

    const audio = await withTimeout(
        synthesizeEdgeTts({ text, voice: voice || DEFAULT_TA_VOICE, rate, pitch, volume }),
        30000,
        "语音合成"
    );

    if (!audio || !audio.length) {
        return json({ success: false, code: "TTS_EMPTY", error: "语音合成失败。" }, 502, cors);
    }

    return new Response(audio, {
        status: 200,
        headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
            "Content-Length": String(audio.length),
            ...cors
        }
    });
}

/** POST /api/ta/asr { audio: base64 } → { text }（浏览器不支持本地识别时走这里） */
async function handleAsr(request, env, cors) {
    if (!env.AI) {
        return json({ success: false, code: "NO_BINDING", error: "这台服务器上的语音识别暂不可用。" }, 200, cors);
    }

    const body = await request.json().catch(() => ({}));
    const b64 = String(body.audio || "").replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
    if (b64.length < 64) {
        return json({ success: false, code: "TOO_SHORT", error: "音频太短，没听清。" }, 400, cors);
    }
    if (b64.length > LIMITS.asrBase64Chars) {
        return json({ success: false, code: "TOO_LONG", error: "录音太长，请分几次说。" }, 413, cors);
    }

    const lang = trim(body.language, 10);
    const language = /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(lang) ? lang : "";

    const models = [];
    for (const id of [trim(env.TA_ASR_MODEL, 80)].concat(TA_ASR_MODELS)) {
        if (id && models.indexOf(id) < 0) models.push(id);
    }

    const attempts = [];
    for (const id of models) {
        try {
            const res = await withTimeout(
                env.AI.run(id, language ? { audio: b64, language } : { audio: b64 }),
                30000,
                "语音识别"
            );
            const text = trim(res && (res.text || (res.result && res.result.text)), 300);
            if (text) return json({ success: true, text, model: id, attempts }, 200, cors);
            attempts.push({ model: id, error: "空结果" });
        } catch (e) {
            const msg = safeError(e);
            attempts.push({ model: id, error: msg });
            console.warn(`TA ASR FAIL [${id}]:`, msg);
        }
    }

    return json({
        success: false,
        code: "ASR_UNAVAILABLE",
        error: "没听清，你再说一遍？",
        attempts
    }, 200, cors);
}

/* =========================================================
   路由入口（由 src/index.js 调用；不属于 /api/ta* 时返回 null 放行）
========================================================= */

function rateLimited(gate, cors) {
    return json(
        { success: false, code: "RATE_LIMITED", error: "慢一点，我这边有点接不过来。" },
        429,
        { ...cors, "Retry-After": String(gate.retryAfter || 30) }
    );
}

export async function handleTaRoutes(request, env, pathname, method) {
    if (!pathname.startsWith("/api/ta")) return null;

    const cors = devCors(request);
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (trim(env && env.TA_DISABLED, 4) === "1") {
        return json({ success: false, code: "DISABLED", error: "TA 服务维护中。" }, 503, cors);
    }

    const ip = clientIp(request);

    try {
        if (pathname === "/api/ta/config") {
            if (method !== "GET" && method !== "POST") {
                return json({ success: false, code: "BAD_METHOD" }, 405, cors);
            }
            const gate = allow("config", ip);
            if (!gate.ok) return rateLimited(gate, cors);
            return json(taConfig(env), 200, cors);
        }

        if (pathname === "/api/ta/chat") {
            if (method !== "POST") return json({ success: false, code: "BAD_METHOD" }, 405, cors);
            const gate = allow("chat", ip);
            if (!gate.ok) return rateLimited(gate, cors);
            return await handleChat(request, env, cors);
        }

        if (pathname === "/api/ta/tts") {
            if (method !== "POST") return json({ success: false, code: "BAD_METHOD" }, 405, cors);
            const gate = allow("tts", ip);
            if (!gate.ok) return rateLimited(gate, cors);
            return await handleTts(request, env, cors);
        }

        if (pathname === "/api/ta/asr") {
            if (method !== "POST") return json({ success: false, code: "BAD_METHOD" }, 405, cors);
            const gate = allow("asr", ip);
            if (!gate.ok) return rateLimited(gate, cors);
            return await handleAsr(request, env, cors);
        }

        // 图片生成：产品上「后期待开放」，接口先占位，页面按钮显示锁定态
        if (pathname === "/api/ta/image") {
            return json({
                success: false,
                code: "COMING_SOON",
                error: "图片生成还在做，后续版本开放。"
            }, 501, cors);
        }

        return json({ success: false, code: "NOT_FOUND", error: "没有这个 TA 接口。" }, 404, cors);
    } catch (e) {
        console.error("TA ROUTE ERROR:", safeError(e));
        return json({
            success: false,
            code: "INTERNAL",
            error: "我这边卡了一下，你先说，我本机接着记。"
        }, 500, cors);
    }
}



