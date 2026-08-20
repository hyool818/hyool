// ai.js — AI 抠图（@imgly/background-removal，懒加载自 jsDelivr ESM）
// 模型在首次使用时从 img.ly CDN 下载（约 40MB），之后由浏览器 IndexedDB 缓存。
import { makeCanvas, canvasToImageData } from './engine.js';

const CDN_URL = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';

let modulePromise = null;
function loadLib() {
  if (!modulePromise) {
    modulePromise = import(/* @vite-ignore */ CDN_URL);
  }
  return modulePromise;
}

/**
 * 移除 ImageData 的背景，返回带 alpha 的新 ImageData。
 * @param {ImageData} imageData
 * @param {{onProgress:(p:number, stage:string)=>void}} opts
 */
export async function removeBackgroundFromImageData(imageData, { onProgress } = {}) {
  const canvas = makeCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.putImageData(imageData, 0, 0);

  const { removeBackground } = await loadLib();
  const blob = await removeBackground(canvas.toDataURL('image/png'), {
    device: 'cpu',
    progress: (key, current, total) => {
      const p = total > 0 ? current / total : 0;
      onProgress?.(p, key);
    },
    output: { format: 'image/png', quality: 1 },
  });

  const bmp = await createImageBitmap(blob);
  try {
    const c = makeCanvas(bmp.width, bmp.height);
    c.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
    const img = canvasToImageData(c);
    // 尺寸可能因模型对齐有 ±几像素差异，统一回到输入尺寸
    if (img.width !== imageData.width || img.height !== imageData.height) {
      const c2 = makeCanvas(imageData.width, imageData.height);
      c2.getContext('2d', { willReadFrequently: true }).drawImage(c, 0, 0, imageData.width, imageData.height);
      return canvasToImageData(c2);
    }
    return img;
  } finally {
    bmp.close?.();
  }
}

export function libLoaded() {
  return !!modulePromise;
}
