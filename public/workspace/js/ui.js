// ui.js — DOM helpers / toast / 下载 / 格式化
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer = null;
export function toast(msg, isErr = false, ms = 2600) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export function fmtBytes(b) {
  if (b == null || !isFinite(b)) return '—';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(2) + ' MB';
}

export function fmtTime(sec) {
  if (!isFinite(sec)) return '0.0s';
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return m > 0 ? `${m}m${s}s` : `${s}s`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyBlob(blob, mime) {
  if (!navigator.clipboard?.write) throw new Error('当前浏览器不支持剪贴板写图片');
  await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
}

export function setStatus(text) {
  $('#statusText').textContent = text;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function el(tag, attrs, text) {
  const e = document.createElement(tag);
  if (typeof attrs === 'string') {
    e.className = attrs;
  } else if (attrs && typeof attrs === 'object') {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === 'className') e.className = v;
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k === 'textContent') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v);
    }
  }
  if (text != null) e.textContent = text;
  return e;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// 把 Blob 交给浏览器解码为位图（createImageBitmap → <img> 兜底）
export async function blobToImageBitmap(blob) {
  try {
    return await createImageBitmap(blob);
  } catch (e) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('图片解码失败'));
        i.src = url;
      });
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  }
}

export function baseName(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}
