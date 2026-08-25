// comfy-client.js — 浏览器直连本机 ComfyUI（默认 :8000）
// Workers 打不到 localhost；须用 http 打开本站（非 https 线上页）。

const DEFAULT_BASE = 'http://127.0.0.1:8000';
const LS_BASE = 'hyool_comfy_base';

export function getComfyBase() {
  try {
    const v = localStorage.getItem(LS_BASE);
    if (v && /^https?:\/\//i.test(v)) return v.replace(/\/$/, '');
  } catch (_) {}
  return DEFAULT_BASE;
}

export function setComfyBase(url) {
  const u = String(url || '').trim().replace(/\/$/, '');
  if (!u) {
    try { localStorage.removeItem(LS_BASE); } catch (_) {}
    return DEFAULT_BASE;
  }
  try { localStorage.setItem(LS_BASE, u); } catch (_) {}
  return u;
}

function mixedContentHint() {
  if (typeof location !== 'undefined' && location.protocol === 'https:') {
    return '当前页面是 https，浏览器会拦截访问本机 http ComfyUI。请用 wrangler 以 http://127.0.0.1 打开本站后再试。';
  }
  return '';
}

export async function pingComfy(base) {
  const root = (base || getComfyBase()).replace(/\/$/, '');
  try {
    const res = await fetch(root + '/system_stats', { method: 'GET', mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return { ok: true, base: root };
  } catch (e) {
    const hint = mixedContentHint();
    return {
      ok: false,
      base: root,
      error: (hint || '无法连接 ComfyUI') + '（' + (e.message || e) + '）。确认桌面版已启动且端口为 ' + root
    };
  }
}

function clientId() {
  try {
    let id = sessionStorage.getItem('hyool_comfy_cid');
    if (!id) {
      id = 'hyool_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('hyool_comfy_cid', id);
    }
    return id;
  } catch (_) {
    return 'hyool_' + Date.now();
  }
}

function isSeedNode(node) {
  const t = String(node.class_type || '');
  return /seed/i.test(t) && ('seed' in (node.inputs || {}));
}

/** 注入提示词 / 尺寸 / 种子。节点 id 与国风首选、krae2 工作流对齐。 */
export function patchWorkflow(workflow, { prompt, width, height, seed } = {}) {
  const graph = JSON.parse(JSON.stringify(workflow || {}));
  const text = String(prompt || '').trim();
  if (text && graph['627'] && graph['627'].inputs) {
    graph['627'].inputs.text = text;
  }
  const w = Number(width) > 0 ? Math.round(Number(width)) : 0;
  const h = Number(height) > 0 ? Math.round(Number(height)) : 0;
  if (w && h && graph['698'] && graph['698'].inputs) {
    graph['698'].inputs.width = w;
    graph['698'].inputs.height = h;
  }
  const s = seed == null || seed === '' ? Math.floor(Math.random() * 1e15) : Number(seed);
  if (graph['649'] && graph['649'].inputs && 'seed' in graph['649'].inputs) {
    graph['649'].inputs.seed = s;
  }
  for (const node of Object.values(graph)) {
    if (!node || !node.inputs) continue;
    if (isSeedNode(node)) node.inputs.seed = s;
  }
  return { graph, seed: s };
}

export async function queuePrompt(workflow, opts = {}) {
  const base = (opts.base || getComfyBase()).replace(/\/$/, '');
  const { graph, seed } = patchWorkflow(workflow, opts);
  const res = await fetch(base + '/prompt', {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: clientId() })
  });
  if (!res.ok) {
    const peek = await res.text().catch(() => '');
    throw new Error('ComfyUI 投递失败（' + res.status + '）：' + peek.slice(0, 120));
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  if (!data.prompt_id) throw new Error('ComfyUI 未返回 prompt_id');
  return { promptId: data.prompt_id, seed, base };
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function waitForImages(promptId, opts = {}) {
  const base = (opts.base || getComfyBase()).replace(/\/$/, '');
  const timeoutMs = opts.timeoutMs || 300000;
  const intervalMs = opts.intervalMs || 1200;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(base + '/history/' + encodeURIComponent(promptId), { mode: 'cors' });
    if (res.ok) {
      const hist = await res.json();
      const entry = hist[promptId];
      if (entry && entry.outputs) {
        const images = [];
        for (const out of Object.values(entry.outputs)) {
          if (out && Array.isArray(out.images)) {
            for (const im of out.images) images.push(im);
          }
        }
        if (images.length) return images;
      }
    }
    await sleep(intervalMs);
  }
  throw new Error('ComfyUI 出图超时，请在桌面版查看队列是否报错。');
}

export async function fetchImageBlob(imageInfo, opts = {}) {
  const base = (opts.base || getComfyBase()).replace(/\/$/, '');
  const q = new URLSearchParams({
    filename: imageInfo.filename,
    subfolder: imageInfo.subfolder || '',
    type: imageInfo.type || 'output'
  });
  const res = await fetch(base + '/view?' + q.toString(), { mode: 'cors' });
  if (!res.ok) throw new Error('拉取出图失败（' + res.status + '）');
  return await res.blob();
}

export async function runWorkflow(workflow, opts = {}) {
  const ping = await pingComfy(opts.base);
  if (!ping.ok) throw new Error(ping.error || 'ComfyUI 未连接');
  const { promptId, seed, base } = await queuePrompt(workflow, { ...opts, base: ping.base });
  const images = await waitForImages(promptId, { ...opts, base });
  const blob = await fetchImageBlob(images[0], { base });
  return { blob, seed, filename: images[0].filename, promptId };
}
