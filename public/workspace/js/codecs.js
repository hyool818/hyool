// codecs.js — 本地 vendored 编解码器适配层
// 依赖 wasm-feature-detect（由 workspace.html 的 import map 解析）
import * as webp from '../vendor/jsquash/webp/index.js';
import * as avif from '../vendor/jsquash/avif/index.js';
import * as jpeg from '../vendor/jsquash/jpeg/index.js';
import * as png from '../vendor/jsquash/png/index.js';
import * as oxipng from '../vendor/jsquash/oxipng/index.js';
import resizeDefault from '../vendor/jsquash/resize/index.js';

export const FORMATS = {
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP' },
  avif: { mime: 'image/avif', ext: 'avif', label: 'AVIF' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG' },
  png: { mime: 'image/png', ext: 'png', label: 'PNG' },
};

/**
 * 把 ImageData 编码为 ArrayBuffer
 * @param {ImageData} imageData
 * @param {'webp'|'avif'|'jpeg'|'png'} format
 * @param {object} opts {quality, lossless, effort, pngOptimise, pngLevel}
 */
export async function encodeImage(imageData, format, opts = {}) {
  const { quality = 75, lossless = false, effort = 4, pngOptimise = false, pngLevel = 2 } = opts;
  switch (format) {
    case 'webp':
      return webp.encode(imageData, { quality, lossless: lossless ? 1 : 0, method: effort });
    case 'avif':
      return avif.encode(imageData, { quality, lossless: lossless ? 1 : 0, effort });
    case 'jpeg': {
      return jpeg.encode(imageData, { quality });
    }
    case 'png': {
      let buf = await png.encode(imageData, { bitDepth: 8 });
      if (pngOptimise) buf = await oxipng.optimise(buf, { level: pngLevel, interlace: 0, optimiseAlpha: true });
      return buf;
    }
    default:
      throw new Error('未知输出格式: ' + format);
  }
}

export async function resizeImage(imageData, { width, height, method = 'lanczos3' }) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (w === imageData.width && h === imageData.height) return imageData;
  return resizeDefault(imageData, {
    width: w,
    height: h,
    method,
    fitMethod: 'stretch',
    premultiply: true,
    linearRGB: true,
  });
}

// 预加载各编解码器（首用才真正编译/下载 wasm，这里触发热身）
export function warmUp() {
  return Promise.allSettled([
    webp.encode(new ImageData(new Uint8ClampedArray(4), 1, 1), { quality: 50 }),
    jpeg.encode(new ImageData(new Uint8ClampedArray(4), 1, 1), { quality: 50 }),
  ]);
}
