/**
 * TA 自测：自建 GPT-SoVITS 这条合成链（参考音频三级优先 + 请求体契约 + 降级头）
 *
 *   node scripts/ta-tts-local-check.mjs          # 纯离线：假 fetch 截上游请求，不碰网络 / 不碰 GPU
 *
 * 覆盖：
 *   1) 参考音频三级优先：TA_TTS_LOCAL_VOICES[voice] → 性别档（FEMALE_REF / MALE_REF）→ TA_TTS_LOCAL_REF
 *   2) 「只配一份素材」的两种后果：性别档缺失时男声**不会偷用女声**（宁可降级，也不假装换过音色）
 *   3) 上游请求体契约（text_lang / media_type / cut5 / speed_factor / seed / Bearer）
 *   4) 降级口径：未配置不算失败、4xx 不重试、快速网络错重试一次、502 也带 X-TA-TTS-Attempts
 *   5) /api/ta/config 的 tts.chain / tts.refs 如实反映配置
 */
import { handleTaRoutes, ttsChain, hasLocalRef, localTtsEndpoint } from "../src/ta/index.js";

const results = [];
function check(name, cond, detail) {
    results.push({ name, ok: !!cond });
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail == null ? "" : "  → " + detail}`);
}

const URL_BASE = "https://ta-tts.example.com";
const FEMALE = "D:\\AI\\refs\\xiaoman.wav";
const MALE = "D:\\AI\\refs\\ayuan.wav";
const GLOBAL = "D:\\AI\\refs\\default.wav";
const FEMALE_VOICE = "zh-CN-XiaoxiaoNeural";
const MALE_VOICE = "zh-CN-YunxiNeural";

/** 假上游：记下每次请求，按 case 决定回音频 / 回 400 / 抛网络错 */
let calls = [];
let nextReply = () => ({ ok: true, status: 200, body: new Uint8Array([1, 2, 3, 4]) });
globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init.body || "{}"));
    calls.push({ url: String(url), headers: init.headers || {}, body: body });
    const r = nextReply();
    if (r.throw) throw new Error(r.throw);
    return {
        ok: !!r.ok,
        status: r.status || 200,
        headers: new Map([["Content-Type", r.contentType || "audio/wav"]]),
        text: async () => String(r.text || ""),
        arrayBuffer: async () => r.body.buffer.slice(r.body.byteOffset, r.body.byteOffset + r.body.byteLength)
    };
};

const ttsEnv = (extra) => Object.assign({
    TA_TTS_LOCAL_URL: URL_BASE,
    TA_TTS_LOCAL_REF: "",
    TA_TTS_LOCAL_FEMALE_REF: "",
    TA_TTS_LOCAL_MALE_REF: "",
    TA_TTS_LOCAL_VOICES: "",
    TA_TTS_LOCAL_TOKEN: "",
    TA_TTS_LOCAL_MEDIA: "wav"
}, extra || {});

let ip = 0;
async function tts(env, payload) {
    ip += 1;
    const res = await handleTaRoutes(
        new Request("http://ta.local/api/ta/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-forwarded-for": "10.9.0." + ip },
            body: JSON.stringify(payload)
        }),
        env, "/api/ta/tts", "POST"
    );
    return {
        status: res.status,
        provider: res.headers.get("X-TA-TTS-Provider") || "",
        voice: res.headers.get("X-TA-TTS-Voice") || "",
        attempts: res.headers.get("X-TA-TTS-Attempts") || "",
        bytes: (await res.arrayBuffer()).byteLength
    };
}

/* ---------------- 1. 端点拼装 ---------------- */

check("只填域名 → 自动补 /tts", localTtsEndpoint({ TA_TTS_LOCAL_URL: "https://x.com" }) === "https://x.com/tts");
check("带尾斜杠也能补对", localTtsEndpoint({ TA_TTS_LOCAL_URL: "https://x.com/" }) === "https://x.com/tts");
check("填完整端点不重复补", localTtsEndpoint({ TA_TTS_LOCAL_URL: "https://x.com/tts" }) === "https://x.com/tts");
check("没配 URL → 空串（不外呼）", localTtsEndpoint({}) === "");


/* ---------------- 2. 参考音频三级优先 ---------------- */

check("只配性别档女声 → 自建层进链", ttsChain(ttsEnv({ TA_TTS_LOCAL_FEMALE_REF: FEMALE })).includes("gptsovits"));
check("只配性别档男声 → 自建层进链", ttsChain(ttsEnv({ TA_TTS_LOCAL_MALE_REF: MALE })).includes("gptsovits"));
check("只配全局默认 → 自建层进链", hasLocalRef({ TA_TTS_LOCAL_REF: GLOBAL }) === true);
check("一份参考音频都没配 → 自建层不进链（不白等 6 s 超时）",
    ttsChain(ttsEnv({})).includes("gptsovits") === false, JSON.stringify(ttsChain(ttsEnv({}))));

calls = [];
let out = await tts(ttsEnv({ TA_TTS_LOCAL_FEMALE_REF: FEMALE, TA_TTS_LOCAL_PROMPT_TEXT: "全局原文" }), { text: "在呢。", voice: FEMALE_VOICE });
check("女声 + 只配女声档 → 200 且来源=gptsovits", out.status === 200 && out.provider === "gptsovits", `status=${out.status} provider=${out.provider}`);
check("女声档命中：ref 用 FEMALE_REF、音色标签=female-default",
    calls.length === 1 && calls[0].body.ref_audio_path === FEMALE && out.voice === "female-default",
    calls.length ? `${calls[0].body.ref_audio_path} / ${out.voice}` : "no call");

calls = [];
out = await tts(ttsEnv({ TA_TTS_LOCAL_FEMALE_REF: FEMALE }), { text: "在呢。", voice: MALE_VOICE });
check("只配女声档时，男声不会偷用女声（自建层跳过 → 502，页面转设备语音）",
    calls.length === 0 && out.status === 502, `calls=${calls.length} status=${out.status}`);

calls = [];
out = await tts(ttsEnv({ TA_TTS_LOCAL_FEMALE_REF: FEMALE, TA_TTS_LOCAL_MALE_REF: MALE, TA_TTS_LOCAL_MALE_PROMPT_TEXT: "男声原文" }), { text: "在呢。", voice: MALE_VOICE });
check("男女各一份 → 男声走 MALE_REF、标签=male-default",
    calls.length === 1 && calls[0].body.ref_audio_path === MALE && out.voice === "male-default",
    calls.length ? `${calls[0].body.ref_audio_path} / ${out.voice}` : "no call");
check("男声档的原文写进 prompt_text", calls.length === 1 && calls[0].body.prompt_text === "男声原文");

calls = [];
out = await tts(ttsEnv({
    TA_TTS_LOCAL_FEMALE_REF: FEMALE,
    TA_TTS_LOCAL_VOICES: JSON.stringify({ "zh-CN-XiaoyiNeural": { ref: "D:\\AI\\refs\\xiaoyi.wav", prompt: "逐音色原文" } })
}), { text: "在呢。", voice: "zh-CN-XiaoyiNeural" });
check("逐音色映射优先于性别档",
    calls.length === 1 && calls[0].body.ref_audio_path === "D:\\AI\\refs\\xiaoyi.wav" && out.voice === "zh-CN-XiaoyiNeural",
    calls.length ? `${calls[0].body.ref_audio_path} / ${out.voice}` : "no call");

calls = [];
out = await tts(ttsEnv({ TA_TTS_LOCAL_VOICES: "{坏掉的 json", TA_TTS_LOCAL_REF: GLOBAL }), { text: "在呢。", voice: FEMALE_VOICE });
check("映射表写坏 → 当没配，回落全局默认（不报错）",
    out.status === 200 && calls.length === 1 && calls[0].body.ref_audio_path === GLOBAL && out.voice === "local-default",
    `status=${out.status} voice=${out.voice}`);

/* ---------------- 3. 上游请求体契约 ---------------- */

calls = [];
nextReply = () => ({ ok: true, status: 200, body: new Uint8Array([9, 9, 9]) });
await tts(ttsEnv({
    TA_TTS_LOCAL_FEMALE_REF: FEMALE,
    TA_TTS_LOCAL_TOKEN: "tok-123",
    TA_TTS_LOCAL_TEXT_LANG: "zh",
    TA_TTS_LOCAL_MEDIA: "wav"
}), { text: "在呢。", voice: FEMALE_VOICE, rate: "+20%" });
const sent = calls[0] || { body: {}, headers: {} };
check("请求体带 text / text_lang / prompt_lang", sent.body.text === "在呢。" && sent.body.text_lang === "zh" && sent.body.prompt_lang === "zh");
check("切句与批处理口径固定（cut5 / batch_size=1 / streaming_mode=false / seed=-1）",
    sent.body.text_split_method === "cut5" && sent.body.batch_size === 1 && sent.body.streaming_mode === false && sent.body.seed === -1);
check("rate=+20% → speed_factor=1.2", sent.body.speed_factor === 1.2, String(sent.body.speed_factor));
check("配了 TOKEN → 带 Authorization: Bearer", String(sent.headers.Authorization || "") === "Bearer tok-123");

calls = [];
await tts(ttsEnv({ TA_TTS_LOCAL_FEMALE_REF: FEMALE }), { text: "在呢。", voice: FEMALE_VOICE, rate: "-60%" });
check("rate=-60% → clamp 到 0.5", calls[0] && calls[0].body.speed_factor === 0.5, calls[0] ? String(calls[0].body.speed_factor) : "no call");

calls = [];
await tts(ttsEnv({ TA_TTS_LOCAL_FEMALE_REF: FEMALE }), { text: "在呢。", voice: FEMALE_VOICE });
check("没配 TOKEN → 不带 Authorization（api_v2.py 本来也不认）", calls[0] && !("Authorization" in calls[0].headers));

/* ---------------- 4. 降级口径 ---------------- */

calls = [];
nextReply = () => ({ ok: false, status: 400, text: "ref audio not found" });
out = await tts(ttsEnv({ TA_TTS_LOCAL_REF: GLOBAL }), { text: "在呢。", voice: FEMALE_VOICE });
check("上游 400 → 不重试（只打一次）", calls.length === 1, "calls=" + calls.length);
check("上游 400 → 502 + X-TA-TTS-Attempts 里写明 gptsovits=http400",
    out.status === 502 && /gptsovits=http400/.test(out.attempts), `${out.status} / ${out.attempts}`);

calls = [];
nextReply = () => ({ ok: true, status: 200, body: new Uint8Array([]) });
out = await tts(ttsEnv({ TA_TTS_LOCAL_REF: GLOBAL }), { text: "在呢。", voice: FEMALE_VOICE });
check("上游回空音频 → 当成失败（不把 0 字节当成功喂给页面）",
    out.status === 502 && /gptsovits=empty/.test(out.attempts), `${out.status} / ${out.attempts}`);

calls = [];
nextReply = () => ({ throw: "connect ECONNREFUSED" });
out = await tts(ttsEnv({ TA_TTS_LOCAL_REF: GLOBAL }), { text: "在呢。", voice: FEMALE_VOICE });
check("隧道抖动（快速网络错）→ 同层重试一次（共 2 次）", calls.length === 2, "calls=" + calls.length);

calls = [];
nextReply = () => ({ ok: true, status: 200, body: new Uint8Array([7]) });
out = await tts(ttsEnv({}), { text: "在呢。", voice: FEMALE_VOICE });
check("没配自建层 → 记 unconfigured，且不外呼", calls.length === 0 && /gptsovits=unconfigured/.test(out.attempts), out.attempts);

/* ---------------- 5. /api/ta/config ---------------- */

let res = await handleTaRoutes(new Request("http://ta.local/api/ta/config", { headers: { "x-forwarded-for": "10.9.9.9" } }),
    ttsEnv({ TA_TTS_LOCAL_FEMALE_REF: FEMALE, TA_TTS_LOCAL_REF: GLOBAL }), "/api/ta/config", "GET");
let cfg = await res.json();
check("/config tts.chain 含 gptsovits", Array.isArray(cfg.tts.chain) && cfg.tts.chain[0] === "gptsovits", JSON.stringify(cfg.tts.chain));
check("/config tts.refs 如实反映「女声已配、男声没配」",
    !!cfg.tts.refs && cfg.tts.refs.female === true && cfg.tts.refs.male === false && cfg.tts.refs.fallback === true,
    JSON.stringify(cfg.tts.refs));
check("/config 不泄露参考音频路径（只给布尔/计数）",
    !JSON.stringify(cfg.tts).includes("xiaoman.wav") && !JSON.stringify(cfg.tts).includes("D:"));

/* ---------------- 汇总 ---------------- */

const failed = results.filter((r) => !r.ok);
console.log("\n" + (failed.length === 0 ? "=== ALL PASSED ===" : "=== " + failed.length + " FAILED ===") +
    ` (${results.length - failed.length} ok / ${failed.length} FAIL)`);
process.exit(failed.length ? 1 : 0);
