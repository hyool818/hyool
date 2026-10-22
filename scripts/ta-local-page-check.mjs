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

/* 只给「字字动画」用的极简 DOM：文本节点 + span + class，够 stream() 真跑一遍。
   故意不提供 getElementById —— boot() 仍然跳过，前面的用例不受影响。 */
function fakeNode(tag) {
    const n = { tag, children: [], text: "", classes: [] };
    Object.defineProperty(n, "className", {
        get: () => n.classes.join(" "),
        set: (v) => { n.classes = String(v).split(/\s+/).filter(Boolean); }
    });
    Object.defineProperty(n, "textContent", {
        get: () => (n.children.length ? n.children.map((c) => c.textContent).join("") : n.text),
        set: (v) => { n.text = String(v); n.children.length = 0; }
    });
    n.classList = {
        add: (c) => { if (!n.classes.includes(c)) n.classes.push(c); },
        remove: (c) => { n.classes = n.classes.filter((x) => x !== c); },
        contains: (c) => n.classes.includes(c)
    };
    n.appendChild = (c) => { n.children.push(c); return c; };
    return n;
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
    document: {
        readyState: "loading",
        addEventListener: () => { },
        createElement: (tag) => fakeNode(tag),
        createTextNode: (t) => { const n = fakeNode("#text"); n.text = String(t); return n; },
        createDocumentFragment: () => fakeNode("#fragment")
    },
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

/* ---------------- 9. 字字动画：真逐字、可打断、与语音解耦 ---------------- */

const RV = sandbox.window.AICompanion && sandbox.window.AICompanion._reveal;
check("页面导出字字动画口径（tokens / plan / run）", !!(RV && RV.tokens && RV.plan && RV.run));

const tokens = RV.tokens("好呀 hello 世界😀").map((t) => t.t);
check("分词：中文逐字、英文按词、空白单独留、emoji 不拆",
    JSON.stringify(tokens) === JSON.stringify(["好", "呀", " ", "hello", " ", "世", "界", "😀"]), JSON.stringify(tokens));

const plan = RV.plan("嗯。好，走");
check("节奏：句末停 190 ms、逗号停 70 ms、普通字走基础间隔",
    plan.steps[1].delay === plan.base + 190 && plan.steps[3].delay === plan.base + 70 && plan.steps[0].delay === plan.base,
    JSON.stringify({ base: plan.base, delays: plan.steps.map((s) => s.delay) }));
check("节奏有上限：短句每字 ≤40 ms、长句自动提速到 9 ms",
    plan.base <= 40 && plan.base >= 9 && RV.plan("字".repeat(300)).base === 9, String(plan.base));

const waitFor = async (cond, ms) => {
    const t0 = Date.now();
    while (!cond()) {
        if (Date.now() - t0 > ms) return false;
        await new Promise((r) => setTimeout(r, 10));
    }
    return true;
};

const liveNode = fakeNode("div");
let liveDone = 0;
RV.run(liveNode, "嗯。我在", () => { liveDone++; });
check("开场：整句先占位进 DOM（字幕不跳行），但还没吐完",
    liveNode.textContent === "嗯。我在" && liveNode.children.length > 0 && liveNode.classes.includes("revealing"),
    liveNode.textContent);
check("逐字跑完：收尾换回纯文本、去掉 revealing、归档只回调一次",
    await waitFor(() => liveDone === 1, 4000) && liveNode.children.length === 0 &&
    liveNode.textContent === "嗯。我在" && !liveNode.classes.includes("revealing"),
    JSON.stringify({ done: liveDone, kids: liveNode.children.length }));

/* 新台词顶掉旧动画：旧的当场补全 + 照旧归档，不能丢消息 */
const oldNode = fakeNode("div");
let oldDone = 0;
RV.run(oldNode, "第一句台词写长一点才好打断", () => { oldDone++; });
const newNode = fakeNode("div");
let newDone = 0;
RV.run(newNode, "第二句", () => { newDone++; });
check("新台词顶掉旧动画：旧的立刻补全并归档（消息不丢）",
    oldDone === 1 && oldNode.textContent === "第一句台词写长一点才好打断" && !oldNode.classes.includes("revealing"),
    JSON.stringify({ done: oldDone, text: oldNode.textContent }));
check("顶掉之后新动画自己跑完",
    await waitFor(() => newDone === 1, 4000) && newNode.textContent === "第二句");

/* 减少动效偏好 → 直接铺全文，不等逐字 tick */
sandbox.window.matchMedia = () => ({ matches: true });
const stillNode = fakeNode("div");
let stillDone = 0;
RV.run(stillNode, "直接显示", () => { stillDone++; });
check("减少动效：一句话直接铺全文（回调同步触发）",
    stillDone === 1 && stillNode.textContent === "直接显示" && stillNode.children.length === 0 && !stillNode.classes.includes("revealing"));
delete sandbox.window.matchMedia;

/* 语音与动画解耦：say() 里先 speak，再把 commit 交给动画收尾 */
check("语音不等动画：speak(out) 在 stream() 之前（字幕不拖声音）",
    /speak\(out\);[^\n]*\n\s*stream\(node\.bubble, out, function \(\) \{ commit\(msg\); \}\)/.test(code));
check("CSS：逐字隐藏只在 .revealing 期间生效（JS 崩了也不会白屏）",
    /\.bubble\.revealing \.ch\{/.test(html) && /\.bubble\.revealing \.ch\.on\{/.test(html));

/* ---------------- 总结 ---------------- */

const failed = results.filter((x) => !x.ok);
console.log("\n" + (failed.length ? `=== ${failed.length} FAILED ===` : `=== ALL PASSED === (${results.length} ok)`));
if (failed.length) {
    for (const f of failed) console.log("  ✗ " + f.name + (f.detail ? "  → " + f.detail : ""));
    process.exit(1);
}
