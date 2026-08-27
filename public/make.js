// make.js — HYOOL 主创作应用（互动小说 / 视觉小说）
import { $, $$, toast } from '/workspace/js/ui.js';

const TOKEN_KEY = 'hyool_token';
const DEFAULT_SPEAKER = '角色名';
const MAX_FILE = 5 * 1024 * 1024;
const TYPE_LABEL = { scene: '场景', dialogue: '对白', choice: '选项' };
const SUB_SIZE_KEY = 'hyool_story_subtitle_size_v1';
const SUB_SIZE_DEFAULT = 27;
const SUB_SIZE_MIN = 18;
const SUB_SIZE_MAX = 36;
const COLOR_PRESETS = [
  { id: 'default', label: '默认白', value: '' },
  { id: 'gold', label: '金色', value: '#f5d78e' },
  { id: 'cyan', label: '青色', value: '#7ee8fa' },
  { id: 'pink', label: '粉色', value: '#ffb3d9' },
  { id: 'green', label: '绿色', value: '#a8f0c6' },
  { id: 'red', label: '红色', value: '#ff8a8a' },
];

let loggedIn = false;
let works = [];
let work = null;
let selectedId = null;
let createOrient = 'landscape';
let uploadTimer = null;
let saveLabel = '';

let playing = false;
let playFlat = [];
let playIdx = 0;

const uid = () => 'b_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function authHeaders() {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t ? { Authorization: 'Bearer ' + t } : {};
  } catch (e) { return {}; }
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function blocks() {
  const ch = work?.chapters?.[0];
  return ch?.blocks || [];
}

function selectedBlock() {
  return blocks().find((b) => b.id === selectedId) || null;
}

function setSave(st) {
  saveLabel = st;
  const el = $('#mkSave');
  if (!el) return;
  el.textContent = st === 'saving' ? '保存中…' : st === 'ok' ? '已保存 ✓' : st === 'err' ? '保存失败' : '';
  el.style.color = st === 'err' ? 'var(--bad)' : st === 'ok' ? 'var(--good)' : 'var(--muted)';
}

function normalizeWork(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.kind !== 'story') return s;
  if (s.orientation !== 'portrait') s.orientation = 'landscape';
  if (!Array.isArray(s.chapters) || !s.chapters.length) {
    s.chapters = [{ id: 'ch_' + uid().slice(2), title: '第一章', blocks: [] }];
  }
  s.chapters.forEach((c) => {
    if (!Array.isArray(c.blocks)) c.blocks = [];
    c.blocks.forEach((b) => {
      if (!b.id) b.id = uid();
      if (b.type === 'dialogue' && !b.speaker) b.speaker = DEFAULT_SPEAKER;
      if (b.type === 'choice') normalizeChoice(b);
    });
  });
  return s;
}

function normalizeChoice(b) {
  if (!Array.isArray(b.choices) || !b.choices.length) {
    b.choices = [
      { id: uid(), label: '继续', jump: 'next' },
      { id: uid(), label: '结束', jump: 'end' },
    ];
  }
  b.choices = b.choices.map((c) => ({
    id: c.id || uid(),
    label: String(c.label || '选项').slice(0, 40),
    jump: c.jump || 'next',
  }));
}

function redirectOtherKind(w) {
  const kind = w.kind || 'story';
  if (kind === 'story') return false;
  const q = new URLSearchParams(location.search);
  const play = q.get('play') === '1' ? '&play=1' : '';
  if (kind === 'h5_game') {
    location.replace('/h5-game.html#edit=' + encodeURIComponent(w.id));
    return true;
  }
  location.replace('/story-editor.html?pro=1&story=' + encodeURIComponent(w.id) + play);
  return true;
}

function getGlobalSubSize() {
  const n = Number(localStorage.getItem(SUB_SIZE_KEY));
  if (!Number.isFinite(n)) return SUB_SIZE_DEFAULT;
  return Math.min(SUB_SIZE_MAX, Math.max(SUB_SIZE_MIN, Math.round(n)));
}

function setGlobalSubSize(px) {
  localStorage.setItem(SUB_SIZE_KEY, String(Math.min(SUB_SIZE_MAX, Math.max(SUB_SIZE_MIN, Math.round(px)))));
}

function ensureSub(b) {
  if (!b.subtitle || typeof b.subtitle !== 'object') b.subtitle = {};
  return b.subtitle;
}

function subPos(b) {
  const sub = ensureSub(b);
  return { x: sub.x != null ? sub.x : 50, y: sub.y != null ? sub.y : 78 };
}

function applySubColor(el, b) {
  const c = ensureSub(b).color;
  if (c) el.style.color = c;
}

function starterBlocks() {
  return [
    { id: uid(), type: 'scene', content: '某个寻常的下课铃后，走廊里只剩下你的脚步声。' },
    { id: uid(), type: 'dialogue', speaker: '你', content: '……今天，好像有什么不一样。' },
    {
      id: uid(), type: 'choice', content: '你要怎么做？',
      choices: [
        { id: uid(), label: '推开教室的门', jump: 'next' },
        { id: uid(), label: '先回家再说', jump: 'end' },
      ],
    },
  ];
}

// ---------- API ----------
async function checkAuth() {
  try {
    const res = await fetch('/api/me', { credentials: 'include', headers: authHeaders() });
    const d = await res.json().catch(() => ({}));
    loggedIn = !!(d.authenticated && d.user);
  } catch (e) { loggedIn = false; }
}

async function loadWorksList() {
  const res = await fetch('/api/stories', { credentials: 'include', headers: authHeaders() });
  if (res.status === 401) throw new Error('login');
  const d = await res.json();
  if (!d.success) throw new Error(d.error || '加载失败');
  return (d.stories || []).map((s) => ({
    id: s.id,
    title: s.title || '未命名',
    kind: s.kind || 'story',
    status: s.status || 'draft',
    cover_image: s.cover_image || '',
  }));
}

async function loadWork(id) {
  const res = await fetch('/api/stories/' + encodeURIComponent(id), { credentials: 'include', headers: authHeaders() });
  const d = await res.json();
  if (!d.success || !d.story) throw new Error(d.error || '作品不存在');
  return normalizeWork(d.story);
}

function scheduleSave() {
  if (!work || !loggedIn) return;
  setSave('saving');
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = setTimeout(saveWork, 700);
}

async function saveWork() {
  if (!work || !loggedIn) return;
  try {
    const res = await fetch('/api/stories/' + encodeURIComponent(work.id), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ data: work }),
    });
    const d = await res.json();
    if (!d.success) {
      setSave('err');
      toast(d.error || '保存失败', true);
      return;
    }
    setSave('ok');
    if (d.story?.status) work.status = d.story.status;
  } catch (e) {
    setSave('err');
    toast('网络异常，保存失败', true);
  }
}

async function createWork(title, orientation) {
  const res = await fetch('/api/stories', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ title, orientation, imgQuality: 'standard', kind: 'story' }),
  });
  const d = await res.json();
  if (!d.success) throw new Error(d.error || '创建失败');
  const s = normalizeWork({ ...d.story });
  s.chapters[0].blocks = starterBlocks();
  await fetch('/api/stories/' + encodeURIComponent(s.id), {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ data: s }),
  });
  return s;
}

async function togglePublish() {
  if (!work) return;
  const target = work.status !== 'published';
  if (target && !confirm('发布「' + work.title + '」？将出现在幻灵世界广场。')) return;
  try {
    const res = await fetch('/api/stories/' + encodeURIComponent(work.id) + '/publish', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ published: target }),
    });
    const d = await res.json();
    if (!d.success) throw new Error(d.error || '失败');
    work.status = d.story.status;
    $('#mkPubBtn').textContent = work.status === 'published' ? '下架' : '发布';
    toast(target ? '已发布' : '已下架');
  } catch (e) {
    toast(e.message || '操作失败', true);
  }
}

async function deleteWorkById(id, title) {
  if (!confirm('删除「' + title + '」？不可恢复。')) return;
  try {
    const res = await fetch('/api/stories/' + encodeURIComponent(id) + '/delete', {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(),
    });
    const d = await res.json();
    if (!d.success) throw new Error(d.error || '删除失败');
    toast('已删除');
    if (work && work.id === id) showHome();
    else renderHome();
  } catch (e) {
    toast(e.message || '删除失败', true);
  }
}

async function uploadFile(file) {
  const mime = file.type || '';
  const isImg = /^image\//.test(mime);
  const isVid = /^video\//.test(mime);
  if (!isImg && !isVid) { toast('请选图片或 MP4 视频', true); return null; }
  if (file.size > MAX_FILE) { toast('文件不能超过 5MB', true); return null; }
  if (!loggedIn) { toast('请先登录再上传', true); return null; }
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', credentials: 'include', headers: authHeaders(), body: fd });
    const d = await res.json();
    if (!d.success || !d.url) { toast(d.error || '上传失败', true); return null; }
    return { url: d.url, type: isVid ? 'video' : 'image' };
  } catch (e) {
    toast('上传失败', true);
    return null;
  }
}

// ---------- 视图 ----------
function showHome() {
  work = null;
  selectedId = null;
  history.replaceState(null, '', '/make.html');
  $('#viewHome').classList.remove('hidden');
  $('#viewEdit').classList.remove('show');
  $('#mkPlayBtn').style.display = 'none';
  $('#mkPubBtn').style.display = 'none';
  $('#mkBrand').textContent = '创作作品';
  $('#mkBrandSub').textContent = 'MAKE';
  $('#mkBack').href = '/';
  $('#mkBack').textContent = '← 首页';
  loadWorksList().then((list) => { works = list; renderHome(); }).catch(() => renderHome());
}

function showEdit() {
  $('#viewHome').classList.add('hidden');
  $('#viewEdit').classList.add('show');
  $('#mkPlayBtn').style.display = '';
  $('#mkPubBtn').style.display = '';
  $('#mkBrand').textContent = work?.title || '未命名';
  $('#mkBrandSub').textContent = '编辑中';
  $('#mkBack').href = '/make.html';
  $('#mkBack').textContent = '← 作品列表';
  $('#mkPubBtn').textContent = work?.status === 'published' ? '下架' : '发布';
  renderEdit();
  history.replaceState(null, '', '/make.html?story=' + encodeURIComponent(work.id));
}

function updateSteps() {
  const b = selectedBlock();
  const hasPic = b && b.media && b.media.url;
  const hasWrite = b && ((b.content || '').trim() || b.type === 'dialogue');
  $$('.mk-step').forEach((el) => {
    const s = el.dataset.step;
    el.classList.toggle('on', s === 'write' ? !!hasWrite : s === 'pic' ? !!hasPic : false);
  });
  if (playing) $$('.mk-step').forEach((el) => { if (el.dataset.step === 'play') el.classList.add('on'); });
}

// ---------- 首页 ----------
function renderHome() {
  const grid = $('#mkGrid');
  grid.innerHTML = '';
  const stories = works.filter((w) => w.kind === 'story');
  const others = works.filter((w) => w.kind !== 'story');
  const all = [...stories, ...others];
  $('#mkEmpty').classList.toggle('hidden', all.length > 0);
  all.forEach((w) => grid.appendChild(homeCard(w)));
}

function homeCard(w) {
  const card = document.createElement('div');
  card.className = 'mk-card';
  const isStory = w.kind === 'story';
  const cover = w.cover_image
    ? '<img src="' + escapeHtml(w.cover_image) + '" alt="">'
    : (w.kind === 'h5_game' ? '🎮' : '📖');
  const pub = w.status === 'published';
  card.innerHTML =
    '<div class="row">' +
      '<div class="thumb">' + cover + '</div>' +
      '<div class="info">' +
        '<div class="title">' + escapeHtml(w.title) + '</div>' +
        '<div class="meta">' + (isStory ? '互动小说' : w.kind) + ' · ' + (pub ? '已发布' : '草稿') + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="ops">' +
      '<button type="button" class="btn primary play-btn">▶ 试玩</button>' +
      '<button type="button" class="btn edit-btn">编辑</button>' +
      (isStory ? '<button type="button" class="btn danger del-btn">删除</button>' : '') +
    '</div>';
  card.querySelector('.edit-btn').addEventListener('click', (e) => { e.stopPropagation(); openWork(w.id, false); });
  card.querySelector('.play-btn').addEventListener('click', (e) => { e.stopPropagation(); openWork(w.id, true); });
  if (isStory) card.querySelector('.del-btn').addEventListener('click', (e) => { e.stopPropagation(); deleteWorkById(w.id, w.title); });
  card.addEventListener('click', () => openWork(w.id, false));
  return card;
}

async function openWork(id, play) {
  try {
    const w = await loadWork(id);
    if (redirectOtherKind(w)) return;
    work = w;
    selectedId = blocks()[0]?.id || null;
    showEdit();
    if (play) startPlay();
  } catch (e) {
    toast(e.message || '打不开作品', true);
  }
}

// ---------- 编辑 ----------
function renderEdit() {
  renderShots();
  renderPreview();
  renderPanel();
  updateSteps();
  const stage = $('#mkStage');
  stage.classList.toggle('portrait', work?.orientation === 'portrait');
}

function renderShots() {
  const list = $('#mkShotsList');
  list.innerHTML = '';
  const bs = blocks();
  $('#mkShotCount').textContent = bs.length ? bs.length + ' 镜' : '';
  bs.forEach((b, i) => {
    const row = document.createElement('div');
    row.className = 'mk-shot' + (b.id === selectedId ? ' on' : '');
    const preview = b.type === 'dialogue'
      ? (b.speaker + '：' + (b.content || '')).slice(0, 40)
      : (b.content || TYPE_LABEL[b.type] || '').slice(0, 40);
    row.innerHTML =
      '<span class="num">' + (i + 1) + '</span>' +
      '<div class="body">' +
        '<div class="type">' + (TYPE_LABEL[b.type] || b.type) + (b.media?.url ? ' · 有图' : '') + '</div>' +
        '<div class="txt">' + escapeHtml(preview || '（空）') + '</div>' +
      '</div>';
    row.addEventListener('click', () => { selectedId = b.id; renderEdit(); });
    list.appendChild(row);
  });
}

function renderPreview() {
  const stage = $('#mkStage');
  stage.innerHTML = '';
  const b = selectedBlock();
  if (!b) {
    stage.innerHTML = '<div class="empty-hint">选左边一个镜头<br>中间会实时显示效果</div>';
    return;
  }
  if (b.media?.url) {
    if (b.media.type === 'video') {
      const v = document.createElement('video');
      v.className = 'bg-vid';
      v.src = b.media.url;
      v.muted = true;
      v.loop = true;
      v.autoplay = true;
      v.playsInline = true;
      stage.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.className = 'bg';
      img.src = b.media.url;
      img.alt = '';
      stage.appendChild(img);
    }
  }
  if (b.type === 'dialogue') {
    const dlg = document.createElement('div');
    dlg.className = 'dlg';
    const sz = getGlobalSubSize();
    dlg.innerHTML = '<div class="sp">' + escapeHtml(b.speaker || DEFAULT_SPEAKER) + '</div><div class="ln">' + escapeHtml(formatLine(b.content)) + '</div>';
    const sp = dlg.querySelector('.sp');
    const ln = dlg.querySelector('.ln');
    sp.style.fontSize = Math.round(sz * 1.15) + 'px';
    ln.style.fontSize = sz + 'px';
    applySubColor(sp, b);
    applySubColor(ln, b);
    stage.appendChild(dlg);
  } else if (b.type === 'scene' && (b.content || '').trim()) {
    const pos = subPos(b);
    const t = document.createElement('div');
    t.className = 'scene-txt';
    t.textContent = b.content;
    t.style.left = pos.x + '%';
    t.style.top = pos.y + '%';
    t.style.transform = 'translate(-50%,-50%)';
    t.style.fontSize = getGlobalSubSize() + 'px';
    applySubColor(t, b);
    bindSceneTextDrag(t, b, stage);
    const hint = document.createElement('div');
    hint.className = 'scene-drag-hint';
    hint.textContent = '拖动文字调整位置';
    stage.appendChild(hint);
    stage.appendChild(t);
  } else if (b.type === 'choice') {
    const dlg = document.createElement('div');
    dlg.className = 'dlg';
    dlg.innerHTML = '<div class="sp">选项</div><div class="ln">' + escapeHtml(b.content || '请选择') + '</div>';
    stage.appendChild(dlg);
  } else if (!b.media?.url) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = b.type === 'scene' ? '场景文字会显示在这里\n右侧可加背景图' : '对白会显示在底部';
    stage.appendChild(hint);
  }
}

function formatLine(t) {
  t = String(t || '').trim();
  if (!t) return '……';
  if (/^[「『"“]/.test(t)) return t;
  return '「' + t + '」';
}

function renderPanel() {
  const panel = $('#mkPanel');
  const b = selectedBlock();
  if (!b) {
    panel.innerHTML = '<p style="color:var(--muted);font-size:13px;text-align:center;padding:24px 0">← 选一个镜头</p>';
    return;
  }
  panel.innerHTML = '';

  const typeRow = document.createElement('div');
  typeRow.className = 'field';
  typeRow.innerHTML = '<label>镜头类型</label>';
  const sel = document.createElement('select');
  ['scene', 'dialogue', 'choice'].forEach((t) => {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = TYPE_LABEL[t];
    if (b.type === t) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => {
    b.type = sel.value;
    if (b.type === 'dialogue' && !b.speaker) b.speaker = DEFAULT_SPEAKER;
    if (b.type === 'choice') normalizeChoice(b);
    scheduleSave();
    renderEdit();
  });
  typeRow.appendChild(sel);
  panel.appendChild(typeRow);

  if (b.type === 'dialogue') {
    const sp = field('角色名', 'text', b.speaker || DEFAULT_SPEAKER, (v) => { b.speaker = v; scheduleSave(); renderPreview(); updateSteps(); });
    panel.appendChild(sp);
  }

  const contentLabel = b.type === 'scene' ? '场景描述' : b.type === 'choice' ? '选项提示' : '对白内容';
  panel.appendChild(field(contentLabel, 'textarea', b.content || '', (v) => {
    b.content = v;
    scheduleSave();
    renderPreview();
    renderShots();
    updateSteps();
  }));

  if (b.type === 'scene' || b.type === 'dialogue') {
    panel.appendChild(textStylePanel(b));
  }

  if (b.type === 'choice') {
    panel.appendChild(choiceEditor(b));
  }

  const bgSec = document.createElement('div');
  bgSec.className = 'field';
  bgSec.innerHTML = '<label>背景图 / 视频</label>';
  if (b.media?.url) {
    const prev = document.createElement('div');
    prev.className = 'mk-bg-preview';
    if (b.media.type === 'video') {
      prev.innerHTML = '<video src="' + escapeHtml(b.media.url) + '" style="width:100%;border-radius:8px" muted loop autoplay playsinline></video>';
    } else {
      prev.innerHTML = '<img src="' + escapeHtml(b.media.url) + '" alt="">';
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn danger';
    rm.textContent = '移除';
    rm.addEventListener('click', () => { delete b.media; scheduleSave(); renderEdit(); });
    prev.appendChild(rm);
    bgSec.appendChild(prev);
  } else {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mk-bg-btn';
    btn.textContent = '🖼 点击上传背景图';
    btn.addEventListener('click', () => pickMedia(b));
    bgSec.appendChild(btn);
  }
  panel.appendChild(bgSec);

  const foot = document.createElement('div');
  foot.className = 'mk-panel-foot';
  const up = btn('↑ 上移', () => moveBlock(b.id, -1));
  const down = btn('↓ 下移', () => moveBlock(b.id, 1));
  const del = btn('删除镜头', () => removeBlock(b.id), true);
  foot.append(up, down, del);
  panel.appendChild(foot);
}

function field(label, tag, value, onInput) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const lab = document.createElement('label');
  lab.textContent = label;
  const el = document.createElement(tag === 'textarea' ? 'textarea' : 'input');
  if (tag !== 'textarea') el.type = 'text';
  el.value = value;
  el.addEventListener('input', () => onInput(el.value));
  wrap.append(lab, el);
  return wrap;
}

function textStylePanel(b) {
  const sub = ensureSub(b);
  const wrap = document.createElement('div');
  wrap.className = 'field mk-text-style';
  const title = document.createElement('label');
  title.textContent = b.type === 'scene' ? '文字样式（中间预览可拖动位置）' : '文字样式';
  wrap.appendChild(title);

  const sizeRow = document.createElement('div');
  sizeRow.className = 'mk-size-row';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(SUB_SIZE_MIN);
  range.max = String(SUB_SIZE_MAX);
  range.value = String(getGlobalSubSize());
  const sizeVal = document.createElement('span');
  sizeVal.textContent = range.value + 'px';
  range.addEventListener('input', () => {
    setGlobalSubSize(Number(range.value));
    sizeVal.textContent = range.value + 'px';
    renderPreview();
    if (playing) renderPlay();
  });
  sizeRow.append(document.createElement('span'), range, sizeVal);
  sizeRow.firstChild.textContent = '字号';
  sizeRow.firstChild.style.fontSize = '11px';
  sizeRow.firstChild.style.color = 'var(--muted)';
  wrap.appendChild(sizeRow);

  const colorLab = document.createElement('label');
  colorLab.textContent = '颜色';
  colorLab.style.marginTop = '10px';
  wrap.appendChild(colorLab);

  const sw = document.createElement('div');
  sw.className = 'swatches';
  COLOR_PRESETS.forEach((p) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch' + (p.id === 'default' ? ' default' : '') + ((!sub.color && p.id === 'default') || sub.color === p.value ? ' on' : '');
    btn.title = p.label;
    if (p.value) btn.style.background = p.value;
    btn.addEventListener('click', () => {
      if (p.id === 'default') delete sub.color;
      else sub.color = p.value;
      scheduleSave();
      sw.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on'));
      btn.classList.add('on');
      colorInp.value = sub.color || '#ffffff';
      renderPreview();
      if (playing) renderPlay();
    });
    sw.appendChild(btn);
  });
  wrap.appendChild(sw);

  const colorInp = document.createElement('input');
  colorInp.type = 'color';
  colorInp.value = sub.color || '#ffffff';
  colorInp.addEventListener('input', () => {
    sub.color = colorInp.value;
    scheduleSave();
    sw.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on'));
    renderPreview();
    if (playing) renderPlay();
  });
  wrap.appendChild(colorInp);

  if (b.type === 'scene') {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn';
    reset.style.marginTop = '8px';
    reset.textContent = '重置文字位置';
    reset.addEventListener('click', () => {
      delete sub.x;
      delete sub.y;
      scheduleSave();
      renderPreview();
      toast('已重置到默认位置');
    });
    wrap.appendChild(reset);
  }
  return wrap;
}

function bindSceneTextDrag(el, b, stage) {
  let dragging = false;
  const move = (clientX, clientY) => {
    const rect = stage.getBoundingClientRect();
    const x = Math.min(96, Math.max(4, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.min(96, Math.max(4, ((clientY - rect.top) / rect.height) * 100));
    const sub = ensureSub(b);
    sub.x = Math.round(x);
    sub.y = Math.round(y);
    el.style.left = sub.x + '%';
    el.style.top = sub.y + '%';
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    el.classList.add('dragging');
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    move(e.clientX, e.clientY);
  });
  el.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');
    try { el.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    scheduleSave();
  });
  el.addEventListener('pointercancel', () => {
    dragging = false;
    el.classList.remove('dragging');
  });
}

function btn(text, fn, danger) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn' + (danger ? ' danger' : '');
  b.textContent = text;
  b.addEventListener('click', fn);
  return b;
}

function choiceEditor(b) {
  normalizeChoice(b);
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.innerHTML = '<label>选项（读者点选）</label>';
  b.choices.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'mk-choice-row';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = c.label;
    inp.placeholder = '选项 ' + (i + 1);
    inp.addEventListener('input', () => { c.label = inp.value; scheduleSave(); renderPreview(); renderShots(); });
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn danger';
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      if (b.choices.length <= 1) return;
      b.choices.splice(i, 1);
      scheduleSave();
      renderEdit();
    });
    row.append(inp, rm);
    wrap.appendChild(row);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn';
  add.style.marginTop = '6px';
  add.textContent = '＋ 加选项';
  add.addEventListener('click', () => {
    b.choices.push({ id: uid(), label: '新选项', jump: 'next' });
    scheduleSave();
    renderEdit();
  });
  wrap.appendChild(add);
  return wrap;
}

function pickMedia(b) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*,video/mp4,video/webm';
  inp.addEventListener('change', async () => {
    const f = inp.files?.[0];
    if (!f) return;
    toast('上传中…');
    const media = await uploadFile(f);
    if (!media) return;
    b.media = media;
    scheduleSave();
    renderEdit();
    toast('背景已添加');
  });
  inp.click();
}

function addBlock(type) {
  const ch = work.chapters[0];
  const block = { id: uid(), type, content: type === 'scene' ? '新场景……' : type === 'choice' ? '你要怎么做？' : '在这里写下对白……' };
  if (type === 'dialogue') block.speaker = DEFAULT_SPEAKER;
  if (type === 'choice') normalizeChoice(block);
  ch.blocks.push(block);
  selectedId = block.id;
  scheduleSave();
  renderEdit();
}

function removeBlock(id) {
  if (!confirm('删除这个镜头？')) return;
  const ch = work.chapters[0];
  ch.blocks = ch.blocks.filter((b) => b.id !== id);
  if (selectedId === id) selectedId = ch.blocks[0]?.id || null;
  scheduleSave();
  renderEdit();
}

function moveBlock(id, dir) {
  const ch = work.chapters[0];
  const i = ch.blocks.findIndex((b) => b.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ch.blocks.length) return;
  const tmp = ch.blocks[i];
  ch.blocks[i] = ch.blocks[j];
  ch.blocks[j] = tmp;
  scheduleSave();
  renderEdit();
}

function openAddPicker() {
  const types = [
    ['dialogue', '💬 对白'],
    ['scene', '🏙 场景'],
    ['choice', '🔀 选项'],
  ];
  const m = document.createElement('div');
  m.className = 'mk-modal show';
  m.innerHTML = '<div class="mk-modal-box"><h2>加镜头</h2><div id="pickList"></div><button type="button" class="btn" id="pickClose" style="width:100%;margin-top:12px">取消</button></div>';
  document.body.appendChild(m);
  const list = m.querySelector('#pickList');
  types.forEach(([t, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.style.cssText = 'width:100%;margin-bottom:8px;text-align:left;padding:12px';
    b.textContent = label;
    b.addEventListener('click', () => { addBlock(t); m.remove(); });
    list.appendChild(b);
  });
  m.querySelector('#pickClose').addEventListener('click', () => m.remove());
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
}

// ---------- 试玩 ----------
function buildPlayFlat() {
  const flat = [];
  (work.chapters || []).forEach((ch) => {
    (ch.blocks || []).forEach((b) => {
      if (['scene', 'dialogue', 'choice'].includes(b.type)) flat.push(b);
    });
  });
  return flat;
}

function startPlay() {
  playFlat = buildPlayFlat();
  if (!playFlat.length) { toast('还没有可播放的镜头，先加对白或场景', true); return; }
  playIdx = 0;
  playing = true;
  $('#playOverlay').classList.add('show');
  $('#playTitle').textContent = work.title || '';
  const ov = $('#playOverlay');
  ov.classList.toggle('orient-portrait', work.orientation === 'portrait');
  ov.classList.toggle('orient-landscape', work.orientation !== 'portrait');
  renderPlay();
  updateSteps();
}

function stopPlay() {
  playing = false;
  $('#playOverlay').classList.remove('show');
  $('#playBody').innerHTML = '';
  updateSteps();
}

function renderPlay() {
  const body = $('#playBody');
  body.innerHTML = '';
  const b = playFlat[playIdx];
  if (!b) { stopPlay(); return; }

  const frame = document.createElement('div');
  frame.className = 'play-frame';

  if (b.media?.url) {
    const bg = document.createElement('div');
    bg.className = 'play-media-bg';
    if (b.media.type === 'video') {
      const v = document.createElement('video');
      v.src = b.media.url;
      v.autoplay = true;
      v.loop = true;
      v.muted = true;
      v.playsInline = true;
      bg.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = b.media.url;
      img.alt = '';
      bg.appendChild(img);
    }
    frame.appendChild(bg);
  }

  const fore = document.createElement('div');
  fore.className = 'play-fore';

  if (b.type === 'choice') {
    normalizeChoice(b);
    fore.classList.add('dlg-fore');
    const box = document.createElement('div');
    box.className = 'play-choice';
    box.innerHTML = '<div class="pc-prompt">' + escapeHtml(b.content || '请选择：') + '</div>';
    const opts = document.createElement('div');
    opts.className = 'pc-opts';
    b.choices.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pc-opt';
      btn.textContent = c.label || '选项';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        jumpPlay(c.jump || 'next');
      });
      opts.appendChild(btn);
    });
    box.appendChild(opts);
    fore.appendChild(box);
    frame.appendChild(fore);
    body.appendChild(frame);
    $('#playPrev').disabled = playIdx === 0;
    $('#playNext').disabled = true;
    return;
  }

  fore.addEventListener('click', playNext);
  if (b.type === 'dialogue') {
    fore.classList.add('dlg-fore');
    const sz = getGlobalSubSize();
    const d = document.createElement('div');
    d.className = 'play-dialogue';
    d.innerHTML = '<div class="pd-speaker">' + escapeHtml(b.speaker || DEFAULT_SPEAKER) + '</div><div class="pd-line">' + escapeHtml(formatLine(b.content)) + '</div>';
    const sp = d.querySelector('.pd-speaker');
    const ln = d.querySelector('.pd-line');
    sp.style.fontSize = Math.round(sz * 1.15) + 'px';
    ln.style.fontSize = sz + 'px';
    applySubColor(sp, b);
    applySubColor(ln, b);
    fore.appendChild(d);
  } else if (b.type === 'scene' && (b.content || '').trim()) {
    const pos = subPos(b);
    const st = document.createElement('div');
    st.className = 'play-scene-text';
    st.style.left = pos.x + '%';
    st.style.top = pos.y + '%';
    st.style.transform = 'translate(-50%,-50%)';
    st.style.fontSize = getGlobalSubSize() + 'px';
    st.textContent = b.content;
    applySubColor(st, b);
    frame.appendChild(st);
  }
  frame.appendChild(fore);
  body.appendChild(frame);
  $('#playPrev').disabled = playIdx === 0;
  $('#playNext').disabled = playIdx >= playFlat.length - 1;
}

function playNext() {
  if (playIdx < playFlat.length - 1) { playIdx++; renderPlay(); }
  else { stopPlay(); toast('试玩结束'); }
}

function playPrev() {
  if (playIdx > 0) { playIdx--; renderPlay(); }
}

function jumpPlay(jump) {
  const j = String(jump || 'next');
  if (j === 'end') { stopPlay(); toast('到此结束'); return; }
  if (j === 'next') { playNext(); return; }
  const idx = playFlat.findIndex((b) => b.id === j);
  if (idx >= 0) { playIdx = idx; renderPlay(); }
  else playNext();
}

// ---------- 新建弹窗 ----------
function openCreateModal() {
  $('#mkNewTitle').value = '';
  createOrient = 'landscape';
  $$('.mk-orient button').forEach((b) => b.classList.toggle('on', b.dataset.o === createOrient));
  $('#mkModal').classList.add('show');
  setTimeout(() => $('#mkNewTitle').focus(), 100);
}

async function confirmCreate() {
  const title = $('#mkNewTitle').value.trim();
  if (!title) { toast('请输入作品名称', true); return; }
  if (!loggedIn) { toast('请先登录', true); return; }
  $('#mkModalOk').disabled = true;
  try {
    work = await createWork(title, createOrient);
    selectedId = blocks()[0]?.id || null;
    $('#mkModal').classList.remove('show');
    showEdit();
    toast('已创建《' + title + '》');
  } catch (e) {
    toast(e.message || '创建失败', true);
  } finally {
    $('#mkModalOk').disabled = false;
  }
}

// ---------- 路由 ----------
async function route() {
  const q = new URLSearchParams(location.search);
  await checkAuth();
  if (!loggedIn) {
    $('#mkLogin').classList.remove('hidden');
    return;
  }
  $('#mkLogin').classList.add('hidden');
  $('#mkApp').classList.remove('hidden');

  try {
    works = await loadWorksList();
  } catch (e) {
    if (e.message === 'login') {
      $('#mkLogin').classList.remove('hidden');
      $('#mkApp').classList.add('hidden');
      return;
    }
  }

  const storyId = q.get('story');
  if (storyId) {
    await openWork(storyId, q.get('play') === '1');
    return;
  }
  if (q.get('new') === '1' || q.get('new') === 'story') {
    openCreateModal();
  }
  renderHome();
}

function bind() {
  $('#mkNewBtn').addEventListener('click', openCreateModal);
  $('#mkModalCancel').addEventListener('click', () => $('#mkModal').classList.remove('show'));
  $('#mkModalOk').addEventListener('click', confirmCreate);
  $('#mkNewTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmCreate(); });
  $$('.mk-orient button').forEach((b) => {
    b.addEventListener('click', () => {
      createOrient = b.dataset.o;
      $$('.mk-orient button').forEach((x) => x.classList.toggle('on', x.dataset.o === createOrient));
    });
  });
  $('#mkAddBtn').addEventListener('click', openAddPicker);
  $('#mkPlayBtn').addEventListener('click', startPlay);
  $('#mkPubBtn').addEventListener('click', togglePublish);
  $('#playClose').addEventListener('click', stopPlay);
  $('#playPrev').addEventListener('click', playPrev);
  $('#playNext').addEventListener('click', playNext);
  $('#mkBack').addEventListener('click', (e) => {
    if (work && $('#viewEdit').classList.contains('show')) {
      e.preventDefault();
      showHome();
    }
  });
}

bind();
route();
