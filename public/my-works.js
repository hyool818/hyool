import { $, toast } from '/workspace/js/ui.js';

const TOKEN_KEY = 'hyool_token';
const KIND = {
  story: { label: '📖 视觉小说', edit: (id) => '/make.html?story=' + encodeURIComponent(id) },
  interactive_video: { label: '📖 视觉小说', edit: (id) => '/make.html?story=' + encodeURIComponent(id) },
  comic: { label: '📚 漫画', edit: (id) => '/story-editor.html?story=' + encodeURIComponent(id) },
  gacha_rogue: { label: '🂠 卡牌', edit: (id) => '/story-editor.html?story=' + encodeURIComponent(id) },
  card_rpg: { label: '⚔️ 卡牌RPG', edit: (id) => '/story-editor.html?story=' + encodeURIComponent(id) },
  h5_game: { label: '🎮 H5', edit: (id) => '/h5-game.html#edit=' + encodeURIComponent(id) },
};

function authHeaders() {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t ? { Authorization: 'Bearer ' + t } : {};
  } catch (e) { return {}; }
}

function playUrl(w) {
  if (w.kind === 'h5_game') return '/h5-play.html?story=' + encodeURIComponent(w.id) + '&from=/make.html';
  if (w.kind === 'story' || w.kind === 'interactive_video' || !w.kind) return '/make.html?story=' + encodeURIComponent(w.id) + '&play=1';
  return '/story-editor.html?pro=1&story=' + encodeURIComponent(w.id) + '&play=1&from=/make.html';
}

function editUrl(w) {
  const k = KIND[w.kind] || KIND.story;
  return k.edit(w.id);
}

function kindLabel(kind) {
  return (KIND[kind] || KIND.story).label;
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function togglePublish(w, btn) {
  const target = w.status !== 'published';
  if (target && !confirm('发布「' + w.title + '」？将出现在幻灵世界广场。')) return;
  try {
    const res = await fetch('/api/stories/' + encodeURIComponent(w.id) + '/publish', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ published: target }),
    });
    const d = await res.json();
    if (!d.success) throw new Error(d.error || '失败');
    w.status = d.story.status;
    btn.textContent = w.status === 'published' ? '下架' : '发布';
    toast(target ? '已发布' : '已下架');
  } catch (e) {
    toast(e.message || '操作失败', true);
  }
}

async function deleteWork(w) {
  if (!confirm('删除「' + w.title + '」？不可恢复。')) return;
  try {
    const res = await fetch('/api/stories/' + encodeURIComponent(w.id) + '/delete', {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(),
    });
    const d = await res.json();
    if (!d.success) throw new Error(d.error || '删除失败');
    toast('已删除');
    loadWorks();
  } catch (e) {
    toast(e.message || '删除失败', true);
  }
}

function renderCard(w) {
  const card = document.createElement('div');
  card.className = 'mw-card';
  const pub = w.status === 'published';
  const cover = w.cover_image
    ? '<img src="' + escapeHtml(w.cover_image) + '" alt="">'
    : (w.kind === 'h5_game' ? '🎮' : '📄');
  card.innerHTML =
    '<div class="row">' +
      '<div class="thumb">' + cover + '</div>' +
      '<div class="info">' +
        '<div class="title">' + escapeHtml(w.title) + '</div>' +
        '<div class="meta">' +
          '<span class="badge">' + kindLabel(w.kind) + '</span>' +
          '<span class="badge' + (pub ? ' pub' : '') + '">' + (pub ? '已发布' : '草稿') + '</span>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="ops">' +
      '<a class="btn primary" href="' + playUrl(w) + '">▶ 试玩</a>' +
      '<a class="btn" href="' + editUrl(w) + '">编辑</a>' +
      '<button type="button" class="btn pub-btn">' + (pub ? '下架' : '发布') + '</button>' +
      '<button type="button" class="btn danger del-btn">删除</button>' +
    '</div>';
  card.querySelector('.pub-btn').addEventListener('click', (e) => togglePublish(w, e.target));
  card.querySelector('.del-btn').addEventListener('click', () => deleteWork(w));
  return card;
}

async function loadWorks() {
  const grid = $('#mwGrid');
  const empty = $('#mwEmpty');
  const count = $('#mwCount');
  grid.innerHTML = '<div class="mw-empty">加载中…</div>';
  try {
    const res = await fetch('/api/stories', { credentials: 'include', headers: authHeaders() });
    if (res.status === 401) {
      $('#mwLogin').classList.remove('hidden');
      $('#mwApp').classList.add('hidden');
      return;
    }
    const d = await res.json();
    if (!d.success) throw new Error(d.error || '加载失败');
    const list = (d.stories || []).map((s) => ({
      id: s.id,
      title: s.title || '未命名',
      kind: s.kind || 'story',
      status: s.status || 'draft',
      cover_image: s.cover_image || '',
    }));
    grid.innerHTML = '';
    if (count) count.textContent = list.length ? '共 ' + list.length + ' 部' : '';
    if (!list.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    list.forEach((w) => grid.appendChild(renderCard(w)));
  } catch (e) {
    grid.innerHTML = '';
    empty.textContent = e.message || '加载失败';
    empty.classList.remove('hidden');
  }
}

async function init() {
  let loggedIn = false;
  try {
    const res = await fetch('/api/me', { credentials: 'include', headers: authHeaders() });
    const d = await res.json().catch(() => ({}));
    loggedIn = !!(d.authenticated && d.user);
  } catch (e) { /* ignore */ }
  if (!loggedIn) {
    $('#mwLogin').classList.remove('hidden');
    return;
  }
  $('#mwApp').classList.remove('hidden');
  await loadWorks();
}

init();
