// app.js — 无限世界 · FastEdit 图片工作台主入口
import { $, $$, toast, fmtBytes, fmtTime, downloadBlob, copyBlob, setStatus, debounce, el, baseName, escapeHtml } from './ui.js';
import { loadAsset, sourceFrame, processImageData, videoOutputDims, drawVideoFrameToCanvas, makeCanvas, decodeImageBlob, canvasToImageData, drawPatchedImage } from './engine.js';
import { encodeImage, FORMATS, warmUp } from './codecs.js';
import { encodeGif, encodeApng, frameToBlobUrl } from './anim.js';
import { sampleVideoFrames, grabVideoFrame, exportVideoLive } from './video.js';
import { PRESETS, presetGeometry } from './presets.js';
import { removeBackgroundFromImageData } from './ai.js';
import { runBatch } from './batch.js';

const PREVIEW_MAX = 1920; // 预览画布最大边（导出仍为全分辨率）

const R = {
  fileInput: $('#fileInput'), importBtn: $('#importBtn'), topExportBtn: $('#topExportBtn'),
  empty: $('#empty'), compareWrap: $('#compareWrap'), editorView: $('#editorView'), stageMenu: $('#stageMenu'),
  canvasOrig: $('#canvasOrig'), canvasOut: $('#canvasOut'), mosaicLayer: $('#mosaicLayer'),
  compareSlider: $('#compareSlider'), compareDivider: $('#compareDivider'), stageHint: $('#stageHint'),
  videoBar: $('#videoBar'), frameStrip: $('#frameStrip'),
  assetBadge: $('#assetBadge'),
  tabs: $('#tabs'), tabBody: $('#tabBody'),
  resizeEnabled: $('#resizeEnabled'), resizeW: $('#resizeW'), resizeH: $('#resizeH'),
  keepRatio: $('#keepRatio'), resetSizeBtn: $('#resetSizeBtn'),
  rotLeft: $('#rotLeft'), rotRight: $('#rotRight'), flipH: $('#flipH'), flipV: $('#flipV'),
  cropModeBtn: $('#cropModeBtn'), cropApplyBtn: $('#cropApplyBtn'), cropCancelBtn: $('#cropCancelBtn'), cropClearBtn: $('#cropClearBtn'),
  formatSelect: $('#formatSelect'), qualityRange: $('#qualityRange'), qualityVal: $('#qualityVal'),
  effortRange: $('#effortRange'), effortVal: $('#effortVal'), losslessToggle: $('#losslessToggle'),
  pngOptimise: $('#pngOptimise'), pngOptField: $('#pngOptField'),
  origSize: $('#origSize'), outSize: $('#outSize'), savedPct: $('#savedPct'),
  exportBtn: $('#exportBtn'), copyBtn: $('#copyBtn'), compareToggle: $('#compareToggle'),
  regionTypeSeg: $('#regionTypeSeg'), regionStrength: $('#regionStrength'), regionStrengthVal: $('#regionStrengthVal'),
  addRegionBtn: $('#addRegionBtn'), regionList: $('#regionList'),
  patchToolSeg: $('#patchToolSeg'), patchPanel: $('#patchPanel'), stampPanel: $('#stampPanel'),
  patchPickBtn: $('#patchPickBtn'), patchFileInput: $('#patchFileInput'),
  patchOpacity: $('#patchOpacity'), patchOpacityVal: $('#patchOpacityVal'),
  patchFeather: $('#patchFeather'), patchFeatherVal: $('#patchFeatherVal'),
  patchList: $('#patchList'),
  stampSize: $('#stampSize'), stampSizeVal: $('#stampSizeVal'),
  stampSoft: $('#stampSoft'), stampSoftVal: $('#stampSoftVal'),
  stampSampleBtn: $('#stampSampleBtn'), stampUndoBtn: $('#stampUndoBtn'), stampDoneBtn: $('#stampDoneBtn'),
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
    patches: [],
    pad: null,
  },
  format: 'webp',
  options: { quality: 75, effort: 4, lossless: false, pngOptimise: true, pngLevel: 2 },
  anim: { applyToAll: true, loop: true, delay: 100, selectedFrame: 0 },
  video: { start: 0, end: 0, fps: 12, format: 'webm' },
  regionType: 'mosaic',
  regionStrength: 16,
  dragMode: null,       // null | 'region' | 'crop' | 'patch' | 'stamp'
  drag: null,           // 拖拽状态：{x0,y0,x1,y1}（打码）或 {kind,...}（裁剪/补丁/图章）
  cropDraft: null,      // 裁剪模式中的框选草稿（确认前不应用，保持完整预览）
  patch: { tool: 'patch', selectedId: null },
  stamp: null,          // 仿制图章工作区：{base, overlay, size, soft, sample, pickSample, undoStack}
  baseCache: null,      // 预览用「不含补丁」的管线结果缓存（补丁在预览层实时合成）
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
  bindPatchEvents();
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
    if (state.dragMode === 'crop') { exitCropMode(); drawOverlay(); return; }
    enterCropMode();
  });
  R.cropApplyBtn.addEventListener('click', applyCropDraft);
  R.cropCancelBtn.addEventListener('click', cancelCropDraft);
  R.cropClearBtn.addEventListener('click', clearCrop);
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
  R.topExportBtn.addEventListener('click', exportCurrent);
  R.copyBtn.addEventListener('click', copyStatic);
}

function bindPatchEvents() {
  // 工具切换：跨图补丁 / 仿制图章
  R.patchToolSeg.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    state.patch.tool = b.dataset.tool;
    $$('.seg-btn', R.patchToolSeg).forEach(x => x.classList.toggle('active', x === b));
    R.patchPanel.classList.toggle('hidden', state.patch.tool !== 'patch');
    R.stampPanel.classList.toggle('hidden', state.patch.tool !== 'stamp');
    if (state.asset && document.querySelector('.tab[data-tab="patch"]').classList.contains('active')) {
      state.dragMode = state.patch.tool === 'stamp' ? 'stamp' : 'patch';
      drawOverlay();
    }
  });

  // 跨图补丁：选择补丁图
  R.patchPickBtn.addEventListener('click', () => R.patchFileInput.click());
  R.patchFileInput.addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    if (!state.asset) { toast('请先导入主图', true); return; }
    if (state.busy) { toast('正在处理中，请稍候', true); return; }
    setBusy(true);
    try {
      for (const f of files) {
        const img = await decodeImageBlob(f);
        addPatchFromImage(img, baseName(f.name));
      }
      toast(`已添加 ${files.length} 个补丁，拖到瑕疵上方即可`, false, 3000);
    } catch (err) {
      toast('补丁图读取失败：' + err.message, true);
    } finally {
      setBusy(false);
    }
  });

  // 透明度 / 羽化：作用于当前选中补丁
  R.patchOpacity.addEventListener('input', () => {
    R.patchOpacityVal.textContent = R.patchOpacity.value;
    const p = selectedPatch();
    if (p) { p.opacity = +R.patchOpacity.value / 100; refreshPatchPreview(); }
  });
  R.patchFeather.addEventListener('input', () => {
    R.patchFeatherVal.textContent = R.patchFeather.value;
    const p = selectedPatch();
    if (p) { p.feather = +R.patchFeather.value / 100; refreshPatchPreview(); }
  });
  R.patchList.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      state.edits.patches = state.edits.patches.filter(p => p.id !== del.dataset.del);
      if (state.patch.selectedId === del.dataset.del) state.patch.selectedId = null;
      renderPatchList();
      syncPatchSliders();
      refreshPatchPreview();
      return;
    }
    const sel = e.target.closest('[data-select]');
    if (sel) {
      state.patch.selectedId = sel.dataset.select;
      renderPatchList();
      syncPatchSliders();
      drawOverlay();
    }
  });

  // 仿制图章
  R.stampSampleBtn.addEventListener('click', () => {
    if (!state.asset) { toast('请先导入图片', true); return; }
    if (state.asset.kind !== 'image') { toast('仿制图章仅支持静态图片', true); return; }
    if (!state.stamp) { enterStampMode(); return; }
    state.stamp.pickSample = true;
    toast('在预览区单击选择取样点', false, 2500);
  });
  R.stampUndoBtn.addEventListener('click', undoStroke);
  R.stampDoneBtn.addEventListener('click', finishStamp);
  R.stampSize.addEventListener('input', () => {
    if (!state.stamp) return;
    state.stamp.size = +R.stampSize.value;
    R.stampSizeVal.textContent = state.stamp.size;
    drawOverlay();
  });
  R.stampSoft.addEventListener('input', () => {
    if (!state.stamp) return;
    state.stamp.soft = +R.stampSoft.value / 100;
    R.stampSoftVal.textContent = R.stampSoft.value;
  });
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

  // 右键菜单（替代浏览器「检查」）：更换 / 删除素材
  R.editorView.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showStageMenu(e.clientX, e.clientY);
  });
  window.addEventListener('pointerdown', (e) => {
    if (!R.stageMenu.classList.contains('hidden') && !e.target.closest('#stageMenu')) hideStageMenu();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    hideStageMenu();
    if (state.dragMode === 'crop') cancelCropDraft();
  });
  R.stageMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    hideStageMenu();
    if (btn.dataset.act === 'replace') { R.fileInput.click(); }
    else if (btn.dataset.act === 'delete') { removeAsset(); }
  });
}

function switchTab(name) {
  $$('.tab', R.tabs).forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel', R.tabBody).forEach(p => p.classList.toggle('active', p.dataset.panel === name));
  // 补丁 tab：按所选工具进入对应指针模式；离开时退出（裁剪模式切换过来先退出，避免模式冲突）
  if (name === 'patch') {
    if (state.asset) {
      if (state.dragMode === 'crop') exitCropMode();
      state.dragMode = state.patch.tool === 'stamp' ? 'stamp' : 'patch';
      drawOverlay();
    }
  } else if (state.dragMode === 'patch' || state.dragMode === 'stamp') {
    state.dragMode = null;
    if (state.stamp) state.stamp.brushPos = null;
    drawOverlay();
  }
}

/* ================= 素材导入 ================= */

/** 默认编辑参数（含补丁列表），保证各处重置一致 */
function defaultEdits() {
  return { crop: null, rotate: 0, flipH: false, flipV: false, resize: { enabled: true, width: 0, height: 0, method: 'lanczos3' }, regions: [], patches: [], pad: null };
}

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
    state.edits = defaultEdits();
    state.cropDraft = null;
    state.drag = null;
    state.patch = { tool: state.patch.tool, selectedId: null };
    state.stamp = null;
    state.baseCache = null;
    state.dragMode = null;
    exitCropMode();
    state.anim.selectedFrame = 0;
    state.appliedPreset = null;
    R.resizeW.value = ''; R.resizeH.value = '';

    const asset = await loadAsset(f);
    state.asset = asset;
    R.assetBadge.textContent = `${asset.kind === 'video' ? 'VIDEO' : asset.kind === 'animated' ? 'GIF/动图' : 'IMAGE'} · ${asset.name} · ${asset.width}×${asset.height}`;
    R.empty.classList.add('hidden');
    R.topExportBtn.classList.remove('hidden');
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

/* ================= 裁剪模式（草稿 → 确认，预览始终保持完整原图） ================= */

function enterCropMode() {
  state.dragMode = 'crop';
  state.drag = null;
  state.cropDraft = state.edits.crop ? { ...state.edits.crop } : null;
  R.cropModeBtn.classList.add('active');
  R.cropApplyBtn.classList.remove('hidden');
  R.cropCancelBtn.classList.remove('hidden');
  R.mosaicLayer.style.cursor = 'crosshair';
  toast('在预览区拖拽框选要保留的区域；松开后可整框拖动 / 拖四角微调，最后点「确认裁剪」', false, 4000);
  drawOverlay();
}

function exitCropMode() {
  state.dragMode = null;
  state.drag = null;
  R.cropModeBtn.classList.remove('active');
  R.cropApplyBtn.classList.add('hidden');
  R.cropCancelBtn.classList.add('hidden');
  R.mosaicLayer.style.cursor = '';
}

function applyCropDraft() {
  if (!state.cropDraft) { toast('请先在预览区框选要保留的区域', true); return; }
  if (state.cropDraft.w < CROP_MIN || state.cropDraft.h < CROP_MIN) { toast('裁剪区域太小，请重新框选', true); return; }
  state.edits.crop = { ...state.cropDraft };
  state.cropDraft = null;
  R.cropClearBtn.classList.remove('hidden');
  exitCropMode();
  drawOverlay();
  rerender();
  scheduleEstimate();
  toast('已应用裁剪，可随时点「清除裁剪」恢复原图', false, 2500);
}

function cancelCropDraft() {
  state.cropDraft = null;
  exitCropMode();
  drawOverlay();
  toast('已取消本次裁剪', false, 1500);
}

function clearCrop() {
  state.edits.crop = null;
  state.cropDraft = null;
  R.cropClearBtn.classList.add('hidden');
  exitCropMode();
  drawOverlay();
  rerender();
  scheduleEstimate();
  toast('已清除裁剪', false, 1500);
}

/* ================= 右键菜单：更换 / 删除素材（替代浏览器「检查」） ================= */

function showStageMenu(x, y) {
  R.stageMenu.style.left = Math.max(4, Math.min(x, innerWidth - 170)) + 'px';
  R.stageMenu.style.top = Math.max(4, Math.min(y, innerHeight - 100)) + 'px';
  R.stageMenu.classList.remove('hidden');
}

function hideStageMenu() { R.stageMenu.classList.add('hidden'); }

/** 删除当前素材：清空舞台回到空状态 */
function removeAsset() {
  if (state.busy) { toast('正在处理中，请稍候', true); return; }
  stopVideoPreview();
  state.asset = null;
  state.aiBackup = null;
  state.edits = defaultEdits();
  state.cropDraft = null;
  state.drag = null;
  state.patch = { tool: state.patch.tool, selectedId: null };
  state.stamp = null;
  state.baseCache = null;
  state.dragMode = null;
  state.compareOn = false;
  state.anim.selectedFrame = 0;
  state.appliedPreset = null;
  exitCropMode();
  R.empty.classList.remove('hidden');
  R.compareWrap.classList.add('hidden');
  R.topExportBtn.classList.add('hidden');
  R.assetBadge.classList.add('hidden');
  R.cropClearBtn.classList.add('hidden');
  R.frameStrip.classList.add('hidden');
  R.videoBar.classList.add('hidden');
  R.aiUndoBtn.classList.add('hidden');
  renderPatchList();
  syncPatchSliders();
  R.stampUndoBtn.disabled = true;
  R.stampDoneBtn.classList.add('hidden');
  R.resizeW.value = ''; R.resizeH.value = '';
  R.compareSlider.value = 50;
  R.compareToggle.classList.remove('active');
  R.compareWrap.classList.remove('compare-on');
  applyCompareClip();
  const o1 = R.canvasOrig.getContext('2d');
  const o2 = R.canvasOut.getContext('2d');
  o1.clearRect(0, 0, R.canvasOrig.width, R.canvasOrig.height);
  o2.clearRect(0, 0, R.canvasOut.width, R.canvasOut.height);
  drawOverlay();
  R.origSize.textContent = ''; R.outSize.textContent = ''; R.savedPct.textContent = '';
  setStatus('已删除当前素材');
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
  if (state.stamp) { drawStampPreview(); return; }
  layoutStage(a.width, a.height);
  const octx = R.canvasOrig.getContext('2d');
  const outW = R.canvasOut.width, outH = R.canvasOut.height;
  octx.clearRect(0, 0, outW, outH);
  octx.drawImage(assetToCanvas(a), 0, 0, outW, outH);
  // 管线缓存不含补丁：补丁在 drawPreviewComposite 里实时合成（拖动/调参不重跑 wasm 管线）
  processImageData(sourceFrame(a), { ...state.edits, patches: [] }).then((img) => {
    state.baseCache = img;
    drawPreviewComposite();
  }).catch((e) => toast('处理失败：' + e.message, true));
  scheduleEstimate();
}

/** 预览合成：管线底图 + 补丁（同步 2D 绘制，拖动补丁时秒级响应） */
function drawPreviewComposite() {
  if (!state.baseCache || state.stamp) return;
  const octx2 = R.canvasOut.getContext('2d');
  const outW = R.canvasOut.width, outH = R.canvasOut.height;
  octx2.clearRect(0, 0, outW, outH);
  octx2.drawImage(imgToCanvas(state.baseCache), 0, 0, outW, outH);
  for (const p of state.edits.patches) {
    const x = p.x * outW, y = p.y * outH, rw = p.w * outW, rh = p.h * outH;
    drawPatchedImage(octx2, p.img, x, y, rw, rh, p.opacity, p.feather * Math.min(rw, rh));
  }
  drawOverlay();
}

function renderAnim() {
  const a = state.asset;
  if (state.stamp) { drawStampPreview(); return; }
  const idx = Math.min(state.anim.selectedFrame, a.frames.length - 1);
  layoutStage(a.width, a.height);
  const octx = R.canvasOrig.getContext('2d');
  const outW = R.canvasOut.width, outH = R.canvasOut.height;
  octx.clearRect(0, 0, outW, outH);
  octx.drawImage(imgToCanvas(a.frames[idx].data), 0, 0, outW, outH);
  processImageData(a.frames[idx].data, { ...frameEditsFor(idx), patches: [] }).then((img) => {
    state.baseCache = img;
    drawPreviewComposite();
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
    patches: state.edits.patches,
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

  // 裁剪模式中的框选遮罩（仅草稿编辑时显示；确认后不遮挡预览）
  if (state.dragMode === 'crop' && state.cropDraft && state.cropDraft.w > 0 && state.cropDraft.h > 0) {
    const x = state.cropDraft.x * W, y = state.cropDraft.y * H;
    const rw = state.cropDraft.w * W, rh = state.cropDraft.h * H;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0, 0, W, y); ctx.fillRect(0, y + rh, W, H - y - rh);
    ctx.fillRect(0, y, x, rh); ctx.fillRect(x + rw, y, W - x - rw, rh);
    ctx.strokeStyle = 'rgba(80,220,160,.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, rw - 2, rh - 2);
    ctx.restore();
    // 四角手柄
    if (rw > 16 && rh > 16) {
      ctx.fillStyle = 'rgba(80,220,160,1)';
      for (const [hx, hy] of [[x, y], [x + rw, y], [x, y + rh], [x + rw, y + rh]]) {
        ctx.fillRect(hx - 4, hy - 4, 8, 8);
      }
    }
  }

  // 补丁边框 / 手柄（内容已由 drawPreviewComposite 合成进 canvasOut，这里只画引导）
  for (const p of state.edits.patches) {
    const x = p.x * W, y = p.y * H, rw = p.w * W, rh = p.h * H;
    const sel = state.patch.selectedId === p.id;
    ctx.strokeStyle = sel ? 'rgba(80,220,160,.95)' : 'rgba(255,255,255,.65)';
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, rw - 1, rh - 1);
    if (sel) {
      ctx.fillStyle = 'rgba(80,220,160,1)';
      for (const [hx, hy] of [[x, y], [x + rw, y], [x, y + rh], [x + rw, y + rh]]) {
        ctx.fillRect(hx - 4, hy - 4, 8, 8);
      }
    }
  }

  // 仿制图章：取样点标记 + 笔刷光标
  if (state.dragMode === 'stamp' && state.stamp) {
    if (state.stamp.sample) {
      const sx = state.stamp.sample.x * W, sy = state.stamp.sample.y * H;
      ctx.strokeStyle = 'rgba(0,190,255,.95)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - 11, sy); ctx.lineTo(sx + 11, sy); ctx.moveTo(sx, sy - 11); ctx.lineTo(sx, sy + 11); ctx.stroke();
    }
    if (state.stamp.brushPos) {
      const rPx = Math.max(2, state.stamp.size / 2);
      const bx = state.stamp.brushPos.x * W, by = state.stamp.brushPos.y * H;
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.arc(bx, by, rPx, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // 拖动时显示取样源位置（sample + 当前点相对笔触起点的偏移）
      if (state.drag && state.drag.kind === 'stamp') {
        const offX = state.drag.start.x - state.stamp.sample.x;
        const offY = state.drag.start.y - state.stamp.sample.y;
        const gx = (state.stamp.brushPos.x - offX) * W, gy = (state.stamp.brushPos.y - offY) * H;
        ctx.strokeStyle = 'rgba(255,200,80,.85)';
        ctx.beginPath(); ctx.arc(gx, gy, rPx, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  // 打码拖拽中的选区
  if (state.drag && !state.drag.kind) {
    const n = normRect(state.drag);
    const x = n.x * W, y = n.y * H, rw = n.w * W, rh = n.h * H;
    if (rw > 3 && rh > 3) {
      ctx.strokeStyle = 'rgba(255,160,60,.95)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x + 1, y + 1, rw - 2, rh - 2);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,160,60,.1)';
      ctx.fillRect(x, y, rw, rh);
    }
  }
}

function applyCompareClip() {
  // 对比开关关闭时禁止裁剪 canvasOut，否则会把 canvasOut 左半截裁掉、露出
  // 底下的原图画布，造成「图片左右分离」的错觉（未编辑时两层内容一致看不出来，
  // 一旦裁剪/旋转等编辑触发重排版就会现形）。
  if (!state.compareOn) {
    R.canvasOut.style.clipPath = '';
    R.canvasOut.style.WebkitClipPath = '';
    R.compareDivider.style.left = '';
    return;
  }
  const pct = +R.compareSlider.value;
  R.canvasOut.style.clipPath = `inset(0 0 0 ${pct}%)`;
  R.canvasOut.style.WebkitClipPath = `inset(0 0 0 ${pct}%)`;
  R.compareDivider.style.left = pct + '%';
}

function toggleCompare() {
  state.compareOn = !state.compareOn;
  R.compareToggle.classList.toggle('active', state.compareOn);
  R.compareWrap.classList.toggle('compare-on', state.compareOn);
  applyCompareClip();
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

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const CROP_MIN = 0.05;   // 裁剪框最小面积（归一化比例）
const HANDLE_PX = 12;    // 裁剪框四角手柄命中半径(px)

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

/** 裁剪框命中检测：四角手柄 → 'nw'|'ne'|'sw'|'se'；框内 → 'move'；其余 → null */
function cropHitTest(p) {
  const b = state.cropDraft;
  if (!b || !b.w || !b.h) return null;
  const W = R.mosaicLayer.width, H = R.mosaicLayer.height;
  const x = b.x * W, y = b.y * H, rw = b.w * W, rh = b.h * H;
  if (rw < HANDLE_PX * 2 || rh < HANDLE_PX * 2) return null;
  const px = p.x * W, py = p.y * H;
  const near = (cx, cy) => Math.hypot(px - cx, py - cy) <= HANDLE_PX;
  if (near(x, y)) return 'nw';
  if (near(x + rw, y)) return 'ne';
  if (near(x, y + rh)) return 'sw';
  if (near(x + rw, y + rh)) return 'se';
  if (px >= x - 4 && px <= x + rw + 4 && py >= y - 4 && py <= y + rh + 4) return 'move';
  return null;
}

/** 补丁命中检测：选中态四角手柄 → 角名；框内 → 'move'；其余 → null（返回 {id, hit}） */
function patchHitTest(p) {
  const W = R.mosaicLayer.width, H = R.mosaicLayer.height;
  const px = p.x * W, py = p.y * H;
  const list = state.edits.patches;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    const x = b.x * W, y = b.y * H, rw = b.w * W, rh = b.h * H;
    if (rw < HANDLE_PX * 2 || rh < HANDLE_PX * 2) continue;
    const near = (cx, cy) => Math.hypot(px - cx, py - cy) <= HANDLE_PX;
    if (state.patch.selectedId === b.id) {
      if (near(x, y)) return { id: b.id, hit: 'nw' };
      if (near(x + rw, y)) return { id: b.id, hit: 'ne' };
      if (near(x, y + rh)) return { id: b.id, hit: 'sw' };
      if (near(x + rw, y + rh)) return { id: b.id, hit: 'se' };
    }
    if (px >= x - 4 && px <= x + rw + 4 && py >= y - 4 && py <= y + rh + 4) return { id: b.id, hit: 'move' };
  }
  return null;
}

/** 补丁拖角缩放（保持原宽高比），以对角为固定点，多次迭代收敛到边界内 */
function resizePatchBox(b, corner, px, py) {
  const ar = b.w / b.h;
  const PAD = 0.02;
  const c = (v, a, z) => Math.min(z, Math.max(a, v));
  let x = b.x, y = b.y, w = b.w, h = b.h;
  for (let i = 0; i < 3; i++) {
    if (corner === 'se') {
      w = c(px - x, PAD, 1 - x); h = w / ar; h = c(h, PAD, 1 - y); w = h * ar; w = c(w, PAD, 1 - x); h = w / ar;
    } else if (corner === 'sw') {
      const R = x + w; w = c(R - px, PAD, R); h = w / ar; h = c(h, PAD, 1 - y); w = h * ar; w = c(w, PAD, R); x = R - w;
    } else if (corner === 'ne') {
      const B = y + h; w = c(px - x, PAD, 1 - x); h = w / ar; h = c(h, PAD, B); w = h * ar; w = c(w, PAD, 1 - x); h = w / ar; y = B - h;
    } else {
      const R = x + w, B = y + h; w = c(R - px, PAD, R); h = w / ar; h = c(h, PAD, B); w = h * ar; w = c(w, PAD, R); x = R - w; y = B - h;
    }
  }
  return { x, y, w, h };
}

function onStagePointerDown(e) {
  if (!state.asset || !state.dragMode) return;
  if (e.button !== 0) return; // 仅左键拖拽
  e.preventDefault();
  R.mosaicLayer.setPointerCapture?.(e.pointerId);
  const p = stagePoint(e);

  if (state.dragMode === 'crop') {
    const prev = state.cropDraft ? { ...state.cropDraft } : null;
    const hit = cropHitTest(p);
    if (hit && hit !== 'move') {
      // 拖角缩放：以对角为固定点
      const b = state.cropDraft;
      const W = R.mosaicLayer.width, H = R.mosaicLayer.height;
      const rx = b.x * W, ry = b.y * H, rw = b.w * W, rh = b.h * H;
      const fx = (hit === 'nw' || hit === 'sw') ? (rx + rw) / W : rx / W;
      const fy = (hit === 'ne' || hit === 'nw') ? (ry + rh) / H : ry / H;
      state.drag = { kind: 'crop-resize', corner: hit, fx, fy, prev };
      drawOverlay();
      return;
    }
    if (hit === 'move') {
      const b = state.cropDraft;
      state.drag = { kind: 'crop-move', box: { ...b }, dx: p.x - b.x, dy: p.y - b.y, prev };
      drawOverlay();
      return;
    }
    // 空白处：重画一个框（替换草稿）
    state.drag = { kind: 'crop-draw', ax: p.x, ay: p.y, prev };
    state.cropDraft = { x: p.x, y: p.y, w: 0, h: 0 };
    drawOverlay();
    return;
  }

  // 补丁：点中→选中并拖拽（整框移动 / 四角缩放）；空白→取消选中
  if (state.dragMode === 'patch') {
    const hit = patchHitTest(p);
    if (hit) {
      state.patch.selectedId = hit.id;
      const b = state.edits.patches.find(x => x.id === hit.id);
      if (hit.hit === 'move') {
        state.drag = { kind: 'patch-move', id: hit.id, box: { ...b }, dx: p.x - b.x, dy: p.y - b.y };
      } else {
        state.drag = { kind: 'patch-resize', id: hit.id, corner: hit.hit };
      }
    } else {
      state.patch.selectedId = null;
    }
    renderPatchList();
    syncPatchSliders();
    drawOverlay();
    return;
  }

  // 仿制图章
  if (state.dragMode === 'stamp') {
    if (!state.stamp) { enterStampMode(); return; }
    if (state.stamp.pickSample) {
      state.stamp.sample = { x: p.x, y: p.y };
      state.stamp.pickSample = false;
      toast('取样点已设置（蓝圈标记），按住瑕疵处涂抹即可', false, 3000);
      drawOverlay();
      return;
    }
    if (!state.stamp.sample) {
      toast('请先点「设置取样点」并在预览区单击选择干净位置', true);
      return;
    }
    state.drag = { kind: 'stamp', start: { x: p.x, y: p.y }, points: [{ x: p.x, y: p.y }] };
    state.stamp.brushPos = { x: p.x, y: p.y };
    drawOverlay();
    return;
  }

  // 打码区域：保持原拖拽画框行为
  state.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  drawOverlay();
}

function onStagePointerMove(e) {
  const p = stagePoint(e);

  // 图章模式：无拖拽时也跟踪笔刷光标（画虚线圆预览）
  if (state.dragMode === 'stamp' && state.stamp && !state.drag) {
    state.stamp.brushPos = { x: p.x, y: p.y };
    drawOverlay();
    return;
  }
  if (!state.drag) return;
  const d = state.drag;

  if (d.kind === 'crop-draw') {
    const n = normRect({ x0: d.ax, y0: d.ay, x1: p.x, y1: p.y });
    state.cropDraft = { x: n.x, y: n.y, w: n.w, h: n.h };
  } else if (d.kind === 'crop-move') {
    const nx = clamp(p.x - d.dx, 0, 1 - d.box.w);
    const ny = clamp(p.y - d.dy, 0, 1 - d.box.h);
    state.cropDraft = { x: nx, y: ny, w: d.box.w, h: d.box.h };
  } else if (d.kind === 'crop-resize') {
    const b = d.prev || { x: 0, y: 0, w: 1, h: 1 };
    const px = clamp(p.x, 0, 1), py = clamp(p.y, 0, 1);
    let x = b.x, y = b.y, w = b.w, h = b.h;
    if (d.corner === 'nw') { x = clamp(px, 0, d.fx); y = clamp(py, 0, d.fy); w = d.fx - x; h = d.fy - y; }
    else if (d.corner === 'ne') { x = d.fx; y = clamp(py, 0, d.fy); w = clamp(px, d.fx, 1) - d.fx; h = d.fy - y; }
    else if (d.corner === 'sw') { x = clamp(px, 0, d.fx); y = d.fy; w = d.fx - x; h = clamp(py, d.fy, 1) - d.fy; }
    else { x = d.fx; y = d.fy; w = clamp(px, d.fx, 1) - d.fx; h = clamp(py, d.fy, 1) - d.fy; }
    if (w < 0.01) w = 0.01;
    if (h < 0.01) h = 0.01;
    state.cropDraft = { x, y, w, h };
  } else if (d.kind === 'patch-move') {
    const b = d.box;
    const nx = clamp(p.x - d.dx, 0, 1 - b.w);
    const ny = clamp(p.y - d.dy, 0, 1 - b.h);
    const patch = state.edits.patches.find(x => x.id === d.id);
    if (patch) { patch.x = nx; patch.y = ny; }
    renderPatchList();
    refreshPatchPreview();
  } else if (d.kind === 'patch-resize') {
    const patch = state.edits.patches.find(x => x.id === d.id);
    if (patch) {
      const nb = resizePatchBox(patch, d.corner, clamp(p.x, 0, 1), clamp(p.y, 0, 1));
      patch.x = nb.x; patch.y = nb.y; patch.w = nb.w; patch.h = nb.h;
    }
    renderPatchList();
    refreshPatchPreview();
  } else if (d.kind === 'stamp') {
    // 按间隔采样路径点，避免笔触过密
    const last = d.points[d.points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > 0.006) d.points.push({ x: p.x, y: p.y });
    state.stamp.brushPos = { x: p.x, y: p.y };
    drawOverlay();
    return;
  } else {
    // 打码拖拽
    state.drag.x1 = p.x; state.drag.y1 = p.y;
  }
  drawOverlay();
}

/** 补丁拖动/缩放后的即时预览刷新（视频走帧绘制，静态/动图走缓存合成） */
function refreshPatchPreview() {
  if (!state.asset) return;
  if (state.asset.kind === 'video') drawVideoPreview();
  else drawPreviewComposite();
}

function onStagePointerUp(e) {
  if (!state.drag) return;
  const d = state.drag;
  state.drag = null;

  // 裁剪：只更新草稿，不应用、不退出（保持完整预览，可继续拖动 / 缩放微调）
  if (d.kind === 'crop-draw' || d.kind === 'crop-move' || d.kind === 'crop-resize') {
    const b = state.cropDraft;
    if (b && (b.w < CROP_MIN || b.h < CROP_MIN)) {
      state.cropDraft = d.prev ? { ...d.prev } : null; // 太小：还原
    }
    drawOverlay();
    return;
  }

  // 补丁：松手即完成本次移动/缩放
  if (d.kind === 'patch-move' || d.kind === 'patch-resize') {
    refreshPatchPreview();
    return;
  }

  // 图章：松手时把整段笔触栅格化到工作区
  if (d.kind === 'stamp') {
    state.stamp.activeStroke = d.points;
    rasterizeStroke();
    return;
  }

  // 打码区域：松开即添加区域
  const n = normRect(d);
  if (n.w < 0.01 || n.h < 0.01) { drawOverlay(); return; }
  state.edits.regions.push({
    id: 'r' + Date.now() + Math.random().toString(16).slice(2, 6),
    x: n.x, y: n.y, w: n.w, h: n.h,
    type: state.regionType, strength: state.regionStrength,
  });
  renderRegionList();
  rerender();
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

/** 当前选中的补丁对象 */
function selectedPatch() {
  return state.edits.patches.find(p => p.id === state.patch.selectedId) || null;
}

/** 把一个补丁图加入编辑：默认居中、宽 40%，保持原宽高比 */
function addPatchFromImage(img, name) {
  const d = outputDims();
  if (!d.w || !d.h) return;
  const ar = (img.width / img.height) * (d.h / d.w); // 归一化坐标系下的宽高比
  let w = 0.4;
  let h = w / ar;
  const maxH = 0.9;
  if (h > maxH) { h = maxH; w = h * ar; }
  const p = {
    id: 'p' + Date.now() + Math.random().toString(16).slice(2, 6),
    img, name: name || '补丁',
    x: 0.5 - w / 2, y: 0.5 - h / 2, w, h,
    opacity: 1, feather: 0,
  };
  state.edits.patches.push(p);
  state.patch.selectedId = p.id;
  renderPatchList();
  syncPatchSliders();
  if (state.asset && document.querySelector('.tab[data-tab="patch"]').classList.contains('active')) {
    state.dragMode = 'patch';
  }
  refreshPatchPreview();
}

function renderPatchList() {
  const list = state.edits.patches;
  R.patchList.innerHTML = '';
  if (!list.length) {
    R.patchList.innerHTML = '<div class="empty-note">还没有补丁<br>点击「选择补丁图」添加</div>';
    return;
  }
  for (const p of list) {
    const row = el('div', { className: 'region-row' + (p.id === state.patch.selectedId ? ' active' : ''), dataset: { select: p.id } });
    row.innerHTML = `<span class="region-tag patch">补丁</span>
      <span class="region-pos">${Math.round(p.x * 100)}%,${Math.round(p.y * 100)}% · ${Math.round(p.w * 100)}×${Math.round(p.h * 100)}%</span>
      <button class="mini-btn danger" data-del="${p.id}" title="删除">×</button>`;
    R.patchList.appendChild(row);
  }
}

/** 滑块同步到当前选中补丁 */
function syncPatchSliders() {
  const p = selectedPatch();
  if (!p) { R.patchOpacity.value = 100; R.patchOpacityVal.textContent = '100'; R.patchFeather.value = 0; R.patchFeatherVal.textContent = '0'; return; }
  R.patchOpacity.value = Math.round(p.opacity * 100);
  R.patchOpacityVal.textContent = R.patchOpacity.value;
  R.patchFeather.value = Math.round(p.feather * 100);
  R.patchFeatherVal.textContent = R.patchFeather.value;
}

/* ================= 仿制图章 ================= */

/** 进入图章工作区：把当前画面（含所有编辑）合并为工作底图，笔触写入独立 overlay */
async function enterStampMode() {
  const a = state.asset;
  if (!a || a.kind !== 'image') { toast('仿制图章仅支持静态图片', true); return; }
  if (state.stamp) return;
  if (state.busy) { toast('正在处理中，请稍候', true); return; }
  setBusy(true);
  try {
    setStatus('正在生成图章工作底图…');
    const base = await processImageData(sourceFrame(a), { ...state.edits, patches: [] });
    state.stamp = {
      base,
      overlay: new ImageData(base.width, base.height),
      size: +R.stampSize.value, soft: +R.stampSoft.value / 100,
      sample: null, pickSample: true, undoStack: [],
      brushPos: null,
    };
    state.dragMode = 'stamp';
    R.stampDoneBtn.classList.remove('hidden');
    drawStampPreview();
    toast('已生成工作底图：先单击预览区选择干净取样点，再按住瑕疵处涂抹', false, 4000);
  } catch (e) {
    toast('图章工作底图生成失败：' + e.message, true);
  } finally {
    setBusy(false);
    setStatus('就绪');
  }
}

/** 图章预览：canvasOut 显示 base + overlay（不经过 wasm 管线） */
function drawStampPreview() {
  const a = state.asset, s = state.stamp;
  if (!a || !s) return;
  layoutStage(s.base.width, s.base.height);
  const W = R.canvasOut.width, H = R.canvasOut.height;
  const octx = R.canvasOrig.getContext('2d');
  octx.clearRect(0, 0, W, H);
  octx.drawImage(imgToCanvas(sourceFrame(a)), 0, 0, W, H);
  const o2 = R.canvasOut.getContext('2d');
  o2.clearRect(0, 0, W, H);
  o2.drawImage(imgToCanvas(s.base), 0, 0, W, H);
  o2.drawImage(imgToCanvas(s.overlay), 0, 0, W, H);
  drawOverlay();
}

/** 输出像素里笔刷半径（把预览 px 换算到工作底图分辨率） */
function stampRadiusOut() {
  const s = state.stamp;
  const scale = s.base.width / Math.max(1, R.canvasOut.width);
  return Math.max(1, (s.size / 2) * scale);
}

/** 松手时把整段笔触栅格化到 overlay（从 base+overlay 取样，软边蒙版融合） */
function rasterizeStroke() {
  const s = state.stamp;
  const pts = s.activeStroke;
  s.activeStroke = null;
  if (!pts || !pts.length) return;
  const W = s.base.width, H = s.base.height;
  const r = stampRadiusOut();
  // 笔触包围盒（输出像素）
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (const p of pts) {
    const px = p.x * W, py = p.y * H;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
  }
  const bx = Math.max(0, Math.floor(minX - r) - 1), by = Math.max(0, Math.floor(minY - r) - 1);
  const bw = Math.min(W - bx, Math.ceil(maxX + r) + 1 - bx);
  const bh = Math.min(H - by, Math.ceil(maxY + r) + 1 - by);
  if (bw <= 0 || bh <= 0) return;

  // 取样源 = base + 已提交的 overlay
  const srcC = makeCanvas(W, H);
  const sctx = srcC.getContext('2d');
  sctx.drawImage(imgToCanvas(s.base), 0, 0);
  const ovC = imgToCanvas(s.overlay);
  sctx.drawImage(ovC, 0, 0);

  const offX = pts[0].x * W - s.sample.x * W;
  const offY = pts[0].y * H - s.sample.y * H;

  // 笔触画布（仅包围盒）
  const strokeC = makeCanvas(bw, bh);
  const stx = strokeC.getContext('2d');
  stx.imageSmoothingQuality = 'high';
  for (const p of pts) {
    const tx = p.x * W, ty = p.y * H;
    const sx = tx - offX, sy = ty - offY;
    stx.drawImage(srcC, sx - r, sy - r, r * 2, r * 2, tx - bx - r, ty - by - r, r * 2, r * 2);
  }

  // 软边蒙版：白圆 + 高斯模糊，destination-in 裁出柔和边缘
  if (s.soft > 0.02) {
    const maskC = makeCanvas(bw, bh);
    const mx = maskC.getContext('2d');
    mx.fillStyle = '#fff';
    for (const p of pts) {
      mx.beginPath();
      mx.arc(p.x * W - bx, p.y * H - by, r, 0, Math.PI * 2);
      mx.fill();
    }
    mx.filter = 'blur(' + Math.max(0.5, r * s.soft) + 'px)';
    for (const p of pts) {
      mx.beginPath();
      mx.arc(p.x * W - bx, p.y * H - by, r, 0, Math.PI * 2);
      mx.fill();
    }
    stx.globalCompositeOperation = 'destination-in';
    stx.drawImage(maskC, 0, 0);
    stx.globalCompositeOperation = 'source-over';
  }

  // 撤销快照（包围盒区域）
  s.undoStack.push(ovC.getContext('2d').getImageData(bx, by, bw, bh));
  ovC.getContext('2d').drawImage(strokeC, bx, by);
  s.overlay = canvasToImageData(ovC);
  R.stampUndoBtn.disabled = s.undoStack.length === 0;
  drawStampPreview();
}

function undoStroke() {
  const s = state.stamp;
  if (!s || !s.undoStack.length) return;
  const snap = s.undoStack.pop();
  const ovC = imgToCanvas(s.overlay);
  ovC.getContext('2d').putImageData(snap, 0, 0);
  s.overlay = canvasToImageData(ovC);
  R.stampUndoBtn.disabled = s.undoStack.length === 0;
  drawStampPreview();
}

/** 完成合并：把 base+overlay 固化到素材，重置编辑参数（几何已含在底图里） */
async function finishStamp() {
  const a = state.asset, s = state.stamp;
  if (!a || !s) return;
  if (state.busy) { toast('正在处理中，请稍候', true); return; }
  setBusy(true);
  try {
    const c = makeCanvas(s.base.width, s.base.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(imgToCanvas(s.base), 0, 0);
    ctx.drawImage(imgToCanvas(s.overlay), 0, 0);
    a.imageData = canvasToImageData(c);
    a.width = c.width;
    a.height = c.height;
    R.assetBadge.textContent = `${a.kind === 'video' ? 'VIDEO' : a.kind === 'animated' ? 'GIF/动图' : 'IMAGE'} · ${a.name} · ${a.width}×${a.height}`;
    // 几何变换已合入底图，重置编辑（补丁/打码也被合入）
    state.edits = defaultEdits();
    state.patch = { tool: state.patch.tool, selectedId: null };
    state.stamp = null;
    state.baseCache = null;
    state.drag = null;
    state.dragMode = null;
    R.stampUndoBtn.disabled = true;
    R.stampDoneBtn.classList.add('hidden');
    R.cropClearBtn.classList.add('hidden');
    R.resizeW.value = ''; R.resizeH.value = '';
    renderPatchList();
    syncPatchSliders();
    drawOverlay();
    rerender();
    toast('图章已合并到图片（裁剪/缩放等已合入底图），可继续编辑', false, 3200);
  } catch (e) {
    toast('合并失败：' + e.message, true);
  } finally {
    setBusy(false);
    setStatus('就绪');
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

/** 统一导出入口：静态图 / 动图 / 视频按当前素材分派（顶栏「保存 / 导出」按钮） */
function exportCurrent() {
  const a = state.asset;
  if (!a) return;
  if (a.kind === 'video') return exportVideo();
  if (a.kind === 'animated') return exportAnim();
  return exportStatic();
}

function assetName() {
  return (state.asset?.name || 'image').replace(/\.[^.]+$/, '');
}

function setBusy(busy, label) {
  state.busy = busy;
  R.exportBtn.disabled = busy;
  R.topExportBtn.disabled = busy;
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









