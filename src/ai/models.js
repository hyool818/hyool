/**
 * HYOOL 模型注册表与路由
 *
 * 可选对话模型：
 *  - llama3.3-70B        Cloudflare Workers AI（默认）
 *  - deepseek-chat       DeepSeek 官方 API（配置 DEEPSEEK_API_KEY 后启用）
 *  - DSV4 Pro / XVERSE / Qwen3  自建 GPU（GPU_BASE_URL + GPU_API_KEY）
 *
 * provider：
 *  - "workers-ai"：env.AI.run
 *  - "deepseek"：OpenAI 兼容；密钥用 Cloudflare Secret / .dev.vars 的 DEEPSEEK_API_KEY（勿写入仓库）
 *  - "gpu"：自建 OpenAI 兼容后端
 */

export const MODEL_REGISTRY = [
    {
        id: "llama3-70b",
        label: "llama3.3-70B",
        provider: "workers-ai",
        modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        status: "online",
        advice: "综合对话能力均衡，中英文稳定，响应快、现网可用；适合日常聊天与大多数场景。",
        temperature: 0.9,
        maxTokens: 300
    },
    {
        id: "deepseek-chat",
        label: "DeepSeek Chat",
        provider: "deepseek",
        modelId: "deepseek-chat",
        status: "online",
        advice: "中文写作与 JSON 提取更稳；需配置 Secret DEEPSEEK_API_KEY（不进 Git）。",
        temperature: 0.7,
        maxTokens: 4096
    },
    {
        id: "dsv4pro",
        label: "DSV4 Pro",
        provider: "gpu",
        modelId: "deepseek-v4-pro",
        status: "coming",
        advice: "擅长复杂推理与长篇剧情推演，适合悬疑、宏大叙事与多线并行展开。",
        temperature: 0.9,
        maxTokens: 400
    },
    {
        id: "xverse-ent-25b",
        label: "XVERSE-Ent-25B",
        provider: "gpu",
        modelId: "XVERSE-Ent-25B",
        status: "coming",
        advice: "中文语境更自然，古风/架空世界观与细腻情感表达出色，适合沉浸式角色扮演。",
        temperature: 0.9,
        maxTokens: 300
    },
    {
        id: "qwen3-27b-instruct",
        label: "Qwen3-27B-Instruct",
        provider: "gpu",
        modelId: "qwen3-27b-instruct",
        status: "coming",
        advice: "多轮指令跟随与多角色调度稳定，适合世界模拟、长对话与多人自主聊天。",
        temperature: 0.9,
        maxTokens: 300
    }
];

const REGISTRY_BY_ID = new Map(MODEL_REGISTRY.map((m) => [m.id, m]));

export const DEFAULT_MODEL_ID = "llama3-70b";
export const DEEPSEEK_MODEL_ID = "deepseek-chat";

/** 是否已配置 DeepSeek（仅检查 env，不暴露 Key） */
export function isDeepseekConfigured(env) {
    return !!(env && String(env.DEEPSEEK_API_KEY || "").trim());
}

/** 按注册表 id 解析模型；未知 id 回退默认模型 */
export function resolveModel(id) {
    return REGISTRY_BY_ID.get(String(id || "")) || REGISTRY_BY_ID.get(DEFAULT_MODEL_ID);
}

/** 判断字符串是否为注册表 id（区别于原始 workers-ai 模型 id） */
export function isRegistryId(id) {
    return REGISTRY_BY_ID.has(String(id || ""));
}

export function getModelInfo(id) {
    const m = resolveModel(id);
    return {
        id: m.id,
        label: m.label,
        provider: m.provider,
        status: m.status,
        advice: m.advice
    };
}

/** @param {object} [env] 传入时按密钥/GPU 配置标注 status */
export function listModelInfos(env) {
    return MODEL_REGISTRY.map((m) => {
        let status = m.status;
        if (m.provider === "deepseek") {
            status = isDeepseekConfigured(env) ? "online" : "need_key";
        } else if (m.provider === "gpu") {
            status = env && String(env.GPU_BASE_URL || "").trim() ? "online" : "coming";
        }
        return {
            id: m.id,
            label: m.label,
            provider: m.provider,
            status,
            advice: m.advice
        };
    });
}

/**
 * 小说/提取：有 DEEPSEEK_API_KEY 则优先 DeepSeek，否则 null（走默认 Workers AI）
 */
export function resolveNovelModelRef(env) {
    return isDeepseekConfigured(env) ? DEEPSEEK_MODEL_ID : null;
}

/**
 * 把任意模型引用解析为「可直接调用」的模型：
 *   - 注册表 id → 解析注册项
 *   - 原始 workers-ai 模型 id（以 @ 开头）→ workers-ai
 *   - 空 → 默认
 */
export function resolveChatTarget(modelRef) {
    if (isRegistryId(modelRef)) {
        const m = resolveModel(modelRef);
        return {
            provider: m.provider,
            modelId: m.modelId,
            status: m.status,
            usedFallback: false
        };
    }
    if (typeof modelRef === "string" && modelRef.startsWith("@")) {
        return {
            provider: "workers-ai",
            modelId: modelRef,
            status: "online",
            usedFallback: false
        };
    }
    const m = resolveModel(null);
    return {
        provider: m.provider,
        modelId: m.modelId,
        status: m.status,
        usedFallback: false
    };
}
