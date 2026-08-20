// video.js — 视频素材：导入 / 取帧 / MediaRecorder 实时重编码导出
import { makeCanvas, canvasToImageData, MAX_DIM } from './engine.js';

export function setupVideoAsset(base) {
  return new Promise((resolve, reject) => {
    const videoEl = document.createElement('video');
    videoEl.preload = 'auto';
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.crossOrigin = 'anonymous';
    const url = URL.createObjectURL(base.src);
    videoEl.onloadedmetadata = () => {
      const w = videoEl.videoWidth, h = videoEl.videoHeight;
      const scale = Math.min(1, MAX_DIM / Math.max(w, h));
      resolve({
        ...base,
        kind: 'video',
        width: w, height: h,
        workW: Math.max(1, Math.round(w * scale)),
        workH: Math.max(1, Math.round(h * scale)),
        scale,
        videoEl,
        srcUrl: url,
        duration: videoEl.duration || 0,
      });
    };
    videoEl.onerror = () => { URL.revokeObjectURL(url); reject(new Error('视频加载失败')); };
    videoEl.src = url;
  });
}

/** 等待 seeked */
function waitSeeked(video) {
  return new Promise((resolve) => {
    if (video.seeking) {
      video.addEventListener('seeked', () => resolve(), { once: true });
    } else resolve();
  });
}

/**
 * 把视频当前帧画到画布（尺寸按 workW/workH，即缩放后的工作尺寸）。
 * 注意：仅取原始帧；几何/打码等编辑由调用方再用 processImageData 应用。
 * @returns {Promise<ImageData>}
 */
export async function grabVideoFrame(video, workW, workH) {
  await waitSeeked(video);
  const c = makeCanvas(workW, workH);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, workW, workH);
  return canvasToImageData(c);
}

/**
 * 采样视频区间内的帧（用于 GIF 导出 / 批量取帧）。
 */
export async function sampleVideoFrames(video, workW, workH, { start, end, fps, onProgress }) {
  const dur = Math.max(0.1, end - start);
  const count = Math.min(600, Math.max(1, Math.round(dur * fps)));
  const frames = [];
  const drawC = makeCanvas(workW, workH);
  const drawCtx = drawC.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < count; i++) {
    const t = start + (dur * i) / Math.max(1, count - 1);
    video.currentTime = t;
    await waitSeeked(video);
    drawCtx.drawImage(video, 0, 0, workW, workH);
    frames.push({ data: canvasToImageData(drawC), delay: Math.round(1000 / fps) });
    onProgress?.(i + 1, count);
  }
  return frames;
}

/** 探测可用的 MediaRecorder 容器 */
export function pickVideoMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const cands = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264',
    'video/mp4',
    'video/webm',
  ];
  for (const c of cands) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

/**
 * 实时重编码导出视频：canvas.captureStream → MediaRecorder。
 * 播放 [start,end] 区间；画布内容的绘制由调用方的 rAF 负责（含打码/裁剪叠加）。
 * @returns {Promise<{blob:Blob, mime:string}>}
 */
export function exportVideoLive(canvas, video, { start, end, fps = 12, onProgress }) {
  return new Promise((resolve, reject) => {
    const mime = pickVideoMime();
    if (!mime) { reject(new Error('当前浏览器不支持 MediaRecorder')); return; }
    const stream = canvas.captureStream(fps);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    let guard = null;

    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = () => { clearInterval(guard); reject(new Error('录制失败')); };
    rec.onstop = () => {
      clearInterval(guard);
      video.pause();
      resolve({ blob: new Blob(chunks, { type: mime.split(';')[0] }), mime });
    };

    const tick = () => {
      if (video.currentTime >= end || video.ended || video.paused) {
        if (video.currentTime >= end || video.ended) {
          clearInterval(guard);
          rec.stop();
          return;
        }
      }
      onProgress?.(Math.min(1, (video.currentTime - start) / Math.max(0.001, end - start)));
    };

    video.currentTime = start;
    video.play().then(() => {
      rec.start(200);
      guard = setInterval(tick, 150);
    }).catch((e) => reject(new Error('播放失败: ' + e.message)));
  });
}
