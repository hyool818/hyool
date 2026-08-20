// engine.js — 核心管线：画布运算 / 处理 / 素材模型
import { resizeImage } from './codecs.js';
import { blobToImageBitmap } from './ui.js';
import { decodeGif, decodeApng, decodeAnimWebp } from './anim.js';
import { setupVideoAsset } from './video.js';

export const MAX_DIM = 5000; // 解码上限（内存保护）

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function imageDataToCanvas(img) {
  const c = makeCanvas(img.width, img.height);
  c.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0);
  return c;
}

export function canvasToImageData(c, x = 0, y = 0, w = c.width, h = c.height) {
  return c.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h);
}

export function imageDataFromBitmap(bmp) {
  const c = makeCanvas(bmp.width, bmp.height);
  c.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
  return canvasToImageData(c);
}

/** 解码任意静态图 Blob → ImageData（带最大尺寸保护） */
export async function decodeImageBlob(blob) {
  const bmp = await blobToImageBitmap(blob);
  try {
    let w = bmp.width, h = bmp.height;
    const scale = Math.min(1, MAX_DIM / Math.max(w, h));
    if (scale < 1) { w = Math.round(w * scale); h = Math.round(h * scale); }
    const c = makeCanvas(w, h);
    c.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0, w, h);
    return canvasToImageData(c);
  } finally {
    if (typeof bmp.close === 'function') bmp.close();
  }
}

/* ---------------- 素材加载 ---------------- */

export function guessKind(file) {
  const n = file.name.toLowerCase();
  if (file.type.startsWith('video/') || /\.(mp4|webm|mov|ogg)$/.test(n)) return 'video';
  if (file.type === 'image/gif' || /\.gif$/.test(n)) return 'gif';
  if (file.type === 'image/apng' || /\.apng$/.test(n)) return 'apng';
  if (file.type === 'image/webp' || /\.webp$/.test(n)) return 'webp';
  return 'image';
}

/**
 * 把 File 加载为内部素材模型。
 * @returns {Promise<object>} {kind:'image'|'animated'|'video', name, mime, size,
 *   width, height, imageData?, frames?, loop?, videoEl?, duration?}
 */
export async function loadAsset(file) {
  const kind = guessKind(file);
  const base = { name: file.name, mime: file.type || '', size: file.size, src: file };

  if (kind === 'video') return setupVideoAsset(base);

  const buffer = await file.arrayBuffer();
  if (kind === 'gif') {
    const g = await decodeGif(buffer);
    if (g.frames.length > 1) return { ...base, kind: 'animated', width: g.width, height: g.height, frames: g.frames, loop: g.loop };
    return { ...base, kind: 'image', width: g.width, height: g.height, imageData: g.frames[0].data };
  }
  if (kind === 'apng') {
    const a = await decodeApng(buffer);
    if (a.frames.length > 1) return { ...base, kind: 'animated', width: a.width, height: a.height, frames: a.frames, loop: a.loop ?? 0 };
    return { ...base, kind: 'image', width: a.width, height: a.height, imageData: a.frames[0].data };
  }
  if (kind === 'webp') {
    const anim = await decodeAnimWebp(buffer);
    if (anim) return { ...base, kind: 'animated', width: anim.width, height: anim.height, frames: anim.frames, loop: anim.loop ?? 0 };
    // 静态 WebP：交给浏览器位图解码
    const img = await decodeImageBlob(new Blob([buffer], { type: 'image/webp' }));
    return { ...base, kind: 'image', width: img.width, height: img.height, imageData: img };
  }
  const img = await decodeImageBlob(new Blob([buffer], { type: file.type || undefined }));
  return { ...base, kind: 'image', width: img.width, height: img.height, imageData: img };
}

/* ---------------- 几何编辑 ---------------- */

export function cropImageData(img, x, y, w, h) {
  const c = makeCanvas(w, h);
  c.getContext('2d', { willReadFrequently: true }).drawImage(imageDataToCanvas(img), x, y, w, h, 0, 0, w, h);
  return canvasToImageData(c);
}

export function rotateImageData(img, deg, flipH, flipV) {
  if ((deg || 0) % 360 === 0 && !flipH && !flipV) return img;
  const rad = (deg % 360) * Math.PI / 180;
  const swap = (deg % 180) !== 0;
  const w = swap ? img.height : img.width;
  const h = swap ? img.width : img.height;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rad);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(imageDataToCanvas(img), -img.width / 2, -img.height / 2);
  return canvasToImageData(c);
}

/**
 * 打码区域绘制（画布版，用于视频逐帧叠加）。
 * regions: [{x,y,w,h,type:'mosaic'|'blur',strength}] 归一化坐标（相对 canvas 尺寸）。
 */
export function applyMosaicToCanvas(canvas, regions) {
  if (!regions || !regions.length) return canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const W = canvas.width, H = canvas.height;
  for (const r of regions) {
    const x = r.x * W, y = r.y * H;
    const rw = r.w * W, rh = r.h * H;
    if (rw < 2 || rh < 2) continue;
    const block = Math.max(2, Math.round(r.strength ?? 16));
    if (r.type === 'blur') {
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, rw, rh); ctx.clip();
      ctx.filter = `blur(${Math.min(block, 40)}px)`;
      ctx.drawImage(canvas, x, y, rw, rh, x, y, rw, rh);
      ctx.restore();
    } else {
      const bw = Math.max(1, Math.round(rw / block));
      const bh = Math.max(1, Math.round(rh / block));
      const tmp = makeCanvas(bw, bh);
      tmp.getContext('2d').drawImage(canvas, x, y, rw, rh, 0, 0, bw, bh);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.beginPath(); ctx.rect(x, y, rw, rh); ctx.clip();
      ctx.drawImage(tmp, x, y, rw, rh);
      ctx.restore();
    }
  }
  return canvas;
}

/**
 * 打码区域绘制。regions: [{x,y,w,h,type:'mosaic'|'blur',strength}] 归一化坐标。
 * 马赛克用「降采样再升采样」的经典算法；模糊用 canvas filter。
 */
export function applyMosaicRegions(img, regions) {
  if (!regions || !regions.length) return img;
  return canvasToImageData(applyMosaicToCanvas(imageDataToCanvas(img), regions));
}

/**
 * 主处理管线：输入源帧 → 裁剪 → 旋转/翻转 → 缩放 → 打码 → pad(contain)
 */
export async function processImageData(src, edits) {
  let img = src;
  if (edits.crop) {
    const { x, y, w, h } = edits.crop; // 归一化 0-1
    img = cropImageData(
      img,
      Math.round(x * img.width),
      Math.round(y * img.height),
      Math.max(1, Math.round(w * img.width)),
      Math.max(1, Math.round(h * img.height))
    );
  }
  img = rotateImageData(img, edits.rotate || 0, edits.flipH, edits.flipV);
  if (edits.resize && edits.resize.enabled && edits.resize.width > 0 && edits.resize.height > 0) {
    img = await resizeImage(img, {
      width: edits.resize.width,
      height: edits.resize.height,
      method: edits.resize.method || 'lanczos3',
    });
  }
  if (edits.regions && edits.regions.length) {
    img = applyMosaicRegions(img, edits.regions);
  }
  if (edits.pad) {
    const { w, h, color = 'transparent' } = edits.pad;
    if (img.width !== w || img.height !== h) {
      const c = makeCanvas(w, h);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, w, h);
      if (color && color !== 'transparent') {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(imageDataToCanvas(img), Math.round((w - img.width) / 2), Math.round((h - img.height) / 2));
      img = canvasToImageData(c);
    }
  }
  return img;
}

/** 取素材某一帧的原始 ImageData（视频帧由外部传入） */
export function sourceFrame(asset, frameIndex = 0) {
  if (asset.kind === 'image') return asset.imageData;
  if (asset.kind === 'animated') return asset.frames[frameIndex].data;
  return null;
}

/* ---------------- 视频逐帧绘制（canvas2d，无 wasm 缩放，适合 rAF） ---------------- */

/** 计算视频编辑后的输出尺寸（不含 pad） */
export function videoOutputDims(asset, edits) {
  let w = asset.workW, h = asset.workH;
  if (edits.crop) { w = edits.crop.w * w; h = edits.crop.h * h; }
  if ((edits.rotate || 0) % 180 !== 0) { const t = w; w = h; h = t; }
  if (edits.resize && edits.resize.enabled && edits.resize.width > 0 && edits.resize.height > 0) {
    w = edits.resize.width; h = edits.resize.height;
  }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

/**
 * 把视频当前帧绘制到目标 canvas（尺寸=canvas.width/height）。
 * 一次 drawImage 完成 裁剪+旋转+翻转+缩放；最后叠加打码区域。
 */
export function drawVideoFrameToCanvas(canvas, video, workW, workH, edits) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const outW = canvas.width, outH = canvas.height;
  ctx.save();
  ctx.clearRect(0, 0, outW, outH);
  const sx = (edits.crop?.x ?? 0) * workW;
  const sy = (edits.crop?.y ?? 0) * workH;
  const sw = (edits.crop?.w ?? 1) * workW;
  const sh = (edits.crop?.h ?? 1) * workH;
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate(((edits.rotate || 0) % 360) * Math.PI / 180);
  ctx.scale(edits.flipH ? -1 : 1, edits.flipV ? -1 : 1);
  ctx.translate(-outW / 2, -outH / 2);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
  ctx.restore();
  applyMosaicToCanvas(canvas, edits.regions);
  return canvas;
}


