/**
 * HYOOL 模型注册表与路由
 *
 * 四个可选「对话模型」（角色对话 / 生命世界多角色对话均使用同一个选择器）：
 *  - llama3.3-70B        现网可用（Cloudflare Workers AI）
 *  - DSV4 Pro            后端 GPU 待上线（OpenAI 兼容接口，配置即用）
 *  - XVERSE-Ent-25B      后端 GPU 待上线
 *  - Qwen3-27B-Instruct  后端 GPU 待上线
 *
 * provider 说明：
 *  - "workers-ai"：直接走 env.AI.run(modelId, {...})，无需额外配置
 *  - "gpu"：OpenAI 兼容 /chat/completions。设置 env.GPU_BASE_URL（如
 *    https://your-backend.example.com/v1）与 env.GPU_API_KEY 即可启用；
 *    未配置时由网关自动回退到 Workers AI 默认模型（llama3.3-70B）。
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

export function listModelInfos() {
    return MODEL_REGISTRY.map((m) => ({
        id: m.id,
        label: m.label,
        provider: m.provider,
        status: m.status,
        advice: m.advice
    }));
}

/**
 * 把任意模型引用解析为「可直接调用」的模型：
 *   - 注册表 id（llama3-70b / dsv4pro / ...）→ 解析注册项
 *   - 原始 workers-ai 模型 id（以 @ 开头）→ 视为 workers-ai provider
 *   - 空 / 未定义 → 默认注册项
 * 返回 { provider, modelId, status, usedFallback }
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
