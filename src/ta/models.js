/**
 * TA（AI 伴侣）· 模型注册表与路由
 *
 * TA 有一份自己的模型清单，刻意不复用 HYOOL 主站的 src/ai/models.js：
 * TA 是独立产品线（后期要烧录进固件），模型口子必须自己收口，
 * 主站换模型不该影响 TA，TA 加模型也不该惊动主站。
 *
 * 三家：
 *   - workers-ai          Cloudflare Workers AI（默认主力，无需 Key，走 env.AI binding）
 *   - deepseek            DeepSeek 官方 OpenAI 兼容 API（需 Secret DEEPSEEK_API_KEY）
 *   - local               本机模型（llama.cpp / LM Studio / vLLM / Ollama 的 OpenAI 兼容端点）
 *                         Worker 在边缘、到不了 127.0.0.1，所以这一家有两种用法：
 *                         ① 页面直连本机（默认，见 public/ta.html 的 TA_API.localChat）；
 *                         ② Worker 走隧道：TA_LOCAL_LLM_URL 配成隧道域名后才进服务端容灾链。
 *
 * 预留接入口（后期加其它模型，只加注册项、不改调用方）：
 *   - openai-compatible   任意 OpenAI 兼容后端：TA_EXTRA_BASE_URL / TA_EXTRA_API_KEY / TA_EXTRA_MODEL
 *   - env.TA_EXTRA_MODELS 一次性追加多个模型（JSON 数组，见 extraModels()）
 */

export const TA_MODELS = [
    {
        id: "cf-llama",
        label: "Cloudflare · llama3.3-70B",
        provider: "workers-ai",
        modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        temperature: 0.95,
        maxTokens: 220,
        note: "现网可用、无需密钥，TA 的兜底主力模型。"
    },
    {
        id: "ds-chat",
        label: "DeepSeek · chat",
        provider: "deepseek",
        modelId: "deepseek-chat",
        temperature: 1.05,
        maxTokens: 260,
        note: "中文口语与角色感更自然；需配置 Secret DEEPSEEK_API_KEY。"
    },
    {
        id: "extra",
        label: "扩展模型（预留）",
        provider: "openai-compatible",
        modelId: "",
        temperature: 0.95,
        maxTokens: 260,
        note: "接入口：配置 TA_EXTRA_BASE_URL / TA_EXTRA_API_KEY / TA_EXTRA_MODEL 即启用。"
    },
    {
        id: "local-qwen",
        label: "本机 · qwen3.6",
        provider: "local",
        modelId: "",
        temperature: 0.95,
        maxTokens: 320,
        note: "接本机 OpenAI 兼容端点（默认 http://127.0.0.1:8080/v1，模型名留空 = 用 /v1/models 第一项）。"
    }
];

export const DEFAULT_TA_MODEL_ID = "cf-llama";

/**
 * 本机模型默认值（env.TA_LOCAL_LLM_* 可覆盖）。
 * 端口 8080 是 llama.cpp（llama-server）的默认口，模型名与 字字动画 里配的一致。
 */
export const TA_LOCAL_LLM_DEFAULTS = {
    baseUrl: "http://127.0.0.1:8080/v1",
    modelId: "qwen3.6-35b-a3b-nothink",
    temperature: 0.95,
    maxTokens: 320
};

/** 解析本机模型配置（Worker 侧；页面侧另有一份同名默认值） */
export function taLocalLlm(env) {
    const e = env || {};
    return {
        baseUrl: String(e.TA_LOCAL_LLM_URL || TA_LOCAL_LLM_DEFAULTS.baseUrl).trim().replace(/\/+$/, ""),
        modelId: String(e.TA_LOCAL_LLM_MODEL || TA_LOCAL_LLM_DEFAULTS.modelId).trim(),
        apiKey: String(e.TA_LOCAL_LLM_KEY || "").trim(),
        temperature: Number(e.TA_LOCAL_LLM_TEMPERATURE) || TA_LOCAL_LLM_DEFAULTS.temperature,
        maxTokens: Number(e.TA_LOCAL_LLM_MAX_TOKENS) || TA_LOCAL_LLM_DEFAULTS.maxTokens
    };
}

/**
 * /api/ta/config 用：告诉页面「本机模型该填什么」，不给密钥。
 * enabled 只表示「Worker 侧配了地址（隧道）」；页面直连不依赖这个字段。
 */
export function localLlmHint(env) {
    const rawUrl = String((env && env.TA_LOCAL_LLM_URL) || "").trim();
    return {
        enabled: !!rawUrl,
        url: rawUrl.replace(/\/+$/, ""),
        model: String((env && env.TA_LOCAL_LLM_MODEL) || "").trim(),
        defaults: {
            url: TA_LOCAL_LLM_DEFAULTS.baseUrl,
            model: TA_LOCAL_LLM_DEFAULTS.modelId
        }
    };
}

/** 语音模型（Workers AI Whisper 系列）；env.TA_ASR_MODEL 可覆盖 */
export const TA_ASR_MODELS = [
    "@cf/openai/whisper-large-v3-turbo",
    "@cf/openai/whisper"
];

const BY_ID = new Map(TA_MODELS.map((m) => [m.id, m]));

export function isTaModelId(id) {
    return BY_ID.has(String(id || ""));
}

/** env.TA_EXTRA_MODELS 里的附加模型（JSON 数组），字段与 TA_MODELS 一致 */
function extraModels(env) {
    const raw = String((env && env.TA_EXTRA_MODELS) || "").trim();
    if (!raw) return [];
    try {
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return [];
        return list
            .map((m) => ({
                id: String((m && m.id) || "").trim(),
                label: String((m && m.label) || (m && m.id) || "").trim(),
                provider: "openai-compatible",
                modelId: String((m && m.modelId) || "").trim(),
                temperature: Number((m && m.temperature) || 0.95),
                maxTokens: Number((m && m.maxTokens) || 260),
                baseUrlEnv: String((m && m.baseUrlEnv) || "TA_EXTRA_BASE_URL").trim(),
                keyEnv: String((m && m.keyEnv) || "TA_EXTRA_API_KEY").trim(),
                note: "由 TA_EXTRA_MODELS 注入。"
            }))
            .filter((m) => m.id && m.modelId);
    } catch (e) {
        console.warn("TA EXTRA MODELS 解析失败：", e && e.message);
        return [];
    }
}

/** 取「注册表 id → 目标」；也接受原始 workers-ai 模型 id（以 @ 开头） */
export function resolveTaTarget(idOrRaw, env) {
    const key = String(idOrRaw || "").trim();
    const all = TA_MODELS.concat(extraModels(env));

    let row = all.find((m) => m.id === key);
    if (!row && key.startsWith("@")) {
        row = {
            id: key,
            label: key,
            provider: "workers-ai",
            modelId: key,
            temperature: 0.95,
            maxTokens: 220,
            note: "直接指定的 Workers AI 模型。"
        };
    }
    if (!row) row = BY_ID.get(DEFAULT_TA_MODEL_ID);

    const target = {
        id: row.id,
        label: row.label,
        provider: row.provider,
        modelId: row.modelId,
        temperature: Number(row.temperature) || 0.95,
        maxTokens: Number(row.maxTokens) || 220,
        baseUrl: "",
        apiKey: ""
    };

    if (row.provider === "deepseek") {
        target.baseUrl = String((env && env.DEEPSEEK_BASE_URL) || "https://api.deepseek.com").replace(/\/+$/, "");
        target.apiKey = String((env && env.DEEPSEEK_API_KEY) || "").trim();
        target.modelId = String((env && env.DEEPSEEK_MODEL) || row.modelId || "deepseek-chat").trim() || "deepseek-chat";
    } else if (row.provider === "openai-compatible") {
        const baseUrlEnv = row.baseUrlEnv || "TA_EXTRA_BASE_URL";
        const keyEnv = row.keyEnv || "TA_EXTRA_API_KEY";
        target.baseUrl = String((env && env[baseUrlEnv]) || "").replace(/\/+$/, "");
        target.apiKey = String((env && env[keyEnv]) || "").trim();
        target.modelId = String(row.modelId || (env && env.TA_EXTRA_MODEL) || "").trim();
    } else if (row.provider === "local") {
        // 本机模型：地址/密钥/模型名都可以由 TA_LOCAL_LLM_* 覆盖；模型名留空则用默认名
        const local = taLocalLlm(env);
        target.baseUrl = local.baseUrl;
        target.apiKey = local.apiKey;
        target.modelId = String(row.modelId || local.modelId).trim();
        target.temperature = Number(row.temperature) || local.temperature;
        target.maxTokens = Number(row.maxTokens) || local.maxTokens;
    }

    target.status = taTargetStatus(target, env);
    return target;
}

/** online / need_key / coming —— 只表达「配置齐不齐」，不暴露任何密钥 */
export function taTargetStatus(target, env) {
    if (target.provider === "workers-ai") {
        return env && env.AI ? "online" : "need_binding";
    }
    if (target.provider === "openai-compatible") {
        return target.baseUrl && target.apiKey && target.modelId ? "online" : "coming";
    }
    if (target.provider === "local") {
        // Worker 到不了 127.0.0.1：必须显式配了 TA_LOCAL_LLM_URL（隧道/公网端点）才算 online
        const explicit = String((env && env.TA_LOCAL_LLM_URL) || "").trim();
        return explicit && target.modelId ? "online" : "coming";
    }
    return target.apiKey ? "online" : "need_key";
}

/**
 * 模型容灾链：按顺序尝试，直到有一个真的回了话。
 * 「TA 不能因为某个模型挂掉就变哑巴」——这是兜底策略的模型侧一半。
 */
export function taModelChain(idOrRaw, env) {
    const want = resolveTaTarget(idOrRaw, env);
    // 只把「真的调得动」的模型放进链里：没配 Key / 没绑 AI 的直接排除，
    // 免得白跑一趟网络再失败（页面上的体感就是「卡一下才回话」）
    const chain = want.status === "online" ? [want] : [];

    const push = (t) => {
        if (!t || !t.modelId) return;
        if (t.status !== "online") return;
        if (chain.some((x) => x.provider === t.provider && x.modelId === t.modelId)) return;
        chain.push(t);
    };

    // 好模型优先（用户选的在前）：本机模型（仅 Worker 侧配了隧道地址时）→ DeepSeek → Workers AI
    push(resolveTaTarget("local-qwen", env));
    push(resolveTaTarget("ds-chat", env));
    push(resolveTaTarget(DEFAULT_TA_MODEL_ID, env));

    return chain;
}

/** 给 /api/ta/config 用：只给前端「能选什么」，不给密钥与地址 */
export function listTaModels(env) {
    const all = TA_MODELS.concat(extraModels(env));
    return all.map((m) => {
        const t = resolveTaTarget(m.id, env);
        return {
            id: t.id,
            label: t.label,
            provider: t.provider,
            status: t.status,
            note: m.note || ""
        };
    });
}
