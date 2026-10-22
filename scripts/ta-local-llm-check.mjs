/**
 * TA 自测：本机模型（qwen3.6 这类 OpenAI 兼容端点）接入检查
 *
 *   node scripts/ta-local-llm-check.mjs                 # 离线断言 + 本机端点实测（连不上就跳过）
 *   node scripts/ta-local-llm-check.mjs --offline       # 只跑离线断言
 *   set TA_LOCAL_LLM_URL=http://127.0.0.1:8080/v1       # 换端点（默认就是 llama.cpp 的 8080）
 *
 * 覆盖：
 *   1) 模型注册表：local-qwen 的两种状态（没配环境变量 = coming，配了 = online）、容灾链去重
 *   2) /api/ta/config 带 llm 提示（不给密钥）
 *   3) /api/ta/prompt：人设越界回落、记忆/心情写进提示词、不调任何模型
 *   4) /api/ta/polish：去 Markdown / 去助手腔 / 全是 AI 腔时返回空
 *   5) 真机：用 /api/ta/prompt 产出的同一份提示词问本机模型，再过 humanizeTaReply
 */

import { handleTaRoutes } from "../src/ta/index.js";
import { buildTaSystemPrompt, humanizeTaReply } from "../src/ta/prompt.js";
import { listTaModels, resolveTaTarget, taTargetStatus, taModelChain, localLlmHint, TA_LOCAL_LLM_DEFAULTS } from "../src/ta/models.js";

const results = [];
function check(name, cond, detail) {
    results.push({ name, ok: !!cond, detail: detail == null ? "" : String(detail) });
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
}

const POST = (path, body, ip = "10.0.0.1") =>
    new Request("http://ta.local" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify(body)
    });

/* ---------------- 1. 模型注册表 ---------------- */

const noEnv = {};
const tunnelled = { TA_LOCAL_LLM_URL: "https://ta-llm.example.com/v1" };

const bare = resolveTaTarget("local-qwen", noEnv);
check("local-qwen 默认指向 127.0.0.1:8080/v1", bare.baseUrl === TA_LOCAL_LLM_DEFAULTS.baseUrl, bare.baseUrl);
check("local-qwen 默认模型名 = qwen3.6-35b-a3b-nothink", bare.modelId === TA_LOCAL_LLM_DEFAULTS.modelId, bare.modelId);
check("没配 TA_LOCAL_LLM_URL → status=coming（Worker 够不着 127.0.0.1）", taTargetStatus(bare, noEnv) === "coming");
check("配了 TA_LOCAL_LLM_URL → status=online", taTargetStatus(resolveTaTarget("local-qwen", tunnelled), tunnelled) === "online");
check("没配隧道时不进服务端容灾链", taModelChain("local-qwen", noEnv).every((t) => t.provider !== "local"));
check("配了隧道时进服务端容灾链", taModelChain("cf-llama", tunnelled).some((t) => t.provider === "local"));
check("TA_LOCAL_LLM_MODEL 可覆盖模型名",
    resolveTaTarget("local-qwen", { TA_LOCAL_LLM_MODEL: "my-model" }).modelId === "my-model");
check("local-qwen 出现在 /config 模型清单里", listTaModels(noEnv).some((m) => m.id === "local-qwen"));

const hint = localLlmHint(noEnv);
check("/config llm 提示含默认地址与模型名",
    hint.enabled === false && hint.defaults.url === TA_LOCAL_LLM_DEFAULTS.baseUrl && hint.defaults.model === TA_LOCAL_LLM_DEFAULTS.modelId);
check("/config llm 提示不含密钥字段", !("apiKey" in hint) && !("key" in hint));

/* ---------------- 2. /api/ta/config ---------------- */

let res = await handleTaRoutes(new Request("http://ta.local/api/ta/config", { headers: { "x-forwarded-for": "10.0.0.2" } }), noEnv, "/api/ta/config", "GET");
let data = await res.json();
check("GET /config → 200 + success", res.status === 200 && data.success === true);
check("/config.llm.defaults 指向本机端点", !!data.llm && data.llm.defaults.url === TA_LOCAL_LLM_DEFAULTS.baseUrl);

/* ---------------- 3. /api/ta/prompt ---------------- */

res = await handleTaRoutes(POST("/api/ta/prompt", {
    persona: { gender: "male", personality: "clear", name: "不存在的名字" },
    mood: 41, intimacy: 78, channel: "text",
    memories: [{ type: "工作", value: "在做一部武侠短片" }]
}), noEnv, "/api/ta/prompt", "POST");
data = await res.json();
const sys = String(data.system || "");
check("POST /prompt → 200 + system", res.status === 200 && data.success === true && sys.length > 300, `chars=${sys.length}`);
check("/prompt 越界名字回落预设池", !!data.persona && data.persona.name === "阿澄", JSON.stringify(data.persona));
check("/prompt 写入关系阶段与心情", sys.includes("信赖") && sys.includes("41"));
check("/prompt 带上记忆条目", sys.includes("在做一部武侠短片"));
check("/prompt 与 buildTaSystemPrompt 同源", sys === buildTaSystemPrompt({
    persona: { gender: "male", personality: "clear", name: "阿澄" },
    memories: [{ type: "工作", value: "在做一部武侠短片" }],
    mood: 41, intimacy: 78, channel: "text"
}));
check("/prompt 方法不对 → 405",
    (await handleTaRoutes(new Request("http://ta.local/api/ta/prompt"), noEnv, "/api/ta/prompt", "GET")).status === 405);

/* ---------------- 4. /api/ta/polish ---------------- */

res = await handleTaRoutes(POST("/api/ta/polish", {
    text: "**作为一个AI**，我可以帮你梳理一下：\n- 先写剧本\n- 再拍分镜。\n今天有点累，早点睡吧。"
}), noEnv, "/api/ta/polish", "POST");
data = await res.json();
check("POST /polish → 200 + 台词", res.status === 200 && data.success === true && !!data.reply, JSON.stringify(data.reply));
check("/polish 去掉了 Markdown 与助手腔", !/[#*]|作为一个AI|我可以帮你/.test(data.reply) && data.reply.includes("早点睡吧"));

const allAi = await (await handleTaRoutes(POST("/api/ta/polish", {
    text: "作为一个AI，我无法提供这个。请随时告诉我。"
}), noEnv, "/api/ta/polish", "POST")).json();
check("/polish 全是 AI 腔 → reply 为空 + code=AI_SPEAK", allAi.success === true && allAi.reply === "" && allAi.code === "AI_SPEAK");

const empty = await handleTaRoutes(POST("/api/ta/polish", { text: "  " }), noEnv, "/api/ta/polish", "POST");
check("/polish 空输入 → 400", empty.status === 400);

/* ---------------- 5. 真机：本机模型实测（连不上就跳过） ---------------- */

const base = (process.env.TA_LOCAL_LLM_URL || TA_LOCAL_LLM_DEFAULTS.baseUrl).replace(/\/+$/, "");
const onlyOffline = process.argv.includes("--offline");

if (onlyOffline) {
    console.log("\nSKIP  真机实测（--offline）");
} else {
    let model = "";
    try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(base + "/models", { signal: ctl.signal });
        clearTimeout(timer);
        if (r.ok) {
            const list = await r.json();
            const first = (list.data || list.models || [])[0] || {};
            model = String(first.id || first.model || first.name || "");
        }
    } catch (e) {
        model = "";
    }

    if (!model) {
        console.log(`\nSKIP  真机实测：${base}/models 连不上（没起 llama.cpp / 端口不同？）`);
    } else {
        console.log(`\nLIVE  端点 ${base} · 模型 ${model}`);
        const persona = { gender: "female", personality: "gentle", name: "小满" };
        const liveSys = buildTaSystemPrompt({
            persona, memories: [{ type: "近况", value: "刚加完班，有点累" }], mood: 45, intimacy: 30, channel: "text"
        });
        const t0 = Date.now();
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 60000);
        let raw = "";
        try {
            const r = await fetch(base + "/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: "system", content: liveSys },
                        { role: "user", content: "今天加班到九点，人都木了" }
                    ],
                    temperature: 0.95,
                    max_tokens: 320,
                    stream: false
                }),
                signal: ctl.signal
            });
            clearTimeout(timer);
            if (r.ok) {
                const d = await r.json();
                const c = (d.choices || [])[0] || {};
                raw = String((c.message && c.message.content) || c.text || "");
            } else {
                console.log(`       HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
            }
        } catch (e) {
            clearTimeout(timer);
            console.log("       请求失败：" + (e && e.name) + " " + (e && e.message));
        }
        const ms = Date.now() - t0;
        const reply = humanizeTaReply(raw, { voice: false });
        console.log(`       原始 ${raw.length} 字 → 清洗后 ${reply.length} 字 / ${ms}ms`);
        console.log(`       台词：${reply || "(空)"}`);
        check("本机模型能按 TA 的提示词回话", raw.trim().length > 0, `${ms}ms`);
        check("清洗后仍是可用台词（≤160 字、无 AI 腔）",
            reply.length > 0 && reply.length <= 160 && !/作为一个(AI|人工智能|助手|语言模型)|我可以帮你|希望能帮到你/.test(reply));
    }
}

/* ---------------- 汇总 ---------------- */

const failed = results.filter((r) => !r.ok);
console.log("\n" + (failed.length ? `=== ${failed.length} FAILED ===` : `=== ALL PASSED === (${results.length} ok)`));
if (failed.length) {
    for (const f of failed) console.log("  ✗ " + f.name + (f.detail ? "  → " + f.detail : ""));
    process.exit(1);
}
