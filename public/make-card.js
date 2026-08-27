/**
 * 卡牌游戏 · 小白可视化编辑器（对齐 make.html 三栏：列表 / 预览 / 属性）
 */
import { toast } from '/workspace/js/ui.js';
import {
  normalizeRogue,
  applyStarterPack,
  startRogueRun,
  stopRogueRun,
  cardGuideText,
  CARD_MODES,
  buildRogueDemoData,
} from '/story-rogue.js';
import {
  portraitHtml,
  portraitThumbHtml,
  STAR_TIERS,
  STAR_MAX,
  starTierLabel,
  starTierFullLabel,
  normalizeCardFrame,
} from '/story-idle.js';

const PAGE = '/make-card.html';
const WORK_KIND = 'gacha_rogue';
const TOKEN_KEY = 'hyool_token';
const MAX_FILE = 5 * 1024 * 1024;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let loggedIn = false;
let works = [];
let work = null;
let createOrient = 'portrait';
let createMode = 'idle';
let select = { type: 'settings', id: null };
let uploadTimer = null;

const uid = () => 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function authHeaders() {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t ? { Authorization: 'Bearer ' + t } : {};
  } catch (e) { return {}; }
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function rogue() {
  if (!work) return null;
  if (!work.rogue) work.rogue = normalizeRogue(null);
  return work.rogue;
}

function liveChar(id) {
  return rogue()?.roster?.find((x) => x.id === id) || null;
}

function setSave(st) {
  const el = $('#mcSave');
  if (!el) return;
  el.textContent = st === 'saving' ? '保存中…' : st === 'ok' ? '已保存 ✓' : st === 'err' ? '保存失败' : '';
  el.style.color = st === 'err' ? 'var(--bad)' : st === 'ok' ? 'var(--good)' : 'var(--muted)';
}

function normalizeWork(s) {
  if (!s || typeof s !== 'object') return null;
  s.kind = WORK_KIND;
  if (s.orientation !== 'landscape') s.orientation = 'portrait';
  s.rogue = normalizeRogue(s.rogue);
  if (!Array.isArray(s.chapters) || !s.chapters.length) {
    s.chapters = [{ id: uid(), title: '第一章', blocks: [{ id: uid(), type: 'rogue', content: '卡牌试玩' }] }];
  }
  return s;
}

async function checkAuth() {
  try {
    const res = await fetch('/api/me', { credentials: 'include', headers: authHeaders() });
    const d = await res.json().catch(() => ({}));
    loggedIn = !!(d.authenticated && d.user);
  } catch (e) { loggedIn = false; }
}

async function loadWorksList() {
  const res = await fetch('/api/stories', { credentials: 'include', headers: authHeaders() });
  const d = await res.json();
  if (!d.success) {
    if (res.status === 401) throw new Error('login');
    throw new Error(d.error || '加载失败');
  }
  return (d.stories || []).filter((w) => (w.kind || 'story') === WORK_KIND);
}

async function loadWork(id) {
  const res = await fetch('/api/stories/' + encodeURIComponent(id), { credentials: 'include', headers: authHeaders() });
  const d = await res.json();
  if (!d.success || !d.story) throw new Error(d.error || '作品不存在');
  if ((d.story.kind || 'story') !== WORK_KIND) throw new Error('不是卡牌作品');
  return normalizeWork({ ...d.story });
}

function scheduleSave() {
  if (!work || !loggedIn) return;
  setSave('saving');
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = setTimeout(saveWork, 700);
}

async function saveWork() {
  if (!work || !loggedIn) return;
  work.kind = WORK_KIND;
  try {
    const res = await fetch('/api/stories/' + encodeURIComponent(work.id), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ data: work }),
    });
    const d = await res.json();
    if (!d.success) { setSave('err'); toast(d.error || '保存失败', true); return; }
    setSave('ok');
    if (d.story?.status) work.status = d.story.status;
  } catch (e) {
    setSave('err');
    toast('网络异常', true);
  }
}

async function createWork(title, orientation, mode) {
  const res = await fetch('/api/stories', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ title, orientation, imgQuality: 'standard', kind: WORK_KIND }),
  });
  const d = await res.json();
  if (!d.success) throw new Error(d.error || '创建失败');
  const s = normalizeWork({ ...d.story });
  applyStarterPack(s, mode || 'idle');
  await fetch('/api/stories/' + encodeURIComponent(s.id), {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ data: s }),
  });
  return s;
}

async function deleteWorkById(id, title) {
  if (!confirm('删除「' + title + '」？不可恢复。')) return;
  const res = await fetch('/api/stories/' + encodeURIComponent(id) + '/delete', {
    method: 'POST', credentials: 'include', headers: authHeaders(),
  });
  const d = await res.json().catch(() => ({}));
  if (!d.success) { toast(d.error || '删除失败', true); return; }
  toast('已删除');
  showHome();
}

async function togglePublish() {
  if (!work) return;
  const target = work.status !== 'published';
  if (target && !confirm('发布「' + work.title + '」？')) return;
  const res = await fetch('/api/stories/' + encodeURIComponent(work.id) + '/publish', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ published: target }),
  });
  const d = await res.json();
  if (!d.success) { toast(d.error || '失败', true); return; }
  work.status = d.story.status;
  $('#mcPubBtn').textContent = work.status === 'published' ? '下架' : '发布';
  toast(target ? '已发布' : '已下架');
}

async function uploadFile(file) {
  if (!/^image\//.test(file.type)) { toast('请选图片', true); return null; }
  if (file.size > MAX_FILE) { toast('不能超过 5MB', true); return null; }
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', credentials: 'include', headers: authHeaders(), body: fd });
  const d = await res.json();
  if (!d.success || !d.url) { toast(d.error || '上传失败', true); return null; }
  return { url: d.url, type: 'image' };
}

// ---------- 视图 ----------
async function showHome() {
  work = null;
  select = { type: 'settings', id: null };
  history.replaceState(null, '', PAGE);
  $('#viewHome').classList.remove('hidden');
  $('#viewEdit').classList.remove('show');
  $('#mcPlayBtn').style.display = 'none';
  $('#mcPubBtn').style.display = 'none';
  $('#mcDelBtn').style.display = 'none';
  $('#mcBrand').textContent = '卡牌游戏';
  $('#mcBrandSub').textContent = 'CARD';
  try {
    works = await loadWorksList();
  } catch (e) {
    if (e.message === 'login') {
      $('#mcLogin').classList.remove('hidden');
      $('#mcApp').classList.add('hidden');
      return;
    }
  }
  $('#mcLogin').classList.add('hidden');
  $('#mcApp').classList.remove('hidden');
  renderHome();
}

function showEdit() {
  $('#viewHome').classList.add('hidden');
  $('#viewEdit').classList.add('show');
  $('#mcPlayBtn').style.display = '';
  $('#mcPubBtn').style.display = '';
  $('#mcDelBtn').style.display = '';
  $('#mcBrand').textContent = work?.title || '未命名';
  $('#mcBrandSub').textContent = '编辑中';
  $('#mcPubBtn').textContent = work?.status === 'published' ? '下架' : '发布';
  renderEdit();
  history.replaceState(null, '', PAGE + '?story=' + encodeURIComponent(work.id));
}

function renderHome() {
  const grid = $('#mcGrid');
  grid.innerHTML = '';
  const mine = works.filter((w) => w.kind === WORK_KIND);
  $('#mcEmpty').classList.toggle('hidden', mine.length > 0);
  mine.forEach((w) => {
    const card = document.createElement('div');
    card.className = 'mc-card';
    const cover = w.cover_image ? '<img src="' + escapeHtml(w.cover_image) + '" alt="">' : '🂠';
    card.innerHTML =
      '<div class="row"><div class="thumb">' + cover + '</div><div class="info">' +
      '<div class="title">' + escapeHtml(w.title) + '</div>' +
      '<div class="meta">' + (w.status === 'published' ? '已发布' : '草稿') + '</div></div></div>' +
      '<div class="ops"><button type="button" class="btn primary play-btn">▶ 试玩</button>' +
      '<button type="button" class="btn edit-btn">编辑</button>' +
      '<button type="button" class="btn danger del-btn">删除</button></div>';
    card.querySelector('.edit-btn').addEventListener('click', (e) => { e.stopPropagation(); openWork(w.id, false); });
    card.querySelector('.play-btn').addEventListener('click', (e) => { e.stopPropagation(); openWork(w.id, true); });
    card.querySelector('.del-btn').addEventListener('click', (e) => { e.stopPropagation(); deleteWorkById(w.id, w.title); });
    card.addEventListener('click', () => openWork(w.id, false));
    grid.appendChild(card);
  });
}

async function openWork(id, play) {
  try {
    work = await loadWork(id);
    select = { type: 'settings', id: null };
    showEdit();
    if (play) startPlay();
  } catch (e) {
    toast(e.message || '打不开', true);
  }
}

function renderEdit() {
  renderGuide();
  renderList();
  renderPreview();
  renderPanel();
  const stage = $('#mcStage');
  stage.classList.toggle('landscape', work?.orientation === 'landscape');
  stage.classList.toggle('portrait', work?.orientation !== 'landscape');
}

function charPreviewMeta(c) {
  let meta = starTierFullLabel(c.star || 1) + ' · 生命 ' + c.hp + ' · 攻击 ' + c.atk + '<br>速度 ' + c.spd;
  if (c.desc) meta += '<br>' + escapeHtml(c.desc);
  return meta;
}

function tierField(label, value, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const lab = document.createElement('label');
  lab.textContent = label;
  const sel = document.createElement('select');
  STAR_TIERS.forEach((t) => {
    const o = document.createElement('option');
    o.value = String(t.star);
    o.textContent = `${t.label}｜${t.hint}`;
    if (t.star === starOf(value)) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => onChange(Number(sel.value) || 1));
  wrap.append(lab, sel);
  return wrap;
}

function starOf(n) {
  return Math.max(1, Math.min(STAR_MAX, Math.round(Number(n) || 1)));
}

function patchListLabel(type, id, text) {
  const sel = id
    ? `#mcList .mc-item[data-type="${type}"][data-id="${CSS.escape(id)}"]`
    : `#mcList .mc-item[data-type="${type}"]`;
  const txt = document.querySelector(sel + ' .txt');
  if (txt) txt.textContent = text || '未命名';
}

function patchListCharThumb(c) {
  const btn = document.querySelector(`#mcList .mc-item[data-type="char"][data-id="${CSS.escape(c.id)}"]`);
  if (!btn) return;
  if (c.portrait) {
    let thumb = btn.querySelector('.thumb');
    if (!thumb) {
      btn.querySelector('.ico')?.remove();
      thumb = document.createElement('span');
      thumb.className = 'thumb';
      btn.insertBefore(thumb, btn.querySelector('.txt'));
    }
    thumb.innerHTML = '<img src="' + escapeHtml(c.portrait) + '" alt="">';
  } else {
    btn.querySelector('.thumb')?.remove();
    if (!btn.querySelector('.ico')) {
      const ico = document.createElement('span');
      ico.className = 'ico';
      ico.textContent = '🧑';
      btn.insertBefore(ico, btn.querySelector('.txt'));
    }
  }
}

function replaceCharPreviewCard(c) {
  const wrap = $('#mcStage .card-big');
  if (!wrap) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = portraitHtml(c, 'goddess-card book card-frame', work?.assets || []);
  const newCard = tmp.firstElementChild;
  if (!newCard) return;
  const oldCard = wrap.querySelector('.goddess-card');
  if (oldCard) oldCard.replaceWith(newCard);
  else wrap.insertBefore(newCard, wrap.firstChild);
}

function syncCharViews(c, opts = {}) {
  patchListLabel('char', c.id, c.name);
  patchListCharThumb(c);
  if (select.type !== 'char' || select.id !== c.id) return;
  const stage = $('#mcStage');
  if (!stage) return;
  let nameEl = stage.querySelector('.card-name');
  let metaEl = stage.querySelector('.card-meta');
  if (!nameEl || !metaEl) {
    renderPreview();
    nameEl = stage.querySelector('.card-name');
    metaEl = stage.querySelector('.card-meta');
  }
  if (nameEl) nameEl.textContent = c.name || '';
  if (metaEl) metaEl.innerHTML = charPreviewMeta(c);
  if (opts.portrait) replaceCharPreviewCard(c);
  else {
    const cardEl = stage.querySelector('.goddess-card');
    const nm = cardEl?.querySelector('.nm');
    if (nm) nm.textContent = c.name || '';
    const star = cardEl?.querySelector('.star');
    if (star) {
      const fid = normalizeCardFrame(c.frame, c.star);
      star.textContent = starTierLabel(c.star || 1);
      star.className = 'star tier-' + fid;
    }
  }
}

function syncEnemyViews(e) {
  patchListLabel('enemy', e.id, e.name);
  if (select.type !== 'enemy' || select.id !== e.id) return;
  const nameEl = $('#mcStage .card-name');
  if (nameEl) nameEl.textContent = '👹 ' + (e.name || '');
  else renderPreview();
  // 关卡面板里敌人多选标签同步
  $$('#mcPanel .mc-enemy-pick').forEach((row) => {
    if (row.dataset.enemyId !== e.id) return;
    const tail = row.childNodes[row.childNodes.length - 1];
    if (tail) tail.textContent = ' ' + (e.name || '');
  });
}

function syncStageViews(s) {
  patchListLabel('stage', s.id, s.title || '未命名关卡');
  if (select.type === 'stage' && select.id === s.id) renderPreview();
}

function refreshPortraitPanel(charId) {
  const c = liveChar(charId);
  const sec = $('#mcPortraitField');
  if (!sec || !c || select.type !== 'char' || select.id !== charId) return;
  sec.innerHTML = '<label>立绘</label>';
  if (c.portrait) {
    sec.innerHTML += '<div class="mc-bg-preview"><img src="' + escapeHtml(c.portrait) + '" alt=""></div>';
    const ops = document.createElement('div');
    ops.className = 'mc-bg-ops';
    ops.append(
      btn('更换', () => pickPortrait(charId)),
      btn('移除', () => clearPortrait(charId), true),
    );
    sec.appendChild(ops);
  } else {
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'mc-bg-btn';
    up.textContent = '🖼 上传立绘';
    up.addEventListener('click', () => pickPortrait(charId));
    sec.appendChild(up);
  }
}

function clearPortrait(charId) {
  const c = liveChar(charId);
  if (!c) return;
  delete c.portrait;
  delete c.portraitKind;
  scheduleSave();
  renderList();
  renderPreview();
  refreshPortraitPanel(charId);
}

function renderGuide() {
  const g = cardGuideText(work);
  const el = $('#mcGuide');
  el.textContent = g.title + ' · ' + g.line + '（' + g.counts + '）';
  el.classList.toggle('ready', g.ready);
}

function renderList() {
  const host = $('#mcList');
  host.innerHTML = '';
  const r = rogue();
  if (!r) return;

  const mkItem = (type, id, ico, label, thumbHtml) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mc-item' + (select.type === type && select.id === id ? ' on' : '');
    btn.dataset.type = type;
    if (id) btn.dataset.id = id;
    btn.innerHTML = (thumbHtml ? '<span class="thumb">' + thumbHtml + '</span>' : '<span class="ico">' + ico + '</span>') +
      '<span class="txt">' + escapeHtml(label) + '</span>';
    btn.addEventListener('click', () => { select = { type, id }; renderEdit(); });
    return btn;
  };

  host.appendChild(mkItem('settings', null, '⚙', '玩法与设置', ''));

  const secC = document.createElement('div');
  secC.className = 'mc-sec';
  secC.innerHTML = '<span>角色</span>';
  const addC = document.createElement('button');
  addC.type = 'button';
  addC.className = 'btn';
  addC.textContent = '＋';
  addC.addEventListener('click', () => addChar());
  secC.appendChild(addC);
  host.appendChild(secC);
  r.roster.forEach((c) => {
    const thumb = c.portrait ? '<img src="' + escapeHtml(c.portrait) + '" alt="">' : '';
    host.appendChild(mkItem('char', c.id, '🧑', c.name, thumb));
  });

  const secS = document.createElement('div');
  secS.className = 'mc-sec';
  secS.innerHTML = '<span>关卡</span>';
  const addS = document.createElement('button');
  addS.type = 'button';
  addS.className = 'btn';
  addS.textContent = '＋';
  addS.addEventListener('click', () => addStage());
  secS.appendChild(addS);
  host.appendChild(secS);
  (r.stages || []).forEach((s) => {
    host.appendChild(mkItem('stage', s.id, '⚔', s.title || '未命名关卡', ''));
  });

  const secE = document.createElement('div');
  secE.className = 'mc-sec';
  secE.innerHTML = '<span>敌人</span>';
  const addE = document.createElement('button');
  addE.type = 'button';
  addE.className = 'btn';
  addE.textContent = '＋';
  addE.addEventListener('click', () => addEnemy());
  secE.appendChild(addE);
  host.appendChild(secE);
  (r.enemies || []).forEach((e) => {
    host.appendChild(mkItem('enemy', e.id, '👹', e.name, ''));
  });
}

function selectedChar() {
  const r = rogue();
  return r?.roster?.find((c) => c.id === select.id) || null;
}

function selectedStage() {
  const r = rogue();
  return r?.stages?.find((s) => s.id === select.id) || null;
}

function selectedEnemy() {
  const r = rogue();
  return r?.enemies?.find((e) => e.id === select.id) || null;
}

function renderPreview() {
  const stage = $('#mcStage');
  stage.innerHTML = '';
  const r = rogue();

  if (select.type === 'char') {
    const c = selectedChar();
    if (!c) { stage.innerHTML = '<div class="empty-hint">选一名角色</div>'; return; }
    const wrap = document.createElement('div');
    wrap.className = 'card-big';
    wrap.innerHTML = portraitHtml(c, 'goddess-card book card-frame', work?.assets || []) +
      '<div class="card-name">' + escapeHtml(c.name) + '</div>' +
      '<div class="card-meta">' + charPreviewMeta(c) + '</div>';
    stage.appendChild(wrap);
    return;
  }

  if (select.type === 'enemy') {
    const e = selectedEnemy();
    if (!e) { stage.innerHTML = '<div class="empty-hint">选一个敌人</div>'; return; }
    stage.innerHTML = '<div class="card-name">👹 ' + escapeHtml(e.name) + '</div>' +
      '<div class="card-meta">生命 ' + e.hp + ' · 攻击 ' + e.atk + ' · 速度 ' + e.spd +
      (e.isBoss ? '<br><strong>BOSS</strong>' : '') + '</div>';
    return;
  }

  if (select.type === 'stage') {
    const s = selectedStage();
    if (!s) { stage.innerHTML = '<div class="empty-hint">选一关</div>'; return; }
    const names = (s.enemyIds || []).map((id) => r.enemies.find((x) => x.id === id)?.name || id).join('、') || '（未配敌人）';
    stage.innerHTML = '<div class="card-name">⚔ ' + escapeHtml(s.title || '关卡') + '</div>' +
      '<div class="card-meta">出战：' + escapeHtml(names) + '</div>';
    return;
  }

  stage.innerHTML = '<div class="empty-hint"><strong>' + escapeHtml(CARD_MODES[r.mode]?.label || '卡牌') + '</strong><br><br>' +
    escapeHtml(CARD_MODES[r.mode]?.hint || '') + '</div>';
}

function field(label, tag, value, onInput, opts = {}) {
  const maxLen = opts.maxLen || 0;
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const lab = document.createElement('label');
  lab.textContent = label;
  const el = document.createElement(tag === 'textarea' ? 'textarea' : 'input');
  if (tag !== 'textarea') el.type = tag === 'number' ? 'number' : 'text';
  if (tag !== 'number') {
    el.setAttribute('lang', 'zh-CN');
    el.autocomplete = 'off';
    el.spellcheck = false;
  }
  el.value = value;
  let composing = false;
  const fire = () => {
    let v = el.value;
    if (maxLen > 0 && v.length > maxLen) {
      v = v.slice(0, maxLen);
      el.value = v;
    }
    onInput(v);
  };
  el.addEventListener('compositionstart', () => { composing = true; });
  el.addEventListener('compositionend', () => {
    composing = false;
    fire();
  });
  el.addEventListener('input', () => {
    if (composing) return;
    fire();
  });
  el.addEventListener('blur', fire);
  wrap.append(lab, el);
  return wrap;
}

function btn(text, fn, danger) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn' + (danger ? ' danger' : '');
  b.textContent = text;
  b.addEventListener('click', fn);
  return b;
}

function renderPanel() {
  const panel = $('#mcPanel');
  panel.innerHTML = '';
  const r = rogue();
  if (!r) return;

  const foot = document.createElement('div');
  foot.className = 'mc-panel-foot';

  if (select.type === 'settings') {
    const modeLab = document.createElement('label');
    modeLab.className = 'field';
    modeLab.textContent = '玩法模式';
    panel.appendChild(modeLab);
    const pick = document.createElement('div');
    pick.className = 'mc-mode-pick';
    Object.values(CARD_MODES).forEach((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mc-mode-btn' + (r.mode === m.id ? ' on' : '');
      b.innerHTML = '<strong>' + m.label + '</strong><span>' + m.hint + '</span>';
      b.addEventListener('click', () => {
        r.mode = m.id;
        scheduleSave();
        renderEdit();
      });
      pick.appendChild(b);
    });
    panel.appendChild(pick);
    panel.appendChild(field('作品名', 'text', work.title || '', (v) => {
      work.title = v.slice(0, 40);
      $('#mcBrand').textContent = work.title || '未命名';
      scheduleSave();
    }));
    const demo = btn('填入示例数据', () => {
      applyStarterPack(work, r.mode);
      scheduleSave();
      renderEdit();
      toast('已填入示例');
    });
    foot.append(demo);
    panel.appendChild(foot);
    return;
  }

  if (select.type === 'char') {
    const c = selectedChar();
    if (!c) return;
    panel.appendChild(field('角色名', 'text', c.name, (v) => { c.name = v; scheduleSave(); syncCharViews(c); }, { maxLen: 16 }));
    panel.appendChild(field('简介', 'textarea', c.desc || '', (v) => { c.desc = v; scheduleSave(); syncCharViews(c); }, { maxLen: 120 }));
    panel.appendChild(field('生命', 'number', String(c.hp), (v) => { c.hp = Math.max(40, Math.min(99999, Number(v) || 120)); scheduleSave(); syncCharViews(c); }));
    panel.appendChild(field('攻击', 'number', String(c.atk), (v) => { c.atk = Math.max(4, Math.min(99, Number(v) || 18)); scheduleSave(); syncCharViews(c); }));
    panel.appendChild(field('速度', 'number', String(c.spd), (v) => { c.spd = Math.max(6, Math.min(40, Number(v) || 16)); scheduleSave(); syncCharViews(c); }));
    panel.appendChild(tierField('品阶', c.star, (v) => {
      c.star = starOf(v);
      c.frame = '';
      scheduleSave();
      syncCharViews(c, { portrait: true });
    }));
    const bgSec = document.createElement('div');
    bgSec.className = 'field mc-portrait-field';
    bgSec.id = 'mcPortraitField';
    bgSec.innerHTML = '<label>立绘</label>';
    if (c.portrait) {
      bgSec.innerHTML += '<div class="mc-bg-preview"><img src="' + escapeHtml(c.portrait) + '" alt=""></div>';
      const ops = document.createElement('div');
      ops.className = 'mc-bg-ops';
      ops.append(
        btn('更换', () => pickPortrait(c.id)),
        btn('移除', () => clearPortrait(c.id), true),
      );
      bgSec.appendChild(ops);
    } else {
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'mc-bg-btn';
      up.textContent = '🖼 上传立绘';
      up.addEventListener('click', () => pickPortrait(c.id));
      bgSec.appendChild(up);
    }
    panel.appendChild(bgSec);
    foot.append(btn('删除角色', () => removeChar(c.id), true));
    panel.appendChild(foot);
    return;
  }

  if (select.type === 'enemy') {
    const e = selectedEnemy();
    if (!e) return;
    panel.appendChild(field('敌人名', 'text', e.name, (v) => { e.name = v; scheduleSave(); syncEnemyViews(e); }, { maxLen: 16 }));
    panel.appendChild(field('生命', 'number', String(e.hp), (v) => { e.hp = Math.max(1, Math.min(99999, Number(v) || 50)); scheduleSave(); renderPreview(); }));
    panel.appendChild(field('攻击', 'number', String(e.atk), (v) => { e.atk = Math.max(1, Math.min(99, Number(e.atk) || 8)); scheduleSave(); renderPreview(); }));
    panel.appendChild(field('速度', 'number', String(e.spd), (v) => { e.spd = Math.max(1, Math.min(40, Number(e.spd) || 12)); scheduleSave(); renderPreview(); }));
    const bossWrap = document.createElement('label');
    bossWrap.className = 'mc-enemy-pick';
    const bossCk = document.createElement('input');
    bossCk.type = 'checkbox';
    bossCk.checked = !!e.isBoss;
    bossCk.addEventListener('change', () => { e.isBoss = bossCk.checked; scheduleSave(); renderPreview(); });
    bossWrap.append(bossCk, document.createTextNode(' BOSS'));
    panel.appendChild(bossWrap);
    foot.append(btn('删除敌人', () => removeEnemy(e.id), true));
    panel.appendChild(foot);
    return;
  }

  if (select.type === 'stage') {
    const s = selectedStage();
    if (!s) return;
    panel.appendChild(field('关卡名', 'text', s.title || '', (v) => { s.title = v; scheduleSave(); syncStageViews(s); }, { maxLen: 40 }));
    const lab = document.createElement('label');
    lab.textContent = '本关敌人（可多选）';
    panel.appendChild(lab);
    const picks = document.createElement('div');
    picks.className = 'mc-enemy-picks';
    if (!r.enemies.length) {
      picks.innerHTML = '<p style="font-size:12px;color:var(--muted)">请先在「敌人」里添加</p>';
    } else {
      r.enemies.forEach((e) => {
        const row = document.createElement('label');
        row.className = 'mc-enemy-pick';
        row.dataset.enemyId = e.id;
        const ck = document.createElement('input');
        ck.type = 'checkbox';
        ck.value = e.id;
        ck.checked = (s.enemyIds || []).includes(e.id);
        ck.addEventListener('change', () => {
          if (!Array.isArray(s.enemyIds)) s.enemyIds = [];
          if (ck.checked) s.enemyIds.push(e.id);
          else s.enemyIds = s.enemyIds.filter((x) => x !== e.id);
          scheduleSave();
          renderPreview();
        });
        row.append(ck, document.createTextNode(' ' + e.name));
        picks.appendChild(row);
      });
    }
    panel.appendChild(picks);
    foot.append(btn('删除关卡', () => removeStage(s.id), true));
    panel.appendChild(foot);
  }
}

function pickPortrait(charId) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.addEventListener('change', async () => {
    const f = inp.files?.[0];
    if (!f) return;
    toast('上传中…');
    const media = await uploadFile(f);
    if (!media) return;
    const c = liveChar(charId);
    if (!c) { toast('角色不存在', true); return; }
    c.portrait = media.url;
    c.portraitKind = 'image';
    scheduleSave();
    renderList();
    renderPreview();
    refreshPortraitPanel(charId);
    toast('立绘已更新');
  });
  inp.click();
}

function addChar() {
  const r = rogue();
  const c = { id: uid(), name: '新角色', elem: 'fire', faction: 'light', star: 3, hp: 120, atk: 18, spd: 16, skillIds: [], portrait: '', desc: '' };
  if (r.mode === 'idle') { c.faction = 'light'; c.elem = 'light'; }
  r.roster.push(c);
  select = { type: 'char', id: c.id };
  scheduleSave();
  renderEdit();
}

function removeChar(id) {
  if (!confirm('删除这个角色？')) return;
  const r = rogue();
  r.roster = r.roster.filter((c) => c.id !== id);
  r.stages.forEach((s) => { if (s.enemyIds) s.enemyIds = s.enemyIds.filter((x) => x !== id); });
  if (select.type === 'char' && select.id === id) select = { type: 'settings', id: null };
  scheduleSave();
  renderEdit();
}

function addEnemy() {
  const r = rogue();
  const e = { id: uid(), name: '新敌人', elem: 'dark', hp: 50, atk: 8, spd: 12 };
  r.enemies.push(e);
  select = { type: 'enemy', id: e.id };
  scheduleSave();
  renderEdit();
}

function removeEnemy(id) {
  if (!confirm('删除这个敌人？')) return;
  const r = rogue();
  r.enemies = r.enemies.filter((e) => e.id !== id);
  r.stages.forEach((s) => { if (s.enemyIds) s.enemyIds = s.enemyIds.filter((x) => x !== id); });
  if (select.type === 'enemy' && select.id === id) select = { type: 'settings', id: null };
  scheduleSave();
  renderEdit();
}

function addStage() {
  const r = rogue();
  const n = (r.stages?.length || 0) + 1;
  const s = { id: uid(), title: '第' + n + '关', enemyIds: r.enemies[0] ? [r.enemies[0].id] : [] };
  if (!Array.isArray(r.stages)) r.stages = [];
  r.stages.push(s);
  select = { type: 'stage', id: s.id };
  scheduleSave();
  renderEdit();
}

function removeStage(id) {
  if (!confirm('删除这一关？')) return;
  const r = rogue();
  r.stages = (r.stages || []).filter((s) => s.id !== id);
  if (select.type === 'stage' && select.id === id) select = { type: 'settings', id: null };
  scheduleSave();
  renderEdit();
}

function deleteSelected() {
  if (select.type === 'char') removeChar(select.id);
  else if (select.type === 'enemy') removeEnemy(select.id);
  else if (select.type === 'stage') removeStage(select.id);
}

function applyDemo() {
  if (!work) return;
  const demo = buildRogueDemoData(rogue().mode);
  work = normalizeWork({ ...work, ...demo, id: work.id, title: work.title, orientation: work.orientation });
  scheduleSave();
  renderEdit();
  toast('已填入示例');
}

// ---------- 试玩 ----------
function startPlay() {
  if (!work) return;
  const g = cardGuideText(work);
  if (!g.ready && !confirm(g.line + '\n仍要试玩？')) return;
  $('#playOverlay').classList.add('show');
  $('#playTitle').textContent = work.title || '';
  startRogueRun({ type: 'rogue', content: '' }, {
    story: work,
    playBody: $('#playBody'),
    playNav: null,
    orientation: work.orientation,
    onWin: stopPlay,
    onExit: stopPlay,
    onPersist: () => scheduleSave(),
  });
}

function stopPlay() {
  stopRogueRun();
  $('#playOverlay').classList.remove('show');
  $('#playBody').innerHTML = '';
}

// ---------- 新建 ----------
function openCreateModal() {
  const host = $('#mcNewModes');
  host.innerHTML = '';
  createMode = 'idle';
  Object.values(CARD_MODES).forEach((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mc-mode-btn' + (m.id === createMode ? ' on' : '');
    b.innerHTML = '<strong>' + m.label + '</strong><span>' + m.hint + '</span>';
    b.addEventListener('click', () => {
      createMode = m.id;
      host.querySelectorAll('.mc-mode-btn').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    });
    host.appendChild(b);
  });
  $('#mcNewTitle').value = '';
  $('#mcModal').classList.add('show');
}

async function route() {
  await checkAuth();
  if (!loggedIn) {
    $('#mcLogin').classList.remove('hidden');
    $('#mcApp').classList.add('hidden');
    const loginA = $('#mcLogin a');
    if (loginA) loginA.href = '/yonder.html?next=' + encodeURIComponent(location.pathname + location.search);
    return;
  }
  const q = new URLSearchParams(location.search);
  const storyId = q.get('story');
  if (storyId) {
    await openWork(storyId, q.get('play') === '1');
    return;
  }
  showHome();
}

function bind() {
  $('#mcNewBtn').addEventListener('click', openCreateModal);
  $('#mcModalCancel').addEventListener('click', () => $('#mcModal').classList.remove('show'));
  $('#mcModalOk').addEventListener('click', async () => {
    const title = ($('#mcNewTitle').value || '').trim() || '未命名卡牌';
    try {
      work = await createWork(title, createOrient, createMode);
      select = { type: 'settings', id: null };
      $('#mcModal').classList.remove('show');
      showEdit();
      toast('已创建');
    } catch (e) {
      toast(e.message || '创建失败', true);
    }
  });
  $$('.mc-orient button').forEach((b) => {
    b.addEventListener('click', () => {
      createOrient = b.dataset.o;
      $$('.mc-orient button').forEach((x) => x.classList.toggle('on', x.dataset.o === createOrient));
    });
  });
  $('#mcPlayBtn').addEventListener('click', startPlay);
  $('#mcPubBtn').addEventListener('click', togglePublish);
  $('#mcDelBtn').addEventListener('click', deleteSelected);
  $('#mcDemoBtn').addEventListener('click', applyDemo);
  $('#playClose').addEventListener('click', stopPlay);
  $('#mcBack').addEventListener('click', (e) => {
    if (work && $('#viewEdit').classList.contains('show')) {
      e.preventDefault();
      showHome();
    }
  });
}

bind();
route();
