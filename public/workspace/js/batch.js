// batch.js — 批量处理：多文件跑同一「处理+压缩」管线
import { loadAsset, processImageData, sourceFrame } from './engine.js';
import { encodeImage } from './codecs.js';
import { FORMATS } from './codecs.js';

/**
 * 处理单个静态文件。
 * @returns {Promise<{name, ok, blob?, bytes?, origBytes?, error?}>}
 */
async function processOne(file, { edits, format, options }) {
  const origBytes = file.size;
  const asset = await loadAsset(file);
  if (asset.kind === 'video') throw new Error('批量暂不支持视频文件');
  if (asset.kind === 'animated') throw new Error('批量暂不支持动图文件');
  const out = await processImageData(sourceFrame(asset), edits);
  const buf = await encodeImage(out, format, options);
  const meta = FORMATS[format] ?? { ext: format };
  return {
    name: asset.name.replace(/\.[^.]+$/, '') + '.' + meta.ext,
    ok: true,
    blob: new Blob([buf], { type: meta.mime }),
    bytes: buf.byteLength,
    origBytes,
    width: out.width,
    height: out.height,
  };
}

/**
 * 运行批量任务。
 * @param {{file:File}[]} items
 * @param {{edits:object, format:string, options:object, concurrency?:number}} config
 * @param {{onProgress:(done:number,total:number,item:any)=>void}} hooks
 */
export async function runBatch(items, config, hooks = {}) {
  const { onProgress = () => {}, onItem = () => {} } = hooks;
  const concurrency = config.concurrency ?? 2;
  const results = new Array(items.length);
  let done = 0;
  const queue = items.map((it, i) => ({ it, i }));

  async function worker() {
    while (queue.length) {
      const { it, i } = queue.shift();
      onItem(i, { status: 'running' });
      try {
        const r = await processOne(it.file, config);
        results[i] = { ...r, item: it };
        onItem(i, { status: 'done', result: r });
      } catch (e) {
        results[i] = { name: it.file.name, ok: false, error: e.message || String(e), item: it, origBytes: it.file.size };
        onItem(i, { status: 'error', error: results[i].error });
      }
      done++;
      onProgress(done, items.length, results[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
