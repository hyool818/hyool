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
const FONT_OPTIONS = [
  { id: 'default', label: '默认', family: '' },
  { id: 'noto-sans', label: '思源黑体', family: '"Noto Sans SC", sans-serif' },
  { id: 'noto-serif', label: '思源宋体', family: '"Noto Serif SC", serif' },
  { id: 'wenkai', label: '霞鹜文楷', family: '"LXGW WenKai", serif' },
  { id: 'zcool-xiaowei', label: '站酷小薇体', family: '"ZCOOL XiaoWei", serif' },
  { id: 'zcool', label: '站酷快乐体', family: '"ZCOOL KuaiLe", cursive' },
  { id: 'zcool-huangyou', label: '站酷黄油体', family: '"ZCOOL QingKe HuangYou", cursive' },
  { id: 'zen-kurenaido', label: '禅楷（细笔）', family: '"Zen Kurenaido", cursive' },
  { id: 'zen-antique', label: '禅古（做旧）', family: '"Zen Antique", serif' },
  { id: 'yuji-syuku', label: '玉辞祝', family: '"Yuji Syuku", serif' },
  { id: 'mashan', label: '马善政手写', family: '"Ma Shan Zheng", cursive' },
  { id: 'longcang', label: '龙藏体', family: '"Long Cang", cursive' },
  { id: 'liu-jian', label: '刘建毛草', family: '"Liu Jian Mao Cao", cursive' },
  { id: 'zhi-mang', label: '志莽星', family: '"Zhi Mang Xing", cursive' },
];
const CROP_PROFILE = {
  landscape: { viewW: 480, viewH: 270, outW: 1280, outH: 720, label: '16:9 横屏' },
  portrait: { viewW: 270, viewH: 480, outW: 1080, outH: 1920, label: '9:16 竖屏' },
};
const TEXT_MODES = {
  caption: { label: '底部字幕', hint: '与对白相同，贴底显示' },
  float: { label: '漂浮字幕', hint: '同一样式，可拖动位置' },
  fullscreen: { label: '全屏强调', hint: '大字居中，适合紧迫感（动效预留）' },
};
const TEXT_EFFECTS = {
  none: { label: '无' },
  pulse: { label: '脉冲' },
};

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

let cropState = { img: null, baseScale: 1, zoom: 1, offsetX: 0, offsetY: 0, viewW: 480, viewH: 270, outW: 1280, outH: 720, drag: false, dragStartX: 0, dragStartY: 0 };
let cropTargetBlock = null;

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
  if (!FONT_OPTIONS.some((f) => f.id === s.textFont)) s.textFont = 'default';
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
  return { x: sub.x != null ? sub.x : 50, y: sub.y != null ? sub.y : 72 };
}

function textMode(b) {
  const sub = ensureSub(b);
  if (b.type === 'dialogue') return 'caption';
  if (sub.mode === 'caption' || sub.mode === 'float' || sub.mode === 'fullscreen') return sub.mode;
  if (sub.x != null || sub.y != null) return 'float';
  return 'caption';
}

function textEffect(b) {
  const e = ensureSub(b).effect;
  return e && TEXT_EFFECTS[e] ? e : 'none';
}

function sceneText(b) {
  if (b.type !== 'scene') return '';
  return String(b.content || '').trim();
}

function captionLabel(b) {
  if (b.type === 'dialogue') return b.speaker || DEFAULT_SPEAKER;
  if (!sceneText(b)) return '';
  const sub = ensureSub(b);
  if (sub.showLabel === false) return '';
  return String(sub.label || '旁白').trim();
}

function formatLine(t) {
  t = String(t || '').trim();
  if (!t) return '……';
  if (/^[「『"“]/.test(t)) return t;
  return '「' + t + '」';
}

function captionContent(b) {
  const t = String(b.content || '').trim();
  if (b.type === 'dialogue') return formatLine(t);
  return t;
}

function hasCaption(b) {
  if (b.type === 'scene') return !!sceneText(b);
  if (b.type === 'dialogue') return !!captionContent(b);
  return false;
}

function buildCaption(b, opts) {
  if (b.type === 'scene' && !sceneText(b)) return null;
  const editing = !!(opts && opts.editing);
  const mode = textMode(b);
  const sz = getGlobalSubSize();
  const wrap = document.createElement('div');
  wrap.className = 'hy-caption mode-' + mode;
  if (editing && mode === 'float') wrap.classList.add('editing');
  const fx = textEffect(b);
  if (fx !== 'none') wrap.classList.add('effect-' + fx);

  const label = captionLabel(b);
  if (label) {
    const sp = document.createElement('div');
    sp.className = 'hy-caption-label';
    sp.textContent = label;
    sp.style.fontSize = Math.round(sz * 1.15) + 'px';
    applySubColor(sp, b);
    applyTextFont(sp);
    wrap.appendChild(sp);
  }

  const ln = document.createElement('div');
  ln.className = 'hy-caption-line';
  ln.textContent = captionContent(b);
  ln.style.fontSize = (mode === 'fullscreen' ? Math.round(sz * 1.35) : sz) + 'px';
  applySubColor(ln, b);
  applyTextFont(ln);
  wrap.appendChild(ln);

  if (mode === 'float') {
    const pos = subPos(b);
    wrap.style.left = pos.x + '%';
    wrap.style.top = pos.y + '%';
    wrap.style.transform = 'translate(-50%,-50%)';
  }
  return wrap;
}

function mountCaption(stage, b, editing) {
  if (!hasCaption(b)) return;
  const cap = buildCaption(b, { editing });
  if (!cap) return;
  if (editing && textMode(b) === 'float') {
    bindCaptionDrag(cap, b, stage);
    const hint = document.createElement('div');
    hint.className = 'scene-drag-hint';
    hint.textContent = '拖动字幕调整位置';
    stage.appendChild(hint);
  }
  stage.appendChild(cap);
}

function applySubColor(el, b) {
  const c = ensureSub(b).color;
  if (c) el.style.color = c;
}

function getWorkFontFamily() {
  const id = work?.textFont || 'default';
  const f = FONT_OPTIONS.find((x) => x.id === id);
  return f?.family || '';
}

function applyTextFont(el) {
  const ff = getWorkFontFamily();
  if (ff) el.style.fontFamily = ff;
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
  if (hasCaption(b)) {
    mountCaption(stage, b, true);
  } else if (b.type === 'choice') {
    const cap = buildCaption({ ...b, type: 'dialogue', speaker: '选项', content: b.content || '请选择' }, { editing: true });
    cap.classList.remove('mode-caption');
    cap.classList.add('mode-float');
    cap.style.left = '50%';
    cap.style.top = '78%';
    cap.style.transform = 'translate(-50%,-50%)';
    stage.appendChild(cap);
  } else if (!b.media?.url) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = b.type === 'scene' ? '写场景文字后，字幕会出现在这里' : '对白会显示在底部';
    stage.appendChild(hint);
  }
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

  const contentLabel = b.type === 'scene' ? '字幕内容' : b.type === 'choice' ? '选项提示' : '对白内容';
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
    const ops = document.createElement('div');
    ops.className = 'mk-bg-ops';
    if (b.media.type !== 'video') {
      const cropBtn = document.createElement('button');
      cropBtn.type = 'button';
      cropBtn.className = 'btn';
      cropBtn.textContent = '✂ 裁剪';
      cropBtn.addEventListener('click', () => recropMedia(b));
      ops.appendChild(cropBtn);
    }
    const replaceBtn = document.createElement('button');
    replaceBtn.type = 'button';
    replaceBtn.className = 'btn';
    replaceBtn.textContent = '更换';
    replaceBtn.addEventListener('click', () => pickMedia(b));
    ops.appendChild(replaceBtn);
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn danger';
    rm.textContent = '移除';
    rm.addEventListener('click', () => { delete b.media; scheduleSave(); renderEdit(); });
    ops.appendChild(rm);
    prev.appendChild(ops);
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
  title.textContent = '文字样式';
  wrap.appendChild(title);

  if (b.type === 'scene') {
    wrap.appendChild(sceneTextModePanel(b, sub));
  }

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

  const fontLab = document.createElement('label');
  fontLab.textContent = '字体（全作品统一）';
  fontLab.style.marginTop = '10px';
  wrap.appendChild(fontLab);
  const fontSel = document.createElement('select');
  FONT_OPTIONS.forEach((f) => {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = f.label;
    if ((work?.textFont || 'default') === f.id) o.selected = true;
    fontSel.appendChild(o);
  });
  fontSel.addEventListener('change', () => {
    if (!work) return;
    work.textFont = fontSel.value;
    scheduleSave();
    renderPreview();
    if (playing) renderPlay();
  });
  wrap.appendChild(fontSel);

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

  if (b.type === 'scene' && textMode(b) === 'float') {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn';
    reset.style.marginTop = '8px';
    reset.textContent = '重置漂浮位置';
    reset.addEventListener('click', () => {
      delete sub.x;
      delete sub.y;
      scheduleSave();
      renderPreview();
      toast('已重置位置');
    });
    wrap.appendChild(reset);
  }
  return wrap;
}

function sceneTextModePanel(b, sub) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.innerHTML = '<label>呈现方式</label>';
  const modeSel = document.createElement('select');
  Object.entries(TEXT_MODES).forEach(([id, m]) => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = m.label;
    if (textMode(b) === id) o.selected = true;
    modeSel.appendChild(o);
  });
  wrap.appendChild(modeSel);
  const hint = document.createElement('p');
  hint.style.cssText = 'font-size:11px;color:var(--muted);line-height:1.55;margin-top:6px';
  hint.textContent = TEXT_MODES[textMode(b)]?.hint || '';
  modeSel.addEventListener('change', () => {
    sub.mode = modeSel.value;
    hint.textContent = TEXT_MODES[modeSel.value]?.hint || '';
    scheduleSave();
    renderEdit();
  });
  wrap.appendChild(hint);

  wrap.appendChild(field('标题（可选）', 'text', sub.label || '旁白', (v) => {
    sub.label = v.trim() || '旁白';
    scheduleSave();
    renderPreview();
    if (playing) renderPlay();
  }));

  const fxWrap = document.createElement('div');
  fxWrap.className = 'field';
  fxWrap.innerHTML = '<label>动效</label>';
  const fxSel = document.createElement('select');
  Object.entries(TEXT_EFFECTS).forEach(([id, m]) => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = m.label;
    if (textEffect(b) === id) o.selected = true;
    fxSel.appendChild(o);
  });
  fxSel.addEventListener('change', () => {
    if (fxSel.value === 'none') delete sub.effect;
    else sub.effect = fxSel.value;
    scheduleSave();
    renderPreview();
    if (playing) renderPlay();
  });
  fxWrap.appendChild(fxSel);
  const fxHint = document.createElement('p');
  fxHint.style.cssText = 'font-size:11px;color:var(--muted);line-height:1.55;margin-top:6px';
  fxHint.textContent = '更多动态文字（打字机、震屏等）后续加入';
  fxWrap.appendChild(fxHint);
  wrap.appendChild(fxWrap);
  return wrap;
}

function bindCaptionDrag(el, b, stage) {
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
    await handleMediaFile(f, b);
  });
  inp.click();
}

async function handleMediaFile(f, b) {
  if (/^video\//.test(f.type)) {
    toast('上传中…');
    const media = await uploadFile(f);
    if (!media) return;
    b.media = media;
    scheduleSave();
    renderEdit();
    toast('背景已添加');
    return;
  }
  if (!/^image\//.test(f.type)) {
    toast('请选图片或 MP4 视频', true);
    return;
  }
  if (f.type === 'image/gif') {
    toast('上传中…');
    const media = await uploadFile(f);
    if (!media) return;
    b.media = media;
    scheduleSave();
    renderEdit();
    toast('背景已添加');
    return;
  }
  openCropModal(f, b);
}

async function recropMedia(b) {
  if (!b.media?.url || b.media.type === 'video') return;
  try {
    toast('加载图片…');
    const img = await loadImageFromUrl(b.media.url);
    openCropWithImage(img, b);
  } catch (e) {
    toast('无法加载图片', true);
  }
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load fail'));
    img.src = url;
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('parse fail'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('read fail'));
    reader.readAsDataURL(file);
  });
}

function cropProfile() {
  return CROP_PROFILE[work?.orientation === 'portrait' ? 'portrait' : 'landscape'];
}

function setupCropView() {
  const p = cropProfile();
  cropState.viewW = p.viewW;
  cropState.viewH = p.viewH;
  cropState.outW = p.outW;
  cropState.outH = p.outH;
  const canvas = $('#cropCanvas');
  canvas.width = p.viewW;
  canvas.height = p.viewH;
  canvas.style.width = p.viewW + 'px';
  canvas.style.height = p.viewH + 'px';
  const hint = $('#cropHint');
  if (hint) hint.textContent = p.label + ' · ' + p.outW + '×' + p.outH;
}

function clampCropOffset() {
  const scale = cropState.baseScale * cropState.zoom;
  const sw = cropState.img.width * scale;
  const sh = cropState.img.height * scale;
  const maxOX = Math.max(0, (sw - cropState.viewW) / 2);
  const maxOY = Math.max(0, (sh - cropState.viewH) / 2);
  cropState.offsetX = Math.min(maxOX, Math.max(-maxOX, cropState.offsetX));
  cropState.offsetY = Math.min(maxOY, Math.max(-maxOY, cropState.offsetY));
}

function renderCrop() {
  const canvas = $('#cropCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = cropState.viewW;
  const H = cropState.viewH;
  ctx.fillStyle = '#0a0a12';
  ctx.fillRect(0, 0, W, H);
  if (!cropState.img) return;
  clampCropOffset();
  const scale = cropState.baseScale * cropState.zoom;
  const sw = cropState.img.width * scale;
  const sh = cropState.img.height * scale;
  const drawX = W / 2 - sw / 2 + cropState.offsetX;
  const drawY = H / 2 - sh / 2 + cropState.offsetY;
  ctx.drawImage(cropState.img, drawX, drawY, sw, sh);
  ctx.strokeStyle = 'rgba(139,123,255,.65)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);
}

function openCropWithImage(img, block) {
  cropTargetBlock = block;
  setupCropView();
  cropState.img = img;
  cropState.baseScale = Math.max(cropState.viewW / img.width, cropState.viewH / img.height);
  cropState.zoom = 1;
  cropState.offsetX = 0;
  cropState.offsetY = 0;
  const zoomEl = $('#cropZoom');
  if (zoomEl) zoomEl.value = '100';
  renderCrop();
  $('#cropBackdrop').classList.add('show');
  $('#cropConfirm').disabled = false;
}

async function openCropModal(file, block) {
  try {
    const img = await loadImageFromFile(file);
    openCropWithImage(img, block);
  } catch (e) {
    toast('图片读取失败', true);
  }
}

function closeCropModal() {
  $('#cropBackdrop').classList.remove('show');
  cropState.img = null;
  cropTargetBlock = null;
  cropState.drag = false;
}

async function confirmCrop() {
  if (!cropState.img || !cropTargetBlock) return;
  const btn = $('#cropConfirm');
  btn.disabled = true;
  const W = cropState.viewW;
  const H = cropState.viewH;
  const scale = cropState.baseScale * cropState.zoom;
  const sw = cropState.img.width * scale;
  const sh = cropState.img.height * scale;
  const drawX = W / 2 - sw / 2 + cropState.offsetX;
  const drawY = H / 2 - sh / 2 + cropState.offsetY;
  const srcX = -drawX / scale;
  const srcY = -drawY / scale;
  const srcW = W / scale;
  const srcH = H / scale;
  const out = document.createElement('canvas');
  out.width = cropState.outW;
  out.height = cropState.outH;
  out.getContext('2d').drawImage(cropState.img, srcX, srcY, srcW, srcH, 0, 0, out.width, out.height);
  const block = cropTargetBlock;
  closeCropModal();
  out.toBlob(async (blob) => {
    btn.disabled = false;
    if (!blob) { toast('裁剪失败', true); return; }
    toast('上传中…');
    const file = new File([blob], 'bg.jpg', { type: 'image/jpeg' });
    const media = await uploadFile(file);
    if (!media) return;
    block.media = media;
    scheduleSave();
    renderEdit();
    toast('背景已更新');
  }, 'image/jpeg', 0.9);
}

function bindCrop() {
  $('#cropCancel').addEventListener('click', closeCropModal);
  $('#cropConfirm').addEventListener('click', confirmCrop);
  $('#cropZoomOut').addEventListener('click', () => {
    cropState.zoom = Math.max(1, +(cropState.zoom - 0.1).toFixed(2));
    $('#cropZoom').value = String(Math.round(cropState.zoom * 100));
    renderCrop();
  });
  $('#cropZoomIn').addEventListener('click', () => {
    cropState.zoom = Math.min(4, +(cropState.zoom + 0.1).toFixed(2));
    $('#cropZoom').value = String(Math.round(cropState.zoom * 100));
    renderCrop();
  });
  $('#cropZoom').addEventListener('input', (e) => {
    cropState.zoom = parseFloat(e.target.value) / 100;
    renderCrop();
  });
  const canvas = $('#cropCanvas');
  canvas.addEventListener('pointerdown', (e) => {
    cropState.drag = true;
    cropState.dragStartX = e.clientX - cropState.offsetX;
    cropState.dragStartY = e.clientY - cropState.offsetY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!cropState.drag) return;
    cropState.offsetX = e.clientX - cropState.dragStartX;
    cropState.offsetY = e.clientY - cropState.dragStartY;
    renderCrop();
  });
  canvas.addEventListener('pointerup', () => { cropState.drag = false; });
  canvas.addEventListener('pointercancel', () => { cropState.drag = false; });
  $('#cropBackdrop').addEventListener('click', (e) => {
    if (e.target === $('#cropBackdrop')) closeCropModal();
  });
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
  if (hasCaption(b)) {
    const cap = buildCaption(b, { editing: false });
    if (cap) {
      if (textMode(b) === 'float' || textMode(b) === 'fullscreen') {
        frame.appendChild(cap);
      } else {
        fore.appendChild(cap);
      }
    }
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
  bindCrop();
}

bind();
route();
