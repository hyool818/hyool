/**
 * HYOOL 中枢 · 编排层：确定性任务 DAG 执行器
 *
 * 任务 = { id, tool, input, dependsOn?, retries?, cacheKey? }
 *
 * runWorkflow 负责：
 *   1. 循环依赖检测（DFS 三色标记，缺失依赖直接报错）
 *   2. 按依赖拓扑推进，就绪任务并发执行（concurrency 默认 3）
 *   3. cacheKey 命中则直接复用缓存结果（素材级缓存，避免重复生成计费/耗时）
 *   4. 失败按 retries 指数退避重试，超过则标记 failed 并阻塞下游
 *   5. 结果聚合为 Map(taskId → { id, tool, status, result, meta, attempts, cached? })
 *
 * 控制流完全由本引擎承担，LLM 不参与任何调度决策。
 */
import { getTool } from "./tools.js";

export async function runWorkflow(tasks, opts = {}) {
    const { env, userId, onProgress, concurrency = 3, cache = new Map() } = opts;
    if (!Array.isArray(tasks) || !tasks.length) {
        return { results: new Map(), report: { done: 0, total: 0 } };
    }

    const byId = new Map(tasks.map((t) => [t.id, t]));
    const results = new Map();
    const done = new Set();
    const pending = new Set(byId.keys());

    /* ---- 1. 依赖校验 + 循环检测 ---- */
    const state = new Map(); // 0 未访问 / 1 访问中 / 2 完成
    const visit = (id) => {
        state.set(id, 1);
        const t = byId.get(id);
        for (const d of t?.dependsOn || []) {
            if (!byId.has(d)) throw new Error(`任务「${id}」依赖不存在的任务「${d}」`);
            if (state.get(d) === 1) throw new Error(`任务依赖成环：${d} → ${id}`);
            if (!state.get(d)) visit(d);
        }
        state.set(id, 2);
    };
    byId.forEach((_, id) => {
        if (!state.get(id)) visit(id);
    });

    /* ---- 2. 就绪推进 ---- */
    const tick = (id, status, extra) => {
        const t = byId.get(id);
        results.set(id, { id, tool: t.tool, status, ...extra });
        done.add(id);
        pending.delete(id);
        onProgress?.({ done: done.size, total: byId.size }, results);
    };

    const runOne = async (id) => {
        const t = byId.get(id);
        const tool = getTool(t.tool);

        if (t.cacheKey && cache.has(t.cacheKey)) {
            const cached = cache.get(t.cacheKey);
            tick(id, "ok", { ...cached, attempts: 0, cached: true });
            return;
        }

        const maxAttempts = Math.max(1, (t.retries ?? 0) + 1);
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const deps = new Map();
                (t.dependsOn || []).forEach((d) => deps.set(d, results.get(d)));
                const ctx = {
                    env,
                    userId,
                    deps,
                    log: (...args) => console.log(`[hub:${id}]`, ...args)
                };
                const out = await tool.run(t.input, ctx);
                if (t.cacheKey) cache.set(t.cacheKey, out);
                tick(id, "ok", { ...out, attempts: attempt });
                return;
            } catch (e) {
                if (attempt < maxAttempts) {
                    await sleep(Math.min(8000, 500 * 2 ** (attempt - 1)));
                } else {
                    tick(id, "failed", { error: String(e?.message || e), attempts: attempt });
                }
            }
        }
    };

    while (pending.size) {
        const ready = [...pending].filter((id) => {
            const t = byId.get(id);
            return (t.dependsOn || []).every((d) => done.has(d) && results.get(d).status === "ok");
        });

        if (!ready.length) {
            // 剩余任务均被失败依赖阻塞 → 标记 skipped
            for (const id of [...pending]) {
                tick(id, "skipped", { error: "前置任务未成功，跳过", attempts: 0 });
            }
            break;
        }

        await Promise.all(ready.slice(0, concurrency).map(runOne));
    }

    return { results, report: { done: done.size, total: byId.size } };
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/** 结果序列化：剔除 bytes 等大字段，供 API/测试使用 */
export function serializeResult(res) {
    if (!res) return null;
    const { result, meta, ...rest } = res;
    const out = { ...rest, bytes: result?.bytes?.byteLength ?? null };
    if (result?.url) out.url = result.url;
    if (result?.story) out.hasStory = true;
    return out;
}
