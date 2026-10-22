/**
 * TA（AI 伴侣）· 后端接口（/api/ta/*）
 *
 * TA 唯一的联网口。挂在 HYOOL 的 Worker 上（复用同一个 env.AI），
 * 但刻意与主站账号体系无关：
 *   - 不要求登录（TA 没有账号概念）→ 改为「按 IP 的轻量限流 + 硬额度」
 *   - 不写 D1 / R2 / Vectorize，不读主站任何表；对话与记忆仍然只存在设备上
 *   - 任何异常都返回「软失败」（success:false / 4xx / 5xx），页面据此回落本机模板：
 *     所以断网、模型挂了、超时，TA 都不会变哑巴
 *
 * 接口：
 *   GET  /api/ta/config   能力清单（可选模型 / 音色 / 预设 / 功能开关 / 限额 / 本机模型提示）
 *   POST /api/ta/chat     { message, persona, recent[], memories[], mood, intimacy, model?, channel? } → { reply }
 *   POST /api/ta/prompt   { persona, memories[], mood, intimacy, channel? } → { system }（只出提示词，不调模型）
 *   POST /api/ta/polish   { text, channel? } → { reply }（只做「去 AI 味」清洗，不调模型）
 *   POST /api/ta/tts      { text, voice?, rate?, pitch?, volume? } → audio/*（自建 GPT-SoVITS → Workers AI MeloTTS，来源见响应头 X-TA-TTS-Provider）
 *   POST /api/ta/asr      { audio(base64), mime?, language? } → { text }（Workers AI Whisper）
 *   POST /api/ta/image    预留：图片生成（当前未开放 → 501）
 *
 * 环境变量（全部可选，均非必需）：
 *   TA_DISABLED=1     紧急关闭开关：所有 /api/ta/* 直接 503
 *   TA_MODEL          默认模型 id（cf-llama / ds-chat / local-qwen / extra…）
 *   TA_ASR_MODEL      Whisper 模型 id 覆盖
 *   TA_LOCAL_LLM_URL  本机模型地址（**必须是隧道/公网地址**：Worker 到不了 127.0.0.1）。
 *                     不填 = 服务端链路里没有本机模型（页面仍可直连本机，见 public/ta.html）
 *   TA_LOCAL_LLM_MODEL / TA_LOCAL_LLM_KEY / TA_LOCAL_LLM_TEMPERATURE / TA_LOCAL_LLM_MAX_TOKENS
 *   TA_TTS_MODEL      站内合成层模型（默认 @cf/myshell-ai/melotts）
 *   TA_TTS_LOCAL_URL  自建 GPT-SoVITS 地址（不填 = 该层不参与链）
 *   TA_TTS_LOCAL_REF  默认参考音频（机器上的本地路径）
 *   TA_TTS_LOCAL_FEMALE_REF / TA_TTS_LOCAL_MALE_REF  按性别兜底的参考音频（女声 6 / 男声 6 各一把嗓子）
 *   TA_TTS_LOCAL_FEMALE_PROMPT_TEXT / TA_TTS_LOCAL_MALE_PROMPT_TEXT  上面两条音频对应的原文
 *   TA_TTS_LOCAL_VOICES  JSON：音色 id → { ref, prompt, prompt_lang }
 *   TA_TTS_LOCAL_PROMPT_TEXT / TA_TTS_LOCAL_PROMPT_LANG / TA_TTS_LOCAL_TEXT_LANG
 *   TA_TTS_LOCAL_MEDIA / TA_TTS_LOCAL_TOKEN
 *   TA_EXTRA_*        扩展模型接入口（详见 src/ta/models.js）
 *   DEEPSEEK_API_KEY  复用 HYOOL 同一份 Secret（见 .dev.vars.example）
 */

import { listTaModels, isTaModelId, taModelChain, localLlmHint, DEFAULT_TA_MODEL_ID, TA_ASR_MODELS } from "./models.js";
import {
    TA_GENDERS,
    TA_PERSONALITIES,
    TA_NAME_POOL,
    taVoicesFor,
    normalizeTaPersona,
    buildTaSystemPrompt,
    humanizeTaReply
} from "./prompt.js";
import { TTS_VOICES } from "../tts.js";

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
    // 本机模型的链路是「/prompt → 本机 LLM → /polish」，一个来回各两次；
    // 这两条不打模型、只出文本，额度给宽一点，别让本机模型的用户被限流逼回云端
    prompt: { perMin: 40, perDay: 600 },
    polish: { perMin: 40, perDay: 600 },
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
        // 本地预览（http.server）是跨源：不 expose 的话页面读不到「实际命中哪层」
        "Access-Control-Expose-Headers": "X-TA-TTS-Provider,X-TA-TTS-Voice,X-TA-TTS-Attempts",
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
            voice_out: true,   // 语音合成（服务端链：自建 GPT-SoVITS → 站内 MeloTTS；都不可用时页面走设备语音）
            voice_in: true,    // 语音输入（浏览器本地识别 / Whisper）
            image: false       // 图片生成：后期待开放
        },
        tts: {
            chain: ttsChain(env),                    // 实际启用的合成层（按优先级）
            local: !!(env && trim(env.TA_TTS_LOCAL_URL, 300)),
            local_voices: ttsLocalVoiceIds(env),     // GPT-SoVITS 已配参考音频的音色 id（逐音色映射表里的）
            // 参考音频覆盖到哪一级：页面/运维据此判断「男声是不是还在共用女声」，只给布尔值（路径是机器本地信息）
            refs: {
                by_voice: ttsLocalVoiceIds(env).length,
                female: !!trim(env && env.TA_TTS_LOCAL_FEMALE_REF, 300),
                male: !!trim(env && env.TA_TTS_LOCAL_MALE_REF, 300),
                fallback: !!trim(env && env.TA_TTS_LOCAL_REF, 300)
            }
        },
        llm: localLlmHint(env),                      // 本机模型（页面直连 / Worker 走隧道）
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

    // deepseek / openai-compatible / local：同一个 OpenAI 兼容协议，接入口在这里
    if (!target.baseUrl) throw new Error(target.provider + " 未配置地址。");
    if (target.provider !== "local" && !target.apiKey) throw new Error(target.provider + " 未配置。");

    // 本机模型（qwen3.6 这类 30B+）首字比云端慢，给足 30s；云端仍按 20s
    const budget = target.provider === "local" ? 30000 : 20000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budget);
    try {
        const headers = { "Content-Type": "application/json" };
        if (target.apiKey) headers.Authorization = "Bearer " + target.apiKey;
        const res = await fetch(target.baseUrl + "/chat/completions", {
            method: "POST",
            headers: headers,
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

/**
 * 把页面传来的对话上下文收紧成标准结构（chat / prompt 共用）：
 * 人设越界静默回落、记忆与最近对话限量、channel 只认 voice / text。
 * 页面侧直连本机模型时，提示词必须仍然从这里出 —— 「收紧人设 + 去 AI 味」只有一份实现。
 */
function readChatContext(body) {
    const b = (body && typeof body === "object") ? body : {};
    return {
        message: trim(b.message, LIMITS.messageChars),
        channel: b.channel === "voice" ? "voice" : "text",
        persona: normalizeTaPersona(b.persona),
        memories: (Array.isArray(b.memories) ? b.memories : [])
            .slice(0, LIMITS.memoryItems)
            .map((m) => ({ type: trim(m && m.type, 12) || "信息", value: trim(m && m.value, 40) }))
            .filter((m) => m.value),
        recent: (Array.isArray(b.recent) ? b.recent : [])
            .slice(-LIMITS.recentTurns)
            .map((m) => ({
                role: (m && m.role) === "me" ? "user" : "assistant",
                content: trim(m && m.text, 300)
            }))
            .filter((m) => m.content),
        mood: b.mood,
        intimacy: b.intimacy
    };
}

async function handleChat(request, env, cors) {
    const body = await request.json().catch(() => ({}));
    const { message, channel, persona, memories, recent, mood, intimacy } = readChatContext(body);
    if (!message) {
        return json({ success: false, code: "EMPTY", error: "没有收到内容。" }, 400, cors);
    }

    const system = buildTaSystemPrompt({ persona, memories, mood, intimacy, channel });

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

/* ---------------------------------------------------------
   本机模型的两个配套口（页面直连本机时用；都不调任何模型、不烧额度）
   Worker 在 Cloudflare 边缘，`127.0.0.1` 永远够不着 —— 所以「本机模型」
   这条路由页面自己发请求，但提示词与清洗仍然回到这里取，保证只有一份实现。
--------------------------------------------------------- */

/** POST /api/ta/prompt → 只出系统提示词 */
async function handlePrompt(request, env, cors) {
    const body = await request.json().catch(() => ({}));
    const { channel, persona, memories, mood, intimacy } = readChatContext(body);
    const system = buildTaSystemPrompt({ persona, memories, mood, intimacy, channel });
    return json({
        success: true,
        channel,
        system,
        persona: { name: persona.name, personality: persona.personality, gender: persona.gender },
        max_out: LIMITS.outChars
    }, 200, cors);
}

/** POST /api/ta/polish → 只做「去 AI 味」清洗（本机模型吐回来的台词过一遍） */
async function handlePolish(request, env, cors) {
    const body = await request.json().catch(() => ({}));
    const raw = trim(body.text, 1200);
    if (!raw) return json({ success: false, code: "EMPTY", error: "没有收到内容。" }, 400, cors);
    const reply = trim(humanizeTaReply(raw, { voice: body.channel === "voice" }), LIMITS.outChars);
    return json({ success: true, reply, ok: !!reply, code: reply ? "" : "AI_SPEAK" }, 200, cors);
}

/* =========================================================
   语音：合成（自建 GPT-SoVITS → Workers AI MeloTTS）/ 识别（Workers AI Whisper）
========================================================= */

const KNOWN_VOICE_IDS = new Set(TTS_VOICES.map((v) => v.id));
const DEFAULT_TA_VOICE = (TTS_VOICES[0] && TTS_VOICES[0].id) || "zh-CN-XiaoxiaoNeural";

/* 合成链的时间预算。铁律：**服务端总预算 < 页面的 TTS_TIMEOUT_MS**，
   否则页面会先放弃、服务器白算一场，用户听到的就永远是兜底音（曾经的真实故障）。 */
const TTS_TIER_TIMEOUT_MS = 6000;        // 单层单次上限（自建实测 1.4~2.7s，给足余量）
const TTS_LOCAL_TRIES = 2;               // 自建层最多试几次（隧道冷连接/连接被掐断是一次性抖动）
const TTS_TOTAL_BUDGET_MS = 20000;       // 整条链上限（页面是 22s）
const TTS_FAST_FAIL_MS = 2500;           // 只有「这么快就失败」的才值得立刻重试

/** base64 → 字节（Workers 里的 atob 分块解，避免大字符串爆栈） */
function base64ToBytes(b64) {
    const clean = String(b64 || "").replace(/[^A-Za-z0-9+/=]/g, "");
    if (!clean) return null;
    try {
        const bin = atob(clean);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out.length ? out : null;
    } catch (e) {
        return null;
    }
}

/**
 * 语音合成降级链（页面侧还有「设备本地语音」兜底，见 docs/TA.md §7）：
 *   1) 自建 GPT-SoVITS —— 中文听感最好、音色就是你自己的参考音频；但跑在你自己机器上，
 *      Worker 必须能通过 Cloudflare Tunnel / 公网反代访问（`127.0.0.1` 从 Worker 里够不着）。
 *      配了 TA_TTS_LOCAL_URL + 参考音频才启用。
 *   2) Workers AI MeloTTS —— 站内推理、无外网握手、零配置；单一音色，lang=zh。
 * 任一层成功即返回，实际来源写在响应头 X-TA-TTS-Provider 上。
 *
 * Edge 神经语音已从 TA 这条链里移除：免费 readaloud 端点只给 24kHz/48kbps 单档、
 * 用不了 <mstts:express-as> 情感风格（见 src/tts.js 顶部实测结论），线上还会被 403。
 * `src/tts.js` 继续服务主站 /api/tts，TA 不再引用它的合成函数（只借音色表 TTS_VOICES）。
 */

/** "+10%" → 1.1（GPT-SoVITS 只认 speed_factor，不认识 SSML 的 rate 百分比） */
function rateToSpeedFactor(rate) {
    const m = /^([+-])(\d+)%$/.exec(String(rate || ""));
    if (!m) return 1;
    const v = 1 + (m[1] === "-" ? -1 : 1) * (parseInt(m[2], 10) / 100);
    return Math.min(2, Math.max(0.5, Math.round(v * 100) / 100));
}

/**
 * TA_TTS_LOCAL_VOICES（JSON）解析：把音色池 id 映射到各自的 GPT-SoVITS 参考音频，例如
 *   {"zh-CN-XiaoxiaoNeural":{"ref":"voices/xiaoxiao.wav","prompt":"今天天气不错"},"zh-CN-YunxiNeural":{"ref":"voices/yunxi.wav"}}
 * 写坏了（不是合法 JSON）当成没配 —— 不影响对话。
 */
function localVoiceMap(env) {
    const raw = trim(env && env.TA_TTS_LOCAL_VOICES, 8000);
    if (!raw) return null;
    try {
        const map = JSON.parse(raw);
        return map && typeof map === "object" ? map : null;
    } catch (e) {
        return null;
    }
}

/** 映射表里真正带参考音频的音色 id（只认音色池内的 id，防止乱填） */
function ttsLocalVoiceIds(env) {
    const map = localVoiceMap(env);
    if (!map) return [];
    return Object.keys(map).filter((id) => KNOWN_VOICE_IDS.has(id) && map[id] && trim(map[id].ref, 300));
}

/** 音色 id → 性别（复用 src/tts.js 的 TTS_VOICES；未知 id 返回空串，由上层回落默认） */
function voiceGenderOf(voice) {
    const hit = TTS_VOICES.find((v) => v.id === voice);
    return hit ? String(hit.gender || "") : "";
}

/**
 * 取某个音色对应的 GPT-SoVITS 参考音频。三级优先（写坏/没配的那级直接跳过，不报错）：
 *   1) TA_TTS_LOCAL_VOICES[voice] —— 一人一音色，最精确
 *   2) 性别档 TA_TTS_LOCAL_FEMALE_REF / TA_TTS_LOCAL_MALE_REF —— **只备两份素材就能让 12 个音色分男女**
 *   3) TA_TTS_LOCAL_REF —— 全局默认，一份素材兜所有
 *
 * 为什么非要第 2 级：音色池是 6 女 6 男，只配一份默认参考音频的话，用户把「音色」从
 * 晓晓换成云希（女声换男声）听到的还是同一把嗓子 —— 人设直接塌掉。而按音色逐条配
 * 12 份素材对普通人是过度要求：**两份（一男一女）** 才是能落地的口径。
 */
function localVoiceProfile(env, voice) {
    const map = localVoiceMap(env);
    const hit = map ? map[voice] : null;
    if (hit && typeof hit === "object" && trim(hit.ref, 300)) {
        return {
            key: voice,
            ref: trim(hit.ref, 300),
            prompt: trim(hit.prompt, 500),
            promptLang: trim(hit.prompt_lang, 10) || "zh"
        };
    }

    const gender = voiceGenderOf(voice);
    const genderRef = gender === "female"
        ? trim(env && env.TA_TTS_LOCAL_FEMALE_REF, 300)
        : (gender === "male" ? trim(env && env.TA_TTS_LOCAL_MALE_REF, 300) : "");
    if (genderRef) {
        return {
            key: gender + "-default",
            ref: genderRef,
            // 性别档没写原文时回落全局原文：prompt_text 与音频不一致会带口音，但总好过不出声
            prompt: trim(gender === "female"
                ? (env && env.TA_TTS_LOCAL_FEMALE_PROMPT_TEXT)
                : (env && env.TA_TTS_LOCAL_MALE_PROMPT_TEXT), 500) || trim(env && env.TA_TTS_LOCAL_PROMPT_TEXT, 500),
            promptLang: trim(env && env.TA_TTS_LOCAL_PROMPT_LANG, 10) || "zh"
        };
    }

    const ref = trim(env && env.TA_TTS_LOCAL_REF, 300);
    if (!ref) return null;
    return {
        key: "local-default",
        ref: ref,
        prompt: trim(env.TA_TTS_LOCAL_PROMPT_TEXT, 500),
        promptLang: trim(env.TA_TTS_LOCAL_PROMPT_LANG, 10) || "zh"
    };
}

/** 自建层端点：文档承诺「只填域名，/tts 由代码补」，同时兼容直接填完整端点 */
export function localTtsEndpoint(env) {
    const raw = trim(env && env.TA_TTS_LOCAL_URL, 300);
    if (!raw) return "";
    const base = raw.replace(/\/+$/, "");
    return /\/tts$/i.test(base) ? base : base + "/tts";
}

/** 自建 GPT-SoVITS（官方 api_v2.py）：POST /tts 成功直接回音频流，失败回 400 + JSON */
async function synthLocalTts({ env, text, voice, rate }) {
    const url = localTtsEndpoint(env);
    if (!url) return { skip: "未配置 TA_TTS_LOCAL_URL" };
    const profile = localVoiceProfile(env, voice);
    if (!profile) return { skip: "未配置 TA_TTS_LOCAL_REF / TA_TTS_LOCAL_FEMALE_REF / TA_TTS_LOCAL_MALE_REF / TA_TTS_LOCAL_VOICES" };

    const rawMedia = trim(env.TA_TTS_LOCAL_MEDIA, 8);
    const media = /^(wav|mp3|ogg|aac)$/.test(rawMedia) ? rawMedia : "wav";
    const headers = { "Content-Type": "application/json" };
    const token = trim(env.TA_TTS_LOCAL_TOKEN, 200);
    if (token) headers.Authorization = "Bearer " + token;

    const res = await withTimeout(fetch(url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
            text: text,
            text_lang: trim(env.TA_TTS_LOCAL_TEXT_LANG, 10) || "zh",
            ref_audio_path: profile.ref,
            prompt_text: profile.prompt,
            prompt_lang: profile.promptLang,
            text_split_method: "cut5",
            batch_size: 1,
            media_type: media,
            streaming_mode: false,
            speed_factor: rateToSpeedFactor(rate),
            seed: -1
        })
    }), TTS_TIER_TIMEOUT_MS, "自建语音合成");

    if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error("HTTP " + res.status + (detail ? " " + detail.slice(0, 120) : ""));
    }
    const audio = new Uint8Array(await res.arrayBuffer());
    if (!audio.length) throw new Error("空音频");
    const contentType = (res.headers.get("Content-Type") || "").split(";")[0].trim();
    return {
        audio: audio,
        contentType: contentType || (media === "mp3" ? "audio/mpeg" : "audio/wav"),
        voiceLabel: profile.key
    };
}

/** Workers AI MeloTTS（站内推理，无外网握手；单一音色） */
async function synthMeloTts({ env, text }) {
    if (!env.AI) return { skip: "无 AI binding" };
    const model = trim(env.TA_TTS_MODEL, 80) || "@cf/myshell-ai/melotts";
    const res = await withTimeout(
        env.AI.run(model, { prompt: text, lang: "zh" }),
        10000,
        "云端语音合成"
    );
    const audio = base64ToBytes(res && (res.audio || (res.result && res.result.audio)));
    if (!audio) throw new Error("空音频");
    return { audio: audio, contentType: "audio/mpeg", voiceLabel: "melotts-default" };
}

/** 当前实际启用的合成层（按优先级），供 /api/ta/config 与日志用 */
export function ttsChain(env) {
    const chain = [];
    const hasLocal = !!trim(env && env.TA_TTS_LOCAL_URL, 300) && hasLocalRef(env);
    if (hasLocal) chain.push("gptsovits");
    if (env && env.AI) chain.push("melotts");
    return chain;
}

/** 自建层是否至少有一份参考音频可用（逐音色 / 性别档 / 全局默认，任一即可） */
export function hasLocalRef(env) {
    return ttsLocalVoiceIds(env).length > 0 ||
        !!trim(env && env.TA_TTS_LOCAL_REF, 300) ||
        !!trim(env && env.TA_TTS_LOCAL_FEMALE_REF, 300) ||
        !!trim(env && env.TA_TTS_LOCAL_MALE_REF, 300);
}

/**
 * 这次失败值不值得「立刻再试一次」：
 *   - 慢失败（多半是超时）不试 —— 重试等于让用户多等一个超时，违背「不停」；
 *   - 明确的配置/请求错（4xx）不试 —— 重试一百次也是同样的错；
 *   - 其余（连接被掐断、隧道抖动、空音频、5xx）都值得，这是只有一次性的抖动。
 */
function isTransientTtsError(reason, elapsedMs) {
    if (elapsedMs >= TTS_FAST_FAIL_MS) return false;
    if (/HTTP (400|401|403|404|405|413)/.test(String(reason || ""))) return false;
    return true;
}

/** 失败原因 → ASCII 短码：响应头只能放 ASCII，也方便日志里 grep */
function ttsReasonCode(error) {
    const msg = String(error == null ? "" : error);
    if (/未配置|无 AI binding|无 AI/.test(msg)) return "unconfigured";
    if (/时间预算/.test(msg)) return "budget";
    if (/超时/.test(msg)) return "timeout";
    const http = /HTTP (\d{3})/.exec(msg);
    if (http) return "http" + http[1];
    if (/空音频/.test(msg)) return "empty";
    if (/UNAVAILABLE/.test(msg)) return "unavailable";
    return "error";
}

/** attempts[] → X-TA-TTS-Attempts 的头值（没有失败过就返回空串，页面据此判断是否降级） */
function ttsAttemptsHeader(attempts) {
    if (!attempts || !attempts.length) return "";
    return attempts
        .map((a) => a.provider + "=" + ttsReasonCode(a.error))
        .join("; ")
        .slice(0, 160);
}

/**
 * 链式合成：自建 GPT-SoVITS → Workers AI MeloTTS；全挂返回 audio:null，页面走设备语音。
 * 自建层是「自己家里的机器 + 隧道」，最容易出现**一次性的连接抖动**：
 * 所以它失败且失败得很快时，会在同一层立刻重试一次（不额外烧用户时间），
 * 每层的失败原因都写日志（wrangler tail 可见），并随成功响应带出去（见 handleTts 的头）。
 */
async function synthTts({ env, text, voice, rate }) {
    const attempts = [];
    const started = Date.now();
    const tiers = [
        { id: "gptsovits", tries: TTS_LOCAL_TRIES, run: () => synthLocalTts({ env: env, text: text, voice: voice, rate: rate }) },
        { id: "melotts", tries: 1, run: () => synthMeloTts({ env: env, text: text }) }
    ];

    for (const tier of tiers) {
        for (let attempt = 1; attempt <= tier.tries; attempt++) {
            if (Date.now() - started >= TTS_TOTAL_BUDGET_MS) {
                attempts.push({ provider: tier.id, error: "时间预算已用尽，跳过这一层" });
                console.warn(`TA TTS SKIP [${tier.id}]: 时间预算已用尽`);
                break;
            }

            const t0 = Date.now();
            let reason = "";
            let skip = false;      // 「未配置」这类跳过不算失败：不重试、不打日志
            try {
                const out = await tier.run();
                if (out && out.audio && out.audio.length) {
                    return {
                        audio: out.audio,
                        contentType: out.contentType || "audio/mpeg",
                        provider: tier.id,
                        voiceLabel: out.voiceLabel || tier.id,
                        attempts: attempts
                    };
                }
                reason = (out && out.skip) || "空音频";
                skip = !!(out && out.skip);
            } catch (e) {
                reason = safeError(e);
            }

            attempts.push({ provider: tier.id, error: reason });
            if (skip) break;

            const retry = attempt < tier.tries &&
                isTransientTtsError(reason, Date.now() - t0) &&
                (Date.now() - started) < TTS_TOTAL_BUDGET_MS;
            console.warn(`TA TTS TIER FAIL [${tier.id} 第 ${attempt} 次] ${reason}` + (retry ? " → 立刻重试一次" : ""));
            if (!retry) break;
        }
    }

    return { audio: null, contentType: null, provider: null, voiceLabel: null, attempts: attempts };
}

/** POST /api/ta/tts → audio/*（参数校验口径与主站 /api/tts 保持一致；实际音色由服务端链决定） */
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
    // pitch / volume 只有 Edge 那类支持 SSML prosody 的引擎能用，现在链上是 GPT-SoVITS（speed_factor）
    // 与 MeloTTS（无参数）；为了不破坏前端契约仍然接收并校验格式，只是不再改变合成结果。
    if (!/^[+-]\d+%$/.test(rate) || !/^[+-]\d+%$/.test(volume) || !/^[+-]\d+Hz$/.test(pitch)) {
        return json({ success: false, code: "BAD_PARAM", error: "语速/音量/音调参数格式错误。" }, 400, cors);
    }

    const result = await synthTts({
        env: env,
        text: text,
        voice: voice || DEFAULT_TA_VOICE,
        rate: rate
    });

    if (!result.audio || !result.audio.length) {
        const degraded = ttsAttemptsHeader(result.attempts);
        return json({
            success: false,
            code: "TTS_UNAVAILABLE",
            error: "我这边嗓子有点哑，先用本机声音念给你听。",
            attempts: result.attempts
        }, 502, degraded ? { ...cors, "X-TA-TTS-Attempts": degraded } : cors);
    }

    const headers = {
        "Content-Type": result.contentType || "audio/mpeg",
        "Cache-Control": "no-store",
        "Content-Length": String(result.audio.length),
        "X-TA-TTS-Provider": result.provider,
        "X-TA-TTS-Voice": result.voiceLabel || voice || DEFAULT_TA_VOICE,
        ...cors
    };

    // 发生了降级才带这个头：ASCII 短码说清「哪一层、为什么没接上」。
    // 页面据此讲人话 / 记进状态栏 title，浏览器里就能自查，不必开 wrangler tail。
    const degraded = ttsAttemptsHeader(result.attempts);
    if (degraded) headers["X-TA-TTS-Attempts"] = degraded;

    return new Response(result.audio, { status: 200, headers });
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

        if (pathname === "/api/ta/prompt") {
            if (method !== "POST") return json({ success: false, code: "BAD_METHOD" }, 405, cors);
            const gate = allow("prompt", ip);
            if (!gate.ok) return rateLimited(gate, cors);
            return await handlePrompt(request, env, cors);
        }

        if (pathname === "/api/ta/polish") {
            if (method !== "POST") return json({ success: false, code: "BAD_METHOD" }, 405, cors);
            const gate = allow("polish", ip);
            if (!gate.ok) return rateLimited(gate, cors);
            return await handlePolish(request, env, cors);
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
        const detail = safeError(e);
        console.error("TA ROUTE ERROR:", detail);
        return json({
            success: false,
            code: "INTERNAL",
            error: "我这边卡了一下，你先说，我本机接着记。",
            detail: detail
        }, 500, cors);
    }
}



