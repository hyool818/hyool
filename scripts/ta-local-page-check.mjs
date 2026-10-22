/**
 * TA 页面自测：本机模型（页面直连）传输层
 *
 *   node scripts/ta-local-page-check.mjs
 *
 * 做法：把 public/ta.html 里那段 IIFE 原样喂进 Node 的 vm 沙箱（不跑 DOM、不跑 boot），
 * 用假 fetch 模拟「本机端点 + /api/ta/prompt + /api/ta/polish + /api/ta/chat」，
 * 只验证「谁来说台词」这条链路：本机优先 → 失败回落云端 → 再失败交给模板。
 */

import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(here, "..", "public", "ta.html");
const html = fs.readFileSync(htmlPath, "utf8");
const m = /<script>([\s\S]*?)<\/script>/.exec(html);
if (!m) throw new Error("ta.html 里找不到内联 <script>");
const code = m[1];

const results = [];
function check(name, cond, detail) {
    results.push({ name, ok: !!cond, detail: detail == null ? "" : String(detail) });
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
}

/* ---------------- 假浏览器环境 ---------------- */

const store = new Map();
const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
};

const calls = [];
const world = {
    localUp: true,
    promptUp: true,
    polishUp: true,
    cloudUp: true,
    localReply: "**嗯**，我也刚忙完。\n- 你先坐会儿\n- 别急着加班了。（微笑）",
    polished: "嗯，我也刚忙完。你先坐会儿，别急着加班了。"
};

function jsonRes(obj, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        json: async () => obj,
        text: async () => JSON.stringify(obj),
        blob: async () => null
    };
}

async function fakeFetch(url, opt = {}) {
    const u = String(url);
    const body = opt.body ? JSON.parse(opt.body) : null;
    calls.push({ url: u, method: (opt.method || "GET").toUpperCase(), body });

    if (u.endsWith("/v1/models")) {
        if (world.localUp) return jsonRes({ data: [{ id: "qwen3.6-35b-a3b-nothink" }] });
        throw new Error("ECONNREFUSED");
    }
    if (u.endsWith("/v1/chat/completions")) {
        if (!world.localUp) throw new Error("ECONNREFUSED");
        return jsonRes({ choices: [{ message: { role: "assistant", content: world.localReply } }] });
    }
    if (u.endsWith("/api/ta/prompt")) {
        if (!world.promptUp) return jsonRes({ success: false }, 500);
        const p = (body && body.persona) || {};
        return jsonRes({
            success: true,
            system: "SYS|" + [p.gender, p.personality, p.name].join("/") + "|mood=" + body.mood,
            persona: p
        });
    }
    if (u.endsWith("/api/ta/polish")) {
        if (!world.polishUp) return jsonRes({ success: false }, 500);
        return jsonRes({ success: true, reply: world.polished });
    }
    if (u.endsWith("/api/ta/chat")) {
        if (!world.cloudUp) return jsonRes({ success: false, code: "LLM_UNAVAILABLE" });
        return jsonRes({ success: true, reply: "云端台词", model: { id: "cf-llama" } });
    }
    if (u.endsWith("/api/ta/config")) {
        return jsonRes({ success: true, version: "test", models: [], default_model: "cf-llama", llm: { enabled: false, url: "", model: "", defaults: { url: "http://127.0.0.1:8080/v1", model: "qwen3.6-35b-a3b-nothink" } } });
    }
    return jsonRes({ success: false, code: "NOT_FOUND" }, 404);
}

const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    fetch: fakeFetch,
    AbortController,
    navigator: { onLine: true },
    localStorage,
    window: {},
    // 没有 getElementById → 页面自己会跳过 boot()，只留下引擎层与传输层
    document: { readyState: "loading", addEventListener: () => { } },
    location: { href: "http://127.0.0.1:8123/ta.html" }
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "ta.html#inline" });

const TA = sandbox.window.AICompanion && sandbox.window.AICompanion.TA_API;
check("页面脚本可在沙箱里执行并导出 TA_API", !!TA);

const basePayload = () => ({
    message: "今天加班到九点",
    persona: { gender: "female", personality: "gentle", name: "小满", voice: "zh-CN-XiaoxiaoNeural" },
    mood: 45, intimacy: 30, channel: "text",
    memories: [{ type: "近况", value: "刚加完班" }],
    recent: [{ role: "me", text: "在吗" }, { role: "her", text: "在的" }]
});

const S = sandbox.window.AICompanion.stateRef();

/* ---------------- 1. 默认配置 ---------------- */

let cfg = TA.localCfg();
check("默认模式 = auto（本机优先）", cfg.mode === "auto" && cfg.enabled === true && cfg.onlyLocal === false);
check("默认本机端点 = 127.0.0.1:8080/v1", cfg.url === "http://127.0.0.1:8080/v1", cfg.url);

/* ---------------- 2. auto + 本机在线 → 本机先说 ---------------- */

calls.length = 0;
let r = await TA.chat(basePayload());
check("auto 且本机在线 → 台词来自本机模型", r.ok && r.via === "local", JSON.stringify({ ok: r.ok, via: r.via, code: r.code }));
check("本机模型用 /v1/models 报的模型名", calls.some((c) => c.url.endsWith("/v1/chat/completions") && c.body.model === "qwen3.6-35b-a3b-nothink"));
check("先取服务端提示词（/api/ta/prompt），再问本机", calls.findIndex((c) => c.url.endsWith("/api/ta/prompt")) < calls.findIndex((c) => c.url.endsWith("/v1/chat/completions")));
check("提示词来自服务端（含人设与心情）", (calls.find((c) => c.url.endsWith("/api/ta/prompt")) || {}).body.system === undefined &&
    (calls.find((c) => c.url.endsWith("/v1/chat/completions")) || {}).body.messages[0].content === "SYS|female/gentle/小满|mood=45");

const cc = (calls.find((c) => c.url.endsWith("/v1/chat/completions")) || {}).body || {};
check("本机请求带最近对话（user/assistant 角色已映射）",
    cc.messages && cc.messages.length === 4 && cc.messages[1].role === "user" && cc.messages[2].role === "assistant" && cc.messages[3].content === "今天加班到九点");
check("本机请求 temperature=0.95 / max_tokens=320 / 非流式", cc.temperature === 0.95 && cc.max_tokens === 320 && cc.stream === false);
check("本机台词过了服务端 /api/ta/polish", r.reply === world.polished && calls.some((c) => c.url.endsWith("/api/ta/polish")), r.reply);

// 手填的模型名优先于 /v1/models 报的第一个
S.local.model = "my-own-model";
calls.length = 0;
await TA.chat(basePayload());
check("手填模型名优先", calls.some((c) => c.url.endsWith("/v1/chat/completions") && c.body.model === "my-own-model"));
S.local.model = "";

/* ---------------- 3. 探活缓存：15s 内不重复探 ---------------- */

calls.length = 0;
const probeCallsBefore = calls.length;
await TA.chat(basePayload());
check("第二次对话不再重复探 /v1/models", calls.filter((c) => c.url.endsWith("/v1/models")).length === probeCallsBefore);

/* ---------------- 4. 提示词拉不到 → 用上次缓存的那份（离线也能本机说话） ---------------- */

world.promptUp = false;
calls.length = 0;
r = await TA.chat({ ...basePayload(), mood: 90 });   // 换心情 → 缓存键不命中，逼它去请求并失败
check("提示词拉不到时用上次缓存 → 本机照常回话", r.ok && r.via === "local", JSON.stringify({ ok: r.ok, code: r.code }));
check("缓存命中时不调云端", !calls.some((c) => c.url.endsWith("/api/ta/chat")));
world.promptUp = true;

/* ---------------- 5. 本机挂了 → 自动回落云端 ---------------- */

world.localUp = false;
calls.length = 0;
r = await TA.chat(basePayload());
check("本机连不上 → 回落云端模型", r.ok && r.via === "cloud" && r.reply === "云端台词", JSON.stringify({ via: r.via, reply: r.reply }));
check("回落时确实打了 /api/ta/chat", calls.some((c) => c.url.endsWith("/api/ta/chat")));

/* ---------------- 6. cloud / local 两种模式 ---------------- */

// cloud：只用云端，根本不碰本机端点
S.local.mode = "cloud";
world.localUp = true;
calls.length = 0;
r = await TA.chat(basePayload());
check("cloud 模式：不碰本机端点，直接走云端", r.ok && r.via === "cloud" && !calls.some((c) => c.url.indexOf("127.0.0.1:8080") >= 0));

// local：只用本机，本机挂了也不偷偷用云端（交给本机台词库）
S.local.mode = "local";
world.localUp = false;
calls.length = 0;
r = await TA.chat(basePayload());
check("local 模式 + 本机挂了 → 不偷用云端", r && r.ok === false && !calls.some((c) => c.url.endsWith("/api/ta/chat")), JSON.stringify({ ok: r.ok, code: r.code }));

S.local.mode = "auto";
world.localUp = true;

/* ---------------- 7. polish 失败 → 保留页面侧最低限度清洗 ---------------- */

world.polishUp = false;
r = await TA.chat(basePayload());
check("polish 拉不到时仍给出台词（页面侧清洗兜底）", r.ok && r.via === "local" && r.reply.length > 0, r.reply);
check("页面侧清洗去掉了 Markdown 符号与列表前缀", !/\*\*|^-\s|`/.test(r.reply), r.reply);
world.polishUp = true;

/* ---------------- 8. 本机与云端都挂 → 软失败（页面走模板） ---------------- */

world.localUp = false;
world.cloudUp = false;
r = await TA.chat(basePayload());
check("本机 + 云端都挂 → ok:false（页面用模板接住，不抛异常）", r && r.ok === false, JSON.stringify(r));
world.cloudUp = true;
world.localUp = true;

/* ---------------- 总结 ---------------- */

const failed = results.filter((x) => !x.ok);
console.log("\n" + (failed.length ? `=== ${failed.length} FAILED ===` : `=== ALL PASSED === (${results.length} ok)`));
if (failed.length) {
    for (const f of failed) console.log("  ✗ " + f.name + (f.detail ? "  → " + f.detail : ""));
    process.exit(1);
}
