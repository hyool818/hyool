/**
 * image-provider.js — 统一生图：comfy（本机）| pollinations（云端）
 */
import {
  getComfyBase,
  setComfyBase,
  pingComfy,
  runWorkflow
} from '/comfy-client.js';

const LS_PROVIDER = 'hyool_img_provider';
const LS_WORKFLOW = 'hyool_comfy_workflow';

export const WORKFLOWS = {
  zit: {
    id: 'zit',
    label: '国风首选（ZIT / 旧环境）',
    url: '/comfy-workflows/zit-guofeng.json'
  },
  krae2: {
    id: 'krae2',
    label: 'krae2 画面优质（新环境）',
    url: '/comfy-workflows/krae2.json'
  }
};

const cache = new Map();

export function getImageProvider() {
  try {
    const v = localStorage.getItem(LS_PROVIDER);
    if (v === 'comfy' || v === 'pollinations') return v;
  } catch (_) {}
  return 'pollinations';
}

export function setImageProvider(p) {
  const v = p === 'comfy' ? 'comfy' : 'pollinations';
  try { localStorage.setItem(LS_PROVIDER, v); } catch (_) {}
  return v;
}

export function getComfyWorkflowId() {
  try {
    const v = localStorage.getItem(LS_WORKFLOW);
    if (v && WORKFLOWS[v]) return v;
  } catch (_) {}
  return 'zit';
}

export function setComfyWorkflowId(id) {
  const v = WORKFLOWS[id] ? id : 'zit';
  try { localStorage.setItem(LS_WORKFLOW, v); } catch (_) {}
  return v;
}

export { getComfyBase, setComfyBase, pingComfy };

async function loadWorkflow(id) {
  const meta = WORKFLOWS[id] || WORKFLOWS.zit;
  if (cache.has(meta.id)) return cache.get(meta.id);
  const res = await fetch(meta.url, { cache: 'no-store' });
  if (!res.ok) throw new Error('加载工作流失败：' + meta.url);
  const json = await res.json();
  cache.set(meta.id, json);
  return json;
}

export function pollinationsUrl(prompt, opts = {}) {
  const w = opts.width || 576;
  const h = opts.height || 1024;
  const seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e6);
  const encoded = encodeURIComponent(String(prompt || 'character portrait'));
  return {
    url: `https://image.pollinations.ai/prompt/${encoded}?width=${w}&height=${h}&nologo=true&model=flux&seed=${seed}`,
    seed,
    provider: 'pollinations'
  };
}

export async function generateImage({ prompt, width, height, seed, workflowId, provider } = {}) {
  const prov = provider || getImageProvider();
  const text = String(prompt || '').trim() ||
    'Adult character portrait, clear face, detailed clothing, cinematic lighting';

  if (prov === 'comfy') {
    const wfId = workflowId || getComfyWorkflowId();
    const graph = await loadWorkflow(wfId);
    const out = await runWorkflow(graph, { prompt: text, width, height, seed });
    return {
      provider: 'comfy',
      workflow: wfId,
      blob: out.blob,
      seed: out.seed,
      filename: out.filename
    };
  }

  const r = pollinationsUrl(text, { width: width || 576, height: height || 1024, seed });
  return { provider: 'pollinations', url: r.url, seed: r.seed };
}

function authToken() {
  try {
    return localStorage.getItem('hyool_token') || localStorage.getItem('hyool_token') || '';
  } catch (_) {
    return '';
  }
}

export async function uploadImageBlob(blob, filename = 'comfy.png') {
  const fd = new FormData();
  const name = filename && /\.(png|jpe?g|webp)$/i.test(filename) ? filename : 'comfy.png';
  const file = new File([blob], name, { type: blob.type || 'image/png' });
  fd.append('file', file);
  const headers = {};
  const t = authToken();
  if (t) headers.Authorization = 'Bearer ' + t;
  const res = await fetch('/api/upload', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: fd
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || '上传失败（' + res.status + '）');
  }
  const url = data.url || data.image_url || (data.id ? '/img/' + data.id : '');
  if (!url) throw new Error('上传成功但未返回图片地址');
  return url;
}

export async function generateAndResolveUrl(opts = {}) {
  const result = await generateImage(opts);
  if (result.provider === 'comfy') {
    const url = await uploadImageBlob(result.blob, result.filename || 'comfy.png');
    return { ...result, url };
  }
  return result;
}

export function mountImageGenSettings(host, { onChange } = {}) {
  if (!host) return null;
  host.innerHTML = '';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px;';

  const provSel = document.createElement('select');
  provSel.innerHTML =
    '<option value="pollinations">云端 Pollinations</option><option value="comfy">本机 ComfyUI</option>';
  provSel.value = getImageProvider();

  const wfSel = document.createElement('select');
  wfSel.innerHTML = Object.values(WORKFLOWS)
    .map((w) => `<option value="${w.id}">${w.label}</option>`)
    .join('');
  wfSel.value = getComfyWorkflowId();

  const baseInp = document.createElement('input');
  baseInp.type = 'text';
  baseInp.placeholder = typeof location !== 'undefined' && location.protocol === 'https:'
    ? 'https://127.0.0.1:8443'
    : 'http://127.0.0.1:8188';
  baseInp.value = getComfyBase();
  baseInp.style.cssText =
    'min-width:180px;flex:1;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.35);color:inherit;';

  const pingBtn = document.createElement('button');
  pingBtn.type = 'button';
  pingBtn.textContent = '检测';
  const status = document.createElement('span');
  status.style.opacity = '0.7';

  function syncVis() {
    const comfy = provSel.value === 'comfy';
    wfSel.style.display = comfy ? '' : 'none';
    baseInp.style.display = comfy ? '' : 'none';
    pingBtn.style.display = comfy ? '' : 'none';
  }
  syncVis();

  const selCss =
    'padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.35);color:inherit;';
  provSel.style.cssText = selCss;
  wfSel.style.cssText = selCss;
  pingBtn.style.cssText =
    'padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(139,139,255,.2);color:inherit;cursor:pointer;';

  provSel.onchange = () => {
    setImageProvider(provSel.value);
    syncVis();
    onChange && onChange();
  };
  wfSel.onchange = () => {
    setComfyWorkflowId(wfSel.value);
    onChange && onChange();
  };
  baseInp.onchange = () => {
    setComfyBase(baseInp.value);
    onChange && onChange();
  };
  pingBtn.onclick = async () => {
    status.textContent = '检测中…';
    setComfyBase(baseInp.value);
    const r = await pingComfy();
    status.textContent = r.ok ? '已连接 ' + r.base : r.error || '失败';
  };

  row.append(provSel, wfSel, baseInp, pingBtn, status);
  host.appendChild(row);

  const tip = document.createElement('div');
  tip.style.cssText = 'margin-top:6px;opacity:0.55;font-size:12px;line-height:1.4;';
  tip.textContent =
    '线上 https：先开 Comfy（常见 :8188 / :8000），再运行 scripts\\start-comfy-bridge.ps1（桥会自动探测端口）。页面走 https://127.0.0.1:8443。本地 http 可直连 Comfy 端口。';
  host.appendChild(tip);
  return { provSel, wfSel, baseInp, status };
}
