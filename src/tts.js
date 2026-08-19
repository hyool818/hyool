/**
 * HYOOL · Edge TTS（微软 Edge 在线语音合成）后端代理模块
 *
 * 通过出站 WebSocket 直连微软 Edge 在线 TTS 服务，无需任何 API Key。
 * 协议细节逆向自开源项目 edge-tts (https://github.com/rany2/edge-tts)。
 *
 * 实测结论：Edge readaloud 端点不支持 <mstts:express-as> 情感风格与
 * <break> 标签（会导致合成无响应超时），故仅使用 prosody 的
 * rate / pitch / volume，配合朗读前文本清洗提升自然度。
 *
 * 接口（登录与限流在 index.js 中处理）：
 *   POST /api/tts             { text, voice?, rate?, pitch?, volume? } → audio/mpeg
 *   GET  /api/tts?text=...    （同 POST，参数走 query）
 */

/* =========================================================
   常量（对齐 edge-tts constants.py）
========================================================= */

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_BASE_URL =
    "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const SEC_MS_GEC_VERSION = "1-143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = "143";
const WIN_EPOCH = 11644473600; // Windows 文件时间(1601) 与 Unix 纪元(1970) 之间的秒数
const TICKS_PER_SECOND = 1e7; // 1 秒 = 1e7 个 100 纳秒单位
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const TEXT_LIMIT = 2000; // 单次请求文本上限（字符）
const CHUNK_LIMIT = 1000; // 单次 SSML 合成上限（字符），超长自动切句分段

/** 前端展示 / 后端校验用的语音列表 */
export const TTS_VOICES = [
    { id: "zh-CN-XiaoxiaoNeural", name: "晓晓 · 女（温暖亲切）", gender: "female" },
    { id: "zh-CN-XiaoyiNeural", name: "晓伊 · 女（活泼）", gender: "female" },
    { id: "zh-CN-YunjianNeural", name: "云健 · 男（成熟稳重）", gender: "male" },
    { id: "zh-CN-YunxiNeural", name: "云希 · 男（阳光）", gender: "male" },
    { id: "zh-CN-YunxiaNeural", name: "云夏 · 男（少年感）", gender: "male" },
    { id: "zh-CN-YunyangNeural", name: "云扬 · 男（新闻播报）", gender: "male" },
    { id: "zh-CN-liaoning-XiaobeiNeural", name: "晓北 · 女（东北腔）", gender: "female" },
    { id: "zh-CN-shaanxi-XiaoniNeural", name: "晓妮 · 女（陕西腔）", gender: "female" },
    { id: "zh-HK-HiuGaaiNeural", name: "曉佳 · 粤语女声", gender: "female" },
    { id: "zh-HK-WanLungNeural", name: "雲龍 · 粤语男声", gender: "male" },
    { id: "zh-TW-HsiaoChenNeural", name: "曉臻 · 台湾女声", gender: "female" },
    { id: "zh-TW-YunJheNeural", name: "雲哲 · 台湾男声", gender: "male" },
    { id: "en-US-EmmaMultilingualNeural", name: "Emma · 英文多语女声", gender: "female" },
    { id: "en-US-ChristopherNeural", name: "Christopher · 英文男声", gender: "male" },
    { id: "ja-JP-NanamiNeural", name: "Nanami · 日文女声", gender: "female" },
    { id: "ja-JP-KeitaNeural", name: "Keita · 日文男声", gender: "male" },
    { id: "ko-KR-SunHiNeural", name: "SunHi · 韩文女声", gender: "female" },
    { id: "ko-KR-InJoonNeural", name: "InJoon · 韩文男声", gender: "male" }
];

const KNOWN_VOICES = new Set(TTS_VOICES.map((v) => v.id));

const WSS_HEADERS = {
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        `(KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 ` +
        `Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
    "Accept-Language": "en-US,en;q=0.9"
};

/* =========================================================
   工具函数
========================================================= */

function connectId() {
    return crypto.randomUUID().replace(/-/g, "");
}

function randomMuid() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return hex.toUpperCase();
}

/** Python 风格的四舍五入到整数（银行家舍入，对齐 edge-tts 的 f"{ticks:.0f}"） */
function roundToInt(x) {
    const fl = Math.floor(x);
    const diff = x - fl;
    if (diff < 0.5) return fl;
    if (diff > 0.5) return fl + 1;
    return fl % 2 === 0 ? fl : fl + 1;
}

/**
 * 生成 Sec-MS-GEC 令牌：
 * SHA256( 取整到最近 5 分钟的 Windows 文件时间戳 + TrustedClientToken ).hex().upper()
 */
async function generateSecMsGec(nowMs = Date.now()) {
    let ticks = nowMs / 1000;
    ticks += WIN_EPOCH;
    ticks -= ticks % 300; // 向下取整到 5 分钟窗口
    ticks *= TICKS_PER_SECOND; // 转为 100ns 单位
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`${roundToInt(ticks)}${TRUSTED_CLIENT_TOKEN}`)
    );
    let hex = "";
    for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, "0");
    return hex.toUpperCase();
}

/** JS 风格日期串，格式对齐 edge-tts 的 date_to_string() */
function jsDateString(d = new Date()) {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];
    const p2 = (n) => String(n).padStart(2, "0");
    return (
        `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p2(d.getUTCDate())} ` +
        `${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} ` +
        "GMT+0000 (Coordinated Universal Time)"
    );
}

function escapeXml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

/** 把 "zh-CN-XiaoxiaoNeural" 转成微软完整格式的 voice 名 */
function normalizeVoice(voice) {
    const m = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(voice || "");
    if (!m) return voice;
    let region = m[2];
    let name = m[3];
    if (name.includes("-")) {
        region = `${region}-${name.slice(0, name.indexOf("-"))}`;
        name = name.slice(name.indexOf("-") + 1);
    }
    return `Microsoft Server Speech Text to Speech Voice (${m[1]}-${region}, ${name})`;
}

/** 朗读前文本清理：去掉 markdown / emoji / 剧本动作描写，归一化标点，
 * 避免 TTS 把“*咧嘴一笑*”“😊”这类内容读出来，听感更接近真人说话。
 */
function cleanTextForSpeech(raw) {
    let t = String(raw || "");
    t = t
        // 代码块 / 行内代码 / 加粗 / 斜体 / markdown 链接 / 标题 / 引用
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/\*\*([^*]*)\*\*/g, "$1")
        .replace(/\*([^*]*)\*/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/^>\s?/gm, "")
        // 剧本动作：*轻笑*、（笑）、[笑]、【笑】
        .replace(/\*[^*\n]{1,24}\*/g, "")
        .replace(/[（(][^）)\n]{1,12}[)）]/g, "")
        .replace(/[\[【][^\]】\n]{1,12}[\]】]/g, "")
        // emoji（含肤色修饰、ZWJ 序列、旗帜、©️®️）
        .replace(
            /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}\u{20E3}\u{00A9}\u{00AE}]/gu,
            ""
        )
        // 连续感叹/问号/句号/逗号/分号 → 单一标点
        .replace(/[！!]{2,}/g, "！")
        .replace(/[？?]{2,}/g, "？")
        .replace(/[。.]{3,}/g, "。")
        .replace(/[。.]{2,}/g, "。")
        .replace(/[，,]{2,}/g, "，")
        .replace(/[；;]{2,}/g, "；")
        // 省略号与波浪号归一
        .replace(/\.{2,}/g, "……")
        .replace(/…+/g, "……")
        .replace(/[~～]{1,}/g, "～")
        // 多余空白与换行
        .replace(/[ \t]+/g, " ")
        .replace(/\s*\n\s*/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return t;
}

/** 长文本按句子边界切分，避免超出单次 SSML 上限 */
function splitText(text, limit = CHUNK_LIMIT) {
    if (text.length <= limit) return [text];
    const parts = [];
    let rest = text;
    while (rest.length > limit) {
        const head = rest.slice(0, limit);
        let cut = -1;
        for (let i = head.length - 1; i >= 0; i--) {
            if ("。！？!?；;…\n".includes(head[i])) {
                cut = i + 1;
                break;
            }
        }
        if (cut <= 0) cut = limit; // 无标点则硬切
        const piece = rest.slice(0, cut).trim();
        if (piece) parts.push(piece);
        rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
    return parts;
}

/* =========================================================
   协议消息构建（对齐 edge-tts communicate.py）
========================================================= */

function buildSpeechConfigMessage() {
    return (
        `X-Timestamp:${jsDateString()}\r\n` +
        "Content-Type:application/json; charset=utf-8\r\n" +
        "Path:speech.config\r\n\r\n" +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{` +
        `"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},` +
        `"outputFormat":"${OUTPUT_FORMAT}"}}}}\r\n`
    );
}

function buildSsmlMessage(voice, text, rate, pitch, volume) {
    const ssml =
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' " +
        "xml:lang='en-US'>" +
        `<voice name='${normalizeVoice(voice)}'>` +
        `<prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>` +
        escapeXml(text) +
        "</prosody>" +
        "</voice></speak>";
    return (
        `X-RequestId:${connectId()}\r\n` +
        "Content-Type:application/ssml+xml\r\n" +
        `X-Timestamp:${jsDateString()}Z\r\n` +
        "Path:ssml\r\n\r\n" +
        ssml
    );
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json; charset=UTF-8",
            "Cache-Control": "no-store"
        }
    });
}

/* =========================================================
   WebSocket 连接与音频收集
========================================================= */

/**
 * 建立到微软 Edge TTS 的出站 WebSocket 连接。
 *
 * 注意：cloudflare:sockets 的 connect() 仅支持 TCP host:port 地址，不支持
 * wss:// URL（运行时直接抛 "Specified address is missing port."）。
 * 出站 WebSocket 必须通过 fetch() + `Upgrade: websocket` 头完成握手，
 * 且握手请求可以携带自定义 headers（Origin / User-Agent / Cookie 等，
 * 微软服务要求浏览器类握手头，否则直接拒绝连接）。
 */
async function openWs(url) {
    const fetchPromise = fetch(url.replace(/^wss:\/\//, "https://"), {
        headers: {
            Upgrade: "websocket",
            Connection: "Upgrade",
            ...WSS_HEADERS,
            Cookie: `muid=${randomMuid()};`
        }
    });
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TTS 服务连接超时，请重试。")), 20000)
    );
    const resp = await Promise.race([fetchPromise, timeout]);
    const ws = resp.webSocket;
    if (!ws) {
        throw new Error(`TTS WebSocket 升级失败（HTTP ${resp.status}）。`);
    }
    // compat date ≥ 2026-03-17 时 websocket_standard_binary_type 默认开启，
    // 二进制帧按 WebSocket 标准以 Blob 投递；显式改回 ArrayBuffer 以便同步解析音频帧。
    ws.binaryType = "arraybuffer";
    ws.accept();
    return ws;
}

function collectAudio(ws) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let done = false;
        const timer = setTimeout(
            () => fail(new Error("TTS 合成超时，请重试。")),
            30000
        );

        function toBytes(data) {
            if (typeof data === "string") return new TextEncoder().encode(data);
            if (data instanceof ArrayBuffer) return new Uint8Array(data);
            if (ArrayBuffer.isView(data)) {
                return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            }
            return new Uint8Array(0);
        }

        function parsePath(headersText) {
            for (const line of headersText.split("\r\n")) {
                if (!line) continue;
                const idx = line.indexOf(":");
                if (idx === -1) continue;
                if (line.slice(0, idx).toLowerCase() === "path") {
                    return line.slice(idx + 1).trim();
                }
            }
            return null;
        }

        function finish() {
            if (done) return;
            done = true;
            clearTimeout(timer);
            cleanup();
            try { ws.close(1000); } catch { /* ignore */ }
            const merged = new Uint8Array(total);
            let offset = 0;
            for (const c of chunks) {
                merged.set(c, offset);
                offset += c.length;
            }
            resolve(merged);
        }

        function fail(err) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            cleanup();
            try { ws.close(1000); } catch { /* ignore */ }
            reject(err);
        }

        const onMessage = (event) => {
            const data = event.data;
            if (typeof data === "string") {
                // 文本帧：解析 Path，turn.end 表示本次合成结束
                const sep = data.indexOf("\r\n\r\n");
                if (sep === -1) return;
                const path = parsePath(data.slice(0, sep));
                if (path === "turn.end") finish();
                if (path === "turn.error") {
                    fail(new Error("语音服务拒绝了本次合成，请重试。"));
                }
                return;
            }
            // 二进制帧：前 2 字节为大端 header 长度，之后是音频数据
            const bytes = toBytes(data);
            if (bytes.length < 2) return;
            const headerLength = (bytes[0] << 8) | bytes[1];
            if (headerLength + 2 > bytes.length) return;
            const headerText = new TextDecoder().decode(
                bytes.subarray(2, headerLength + 2)
            );
            if (parsePath(headerText) === "audio") {
                const audio = bytes.subarray(headerLength + 2);
                if (audio.length > 0) {
                    chunks.push(audio);
                    total += audio.length;
                }
            }
        };

        const onError = () => fail(new Error("TTS 连接中断，请重试。"));
        const onClose = () => {
            if (!done) fail(new Error("TTS 连接已关闭。"));
        };
        const cleanup = () => {
            ws.removeEventListener("message", onMessage);
            ws.removeEventListener("error", onError);
            ws.removeEventListener("close", onClose);
        };

        ws.addEventListener("message", onMessage);
        ws.addEventListener("error", onError);
        ws.addEventListener("close", onClose);
    });
}

/* =========================================================
   对外接口
========================================================= */

/** 单段文本合成（一次 WebSocket 会话） */
async function synthChunk({ text, voice, rate, pitch, volume }) {
    const connectionId = connectId();
    const secMsGec = await generateSecMsGec();
    const url =
        `${WSS_BASE_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
        `&ConnectionId=${connectionId}` +
        `&Sec-MS-GEC=${secMsGec}` +
        `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

    const ws = await openWs(url);
    const audioPromise = collectAudio(ws); // 先挂监听再发送，避免丢帧
    ws.send(buildSpeechConfigMessage());
    ws.send(buildSsmlMessage(voice, text, rate, pitch, volume));
    return await audioPromise;
}

/** 合成语音，返回 MP3 字节（Uint8Array） */
export async function synthesizeEdgeTts({
    text,
    voice = DEFAULT_VOICE,
    rate = "+0%",
    pitch = "+0Hz",
    volume = "+0%"
}) {
    const cleaned = cleanTextForSpeech(
        String(text || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    ).trim();
    if (!cleaned) throw new Error("没有可合成的文本。");

    const parts = splitText(cleaned, CHUNK_LIMIT);
    const all = [];
    for (const part of parts) {
        all.push(
            await synthChunk({ text: part, voice, rate, pitch, volume })
        );
    }

    const total = all.reduce((n, a) => n + a.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const a of all) {
        merged.set(a, offset);
        offset += a.length;
    }
    return merged;
}

/** POST/GET /api/tts 处理器（登录与限流已在 index.js 完成） */
export async function handleTtsRequest(request, env, user) {
    const url = new URL(request.url);
    const method = request.method;

    if (method !== "POST" && method !== "GET") {
        return json({ success: false, error: "不支持的方法。" }, 405);
    }

    let text = "";
    let voice = "";
    let rate = "+0%";
    let pitch = "+0Hz";
    let volume = "+0%";

    if (method === "POST") {
        const body = await request.json().catch(() => ({}));
        text = String(body.text || "").trim();
        voice = String(body.voice || "").trim();
        rate = String(body.rate || "+0%").trim();
        pitch = String(body.pitch || "+0Hz").trim();
        volume = String(body.volume || "+0%").trim();
    } else {
        text = String(url.searchParams.get("text") || "").trim();
        voice = String(url.searchParams.get("voice") || "").trim();
        rate = String(url.searchParams.get("rate") || "+0%").trim();
        pitch = String(url.searchParams.get("pitch") || "+0Hz").trim();
        volume = String(url.searchParams.get("volume") || "+0%").trim();
    }

    if (!text) return json({ success: false, error: "缺少文本内容。" }, 400);
    if (text.length > TEXT_LIMIT) {
        return json({ success: false, error: "文本过长（最多 2000 字）。" }, 400);
    }
    if (voice && !KNOWN_VOICES.has(voice)) {
        return json({ success: false, error: "不支持的语音。" }, 400);
    }
    if (
        !/^[+-]\d+%$/.test(rate) ||
        !/^[+-]\d+%$/.test(volume) ||
        !/^[+-]\d+Hz$/.test(pitch)
    ) {
        return json({ success: false, error: "语速/音量/音调参数格式错误。" }, 400);
    }

    const audio = await synthesizeEdgeTts({
        text,
        voice: voice || DEFAULT_VOICE,
        rate,
        pitch,
        volume
    });

    if (!audio || audio.length === 0) {
        return json({ success: false, error: "语音合成失败，请稍后再试。" }, 502);
    }

    return new Response(audio, {
        status: 200,
        headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
            "Content-Length": String(audio.length)
        }
    });
}
