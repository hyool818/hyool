/**
 * HYOOL 中枢 · 工具层：统一 Tool 接口 + 注册表
 *
 * 每个工具 = { id, label, retryable, run(input, ctx) → { result, meta } }
 *   - input：结构化参数（来自编排层派生的任务）
 *   - ctx：{ env, userId, deps } —— deps 为依赖任务结果 Map(任务 id → {result})
 *   - 返回：{ result, meta }；抛错视为失败，编排层按 retryable 重试
 *
 * 契约：工具只管「产出一个素材/一份数据」，不做控制流、不做持久化编排；
 * 素材是否入库（hub.store）由编排层按需附加依赖，因此每个工具可独立测试。
 */
import { synthesizeEdgeTts } from "../tts.js";
import { composeStoryJSON } from "./blueprint.js";

const POLLINATIONS_IMG =
    "https://image.pollinations.ai/prompt/{prompt}?width={w}&height={h}&nologo=true&model=flux&seed={seed}";

/** 文生图（Pollinations + Flux）。返回图片字节 + 上游 URL，是否入库由编排层决定。 */
export async function toolPollinationsImage(input, ctx) {
    const { prompt, width = 1024, height = 1024, seed } = input;
    if (!prompt) throw new Error("缺少年图 prompt");
    const url = POLLINATIONS_IMG
        .replace("{prompt}", encodeURIComponent(prompt))
        .replace("{w}", String(width))
        .replace("{h}", String(height))
        .replace("{seed}", String(seed ?? Math.floor(Math.random() * 1e6)));

    const res = await fetch(url);
    const isImage = (res.headers.get("content-type") || "").includes("image");
    if (!res.ok || !isImage) {
        const peek = await res.text().catch(() => "");
        throw new Error(`pollinations 生成失败（${res.status}）：${peek.slice(0, 80)}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
        result: { url, bytes, mime: "image/jpeg", width, height, seed: seed ?? null },
        meta: { provider: "pollinations", bytes: bytes.byteLength }
    };
}

/** 配音（Edge TTS，复用 src/tts.js）。返回 MP3 字节。 */
export async function toolEdgeTts(input, ctx) {
    const { text, voice, rate = "+0%", pitch = "+0Hz", volume = "+0%" } = input;
    if (!text?.trim()) throw new Error("缺少配音文本");
    const bytes = await synthesizeEdgeTts({ text, voice, rate, pitch, volume });
    return {
        result: { bytes, mime: "audio/mpeg", voice, text },
        meta: { provider: "edge-tts", bytes: bytes.byteLength }
    };
}

/**
 * 素材入库：bytes → R2（env.HUB_BUCKET），返回 /img/<key> 引用。
 * 未配置 R2 时降级为「未持久化」，标记 ephemeral 并回传 sourceUrl，
 * 保证流程可端到端跑通（Phase 1 接入 R2 后即自动启用）。
 * input.sourceDep：依赖的生成任务 id，bytes 由编排层 ctx.deps 注入。
 */
export async function toolStoreAsset(input, ctx) {
    const { key, mime, sourceDep, sourceUrl } = input;
    const dep = sourceDep ? ctx.deps?.get(sourceDep) : null;
    const bytes = input.bytes || dep?.result?.bytes;
    if (ctx.env?.HUB_BUCKET && bytes) {
        await ctx.env.HUB_BUCKET.put(key, bytes, { httpMetadata: { contentType: mime || "application/octet-stream" } });
        return { result: { url: `/img/${key}`, stored: true }, meta: { bucket: "r2" } };
    }
    return { result: { url: sourceUrl || dep?.result?.url || null, stored: false, ephemeral: true }, meta: { bucket: "none" } };
}

/** 组装作品：把 Blueprint + 素材映射为 story-editor 作品 JSON。 */
export async function toolComposeStory(input, ctx) {
    const { blueprint } = input;
    const assetMap = {};
    if (ctx.deps) {
        ctx.deps.forEach((res, taskId) => {
            // 只收集入库结果，store 任务 id 形如 <genId>_store，还原为 genId 作为 assetMap 键
            if (res?.status === "ok" && res.tool === "hub.store" && res.result?.url) {
                assetMap[taskId.replace(/_store$/, "")] = res.result;
            }
        });
    }
    return { result: { story: composeStoryJSON(blueprint, assetMap) }, meta: { assets: Object.keys(assetMap).length } };
}

export const TOOL_REGISTRY = {
    "hub.image": { id: "hub.image", label: "文生图（Pollinations）", retryable: true, run: toolPollinationsImage },
    "hub.tts": { id: "hub.tts", label: "配音（Edge TTS）", retryable: true, run: toolEdgeTts },
    "hub.store": { id: "hub.store", label: "素材入库（R2）", retryable: true, run: toolStoreAsset },
    "hub.story": { id: "hub.story", label: "组作品（story-editor JSON）", retryable: false, run: toolComposeStory }
};

export function getTool(id) {
    const t = TOOL_REGISTRY[id];
    if (!t) throw new Error(`未知工具：${id}`);
    return t;
}
