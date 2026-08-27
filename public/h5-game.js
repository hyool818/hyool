import { $, toast } from '/workspace/js/ui.js';

const TOKEN_KEY = 'hyool_token';
let loggedIn = false;
let games = [];
let current = null;
let coverUrl = '';

function authHeaders() {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t ? { Authorization: 'Bearer ' + t } : {};
  } catch (e) { return {}; }
}

function normalizePlayUrl(raw) {
  const u = String(raw || '').trim();
  if (!u) return '';
  if (u.startsWith('/img/') || u.startsWith('/api/')) return u.slice(0, 2000);
  try {
    const parsed = new URL(u, location.origin);
    if (parsed.protocol === 'https:') return parsed.href.slice(0, 2000);
    if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
      return parsed.href.slice(0, 2000);
    }
  } catch (e) { /* ignore */ }
  return '';
}

function normalizeH5(story) {
  if (!story || story.kind !== 'h5_game') return null;
  const h5 = story.h5 && typeof story.h5 === 'object' ? story.h5 : {};
  return {
    id: story.id,
    title: story.title || '未名游戏',
    cover_image: story.cover_image || '',
    status: story.status || 'draft',
    share_id: story.share_id || '',
    orientation: story.orientation === 'portrait' ? 'portrait' : 'landscape',
    h5: {
      playUrl: String(h5.playUrl || '').trim(),
      description: String(h5.description || '').trim().slice(0, 200),
    },
  };
}

function showList() {
  $('#h5ListView')?.classList.remove('hidden');
  $('#h5ListApp')?.classList.toggle('hidden', !loggedIn);
  $('#h5EditView')?.classList.add('hidden');
  $('#h5Back').href = '/fantasy.html';
  location.hash = '';
}

function showEdit(id) {
  current = games.find(g => g.id === id) || null;
  if (!current) { showList(); return; }
  $('#h5ListView')?.classList.add('hidden');
  $('#h5ListApp')?.classList.add('hidden');
  $('#h5EditView')?.classList.remove('hidden');
  $('#h5Back').href = '/h5-game.html';
  location.hash = 'edit=' + encodeURIComponent(id);

  $('#h5Title').value = current.title;
  coverUrl = current.cover_image || '';
  renderCoverPreview();
  $('#h5PlayUrl').value = current.h5.playUrl || '';
  $('#h5Desc').value = current.h5.description || '';
  $('#h5OrientPick').querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', b.dataset.o === current.orientation);
  });
  updateStatusLine();
}

function renderCoverPreview() {
  const box = $('#h5CoverPreview');
  if (!box) return;
  if (coverUrl) {
    box.innerHTML = '<img src="' + coverUrl.replace(/"/g, '&quot;') + '" alt="">';
  } else {
    box.innerHTML = '<span class="ic">🎮</span>';
  }
}

function updateStatusLine() {
  const el = $('#h5StatusLine');
  if (!el || !current) return;
  const pub = current.status === 'published';
  el.textContent = pub
    ? '已发布：访客可在幻灵世界广场与你的主页试玩。'
    : '未发布：仅自己可见；保存后点「发布到广场」。';
  const pubBtn = $('#h5PubBtn');
  if (pubBtn) pubBtn.textContent = pub ? '从广场下架' : '发布到广场';
}

function renderGrid() {
  const grid = $('#h5Grid');
  const empty = $('#h5Empty');
  const count = $('#h5Count');
  if (!grid) return;
  grid.innerHTML = '';
  if (count) count.textContent = games.length ? '共 ' + games.length + ' 款' : '';
  if (!games.length) {
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');
  games.forEach(g => {
    const a = document.createElement('a');
    a.className = 'h5-card';
    a.href = '/h5-game.html#edit=' + encodeURIComponent(g.id);
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (g.cover_image) {
      const img = document.createElement('img');
      img.src = g.cover_image;
      img.alt = '';
      img.loading = 'lazy';
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = '<span class="ic">🎮</span>';
    }
    const body = document.createElement('div');
    body.className = 'body';
    body.innerHTML = '<div class="title">' + escapeHtml(g.title) + '</div>'
      + '<div class="meta">' + (g.orientation === 'portrait' ? '竖屏' : '横屏')
      + (g.h5.playUrl ? ' · 已填地址' : ' · 待填地址') + '</div>'
      + '<span class="badge' + (g.status === 'published' ? ' pub' : '') + '">'
      + (g.status === 'published' ? '已发布' : '草稿') + '</span>';
    a.append(thumb, body);
    grid.appendChild(a);
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function loadGames() {
  if (!loggedIn) return;
  try {
    const res = await fetch('/api/stories', { credentials: 'include', headers: authHeaders() });
    if (res.status === 401) { loggedIn = false; return; }
    const d = await res.json();
    if (!d.success) throw new Error(d.error || '加载失败');
    games = (d.stories || []).map(normalizeH5).filter(Boolean);
    renderGrid();
  } catch (e) {
    toast(e.message || '加载失败', true);
  }
}

function buildPayload() {
  const title = String($('#h5Title')?.value || '').trim().slice(0, 40) || '未名游戏';
  const orientation = $('#h5OrientPick')?.querySelector('button.on')?.dataset.o === 'portrait' ? 'portrait' : 'landscape';
  const playUrl = normalizePlayUrl($('#h5PlayUrl')?.value);
  const rawUrl = String($('#h5PlayUrl')?.value || '').trim();
  if (rawUrl && !playUrl) {
    throw new Error('游戏地址须为 HTTPS，或本站 /img/… 路径');
  }
  return {
    kind: 'h5_game',
    title,
    orientation,
    imgQuality: 'standard',
    cast: {},
    chapters: [],
    h5: {
      playUrl,
      description: String($('#h5Desc')?.value || '').trim().slice(0, 200),
    },
    cover_image: coverUrl,
  };
}

async function saveCurrent() {
  if (!current) return;
  let payload;
  try { payload = buildPayload(); } catch (e) { toast(e.message, true); return; }
  try {
    const res = await fetch('/api/stories/' + encodeURIComponent(current.id), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ data: payload, cover_image: coverUrl }),
    });
    const d = await res.json();
    if (!d.success) throw new Error(d.error || '保存失败');
    current = normalizeH5({ ...d.story, title: d.story.title || payload.title });
    const idx = games.findIndex(g => g.id === current.id);
    if (idx >= 0) games[idx] = current;
    else games.unshift(current);
    toast('已保存');
    updateStatusLine();
  } catch (e) {
    toast(e.message || '保存失败', true);
  }
}

async function togglePublish() {
  if (!current) return;
  const target = current.status !== 'published';
  if (target && !normalizePlayUrl($('#h5PlayUrl')?.value)) {
    toast('请先填写有效的游戏地址再发布', true);
    return;
  }
  if (target) await saveCurrent();
  try {
    const res = await fetch('/api/stories/' + encodeURIComponent(current.id) + '/publish', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ published: target }),
    });
    const d = await res.json();
    if (!d.success) throw new Error(d.error || '操作失败');
    current.status = d.story.status;
    if (d.story.share_id) current.share_id = d.story.share_id;
    renderGrid();
    updateStatusLine();
    toast(target ? '已发布到幻灵世界广场' : '已从广场下架');
  } catch (e) {
    toast(e.message || '操作失败', true);
  }
}

async function deleteCurrent() {
  if (!current || !confirm('确定删除「' + current.title + '」？不可恢复。')) return;
  try {
    const res = await fetch('/api/stories/' + encodeURIComponent(current.id) + '/delete', {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(),
    });
    const d = await res.json();
    if (!d.success) throw new Error(d.error || '删除失败');
    games = games.filter(g => g.id !== current.id);
    current = null;
    toast('已删除');
    showList();
    renderGrid();
  } catch (e) {
    toast(e.message || '删除失败', true);
  }
}

async function createGame(title) {
  const t = String(title || '').trim().slice(0, 40) || '未名游戏';
  try {
    const res = await fetch('/api/stories', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ title: t, orientation: 'landscape', kind: 'h5_game' }),
    });
    const d = await res.json();
    if (!d.success) throw new Error(d.error || '创建失败');
    const g = normalizeH5(d.story);
    if (g) games.unshift(g);
    showEdit(g.id);
    renderGrid();
    toast('已创建，请填写游戏地址');
  } catch (e) {
    toast(e.message || '创建失败', true);
  }
}

async function uploadCover(file) {
  if (!file || !file.size) return;
  if (file.size > 5 * 1024 * 1024) { toast('封面过大（限 5MB）', true); return; }
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', credentials: 'include', headers: authHeaders(), body: fd });
    const d = await res.json();
    if (!res.ok || !d.success) throw new Error(d.error || '上传失败');
    coverUrl = d.url || '';
    renderCoverPreview();
    toast('封面上传成功');
  } catch (e) {
    toast(e.message || '上传失败', true);
  }
}

function parseHash() {
  const h = location.hash.replace(/^#/, '');
  const m = h.match(/^edit=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function init() {
  try {
    const res = await fetch('/api/me', { credentials: 'include', headers: authHeaders() });
    const d = await res.json().catch(() => ({}));
    loggedIn = !!(d.authenticated && d.user);
  } catch (e) { loggedIn = false; }

  if (!loggedIn) {
    $('#h5Login')?.classList.remove('hidden');
    $('#h5ListApp')?.classList.add('hidden');
    return;
  }
  $('#h5Login')?.classList.add('hidden');
  await loadGames();
  const editId = parseHash();
  if (editId) showEdit(editId);
  else showList();
}

$('#h5CreateBtn')?.addEventListener('click', () => {
  $('#h5CreateModal')?.classList.add('show');
  $('#h5NewTitle')?.focus();
});
$('#h5NewCancel')?.addEventListener('click', () => $('#h5CreateModal')?.classList.remove('show'));
$('#h5NewConfirm')?.addEventListener('click', async () => {
  const t = $('#h5NewTitle')?.value;
  $('#h5CreateModal')?.classList.remove('show');
  await createGame(t);
});
$('#h5SaveBtn')?.addEventListener('click', saveCurrent);
$('#h5PlayBtn')?.addEventListener('click', async () => {
  await saveCurrent();
  if (!current) return;
  const url = normalizePlayUrl($('#h5PlayUrl')?.value);
  if (!url) { toast('请先填写有效游戏地址', true); return; }
  location.href = '/h5-play.html?story=' + encodeURIComponent(current.id) + '&from=/h5-game.html';
});
$('#h5PubBtn')?.addEventListener('click', togglePublish);
$('#h5DelBtn')?.addEventListener('click', deleteCurrent);
$('#h5CoverBtn')?.addEventListener('click', () => $('#h5CoverInput')?.click());
$('#h5CoverInput')?.addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) uploadCover(f);
  e.target.value = '';
});
$('#h5OrientPick')?.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    $('#h5OrientPick').querySelectorAll('button').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
  });
});

init();

window.addEventListener('hashchange', () => {
  const id = parseHash();
  if (id) showEdit(id);
  else if (loggedIn) { showList(); renderGrid(); }
});
