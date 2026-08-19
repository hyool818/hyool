/**
 * 本地回归：Edge TTS 语速参数（rate）回归测试。
 *
 * 结论（实验定论，2026-08）：Edge readaloud 端点不支持
 * <mstts:express-as> 情感风格与 <break> 标签（均导致合成无响应超时），
 * 故生产只使用 prosody 的 rate / pitch / volume。
 * 本脚本验证三档语速都能正常合成、且字节数随 rate 单调变化。
 *
 * 运行：node test-tts-express.mjs  （Node >= 21，需能访问外网）
 * 代理：$env:HYOOL_PROXY = "http://127.0.0.1:7890"; node test-tts-express.mjs
 */
import { WebSocket as UWebSocket, ProxyAgent } from "undici";

setTimeout(() => { console.log("GLOBAL TIMEOUT, force exit"); process.exit(1); }, 120000);

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_BASE_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const SEC_MS_GEC_VERSION = "1-143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = "143";
const WIN_EPOCH = 11644473600;
const TICKS_PER_SECOND = 1e7;
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const WSS_HEADERS = {
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
  Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    `Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
  "Accept-Language": "en-US,en;q=0.9",
};

function connectId() { return crypto.randomUUID().replace(/-/g, ""); }
function randomMuid() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex.toUpperCase();
}
function roundToInt(x) {
  const fl = Math.floor(x);
  const diff = x - fl;
  if (diff < 0.5) return fl;
  if (diff > 0.5) return fl + 1;
  return fl % 2 === 0 ? fl : fl + 1;
}
async function generateSecMsGec(nowMs = Date.now()) {
  let ticks = nowMs / 1000;
  ticks += WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= TICKS_PER_SECOND;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${roundToInt(ticks)}${TRUSTED_CLIENT_TOKEN}`)
  );
  let hex = "";
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, "0");
  return hex.toUpperCase();
}
function jsDateString(d = new Date()) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p2 = (n) => String(n).padStart(2, "0");
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p2(d.getUTCDate())} ` +
    `${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} ` +
    "GMT+0000 (Coordinated Universal Time)";
}

function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
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
  // 与 src/tts.js 的 buildSsmlMessage 完全一致的纯 plain SSML（无 mstts / break）
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

function openWsLocal(url) {
  return new Promise((resolve, reject) => {
    const opts = { headers: WSS_HEADERS, maxPayload: 16 * 1024 * 1024 };
    if (process.env.HYOOL_PROXY) {
      opts.dispatcher = new ProxyAgent(process.env.HYOOL_PROXY);
    }
    const ws = new UWebSocket(url, opts);
    ws.binaryType = "arraybuffer";
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("connect timeout (8s)"));
    }, 8000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(ws); });
    ws.addEventListener("error", (e) => {
      clearTimeout(timer);
      reject(new Error("connect error: " + (e?.message || e?.type || "unknown")));
    });
    ws.addEventListener("close", (e) => {
      if (!e.wasClean) console.log("  [close] code=" + e.code + " reason=" + e.reason);
    });
  });
}

function collectAudio(ws) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let done = false;
    const timer = setTimeout(() => fail(new Error("合成超时(20s)")), 20000);
    function finish() {
      if (done) return;
      done = true; clearTimeout(timer);
      try { ws.close(1000); } catch {}
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) { merged.set(c, offset); offset += c.length; }
      resolve(merged);
    }
    function fail(err) {
      if (done) return;
      done = true; clearTimeout(timer);
      try { ws.close(1000); } catch {}
      reject(err);
    }
    function parsePath(headersText) {
      for (const line of headersText.split("\r\n")) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        if (line.slice(0, idx).toLowerCase() === "path") return line.slice(idx + 1).trim();
      }
      return null;
    }
    ws.addEventListener("message", (event) => {
      const data = event.data;
      if (typeof data === "string") {
        const sep = data.indexOf("\r\n\r\n");
        if (sep === -1) return;
        const path = parsePath(data.slice(0, sep));
        if (path === "turn.end") return finish();
        if (path === "turn.error") return fail(new Error("service rejected (turn.error)"));
        if (path === "response") {
          const body = data.slice(sep + 4);
          if (/error/i.test(body)) {
            console.log("  [response body]", body.slice(0, 300));
          }
        }
        if (path !== "audio.metadata") {
          console.log("  [text frame] path=" + path);
        }
        return;
      }
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(0);
      if (bytes.length < 2) return;
      const headerLength = (bytes[0] << 8) | bytes[1];
      if (headerLength + 2 > bytes.length) return;
      const headerText = new TextDecoder().decode(bytes.subarray(2, headerLength + 2));
      if (parsePath(headerText) === "audio") {
        const audio = bytes.subarray(headerLength + 2);
        if (audio.length > 0) { chunks.push(audio); total += audio.length; }
      }
    });
    ws.addEventListener("close", (e) => {
      if (!done && !e.wasClean) fail(new Error("连接中断"));
    });
    ws.addEventListener("error", () => fail(new Error("连接错误")));
  });
}

async function synth({ text, voice = "zh-CN-XiaoxiaoNeural", rate = "+0%", pitch = "+0Hz", volume = "+0%" }) {
  const connectionId = connectId();
  const secMsGec = await generateSecMsGec();
  const url =
    `${WSS_BASE_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&ConnectionId=${connectionId}` +
    `&Sec-MS-GEC=${secMsGec}` +
    `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
  const ws = await openWsLocal(url);
  const audioPromise = collectAudio(ws);
  ws.send(buildSpeechConfigMessage());
  ws.send(buildSsmlMessage(voice, text, rate, pitch, volume));
  return await audioPromise;
}

const text = "你好呀，今天过得怎么样？我好想和你一起去散步呀。希望你能一直陪着我。";
const voice = "zh-CN-XiaoxiaoNeural";

// 语速三档：-50% / 正常 / +50%（对应前端滑块的 -50 ~ +50）
const cases = [
  { name: "rate=-50%", rate: "-50%" },
  { name: "rate=+0% ", rate: "+0%" },
  { name: "rate=+50%", rate: "+50%" },
];

const results = [];
for (const c of cases) {
  try {
    const t0 = Date.now();
    const audio = await synth({ text, voice, rate: c.rate });
    const ms = Date.now() - t0;
    results.push({ rate: c.rate, bytes: audio.length, ms });
    // 48kbit/s mono → 6000 B/s，估算时长便于对比
    const sec = (audio.length / 6000).toFixed(1);
    console.log(`${c.name}: OK  bytes=${audio.length}  ~${sec}s  ${ms}ms`);
  } catch (e) {
    results.push({ rate: c.rate, error: e.message });
    console.log(`${c.name}: FAIL ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 300));
}

// 校验单调性：rate 越高，同文本音频应越短
const ok = results.filter((r) => !r.error);
if (ok.length === 3) {
  const asc = ok.map((r) => r.bytes).every((b, i, a) => i === 0 || a[i - 1] >= b);
  console.log(asc ? "PASS：字节数随 rate 单调递减，语速调节生效" : "WARN：字节数未单调变化");
} else {
  console.log(`FAIL：${ok.length}/3 个档位合成成功`);
}
console.log("done");
process.exit(0);

