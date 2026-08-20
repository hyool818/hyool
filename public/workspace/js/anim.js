// anim.js — 动图：GIF(omggif+gifenc) / APNG(UPNG) / 动 WebP(ImageDecoder)
import { makeCanvas, canvasToImageData, MAX_DIM } from './engine.js';
import { GIFEncoder, quantize, applyPalette } from '../vendor/gifenc/gifenc.esm.js';

/* ---------------- GIF 解码 ---------------- */

export async function decodeGif(buffer) {
  const { GifReader } = window;
  if (!GifReader) throw new Error('GIF 解码器未加载');
  const bytes = new Uint8Array(buffer);
  const reader = new GifReader(bytes);
  const width = reader.width, height = reader.height;
  const numFrames = reader.numFrames();

  // 解码上限保护：过大的 GIF 帧按比例缩小后再进入工作区
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  const W = Math.max(1, Math.round(width * scale));
  const H = Math.max(1, Math.round(height * scale));

  const full = new Uint8Array(W * H * 4); // 合成的整帧 RGBA（累加态）
  const scratch = new Uint8Array(width * height * 4);
  const frames = [];
  let before = null; // 上一帧绘制前的画布快照（disposal=3 恢复用）

  for (let i = 0; i < numFrames; i++) {
    const info = reader.frameInfo(i);
    // 处理上一帧的 disposal
    if (i > 0) {
      const prevInfo = reader.frameInfo(i - 1);
      if (prevInfo.disposal_type === 2) { // 恢复背景 → 清空上一帧矩形
        const px = Math.round(prevInfo.x * scale), py = Math.round(prevInfo.y * scale);
        const pw = Math.round(prevInfo.width * scale), ph = Math.round(prevInfo.height * scale);
        for (let yy = py; yy < Math.min(H, py + ph); yy++) {
          const row = yy * W + px;
          for (let xx = 0; xx < Math.min(W - px, pw); xx++) {
            full[(row + xx) * 4 + 3] = 0;
            full[(row + xx) * 4] = full[(row + xx) * 4 + 1] = full[(row + xx) * 4 + 2] = 0;
          }
        }
      } else if (prevInfo.disposal_type === 3 && before) { // 恢复之前画面（上一帧绘制前）
        full.set(before);
      }
    }
    before = full.slice();
    scratch.fill(0);
    reader.decodeAndBlitFrameRGBA(i, scratch);

    // 合成到 full：按 scale 缩放绘制（最近邻）
    if (scale === 1) {
      for (let yy = 0; yy < height; yy++) {
        for (let xx = 0; xx < width; xx++) {
          const si = (yy * width + xx) * 4;
          if (scratch[si + 3] > 0) {
            const di = (yy * W + xx) * 4;
            full[di] = scratch[si]; full[di + 1] = scratch[si + 1];
            full[di + 2] = scratch[si + 2]; full[di + 3] = 255;
          }
        }
      }
    } else {
      for (let yy = 0; yy < H; yy++) {
        for (let xx = 0; xx < W; xx++) {
          const si = (Math.floor(yy / scale) * width + Math.floor(xx / scale)) * 4;
          if (scratch[si + 3] > 0) {
            const di = (yy * W + xx) * 4;
            full[di] = scratch[si]; full[di + 1] = scratch[si + 1];
            full[di + 2] = scratch[si + 2]; full[di + 3] = 255;
          }
        }
      }
    }

    const data = new ImageData(new Uint8ClampedArray(full.buffer.slice(0)), W, H);
    frames.push({ data, delay: info.delay * 10 }); // omggif 的 delay 单位是 1/100s
  }

  return { width: W, height: H, frames, loop: reader.loopCount() || 0 };
}

/* ---------------- GIF 编码（gifenc） ---------------- */

function quantizeFrame(rgba, w, h) {
  const palette = quantize(rgba, 256, { format: 'rgb565' });
  const index = applyPalette(rgba, palette);
  const out = new Uint8Array(w * h);
  let hasAlpha = false;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) { hasAlpha = true; break; }
  }
  if (hasAlpha) {
    // 透明像素统一映射到 index 0（调色板首位强制为黑色=透明）
    palette.unshift([0, 0, 0]);
    for (let i = 0; i < w * h; i++) out[i] = index[i] + 1;
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      if (rgba[p + 3] < 128) out[i] = 0;
    }
  } else {
    out.set(index);
  }
  return { palette, index: out, hasAlpha };
}

/**
 * 编码 GIF。
 * @param {{data:ImageData}[]} frames
 * @param {{delay:number, loop:boolean, onProgress:(i:number,n:number)=>void}} opts
 */

/* ---------------- APNG（UPNG） ---------------- */

export async function decodeApng(buffer) {
  const UPNG = window.UPNG;
  if (!UPNG) throw new Error('APNG 解码器未加载');
  const out = UPNG.decode(new Uint8Array(buffer));
  const bufs = UPNG.toRGBA8(out);
  const w = out.width, h = out.height;
  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  const W = Math.max(1, Math.round(w * scale));
  const H = Math.max(1, Math.round(h * scale));
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const frames = bufs.map((buf, i) => {
    if (scale === 1) {
      return { data: new ImageData(new Uint8ClampedArray(buf), w, h), delay: out.frames?.[i]?.delay ?? 100 };
    }
    ctx.putImageData(new ImageData(new Uint8ClampedArray(buf), w, h), 0, 0);
    const c2 = makeCanvas(W, H);
    c2.getContext('2d', { willReadFrequently: true }).drawImage(c, 0, 0, W, H);
    return { data: canvasToImageData(c2), delay: out.frames?.[i]?.delay ?? 100 };
  });
  return { width: W, height: H, frames, loop: 0 };
}

/**
 * 编码 APNG。delay 单位 ms（UPNG 内部换算）。返回 ArrayBuffer。
 */
export async function encodeApng(frames, delay = 100) {
  const UPNG = window.UPNG;
  const w = frames[0].data.width, h = frames[0].data.height;
  const bufs = frames.map(f => f.data.data.buffer);
  const dels = frames.map(() => delay);
  const ab = UPNG.encode(bufs, w, h, 256, dels, 0);
  return ab;
}

/* ---------------- 动 WebP（ImageDecoder，Chrome/Edge） ---------------- */

export function supportsImageDecoder() {
  return typeof ImageDecoder !== 'undefined';
}

export async function decodeAnimWebp(buffer) {
  if (!supportsImageDecoder()) return null;
  try {
    const decoder = new ImageDecoder({ data: buffer, type: 'image/webp' });
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track || track.frameCount <= 1) return null;
    const frames = [];
    const times = [];
    for (let i = 0; i < track.frameCount; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      const c = makeCanvas(image.displayWidth, image.displayHeight);
      c.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0);
      frames.push({ data: canvasToImageData(c), delay: 100 });
      times.push(image.duration ?? 100);
      image.close?.();
    }
    frames.forEach((f, i) => { f.delay = times[i] > 0 ? Math.round(times[i]) : 100; });
    decoder.close();
    if (!frames.length) return null;
    return { width: frames[0].data.width, height: frames[0].data.height, frames, loop: 0 };
  } catch (e) {
    console.warn('动 WebP 解码失败，按静态处理:', e);
    return null;
  }
}

/* ---------------- 静态图（供动图导出「当前帧」用） ---------------- */

export function frameToBlobUrl(frame) {
  const c = makeCanvas(frame.data.width, frame.data.height);
  c.getContext('2d').putImageData(frame.data, 0, 0);
  return c.toDataURL('image/png');
}

export function encodeGif(frames, { delay = 100, loop = true, onProgress } = {}) {
  const w = frames[0].data.width, h = frames[0].data.height;
  const gif = GIFEncoder();
  let first = true;
  frames.forEach((f, i) => {
    const rgba = f.data.data;
    const { palette, index, hasAlpha } = quantizeFrame(rgba, w, h);
    gif.writeFrame(index, w, h, {
      palette,
      delay,
      transparent: hasAlpha,
      transparentIndex: 0,
      dispose: 1,
      repeat: first ? (loop ? 0 : -1) : undefined,
      first,
    });
    first = false;
    onProgress?.(i + 1, frames.length);
  });
  gif.finish();
  return gif.bytes();
}
