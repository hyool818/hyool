// audio.js — 音频工坊：导入 / 波形 / 裁剪 / 拼接 / 音效 / 导出 WAV·MP3（纯本地）
import { $, $$, toast, fmtTime, downloadBlob, setStatus, escapeHtml as esc } from './ui.js';

const ctx = new (window.AudioContext || window.webkitAudioContext)();

const R = {
  fileInput: $('#fileInput'), importBtn: $('#importBtn'),
  empty: $('#empty'), clipList: $('#clipList'), transport: $('#transport'),
  playBtn: $('#playBtn'), progressBar: $('#progressBar'), progressFill: $('#progressFill'),
  timeLabel: $('#timeLabel'), assetBadge: $('#assetBadge'),
  compOn: $('#compOn'), exportFormat: $('#exportFormat'), exportBtn: $('#exportBtn'),
  exportProgress: $('#exportProgress'),
};

/* ---------- 实时效果链：masterGain → EQ → (压缩器) → 输出 ---------- */
const masterGain = ctx.createGain(); masterGain.gain.value = 0.9;
const eqLow = ctx.createBiquadFilter();  eqLow.type = 'lowshelf';  eqLow.frequency.value = 200;
const eqMid = ctx.createBiquadFilter();  eqMid.type = 'peaking';   eqMid.frequency.value = 1000; eqMid.Q.value = 1;
const eqHigh = ctx.createBiquadFilter(); eqHigh.type = 'highshelf'; eqHigh.frequency.value = 4000;
const comp = ctx.createDynamicsCompressor();
comp.threshold.value = -18; comp.knee.value = 20; comp.ratio.value = 6;
comp.attack.value = 0.003; comp.release.value = 0.25;
masterGain.connect(eqLow); eqLow.connect(eqMid); eqMid.connect(eqHigh);
applyCompBypass();

function applyCompBypass() {
  eqHigh.disconnect();
  if (R.compOn.checked) eqHigh.connect(comp).connect(ctx.destination);
  else eqHigh.connect(ctx.destination);
}

/* ---------- 状态 ---------- */
let clips = [];       // {id,name,buffer,trimStart,trimEnd,volume,fadeIn,fadeOut,reverse,reversed,_card,_canvas}
let uid = 0;
let playing = false;
let playFrom = 0;     // 时间轴起点（暂停后继续用）
let playStartAbs = 0; // ctx.currentTime 快照
let rafId = 0;
let playSources = [];

const trimLen = (c) => Math.max(0, c.trimEnd - c.trimStart);
const totalDuration = () => clips.reduce((a, c) => a + trimLen(c), 0);

/* ---------- 导入 ---------- */
async function importFiles(files) {
  const list = [...files].filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i.test(f.name));
  if (!list.length) { toast('未找到支持的音频文件', true); return; }
  ctx.resume().catch(() => {});
  let added = 0;
  for (const file of list) {
    try {
      const buf = await file.arrayBuffer();
      const audio = await ctx.decodeAudioData(buf);
      clips.push({
        id: ++uid, name: file.name, buffer: audio,
        trimStart: 0, trimEnd: audio.duration,
        volume: 1, fadeIn: 0, fadeOut: 0, reverse: false, reversed: null,
      });
      added++;
    } catch (e) { console.warn('decode failed:', file.name, e); }
  }
  if (added) { render(); toast(`已导入 ${added} 个音频`); updateStatus(); }
  else toast('音频解码失败（可能是不支持的编码）', true);
}

/* ---------- 渲染 ---------- */
function render() {
  R.empty.classList.toggle('hidden', clips.length > 0);
  R.clipList.classList.toggle('hidden', clips.length === 0);
  R.transport.classList.toggle('hidden', clips.length === 0);
  R.assetBadge.classList.toggle('hidden', clips.length === 0);
  R.assetBadge.textContent = clips.length ? `${clips.length} 片段 · ${fmtTime(totalDuration())}` : '';
  R.clipList.innerHTML = '';
  clips.forEach((c, i) => R.clipList.appendChild(buildClipCard(c, i)));
  requestAnimationFrame(() => clips.forEach(drawWave));
}

function buildClipCard(c, i) {
  const dur = c.buffer.duration;
  const card = document.createElement('div');
  card.className = 'clip';
  card.innerHTML = `
    <div class="clip-head">
      <span class="clip-idx">${i + 1}</span>
      <span class="clip-name" title="${esc(c.name)}">${esc(c.name)}</span>
      <span class="clip-dur mono">${fmtTime(dur)}</span>
      <button class="btn tiny ghost" data-ctrl="remove" title="移除">✕</button>
    </div>
    <canvas class="clip-wave"></canvas>
    <div class="clip-rows">
      <label class="field"><span>起点 <b class="val mono" data-val="trimStart">${fmtTime(c.trimStart)}</b></span>
        <input type="range" min="0" max="${dur}" step="0.01" value="${c.trimStart}" data-ctrl="trimStart"></label>
      <label class="field"><span>终点 <b class="val mono" data-val="trimEnd">${fmtTime(c.trimEnd)}</b></span>
        <input type="range" min="0" max="${dur}" step="0.01" value="${c.trimEnd}" data-ctrl="trimEnd"></label>
      <label class="field"><span>音量 <b class="val mono" data-val="volume">${Math.round(c.volume * 100)}%</b></span>
        <input type="range" min="0" max="2" step="0.05" value="${c.volume}" data-ctrl="volume"></label>
      <label class="field"><span>淡入 <b class="val mono" data-val="fadeIn">${c.fadeIn.toFixed(1)}s</b></span>
        <input type="range" min="0" max="${Math.min(10, dur).toFixed(1)}" step="0.1" value="${c.fadeIn}" data-ctrl="fadeIn"></label>
      <label class="field"><span>淡出 <b class="val mono" data-val="fadeOut">${c.fadeOut.toFixed(1)}s</b></span>
        <input type="range" min="0" max="${Math.min(10, dur).toFixed(1)}" step="0.1" value="${c.fadeOut}" data-ctrl="fadeOut"></label>
      <label class="check-field"><input type="checkbox" ${c.reverse ? 'checked' : ''} data-ctrl="reverse"> 反向播放</label>
    </div>`;
  c._card = card;
  c._canvas = card.querySelector('.clip-wave');
  return card;
}

function drawWave(c) {
  const canvas = c._canvas;
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  const ch = c.buffer.getChannelData(0);
  const sr = c.buffer.sampleRate;
  const s0 = Math.floor(c.trimStart * sr), s1 = Math.ceil(c.trimEnd * sr);
  const len = Math.max(1, s1 - s0);
  const H = canvas.height;
  g.fillStyle = 'rgba(139,123,255,.85)';
  for (let x = 0; x < canvas.width; x++) {
    const a = s0 + Math.floor((len * x) / canvas.width);
    const b = s0 + Math.floor((len * (x + 1)) / canvas.width);
    let mn = 1, mx = -1;
    for (let i = a; i < b; i++) { const v = ch[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const y0 = ((mn + 1) / 2) * H, y1 = ((mx + 1) / 2) * H;
    g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
  const dur = c.buffer.duration;
  const x0 = (c.trimStart / dur) * canvas.width, x1 = (c.trimEnd / dur) * canvas.width;
  g.fillStyle = 'rgba(5,5,10,.62)';
  g.fillRect(0, 0, x0, canvas.height);
  g.fillRect(x1, 0, canvas.width - x1, canvas.height);
}

/* ---------- 播放 ---------- */
function getPlayBuffer(c) {
  if (!c.reverse) return c.buffer;
  if (!c.reversed) {
    const src = c.buffer;
    const rev = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      const a = src.getChannelData(ch), b = rev.getChannelData(ch);
      for (let i = 0; i < a.length; i++) b[i] = a[a.length - 1 - i];
    }
    c.reversed = rev;
  }
  return c.reversed;
}

function applyEnvelope(g, c, localStart, dur) {
  const vol = c.volume;
  const t = ctx.currentTime;
  const fadeIn = Math.min(c.fadeIn, dur);
  const fadeOut = Math.min(c.fadeOut, dur - fadeIn);
  g.gain.setValueAtTime(0, t);
  if (fadeIn > 0) g.gain.linearRampToValueAtTime(vol, t + fadeIn);
  else g.gain.setValueAtTime(vol, t);
  if (fadeOut > 0) g.gain.setValueAtTime(vol, t + dur - fadeOut);
  g.gain.linearRampToValueAtTime(0, t + dur);
}

function buildSources(fromTime) {
  const sources = [];
  let offset = 0;
  for (const c of clips) {
    const dur = trimLen(c);
    const t0 = offset; offset += dur;
    if (dur <= 0 || offset <= fromTime) continue;
    const src = ctx.createBufferSource();
    src.buffer = getPlayBuffer(c);
    const localStart = Math.max(0, fromTime - t0);
    const remain = dur - localStart;
    src.start(ctx.currentTime + Math.max(0, t0 - fromTime), c.trimStart + localStart, remain);
    const g = ctx.createGain();
    applyEnvelope(g, c, localStart, remain);
    src.connect(g).connect(masterGain);
    sources.push({ src });
  }
  return sources;
}

function stopSources() {
  cancelAnimationFrame(rafId);
  playSources.forEach(s => { try { s.src.stop(); } catch (e) {} });
  playSources = [];
}

function togglePlay() {
  if (!clips.length) return;
  ctx.resume().catch(() => {});
  if (playing) {
    playFrom += ctx.currentTime - playStartAbs; // 记录暂停位置，恢复时接着播
    playing = false;
    R.playBtn.textContent = '▶ 播放';
    stopSources();
    return;
  }
  stopSources();
  playSources = buildSources(playFrom);
  playStartAbs = ctx.currentTime;
  playing = true;
  R.playBtn.textContent = '❚❚ 暂停';
  tick();
}

function tick() {
  const total = totalDuration();
  if (!total) { stopSources(); return; }
  const pos = playFrom + (ctx.currentTime - playStartAbs);
  if (pos >= total) { playing = false; playFrom = 0; R.playBtn.textContent = '▶ 播放'; stopSources(); updateTimeUI(0); return; }
  updateTimeUI(pos);
  rafId = requestAnimationFrame(tick);
}

function updateTimeUI(pos) {
  const total = totalDuration();
  R.progressFill.style.width = (total ? (pos / total) * 100 : 0) + '%';
  R.timeLabel.textContent = `${fmtTime(Math.min(pos, total))} / ${fmtTime(total)}`;
}

/* ---------- 导出 ---------- */
const eqVal = (k) => parseFloat($(`#effectPanel [data-eq="${k}"]`).value) || 0;

function getOfflineBuffer(c, off) {
  if (!c.reverse) return c.buffer;
  if (!c.reversed) {
    const src = c.buffer;
    const rev = off.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      const a = src.getChannelData(ch), b = rev.getChannelData(ch);
      for (let i = 0; i < a.length; i++) b[i] = a[a.length - 1 - i];
    }
    c.reversed = rev;
  }
  return c.reversed;
}

async function doExport() {
  const total = totalDuration();
  if (!clips.length || total <= 0) { toast('没有可导出的内容', true); return; }
  const fmt = R.exportFormat.value;
  const len = Math.ceil(total * 44100);
  const off = new OfflineAudioContext(2, len, 44100);
  const master = off.createGain(); master.gain.value = 0.9;
  const l = off.createBiquadFilter(); l.type = 'lowshelf'; l.frequency.value = 200; l.gain.value = eqVal('low');
  const m = off.createBiquadFilter(); m.type = 'peaking'; m.frequency.value = 1000; m.Q.value = 1; m.gain.value = eqVal('mid');
  const h = off.createBiquadFilter(); h.type = 'highshelf'; h.frequency.value = 4000; h.gain.value = eqVal('high');
  const comp = off.createDynamicsCompressor();
  master.connect(l); l.connect(m); m.connect(h);
  if (R.compOn.checked) { h.connect(comp); comp.connect(off.destination); } else h.connect(off.destination);

  let offset = 0;
  for (const c of clips) {
    const dur = trimLen(c);
    if (dur <= 0) continue;
    const src = off.createBufferSource();
    src.buffer = getOfflineBuffer(c, off);
    const g = off.createGain();
    const vol = c.volume;
    const fadeIn = Math.min(c.fadeIn, dur);
    const fadeOut = Math.min(c.fadeOut, dur - fadeIn);
    g.gain.setValueAtTime(0, offset);
    if (fadeIn > 0) g.gain.linearRampToValueAtTime(vol, offset + fadeIn); else g.gain.setValueAtTime(vol, offset);
    if (fadeOut > 0) g.gain.setValueAtTime(vol, offset + dur - fadeOut);
    g.gain.linearRampToValueAtTime(0, offset + dur);
    src.start(offset, c.trimStart, dur);
    src.connect(g).connect(master);
    offset += dur;
  }

  R.exportProgress.classList.add('active');
  R.exportBtn.disabled = true;
  setStatus('导出中：离线合成音频…');
  try {
    const rendered = await off.startRendering();
    await new Promise(r => setTimeout(r, 30));
    let blob;
    if (fmt === 'mp3') { setStatus('导出中：MP3 编码…'); blob = await encodeMp3(rendered); }
    else blob = new Blob([audioBufferToWav(rendered)], { type: 'audio/wav' });
    downloadBlob(blob, `音频工坊_${Date.now()}.${fmt}`);
    setStatus('导出完成');
    toast('导出完成');
  } catch (e) {
    console.error(e);
    toast('导出失败：' + e.message, true);
    setStatus('就绪');
  } finally {
    R.exportProgress.classList.remove('active');
    R.exportBtn.disabled = false;
  }
}

function audioBufferToWav(buf) {
  const n = buf.length, ch = Math.min(2, buf.numberOfChannels), sr = buf.sampleRate;
  const bytes = 44 + n * ch * 2;
  const ab = new ArrayBuffer(bytes);
  const dv = new DataView(ab);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); ws(8, 'WAVE');
  ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, ch, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true);
  dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
  ws(36, 'data'); dv.setUint32(40, n * ch * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, buf.getChannelData(c)[i]));
      dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return ab;
}

const MP3_CDN = 'https://cdn.jsdelivr.net/npm/@breezystack/lamejs@1.2.7/+esm';
let mp3Lib = null;
async function loadMp3Lib() {
  if (!mp3Lib) {
    const mod = await import(MP3_CDN);
    const cls = mod.Mp3Encoder || (mod.default && mod.default.Mp3Encoder) || mod.default;
    if (typeof cls !== 'function') throw new Error('MP3 编码器加载失败');
    mp3Lib = { Mp3Encoder: cls };
  }
  return mp3Lib;
}

async function encodeMp3(buf) {
  const { Mp3Encoder } = await loadMp3Lib();
  const L = buf.getChannelData(0);
  const Rch = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const enc = new Mp3Encoder(2, buf.sampleRate, 192);
  const out = [];
  const block = 1152;
  for (let i = 0; i < buf.length; i += block) {
    const k = Math.min(block, buf.length - i);
    const l = new Int16Array(k), r = new Int16Array(k);
    for (let j = 0; j < k; j++) {
      const a = L[i + j], b = Rch[i + j];
      l[j] = a < 0 ? a * 0x8000 : a * 0x7FFF;
      r[j] = b < 0 ? b * 0x8000 : b * 0x7FFF;
    }
    const part = enc.encodeBuffer(l, r);
    if (part.length) out.push(new Uint8Array(part));
    if (i % (block * 40) === 0) await new Promise(rs => setTimeout(rs, 0));
  }
  const end = enc.flush();
  if (end.length) out.push(new Uint8Array(end));
  return new Blob(out, { type: 'audio/mpeg' });
}

/* ---------- 事件 ---------- */
function updateStatus() {
  setStatus(clips.length ? `就绪 · ${clips.length} 个片段，总时长 ${fmtTime(totalDuration())}` : '就绪 · 导入音频开始');
}

R.importBtn.addEventListener('click', () => { ctx.resume().catch(() => {}); R.fileInput.click(); });
R.fileInput.addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
R.playBtn.addEventListener('click', togglePlay);
R.exportBtn.addEventListener('click', doExport);

R.progressBar.addEventListener('click', (e) => {
  if (!clips.length) return;
  const rect = R.progressBar.getBoundingClientRect();
  const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const total = totalDuration();
  playFrom = pct * total;
  if (playing) { stopSources(); playSources = buildSources(playFrom); playStartAbs = ctx.currentTime; tick(); }
  else updateTimeUI(playFrom);
});

R.clipList.addEventListener('input', (e) => {
  const ctrl = e.target.dataset && e.target.dataset.ctrl;
  if (!ctrl) return;
  const card = e.target.closest('.clip');
  const c = clips.find(x => x._card === card);
  if (!c) return;
  if (ctrl === 'trimStart') c.trimStart = Math.min(parseFloat(e.target.value), c.trimEnd - 0.01);
  else if (ctrl === 'trimEnd') c.trimEnd = Math.max(parseFloat(e.target.value), c.trimStart + 0.01);
  else if (ctrl === 'volume') c.volume = parseFloat(e.target.value);
  else if (ctrl === 'fadeIn') c.fadeIn = Math.min(parseFloat(e.target.value), trimLen(c));
  else if (ctrl === 'fadeOut') c.fadeOut = Math.min(parseFloat(e.target.value), trimLen(c));
  else if (ctrl === 'reverse') { c.reverse = e.target.checked; c.reversed = null; }
  const sStart = card.querySelector('[data-ctrl="trimStart"]');
  const sEnd = card.querySelector('[data-ctrl="trimEnd"]');
  sStart.max = c.trimEnd; sStart.value = c.trimStart;
  sEnd.min = c.trimStart; sEnd.value = c.trimEnd;
  const labels = {
    trimStart: fmtTime(c.trimStart), trimEnd: fmtTime(c.trimEnd),
    volume: Math.round(c.volume * 100) + '%',
    fadeIn: c.fadeIn.toFixed(1) + 's', fadeOut: c.fadeOut.toFixed(1) + 's',
  };
  const val = card.querySelector(`[data-val="${ctrl}"]`);
  if (val && labels[ctrl]) val.textContent = labels[ctrl];
  drawWave(c);
  if (playing) { stopSources(); playSources = buildSources(playFrom); playStartAbs = ctx.currentTime; tick(); }
  updateStatus();
});

R.clipList.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-ctrl="remove"]');
  if (!btn) return;
  const card = btn.closest('.clip');
  const idx = clips.findIndex(x => x._card === card);
  if (idx >= 0) {
    playing = false; playFrom = 0; R.playBtn.textContent = '▶ 播放'; stopSources();
    clips.splice(idx, 1);
    render(); updateStatus();
  }
});

$$('#effectPanel [data-eq]').forEach(sl => {
  sl.addEventListener('input', () => {
    const v = parseFloat(sl.value);
    if (sl.dataset.eq === 'low') eqLow.gain.value = v;
    else if (sl.dataset.eq === 'mid') eqMid.gain.value = v;
    else eqHigh.gain.value = v;
    const b = sl.closest('.field').querySelector('.val');
    if (b) b.textContent = (v > 0 ? '+' : '') + v + ' dB';
  });
});
R.compOn.addEventListener('change', applyCompBypass);

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
});

let rsz;
window.addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(() => clips.forEach(drawWave), 150); });

/* ---------- 初始化 ---------- */
[['low', eqLow], ['mid', eqMid], ['high', eqHigh]].forEach(([k, node]) => {
  const sl = $(`#effectPanel [data-eq="${k}"]`);
  if (sl) node.gain.value = parseFloat(sl.value);
});
updateStatus();
