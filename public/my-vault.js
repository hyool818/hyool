import { $, toast } from '/workspace/js/ui.js';
import { vaultAuthHeaders, vaultLoggedIn, fetchMyVault, deleteVaultItem, formatBytes } from '/my-vault-api.js';

const FILTERS = [
  ['all', '全部'],
  ['image', '图片'],
  ['video', '视频'],
  ['audio', '音频'],
];

let catFilter = 'all';

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
        img.src = a.url;
        img.alt = '';
        img.loading = 'lazy';
        thumb.appendChild(img);
      } else if (a.type === 'video') {
        const v = document.createElement('video');
        v.src = a.url;
        v.muted = true;
        v.playsInline = true;
        v.preload = 'metadata';
        thumb.appendChild(v);
      } else {
        const ic = document.createElement('div');
        ic.className = 'ic';
        ic.textContent = '♪';
        thumb.appendChild(ic);
      }
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = '<b>' + (a.type === 'audio' ? '音频' : a.type === 'video' ? '视频' : '图片') + '</b>'
        + formatBytes(a.byteSize) + '<br>' + (a.createdAt || '').slice(0, 16);
      card.append(del, thumb, meta);
      card.addEventListener('click', () => {
        navigator.clipboard && navigator.clipboard.writeText(a.url).then(() => toast('已复制地址 ' + a.url)).catch(() => toast(a.url));
      });
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
