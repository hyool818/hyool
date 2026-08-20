// app.js — 无限世界 · FastEdit 图片工作台主入口
import { $, $$, toast, fmtBytes, fmtTime, downloadBlob, copyBlob, setStatus, debounce, el, baseName, escapeHtml } from './ui.js';
import { loadAsset, sourceFrame, processImageData, videoOutputDims, drawVideoFrameToCanvas, makeCanvas } from './engine.js';
import { encodeImage, FORMATS, warmUp } from './codecs.js';
import { encodeGif, encodeApng, frameToBlobUrl } from './anim.js';
import { sampleVideoFrames, grabVideoFrame, exportVideoLive } from './video.js';
import { PRESETS, presetGeometry } from './presets.js';
import { removeBackgroundFromImageData } from './ai.js';
import { runBatch } from './batch.js';

const PREVIEW_MAX = 1920; // 预览画布最大边（导出仍为全分辨率）

const R = {
  fileInput: $('#fileInput'), importBtn: $('#importBtn'),
  empty: $('#empty'), compareWrap: $('#compareWrap'),
  canvasOrig: $('#canvasOrig'), canvasOut: $('#canvasOut'), mosaicLayer: $('#mosaicLayer'),
  compareSlider: $('#compareSlider'), stageHint: $('#stageHint'),
  videoBar: $('#videoBar'), frameStrip: $('#frameStrip'),
  assetBadge: $('#assetBadge'),
  tabs: $('#tabs'), tabBody: $('#tabBody'),
  resizeEnabled: $('#resizeEnabled'), resizeW: $('#resizeW'), resizeH: $('#resizeH'),
  keepRatio: $('#keepRatio'), resetSizeBtn: $('#resetSizeBtn'),
  rotLeft: $('#rotLeft'), rotRight: $('#rotRight'), flipH: $('#flipH'), flipV: $('#flipV'),
  cropModeBtn: $('#cropModeBtn'), cropClearBtn: $('#cropClearBtn'),
  formatSelect: $('#formatSelect'), qualityRange: $('#qualityRange'), qualityVal: $('#qualityVal'),
  effortRange: $('#effortRange'), effortVal: $('#effortVal'), losslessToggle: $('#losslessToggle'),
  pngOptimise: $('#pngOptimise'), pngOptField: $('#pngOptField'),
  origSize: $('#origSize'), outSize: $('#outSize'), savedPct: $('#savedPct'),
  exportBtn: $('#exportBtn'), copyBtn: $('#copyBtn'), compareToggle: $('#compareToggle'),
  regionTypeSeg: $('#regionTypeSeg'), regionStrength: $('#regionStrength'), regionStrengthVal: $('#regionStrengthVal'),
  addRegionBtn: $('#addRegionBtn'), regionList: $('#regionList'),
  aiRemoveBtn: $('#aiRemoveBtn'), aiUndoBtn: $('#aiUndoBtn'), aiProgress: $('#aiProgress'),
  aiProgressBar: $('#aiProgressBar'), aiProgressText: $('#aiProgressText'),
  applyToAll: $('#applyToAll'), animLoop: $('#animLoop'), delayRange: $('#delayRange'), delayVal: $('#delayVal'),
  animExportFormat: $('#animExportFormat'), exportAnimBtn: $('#exportAnimBtn'),
  dupFrameBtn: $('#dupFrameBtn'), delFrameBtn: $('#delFrameBtn'),
  playBtn: $('#playBtn'), videoSeek: $('#videoSeek'), videoTime: $('#videoTime'),
  trimStart: $('#trimStart'), trimEnd: $('#trimEnd'), trimLabel: $('#trimLabel'),
  videoExportFormat: $('#videoExportFormat'), videoFps: $('#videoFps'), videoFpsVal: $('#videoFpsVal'),
  exportVideoBtn: $('#exportVideoBtn'),
  presetGrid: $('#presetGrid'),
  batchAddBtn: $('#batchAddBtn'), batchInput: $('#batchInput'), batchList: $('#batchList'),
  batchRunBtn: $('#batchRunBtn'), batchClearBtn: $('#batchClearBtn'), batchDownloadAllBtn: $('#batchDownloadAllBtn'),
};

const state = {
  asset: null,
  edits: {
    crop: null,
    rotate: 0, flipH: false, flipV: false,
    resize: { enabled: true, width: 0, height: 0, method: 'lanczos3' },
    regions: [],
    pad: null,
  },
  format: 'webp',
  options: { quality: 75, effort: 4, lossless: false, pngOptimise: true, pngLevel: 2 },
  anim: { applyToAll: true, loop: true, delay: 100, selectedFrame: 0 },
  video: { start: 0, end: 0, fps: 12, format: 'webm' },
  regionType: 'mosaic',
  regionStrength: 16,
  dragMode: null,       // null | 'region' | 'crop'
  drag: null,           // {x0,y0,x1,y1} 归一化
  compareOn: false,
  aiBackup: null,       // AI 抠图前的原帧备份
  batch: [],
  busy: false,
  videoTimer: 0,
  lastEstimate: null,
  appliedPreset: null,
};

/* ================= 初始化 ================= */

function init() {
  buildPresetGrid();
  bindEvents();
  bindMosaicVideoEvents();
  bindAnimVideoBatchEvents();
  warmUp().then(() => setStatus('就绪 · 编解码器预热完成')).catch(() => setStatus('就绪'));
  setStatus('就绪');
}

function bindEvents() {
  R.importBtn.addEventListener('click', () => R.fileInput.click());
  R.fileInput.addEventListener('change', (e) => { handleFiles([...e.target.files]); e.target.value = ''; });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) handleFiles(files);
  });

  // tabs
  R.tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) switchTab(btn.dataset.tab);
  });

  // 压缩控制
  R.formatSelect.addEventListener('change', () => { state.format = R.formatSelect.value; updateCompressFields(); scheduleEstimate(); });
  R.qualityRange.addEventListener('input', () => { R.qualityVal.textContent = R.qualityRange.value; state.options.quality = +R.qualityRange.value; scheduleEstimate(); });
  R.effortRange.addEventListener('input', () => { R.effortVal.textContent = R.effortRange.value; state.options.effort = +R.effortRange.value; scheduleEstimate(); });
  R.losslessToggle.addEventListener('change', () => { state.options.lossless = R.losslessToggle.checked; scheduleEstimate(); });
  R.pngOptimise.addEventListener('change', () => { state.options.pngOptimise = R.pngOptimise.checked; scheduleEstimate(); });

  // 处理控制
  R.resizeEnabled.addEventListener('change', () => { state.edits.resize.enabled = R.resizeEnabled.checked; rerender(); scheduleEstimate(); });
  R.resizeW.addEventListener('input', () => onResizeInput());
  R.resizeH.addEventListener('input', () => onResizeInput());
  R.keepRatio.addEventListener('change', () => onResizeInput());
  R.resetSizeBtn.addEventListener('click', () => {
    state.edits.resize = { enabled: true, width: 0, height: 0, method: 'lanczos3' };
    R.resizeW.value = ''; R.resizeH.value = '';
    rerender(); scheduleEstimate();
  });
  R.rotLeft.addEventListener('click', () => { state.edits.rotate = (state.edits.rotate - 90 + 360) % 360; rerender(); scheduleEstimate(); });
  R.rotRight.addEventListener('click', () => { state.edits.rotate = (state.edits.rotate + 90) % 360; rerender(); scheduleEstimate(); });
  R.flipH.addEventListener('click', () => { state.edits.flipH = !state.edits.flipH; rerender(); scheduleEstimate(); });
  R.flipV.addEventListener('click', () => { state.edits.flipV = !state.edits.flipV; rerender(); scheduleEstimate(); });
  R.cropModeBtn.addEventListener('click', () => {
    state.dragMode = 'crop';
    toast('在预览区按住拖拽，选择要保留的裁剪区域', false, 3000);
    drawOverlay();
  });
  R.cropClearBtn.addEventListener('click', () => {
    state.edits.crop = null;
    R.cropClearBtn.classList.add('hidden');
    rerender(); scheduleEstimate();
  });
}

function bindMosaicVideoEvents() {
  // 打码
  R.regionTypeSeg.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    state.regionType = b.dataset.type;
    $$('.seg-btn', R.regionTypeSeg).forEach(x => x.classList.toggle('active', x === b));
  });
  R.regionStrength.addEventListener('input', () => {
    state.regionStrength = +R.regionStrength.value;
    R.regionStrengthVal.textContent = state.regionStrength;
    state.edits.regions.forEach(r => { r.strength = state.regionStrength; });
    rerender();
  });
  R.addRegionBtn.addEventListener('click', () => {
    state.dragMode = 'region';
    toast('在预览区按住拖拽，框住要打码的区域', false, 3000);
    drawOverlay();
  });
  R.regionList.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      state.edits.regions = state.edits.regions.filter(r => r.id !== del.dataset.del);
      renderRegionList();
      rerender();
    }
  });

  // 对比
  R.compareToggle.addEventListener('click', toggleCompare);
  R.compareSlider.addEventListener('input', () => applyCompareClip());

  // 导出
  R.exportBtn.addEventListener('click', exportStatic);
  R.copyBtn.addEventListener('click', copyStatic);
}

function bindAnimVideoBatchEvents() {
  // 动画
  R.applyToAll.addEventListener('change', () => { state.anim.applyToAll = R.applyToAll.checked; rerender(); });
  R.animLoop.addEventListener('change', () => { state.anim.loop = R.animLoop.checked; });
  R.delayRange.addEventListener('input', () => {
    state.anim.delay = +R.delayRange.value;
    R.delayVal.textContent = state.anim.delay;
  });
  R.exportAnimBtn.addEventListener('click', exportAnim);
  R.dupFrameBtn.addEventListener('click', dupFrame);
  R.delFrameBtn.addEventListener('click', delFrame);

  // 视频
  R.playBtn.addEventListener('click', toggleVideoPlay);
  R.videoSeek.addEventListener('input', () => {
    if (!state.asset) return;
    state.asset.videoEl.currentTime = (+R.videoSeek.value / 1000) * state.asset.duration;
  });
  R.trimStart.addEventListener('input', updateTrim);
  R.trimEnd.addEventListener('input', updateTrim);
  R.videoFps.addEventListener('input', () => {
    state.video.fps = +R.videoFps.value;
    R.videoFpsVal.textContent = state.video.fps;
  });
  R.exportVideoBtn.addEventListener('click', exportVideo);

  // 批量
  R.batchAddBtn.addEventListener('click', () => R.batchInput.click());
  R.batchInput.addEventListener('change', (e) => { addBatchFiles([...e.target.files]); e.target.value = ''; });
  R.batchRunBtn.addEventListener('click', runBatchUI);
  R.batchClearBtn.addEventListener('click', () => { state.batch = []; renderBatchList(); });
  R.batchDownloadAllBtn.addEventListener('click', downloadAllBatch);
  R.batchList.addEventListener('click', (e) => {
    const d = e.target.closest('[data-del]');
    if (d) { state.batch = state.batch.filter((_, i) => i !== +d.dataset.del); renderBatchList(); }
    const dl = e.target.closest('[data-download]');
    if (dl) { const r = state.batch[+dl.dataset.download]?.result; if (r?.ok) downloadBlob(r.blob, r.name); }
  });

  // AI
  R.aiRemoveBtn.addEventListener('click', aiRemove);
  R.aiUndoBtn.addEventListener('click', aiUndo);

  // 舞台指针（打码/裁剪交互）
  R.mosaicLayer.addEventListener('pointerdown', onStagePointerDown);
  window.addEventListener('pointermove', onStagePointerMove);
  window.addEventListener('pointerup', onStagePointerUp);
}

function switchTab(name) {
  $$('.tab', R.tabs).forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel', R.tabBody).forEach(p => p.classList.toggle('active', p.dataset.panel === name));
}

/* ================= 素材导入 ================= */

async function handleFiles(files) {
  if (!files.length) return;
  if (state.busy) { toast('正在处理中，请稍候', true); return; }
  // 多文件：第一个进舞台，其余进批量列表
  if (files.length > 1) {
    addBatchFiles(files.slice(1));
    toast(`其余 ${files.length - 1} 个文件已加入批量列表`);
  }
  const f = files[0];
  try {
    setStatus('正在解析 ' + baseName(f.name) + ' …');
    stopVideoPreview();
    state.asset = null;
    state.aiBackup = null;
    state.edits = { crop: null, rotate: 0, flipH: false, flipV: false, resize: { enabled: true, width: 0, height: 0, method: 'lanczos3' }, regions: [], pad: null };
    state.anim.selectedFrame = 0;
    state.appliedPreset = null;
    R.resizeW.value = ''; R.resizeH.value = '';

    const asset = await loadAsset(f);
    state.asset = asset;
    R.assetBadge.textContent = `${asset.kind === 'video' ? 'VIDEO' : asset.kind === 'animated' ? 'GIF/动图' : 'IMAGE'} · ${asset.name} · ${asset.width}×${asset.height}`;
    R.empty.classList.add('hidden');
    R.compareWrap.classList.remove('hidden');
    R.stageHint.classList.add('hidden');
    R.frameStrip.classList.toggle('hidden', asset.kind !== 'animated');
    R.videoBar.classList.toggle('hidden', asset.kind !== 'video');
    R.cropClearBtn.classList.toggle('hidden', !state.edits.crop);
    R.origSize.textContent = fmtBytes(f.size);
    R.outSize.textContent = '—';
    R.savedPct.textContent = '';
    state.compareOn = false;
    R.compareSlider.value = 50;
    R.compareToggle.classList.remove('active');
    R.aiUndoBtn.classList.add('hidden');

    if (asset.kind === 'video') {
      setupVideo(asset);
    } else if (asset.kind === 'animated') {
      renderFrameStrip();
      rerender();
    } else {
      renderImage();
    }
    switchTab('transform');
    setStatus(`已载入 ${asset.name}（${asset.kind}）`);
  } catch (e) {
    console.error(e);
    toast('无法读取该文件：' + e.message, true);
    setStatus('载入失败');
  }
}

/* ================= 舞台渲染 ================= */

/** 计算「几何编辑后」的输出尺寸（供预览画布与导出用） */
function outputDims() {
  const a = state.asset;
  if (!a) return { w: 0, h: 0 };
  if (a.kind === 'video') return videoOutputDims(a, state.edits);
  let w = a.width, h = a.height;
  if (state.edits.crop) { w = state.edits.crop.w * w; h = state.edits.crop.h * h; }
  if (state.edits.rotate % 180 !== 0) { const t = w; w = h; h = t; }
  if (state.edits.resize.enabled && state.edits.resize.width > 0 && state.edits.resize.height > 0) {
    w = state.edits.resize.width; h = state.edits.resize.height;
  }
  if (state.edits.pad) { w = state.edits.pad.w; h = state.edits.pad.h; }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

/** 设置三张画布（原图/输出/打码层）为同一尺寸（预览按比例缩到 PREVIEW_MAX 内） */
function layoutStage(outW, outH) {
  const scale = Math.min(1, PREVIEW_MAX / Math.max(outW, outH));
  const w = Math.max(1, Math.round(outW * scale));
  const h = Math.max(1, Math.round(outH * scale));
  for (const c of [R.canvasOrig, R.canvasOut, R.mosaicLayer]) {
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }
  applyCompareClip();
}

/** 预览画布用的 canvas 工具 */
function assetToCanvas(a) { return imgToCanvas(a.imageData); }
function imgToCanvas(img) {
  const c = makeCanvas(img.width, img.height);
  c.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0);
  return c;
}

function renderImage() {
  const a = state.asset;
  layoutStage(a.width, a.height);
  const octx = R.canvasOrig.getContext('2d');
  const octx2 = R.canvasOut.getContext('2d');
  const outW = R.canvasOut.width, outH = R.canvasOut.height;
  octx.clearRect(0, 0, outW, outH);
  octx2.clearRect(0, 0, outW, outH);
  octx.drawImage(assetToCanvas(a), 0, 0, outW, outH);
  processImageData(sourceFrame(a), state.edits).then((img) => {
    octx2.drawImage(imgToCanvas(img), 0, 0, outW, outH);
    drawOverlay();
  }).catch((e) => toast('处理失败：' + e.message, true));
  scheduleEstimate();
}

function renderAnim() {
  const a = state.asset;
  const idx = Math.min(state.anim.selectedFrame, a.frames.length - 1);
  layoutStage(a.width, a.height);
  const octx = R.canvasOrig.getContext('2d');
  const octx2 = R.canvasOut.getContext('2d');
  const outW = R.canvasOut.width, outH = R.canvasOut.height;
  octx.clearRect(0, 0, outW, outH);
  octx2.clearRect(0, 0, outW, outH);
  octx.drawImage(imgToCanvas(a.frames[idx].data), 0, 0, outW, outH);
  processImageData(a.frames[idx].data, frameEditsFor(idx)).then((img) => {
    octx2.drawImage(imgToCanvas(img), 0, 0, outW, outH);
    drawOverlay();
  }).catch((e) => toast('处理失败：' + e.message, true));
  renderFrameStrip();
}

/** 动画帧编辑参数：几何(裁剪/旋转/缩放/pad)对所有帧生效；打码仅对选中帧(或 applyToAll 时全部)生效 */
function frameEditsFor(idx) {
  const useRegions = state.anim.applyToAll || idx === state.anim.selectedFrame;
  return {
    crop: state.edits.crop,
    rotate: state.edits.rotate,
    flipH: state.edits.flipH,
    flipV: state.edits.flipV,
    resize: state.edits.resize,
    pad: state.edits.pad,
    regions: useRegions ? state.edits.regions : [],
  };
}

function drawOverlay() {
  const c = R.mosaicLayer;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);

  // 打码区域
  for (const r of state.edits.regions) {
    const x = r.x * W, y = r.y * H, rw = r.w * W, rh = r.h * H;
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 1, y + 1, rw - 2, rh - 2);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(x, y, rw, rh);
  }

  // 拖拽中的选区
  if (state.drag) {
    const n = normRect(state.drag);
    const x = n.x * W, y = n.y * H, rw = n.w * W, rh = n.h * H;
    if (rw > 3 && rh > 3) {
      ctx.strokeStyle = state.dragMode === 'crop' ? 'rgba(80,220,160,.95)' : 'rgba(255,160,60,.95)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x + 1, y + 1, rw - 2, rh - 2);
      ctx.setLineDash([]);
      ctx.fillStyle = state.dragMode === 'crop' ? 'rgba(80,220,160,.1)' : 'rgba(255,160,60,.1)';
      ctx.fillRect(x, y, rw, rh);
    }
  }

  // 裁剪范围（已确定）
  if (state.edits.crop) {
    const x = state.edits.crop.x * W, y = state.edits.crop.y * H;
    const rw = state.edits.crop.w * W, rh = state.edits.crop.h * H;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0, 0, W, y); ctx.fillRect(0, y + rh, W, H - y - rh);
    ctx.fillRect(0, y, x, rh); ctx.fillRect(x + rw, y, W - x - rw, rh);
    ctx.strokeStyle = 'rgba(80,220,160,.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, rw, rh);
    ctx.restore();
  }
}

function applyCompareClip() {
  const pct = +R.compareSlider.value;
  R.canvasOut.style.clipPath = `inset(0 0 0 ${pct}%)`;
  R.canvasOut.style.WebkitClipPath = `inset(0 0 0 ${pct}%)`;
}

function toggleCompare() {
  state.compareOn = !state.compareOn;
  R.compareToggle.classList.toggle('active', state.compareOn);
  R.compareWrap.classList.toggle('compare-on', state.compareOn);
  if (!state.compareOn) { R.canvasOut.style.clipPath = ''; R.canvasOut.style.WebkitClipPath = ''; }
}

/** 全量重渲染（编辑参数变化后） */
function rerender() {
  if (!state.asset) return;
  if (state.asset.kind === 'video') { drawVideoPreview(); return; }
  if (state.asset.kind === 'animated') renderAnim(); else renderImage();
}

/** 重渲染调度（防抖） */
const scheduleRender = debounce(() => rerender(), 120);

/* ================= 打码/裁剪指针交互 ================= */

function stagePoint(e) {
  const rect = R.mosaicLayer.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
  };
}

function normRect(d) {
  return {
    x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1),
    w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0),
  };
}

function onStagePointerDown(e) {
  if (!state.asset || !state.dragMode) return;
  e.preventDefault();
  R.mosaicLayer.setPointerCapture?.(e.pointerId);
  const p = stagePoint(e);
  state.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  drawOverlay();
}

function onStagePointerMove(e) {
  if (!state.drag) return;
  const p = stagePoint(e);
  state.drag.x1 = p.x; state.drag.y1 = p.y;
  drawOverlay();
}

function onStagePointerUp(e) {
  if (!state.drag) return;
  const d = state.drag;
  state.drag = null;
  const n = normRect(d);
  if (n.w < 0.01 || n.h < 0.01) { drawOverlay(); return; }
  if (state.dragMode === 'region') {
    state.edits.regions.push({
      id: 'r' + Date.now() + Math.random().toString(16).slice(2, 6),
      x: n.x, y: n.y, w: n.w, h: n.h,
      type: state.regionType, strength: state.regionStrength,
    });
    renderRegionList();
    rerender();
    drawOverlay();
  } else if (state.dragMode === 'crop') {
    // 加一点归一化守卫：至少保留 5% 面积
    state.edits.crop = { x: n.x, y: n.y, w: n.w, h: n.h };
    R.cropClearBtn.classList.remove('hidden');
    rerender();
    scheduleEstimate();
  }
  state.dragMode = null;
  drawOverlay();
}

function renderRegionList() {
  const list = state.edits.regions;
  R.regionList.innerHTML = '';
  if (!list.length) {
    R.regionList.innerHTML = '<div class="empty-note">还没有打码区域<br>点击「添加区域」后在预览区框选</div>';
    return;
  }
  for (const r of list) {
    const row = el('div', { className: 'region-row' });
    row.innerHTML = `<span class="region-tag ${r.type}">${r.type === 'mosaic' ? '马赛克' : '模糊'}</span>
      <span class="region-pos">${Math.round(r.x * 100)}%,${Math.round(r.y * 100)}%</span>
      <button class="mini-btn danger" data-del="${r.id}" title="删除">×</button>`;
    R.regionList.appendChild(row);
  }
}

/* ================= 动画帧条 ================= */

function renderFrameStrip() {
  const a = state.asset;
  if (!a || a.kind !== 'animated') return;
  R.frameStrip.innerHTML = '';
  a.frames.forEach((f, i) => {
    const cell = el('div', { className: 'frame-item' + (i === state.anim.selectedFrame ? ' active' : '') });
    const img = el('img', { src: frameToBlobUrl(f), alt: 'f' + i });
    cell.appendChild(img);
    cell.appendChild(el('div', { className: 'f-index' }, i + 1));
    const tag = el('div', { className: 'f-delay' }, Math.round(f.delay) + 'ms');
    cell.appendChild(tag);
    cell.addEventListener('click', () => {
      state.anim.selectedFrame = i;
      renderAnim();
    });
    R.frameStrip.appendChild(cell);
  });
}

function dupFrame() {
  const a = state.asset;
  if (!a || a.kind !== 'animated') { toast('仅动图支持帧操作', true); return; }
  const f = a.frames[state.anim.selectedFrame];
  const copy = { data: new ImageData(new Uint8ClampedArray(f.data.data), f.data.width, f.data.height), delay: f.delay };
  a.frames.splice(state.anim.selectedFrame + 1, 0, copy);
  state.anim.selectedFrame += 1;
  renderFrameStrip();
  rerender();
}

function delFrame() {
  const a = state.asset;
  if (!a || a.kind !== 'animated') { toast('仅动图支持帧操作', true); return; }
  if (a.frames.length <= 1) { toast('至少保留一帧', true); return; }
  a.frames.splice(state.anim.selectedFrame, 1);
  state.anim.selectedFrame = Math.min(state.anim.selectedFrame, a.frames.length - 1);
  renderFrameStrip();
  rerender();
}

/* ================= 视频 ================= */

function setupVideo(asset) {
  const dims = outputDims();
  layoutStage(dims.w, dims.h);
  state.video.start = 0;
  state.video.end = asset.duration;
  R.trimStart.value = 0;
  R.trimEnd.value = asset.duration;
  R.trimLabel.textContent = `0.0s ~ ${asset.duration.toFixed(1)}s`;
  R.videoTime.textContent = '0:00 / ' + fmtTime(asset.duration);
  R.playBtn.textContent = '播放';
  drawVideoPreview();
}

function drawVideoPreview() {
  const a = state.asset;
  if (!a || a.kind !== 'video') return;
  const dims = outputDims();
  layoutStage(dims.w, dims.h);
  const c = R.canvasOut;
  try {
    drawVideoFrameToCanvas(c, a.videoEl, a.workW, a.workH, state.edits);
    drawOverlay();
  } catch (e) { /* 首帧未就绪 */ }
}

function startVideoPreview() {
  stopVideoPreview();
  const timer = setInterval(() => {
    const a = state.asset;
    if (!a) return;
    drawVideoPreview();
    const cur = a.videoEl.currentTime || 0;
    R.videoSeek.value = (cur / a.duration) * 1000;
    R.videoTime.textContent = fmtTime(cur) + ' / ' + fmtTime(a.duration);
  }, 66);
  state.videoTimer = timer;
}

function stopVideoPreview() {
  if (state.videoTimer) { clearInterval(state.videoTimer); state.videoTimer = 0; }
}

function toggleVideoPlay() {
  const a = state.asset;
  if (!a || a.kind !== 'video') return;
  const v = a.videoEl;
  if (v.paused) {
    if (v.currentTime >= state.video.end || v.ended) v.currentTime = state.video.start;
    v.play().then(() => {
      R.playBtn.textContent = '暂停';
      startVideoPreview();
    }).catch((e) => toast('播放失败：' + e.message, true));
  } else {
    v.pause();
    R.playBtn.textContent = '播放';
    stopVideoPreview();
    drawVideoPreview();
  }
}

function updateTrim() {
  const a = state.asset;
  if (!a) return;
  const s = Math.min(+R.trimStart.value, +R.trimEnd.value);
  const e = Math.max(+R.trimStart.value, +R.trimEnd.value);
  state.video.start = Math.max(0, s);
  state.video.end = Math.min(a.duration, e);
  R.trimStart.value = state.video.start;
  R.trimEnd.value = state.video.end;
  R.trimLabel.textContent = `${state.video.start.toFixed(1)}s ~ ${state.video.end.toFixed(1)}s`;
}

/* ================= 尺寸估算（压缩预览） ================= */

const estimateTimer = { t: 0 };
function scheduleEstimate() {
  clearTimeout(estimateTimer.t);
  estimateTimer.t = setTimeout(runEstimate, 400);
}

async function runEstimate() {
  const a = state.asset;
  if (!a || a.kind === 'video') return;
  if (a.kind === 'animated') { R.outSize.textContent = '—'; R.savedPct.textContent = ''; return; }
  try {
    const img = await processImageData(sourceFrame(a), state.edits);
    const buf = await encodeImage(img, state.format, state.options);
    const meta = FORMATS[state.format];
    R.outSize.textContent = fmtBytes(buf.byteLength) + (meta?.note ? ' · ' + meta.note : '');
    const orig = parseFloat(R.origSize.textContent) || 0;
    if (orig > 0) {
      const pct = Math.round((1 - buf.byteLength / orig) * 100);
      R.savedPct.textContent = pct > 0 ? `−${pct}%` : `+${Math.abs(pct)}%`;
      R.savedPct.style.color = pct >= 0 ? 'var(--ok)' : 'var(--warn)';
    }
    state.lastEstimate = { bytes: buf.byteLength, blob: new Blob([buf], { type: meta.mime }) };
  } catch (e) {
    R.outSize.textContent = '估算失败';
  }
}

function updateCompressFields() {
  const f = state.format;
  const losslessOk = f === 'webp' || f === 'avif';
  R.losslessToggle.closest('.field').classList.toggle('hidden', !losslessOk);
  const effortOk = f === 'webp' || f === 'avif';
  R.effortRange.closest('.field').classList.toggle('hidden', !effortOk);
  R.pngOptField.classList.toggle('hidden', f !== 'png');
  if (f === 'jpeg') {
    R.qualityRange.value = Math.min(R.qualityRange.value, 90);
  }
  R.qualityVal.textContent = R.qualityRange.value;
}

function onResizeInput() {
  const w = parseInt(R.resizeW.value, 10);
  const h = parseInt(R.resizeH.value, 10);
  if (R.keepRatio.checked && state.asset) {
    const { w: ow, h: oh } = outputDims();
    if (!isNaN(w) && w > 0) { R.resizeH.value = Math.max(1, Math.round(w * (oh / ow))); }
    else if (!isNaN(h) && h > 0) { R.resizeW.value = Math.max(1, Math.round(h * (ow / oh))); }
  }
  const nw = parseInt(R.resizeW.value, 10) || 0;
  const nh = parseInt(R.resizeH.value, 10) || 0;
  state.edits.resize.width = Math.min(nw, 5000);
  state.edits.resize.height = Math.min(nh, 5000);
  scheduleRender();
  scheduleEstimate();
}

/* ================= 导出 ================= */

function assetName() {
  return (state.asset?.name || 'image').replace(/\.[^.]+$/, '');
}

function setBusy(busy, label) {
  state.busy = busy;
  R.exportBtn.disabled = busy;
  R.copyBtn.disabled = busy;
  R.exportAnimBtn.disabled = busy;
  R.exportVideoBtn.disabled = busy;
  setStatus(busy ? label || '处理中…' : '就绪');
}

async function exportStatic() {
  const a = state.asset;
  if (!a || a.kind !== 'image') { toast('仅静态图片支持此导出', true); return; }
  setBusy(true, '正在编码 ' + state.format.toUpperCase() + ' …');
  try {
    const img = await processImageData(sourceFrame(a), state.edits);
    const buf = await encodeImage(img, state.format, state.options);
    const meta = FORMATS[state.format];
    downloadBlob(new Blob([buf], { type: meta.mime }), assetName() + '.' + meta.ext);
    toast('已导出 ' + assetName() + '.' + meta.ext + '（' + fmtBytes(buf.byteLength) + '）');
  } catch (e) {
    toast('导出失败：' + e.message, true);
  } finally {
    setBusy(false);
  }
}

async function copyStatic() {
  const a = state.asset;
  if (!a || a.kind !== 'image') { toast('仅静态图片支持复制', true); return; }
  setBusy(true, '正在编码 …');
  try {
    const img = await processImageData(sourceFrame(a), state.edits);
    const buf = await encodeImage(img, state.format, state.options);
    const meta = FORMATS[state.format];
    await copyBlob(new Blob([buf], { type: meta.mime }));
    toast('已复制到剪贴板');
  } catch (e) {
    toast('复制失败：' + e.message, true);
  } finally {
    setBusy(false);
  }
}

async function exportAnim() {
  const a = state.asset;
  if (!a || a.kind !== 'animated') { toast('仅动图支持此导出', true); return; }
  const fmt = R.animExportFormat.value;
  const delay = state.anim.delay;
  setBusy(true, '正在处理 ' + a.frames.length + ' 帧 …');
  try {
    const frames = [];
    for (let i = 0; i < a.frames.length; i++) {
      frames.push(await processImageData(a.frames[i].data, frameEditsFor(i)));
      if (i % 5 === 0) setStatus(`正在处理第 ${i + 1}/${a.frames.length} 帧…`);
    }
    // anim.js 的 encodeGif/encodeApng 期望传入 { data: ImageData } 包裹对象
    const animFrames = frames.map(d => ({ data: d }));
    const base = assetName();
    if (fmt === 'gif') {
      const buf = encodeGif(animFrames, { delay, loop: state.anim.loop });
      downloadBlob(new Blob([buf], { type: 'image/gif' }), base + '.gif');
      toast('已导出 GIF（' + fmtBytes(buf.byteLength) + '）');
    } else if (fmt === 'apng') {
      const buf = await encodeApng(animFrames, delay);
      downloadBlob(new Blob([buf], { type: 'image/apng' }), base + '.apng');
      toast('已导出 APNG（' + fmtBytes(buf.byteLength) + '）');
    } else {
      // 导出当前帧为静态图
      const idx = Math.min(state.anim.selectedFrame, frames.length - 1);
      const buf = await encodeImage(frames[idx], fmt, state.options);
      const meta = FORMATS[fmt];
      downloadBlob(new Blob([buf], { type: meta.mime }), base + '-f' + (idx + 1) + '.' + meta.ext);
      toast('已导出第 ' + (idx + 1) + ' 帧');
    }
  } catch (e) {
    toast('动图导出失败：' + e.message, true);
  } finally {
    setBusy(false);
  }
}

async function exportVideo() {
  const a = state.asset;
  if (!a || a.kind !== 'video') return;
  const fmt = R.videoExportFormat.value;
  setBusy(true, '正在实时重编码视频…');
  const v = a.videoEl;
  const wasPlaying = !v.paused;
  if (wasPlaying) { v.pause(); stopVideoPreview(); }

  const dims = outputDims();
  const canvas = makeCanvas(dims.w, dims.h);

  // 录制期间逐帧把「视频+编辑」绘制到 canvas
  let raf = 0;
  const drawLoop = () => {
    raf = requestAnimationFrame(drawLoop);
    drawVideoFrameToCanvas(canvas, v, a.workW, a.workH, state.edits);
  };

  try {
    if (fmt === 'gif') {
      const fps = state.video.fps;
      setStatus('正在采样视频帧（' + fps + 'fps）…');
      const frames = await sampleVideoFrames(v, a.workW, a.workH, { start: state.video.start, end: state.video.end, fps });
      setStatus('正在合成 GIF…');
      const processed = [];
      for (const f of frames) {
        processed.push(await processImageData(f.data, state.edits));
      }
      const gifFrames = processed.map(d => ({ data: d }));
      const buf = encodeGif(gifFrames, { delay: 1000 / fps, loop: true });
      downloadBlob(new Blob([buf], { type: 'image/gif' }), assetName() + '.gif');
      toast('已导出视频 GIF（' + fmtBytes(buf.byteLength) + '）');
    } else if (fmt === 'snapshot') {
      const img = await grabVideoFrame(v, a.workW, a.workH);
      const out = await processImageData(img, state.edits);
      const buf = await encodeImage(out, state.format, state.options);
      const meta = FORMATS[state.format];
      downloadBlob(new Blob([buf], { type: meta.mime }), assetName() + '-snap.' + meta.ext);
      toast('已导出当前帧快照');
    } else {
      drawLoop();
      const { blob, mime } = await exportVideoLive(canvas, v, {
        start: state.video.start,
        end: state.video.end,
        fps: Math.min(30, state.video.fps),
        onProgress: (p) => setStatus('正在录制… ' + Math.round(p * 100) + '%'),
      });
      const ext = mime.includes('webm') ? 'webm' : 'mp4';
      downloadBlob(blob, assetName() + '-re.' + ext);
      toast('已导出视频（' + fmtBytes(blob.size) + '）');
    }
  } catch (e) {
    toast('视频导出失败：' + e.message, true);
  } finally {
    cancelAnimationFrame(raf);
    if (wasPlaying) v.play().catch(() => {});
    setBusy(false);
  }
}

/* ================= AI 抠图 ================= */

async function aiRemove() {
  const a = state.asset;
  if (!a || a.kind !== 'image') { toast('AI 抠图仅支持静态图片', true); return; }
  if (state.busy) return;
  R.aiRemoveBtn.disabled = true;
  R.aiProgress.classList.remove('hidden');
  R.aiProgressBar.style.width = '0%';
  R.aiProgressText.textContent = '加载模型…（首次约 40MB，之后走本地缓存）';
  try {
    const result = await removeBackgroundFromImageData(a.imageData, {
      onProgress: (p, stage) => {
        R.aiProgressBar.style.width = Math.round(p * 100) + '%';
        R.aiProgressText.textContent = (stage || '') + ' ' + Math.round(p * 100) + '%';
      },
    });
    if (!state.aiBackup) state.aiBackup = a.imageData;
    a.imageData = result;
    R.aiUndoBtn.classList.remove('hidden');
    renderImage();
    toast('抠图完成，可在「处理」中继续编辑');
  } catch (e) {
    console.error(e);
    toast('AI 抠图失败：' + e.message, true);
  } finally {
    R.aiRemoveBtn.disabled = false;
    R.aiProgress.classList.add('hidden');
    setStatus('就绪');
  }
}

function aiUndo() {
  const a = state.asset;
  if (!a || !state.aiBackup) return;
  a.imageData = state.aiBackup;
  state.aiBackup = null;
  R.aiUndoBtn.classList.add('hidden');
  renderImage();
  toast('已恢复原始图像');
}

/* ================= 平台预设 ================= */

function buildPresetGrid() {
  R.presetGrid.innerHTML = '';
  for (const p of PRESETS) {
    const card = el('button', { className: 'preset-card', dataset: { preset: p.id } });
    card.innerHTML = `<span class="preset-name">${p.name}</span>
      <span class="preset-meta">${p.meta}</span>
      <span class="preset-note">${p.note || ''}</span>`;
    card.addEventListener('click', () => applyPreset(p));
    R.presetGrid.appendChild(card);
  }
}

function applyPreset(p) {
  const a = state.asset;
  if (!a) { toast('请先导入素材', true); return; }
  if (a.kind !== 'image') { toast('预设仅适用于静态图片', true); return; }
  const srcW = a.width, srcH = a.height;
  const g = presetGeometry(srcW, srcH, p);
  state.edits.crop = g.crop;
  state.edits.resize = { enabled: true, width: g.resize.width, height: g.resize.height, method: 'lanczos3' };
  state.edits.pad = g.pad ? { w: g.pad.w, h: g.pad.h, color: p.format === 'jpeg' ? '#ffffff' : 'transparent' } : null;
  state.format = p.format;
  state.options.quality = p.quality;
  state.options.lossless = false;
  state.appliedPreset = p;
  // 同步控件
  R.formatSelect.value = p.format;
  R.qualityRange.value = p.quality;
  R.qualityVal.textContent = p.quality;
  R.losslessToggle.checked = false;
  updateCompressFields();
  renderImage();
  switchTab('compress');
  toast(`已应用「${p.name}」：${g.aspect === 'contain' ? '等比缩放入内' : '居中裁剪'} → ${g.resize.width}×${g.resize.height}`);
}

/* ================= 批量处理 ================= */

function addBatchFiles(files) {
  if (!files.length) return;
  for (const f of files) {
    if (f.type && !f.type.startsWith('image/')) continue;
    state.batch.push({ file: f, status: 'ready', result: null });
  }
  renderBatchList();
  toast(`已加入 ${files.length} 个文件`);
}

function batchConfig() {
  const format = state.format;
  return {
    edits: state.edits,
    format,
    options: state.options,
    concurrency: 2,
  };
}

function renderBatchList() {
  R.batchList.innerHTML = '';
  const items = state.batch;
  if (!items.length) {
    R.batchList.innerHTML = '<div class="empty-note">还没有加入文件<br>点「添加文件」选择多张图片</div>';
    return;
  }
  items.forEach((it, i) => {
    const row = el('div', { className: 'batch-row' });
    const statusCls = it.status === 'done' ? 'ok' : it.status === 'error' ? 'err' : 'idle';
    let right = '';
    if (it.status === 'done' && it.result) {
      right = `<span class="batch-size">${fmtBytes(it.result.bytes)}</span>
        <button class="mini-btn" data-download="${i}">下载</button>`;
    } else if (it.status === 'error') {
      right = `<span class="batch-err" title="${escapeHtml(it.error)}">${escapeHtml(it.error.slice(0, 24))}</span>`;
    } else if (it.status === 'running') {
      right = '<span class="batch-size pulse">处理中…</span>';
    } else {
      right = `<span class="batch-size">${fmtBytes(it.file.size)}</span>`;
    }
    row.innerHTML = `<span class="batch-name">${escapeHtml(it.file.name)}</span>
      <span class="batch-status ${statusCls}"></span>${right}
      <button class="mini-btn danger" data-del="${i}">×</button>`;
    R.batchList.appendChild(row);
  });
}

async function runBatchUI() {
  if (!state.batch.length) { toast('批量列表为空', true); return; }
  if (state.busy) return;
  if (state.batch.some(b => b.status === 'running')) return;
  state.batch.forEach(b => { b.status = 'ready'; b.result = null; });
  renderBatchList();
  state.busy = true;
  R.batchRunBtn.disabled = true;
  try {
    await runBatch(
      state.batch.map(b => ({ file: b.file })),
      batchConfig(),
      {
        onItem: (i, ev) => {
          state.batch[i].status = ev.status === 'done' ? 'done' : ev.status === 'error' ? 'error' : 'running';
          if (ev.result) state.batch[i].result = ev.result;
          renderBatchList();
        },
        onProgress: (done, total) => setStatus(`批量处理 ${done}/${total}`),
      }
    );
    const ok = state.batch.filter(b => b.status === 'done').length;
    toast(`批量完成：成功 ${ok}/${state.batch.length}`);
  } catch (e) {
    toast('批量失败：' + e.message, true);
  } finally {
    state.busy = false;
    R.batchRunBtn.disabled = false;
    setStatus('就绪');
  }
}

function downloadAllBatch() {
  const done = state.batch.filter(b => b.result?.ok);
  if (!done.length) { toast('没有可下载的处理结果', true); return; }
  let n = 0;
  for (const b of done) {
    setTimeout(() => { downloadBlob(b.result.blob, b.result.name); }, n * 250);
    n++;
  }
  toast(`开始下载 ${n} 个文件`);
}

/* ================= 启动 ================= */

init();

/* 供 hub.js 从「无限世界 · 工具总览」直达指定面板 */
window.enterWorkspaceTab = switchTab;









