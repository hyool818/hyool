import { $, toast } from '/workspace/js/ui.js';
import { vaultAuthHeaders, vaultLoggedIn, fetchMyVault, deleteVaultItem, formatBytes } from '/my-vault-api.js';

const FILTERS = [
  ['all', '全部'],
  ['image', '图片'],
  ['video', '视频'],
  ['audio', '音频'],
];

const MAX_IMG_LOADS = 2;
let catFilter = 'all';
let imgLoading = 0;
const imgWait = [];
let vaultObserver = null;
let lbItem = null;

function resolveBackHref() {
  const from = new URLSearchParams(location.search).get('from');
  if (from && from.charAt(0) === '/' && from.charAt(1) !== '/') return from;
  try {
    const ref = document.referrer ? new URL(document.referrer) : null;
    if (ref && ref.origin === location.origin) {
      const p = ref.pathname;
      if (p === '/studio-world.html' || p === '/studio-world') return p + ref.search;
      if (p.startsWith('/@')) return p + ref.search;
    }
  } catch { /* ignore */ }
  return '/studio-world.html';
}

function setupBackNav() {
  const el = document.getElementById('vaultBack');
  if (!el) return;
  el.href = resolveBackHref();
  el.textContent = '← 返回';
}

function scheduleImgLoad(img, url) {
  imgWait.push(() => {
    imgLoading++;
    const done = () => {
      imgLoading = Math.max(0, imgLoading - 1);
      pumpImgQueue();
    };
    img.addEventListener('load', () => {
      img.classList.add('is-loaded');
      done();
    }, { once: true });
    img.addEventListener('error', done, { once: true });
    img.src = url;
  });
  pumpImgQueue();
}

function pumpImgQueue() {
  while (imgLoading < MAX_IMG_LOADS && imgWait.length) {
    const run = imgWait.shift();
    if (run) run();
  }
}

function observeThumb(img, url) {
  img.dataset.src = url;
  img.alt = '';
  img.decoding = 'async';
  if (!vaultObserver) {
    vaultObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        vaultObserver.unobserve(el);
        const u = el.dataset.src;
        delete el.dataset.src;
        if (u) scheduleImgLoad(el, u);
      });
    }, { rootMargin: '100px' });
  }
  vaultObserver.observe(img);
}

function typeLabel(type) {
  if (type === 'audio') return '音频';
  if (type === 'video') return '视频';
  return '图片';
}

function closeVaultLightbox() {
  const lb = $('#vaultLightbox');
  const media = $('#vaultLbMedia');
  if (!lb) return;
  lb.classList.remove('show');
  lb.setAttribute('aria-hidden', 'true');
  if (media) {
    media.querySelectorAll('video, audio').forEach((el) => {
      try { el.pause(); } catch { /* ignore */ }
    });
    media.innerHTML = '';
  }
  lbItem = null;
}

function openVaultLightbox(item) {
  if (!item || !item.url) return;
  const lb = $('#vaultLightbox');
  const media = $('#vaultLbMedia');
  const info = $('#vaultLbInfo');
  const openA = $('#vaultLbOpen');
  if (!lb || !media) return;
  lbItem = item;
  media.innerHTML = '';
  if (item.type === 'video') {
    const v = document.createElement('video');
    v.src = item.url;
    v.controls = true;
    v.playsInline = true;
    v.preload = 'metadata';
    media.appendChild(v);
    v.play().catch(() => {});
  } else if (item.type === 'audio') {
    const a = document.createElement('audio');
    a.src = item.url;
    a.controls = true;
    a.preload = 'metadata';
    media.appendChild(a);
    a.play().catch(() => {});
  } else {
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = '原图';
    media.appendChild(img);
  }
  if (info) {
    info.textContent = typeLabel(item.type) + ' · ' + formatBytes(item.byteSize)
      + (item.createdAt ? ' · ' + String(item.createdAt).slice(0, 16) : '');
  }
  if (openA) {
    openA.href = item.url;
    openA.style.display = item.type === 'audio' ? 'none' : '';
  }
  lb.classList.add('show');
  lb.setAttribute('aria-hidden', 'false');
}

function bindLightbox() {
  const lb = $('#vaultLightbox');
  if (!lb || lb.dataset.bound) return;
  lb.dataset.bound = '1';
  const close = () => closeVaultLightbox();
  $('#vaultLbClose')?.addEventListener('click', (e) => { e.stopPropagation(); close(); });
  $('#vaultLbClose2')?.addEventListener('click', (e) => { e.stopPropagation(); close(); });
  lb.addEventListener('click', (e) => {
    if (e.target === lb) close();
  });
  $('#vaultLbInner')?.addEventListener('click', (e) => e.stopPropagation());
  $('#vaultLbCopy')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!lbItem?.url) return;
    navigator.clipboard?.writeText(lbItem.url)
      .then(() => toast('已复制地址'))
      .catch(() => toast(lbItem.url));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lb.classList.contains('show')) close();
  });
}

async function uploadFile(file) {
  if (!file || !file.size) return null;
  if (file.size > 5 * 1024 * 1024) { toast('文件过大（限 5MB）', true); return null; }
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', credentials: 'include', headers: vaultAuthHeaders(), body: fd });
  const data = await res.json();
  if (!res.ok || !data.success) {
    toast(data.error || '上传失败', true);
    return null;
  }
  toast('已存入专属库' + (data.storage === 'r2' ? '（云端）' : ''));
  return data;
}

function renderFilters() {
  const host = $('#vaultFilters');
  if (!host) return;
  host.innerHTML = '';
  FILTERS.forEach(([id, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn tiny' + (catFilter === id ? ' on' : '');
    b.textContent = label;
    b.addEventListener('click', () => { catFilter = id; renderFilters(); loadVault(); });
    host.appendChild(b);
  });
}

async function loadVault() {
  const grid = $('#vaultGrid');
  const empty = $('#vaultEmpty');
  if (!grid) return;
  if (vaultObserver) {
    vaultObserver.disconnect();
    vaultObserver = null;
  }
  imgWait.length = 0;
  grid.innerHTML = '<div class="vault-empty">加载中…</div>';
  try {
    const items = await fetchMyVault(catFilter);
    grid.innerHTML = '';
    if (!items.length) {
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');
    items.forEach((a) => {
      const card = document.createElement('div');
      card.className = 'vault-card';
      card.title = '点击查看原' + (a.type === 'video' ? '视频' : a.type === 'audio' ? '音频' : '图');
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.textContent = '删除';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('从专属库永久删除？\n已挂在作品里的链接会失效。')) return;
        try {
          await deleteVaultItem(a.id);
          toast('已删除');
          loadVault();
        } catch (err) {
          toast(err.message || '删除失败', true);
        }
      });
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      if (a.type === 'image') {
        const img = document.createElement('img');
        observeThumb(img, a.url);
        thumb.appendChild(img);
      } else if (a.type === 'video') {
        const v = document.createElement('video');
        v.className = 'vault-thumb-vid';
        v.src = a.url;
        v.muted = true;
        v.playsInline = true;
        v.preload = 'metadata';
        v.setAttribute('aria-hidden', 'true');
        thumb.appendChild(v);
      } else {
        const ic = document.createElement('div');
        ic.className = 'ic';
        ic.textContent = '♪';
        thumb.appendChild(ic);
      }
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = '<b>' + typeLabel(a.type) + '</b>'
        + formatBytes(a.byteSize) + '<br>' + (a.createdAt || '').slice(0, 16);
      card.append(del, thumb, meta);
      card.addEventListener('click', () => openVaultLightbox(a));
      grid.appendChild(card);
    });
  } catch (e) {
    grid.innerHTML = '';
    if (empty) {
      empty.textContent = e.message || '加载失败';
      empty.classList.remove('hidden');
    }
  }
}

function init() {
  setupBackNav();
  bindLightbox();
  const login = $('#vaultLogin');
  const app = $('#vaultApp');
  if (!vaultLoggedIn()) {
    login && login.classList.remove('hidden');
    app && app.classList.add('hidden');
    return;
  }
  login && login.classList.add('hidden');
  app && app.classList.remove('hidden');
  renderFilters();
  loadVault();
  const upBtn = $('#vaultUploadBtn');
  const fileIn = $('#vaultFileInput');
  if (upBtn && fileIn) {
    upBtn.addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', async () => {
      const file = fileIn.files && fileIn.files[0];
      fileIn.value = '';
      if (!file) return;
      upBtn.disabled = true;
      upBtn.textContent = '上传中…';
      await uploadFile(file);
      upBtn.disabled = false;
      upBtn.textContent = '＋ 上传素材';
      loadVault();
    });
  }
}

init();
