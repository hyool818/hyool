// story-editor.js — 作品编辑器（文字剧情积木 · 纯前端 localStorage）
// 数据结构：作品{id,title,chapters} → 章节{id,title,blocks} → 积木{id,type,content[,speaker][,media][,audio]}
// 类型：scene=场景 / dialogue=对白（额外字段 speaker）
// media（可选）：{url, type} —— url 为 /api/upload 上传后的 /img/xxx 引用（二进制存服务端，localStorage 只存引用）
//   type: 'image'（图片/GIF/WebP）| 'video'（MP4）
// audio（可选）：{url, type:'audio'} —— 配音（MP3/WAV/M4A/OGG），同一套 /api/upload 上传与引用
// sfx（可选）：{url, type:'audio'} —— 音效（进入该积木自动播放一次，切幕停止）
// subtitle（可选，对白）：{on, text, pos:'bottom'|'top'|'mid', size:'sm'|'md'|'lg'} —— 字幕（缺省=默认开启、角色名+对白、底部、中）
// 章节 bgm（可选）：{url, type:'audio', volume(0~1)} —— BGM（进入章节自动循环播放，同章节切幕不重启）
import { $, toast } from '/workspace/js/ui.js';

const SAVE_KEY = 'hyool_stories_v1';
const DEFAULT_SPEAKER = '角色名';
const MAX_MEDIA_SIZE = 5 * 1024 * 1024; // 与后端 /api/upload 一致
const ALLOWED_MEDIA = { // MIME → media.type
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'video/mp4': 'video',
};
const MEDIA_TYPES_LABEL = '图片 / GIF / WebP / MP4（限 5MB）';
const ALLOWED_AUDIO = { // MIME → audio.type（配音）
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'audio/mp4': 'audio',
  'audio/x-m4a': 'audio',
  'audio/ogg': 'audio',
};
const AUDIO_TYPES_LABEL = '配音：MP3 / WAV / M4A / OGG（限 5MB）';

let stories = loadStories();
let currentId = null;   // 当前打开的作品 id
let chapterId = null;   // 当前打开的章节 id
let playFlat = [];      // 播放列表（跨章节展开后的积木）
let playIdx = 0;
let modalOk = null;     // 当前弹窗的「确定」回调
let playAudio = null;   // 播放中积木的配音（Audio 实例，切幕/退出时先停掉避免叠音）
let playSfx = null;     // 当前幕音效（Audio 实例，切幕停止）
let playBgm = null;     // 当前章节 BGM（Audio 实例，同章节连续播放）
let playBgmChapter = null; // 当前 BGM 所属章节 id（跨章节才切换）

// ---------- 本地存储 ----------
function loadStories() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(stories)); }
  catch (e) { toast('保存失败：浏览器本地存储不可用', true); }
}
const uid = () => 'b_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const story = () => stories.find(s => s.id === currentId);
const chapter = () => { const s = story(); return s ? s.chapters.find(c => c.id === chapterId) : null; };
const findBlock = (blockId) => {
  const s = story();
  if (!s) return null;
  for (const c of s.chapters) {
    const b = c.blocks.find(x => x.id === blockId);
    if (b) return b;
  }
  return null;
};
const blockIndex = (blockId) => {
  const ch = chapter();
  return ch ? ch.blocks.findIndex(x => x.id === blockId) : -1;
};

// ---------- 作品库 ----------
function renderLibrary() {
  const host = $('#storyList');
  host.innerHTML = '';
  $('#storyCount').textContent = stories.length ? `共 ${stories.length} 部` : '';
  if (!stories.length) {
    const d = document.createElement('div');
    d.style.cssText = 'grid-column:1/-1;text-align:center;color:var(--muted);padding:30px 0;line-height:2;font-size:12.5px';
    d.textContent = '还没有作品。\n输入名称，点击「＋ 创建作品」，开始你的第一个故事。';
    host.appendChild(d);
    return;
  }
  stories.forEach(s => {
    const total = s.chapters.reduce((n, c) => n + c.blocks.length, 0);
    const card = document.createElement('div');
    card.className = 'story-card';
    card.dataset.storyId = s.id;
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = s.title;
    const m = document.createElement('div');
    m.className = 'm';
    m.textContent = `${s.chapters.length} 章 · ${total} 块积木`;
    const ops = document.createElement('div');
    ops.className = 'ops';
    const openBtn = document.createElement('button');
    openBtn.className = 'btn small primary';
    openBtn.textContent = '打开编辑';
    openBtn.addEventListener('click', () => openStory(s.id));
    const playBtn = document.createElement('button');
    playBtn.className = 'btn small';
    playBtn.textContent = '▶ 播放';
    playBtn.addEventListener('click', () => { openStory(s.id); startPlay(); });
    const delBtn = document.createElement('button');
    delBtn.className = 'btn small danger';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', () => {
      if (!confirm(`确定删除作品「${s.title}」？所有章节和积木都会被删除。`)) return;
      stories = stories.filter(x => x.id !== s.id);
      persist();
      renderLibrary();
      toast('已删除作品');
    });
    ops.append(openBtn, playBtn, delBtn);
    card.append(t, m, ops);
    host.appendChild(card);
  });
}

function createStory() {
  const input = $('#newTitle');
  const title = input.value.trim();
  if (!title) { toast('请先输入作品名称', true); input.focus(); return; }
  const s = { id: uid(), title, chapters: [{ id: uid(), title: '第一章', blocks: [] }] };
  stories.unshift(s);
  persist();
  input.value = '';
  openStory(s.id);
  toast(`已创建《${title}》`);
}

// ---------- 视图切换 ----------
function showEditor() {
  $('#viewLibrary').classList.add('hidden');
  $('#viewEditor').classList.remove('hidden');
  $('#playBtn').classList.remove('hidden');
  $('#libBtn').classList.remove('hidden');
}
function openStory(id) {
  currentId = id;
  const s = story();
  chapterId = (s.chapters[0] && s.chapters[0].id) || null;
  renderEditor();
  showEditor();
}
function backToLibrary() {
  currentId = null;
  chapterId = null;
  playFlat = [];
  $('#viewEditor').classList.add('hidden');
  $('#playBtn').classList.add('hidden');
  $('#libBtn').classList.add('hidden');
  renderLibrary();
  $('#viewLibrary').classList.remove('hidden');
}

// ---------- 编辑器 ----------
function renderEditor() {
  const s = story();
  if (!s) return;
  $('#storyTitle').value = s.title;
  renderChapters();
  renderBlocks();
}

function renderChapters() {
  const s = story();
  const host = $('#chapterList');
  host.innerHTML = '';
  s.chapters.forEach(c => {
    const item = document.createElement('div');
    item.className = 'ch-item' + (c.id === chapterId ? ' active' : '');
    item.dataset.chapterId = c.id;
    const name = document.createElement('span');
    name.className = 'ch-name';
    name.textContent = c.blocks.length ? `${c.title}（${c.blocks.length}）` : c.title;
    const ren = document.createElement('button');
    ren.className = 'mini-btn';
    ren.textContent = '重命名';
    ren.addEventListener('click', (e) => { e.stopPropagation(); renameChapter(c); });
    const del = document.createElement('button');
    del.className = 'mini-btn danger';
    del.textContent = '删';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (s.chapters.length <= 1) { toast('至少保留一个章节', true); return; }
      if (!confirm(`确定删除章节「${c.title}」？其中的积木也会一起删除。`)) return;
      s.chapters = s.chapters.filter(x => x.id !== c.id);
      if (chapterId === c.id) chapterId = s.chapters[0].id;
      persist();
      renderEditor();
      toast('已删除章节');
    });
    item.append(name, ren, del);
    item.addEventListener('click', () => { chapterId = c.id; renderEditor(); });
    host.appendChild(item);
  });
}

// ---------- 积木 ----------
function renderBlocks() {
  const ch = chapter();
  const host = $('#blockList');
  host.innerHTML = '';
  const headTitle = $('#chapterTitle');
  const headCount = $('#chapterCount');
  if (!ch) {
    headTitle.textContent = '';
    headCount.textContent = '';
    return;
  }
  headTitle.textContent = ch.title;
  headCount.textContent = `${ch.blocks.length} 块积木`;
  if (!ch.blocks.length) {
    const d = document.createElement('div');
    d.className = 'block-empty';
    d.textContent = '这一章还没有内容。\n点击下方「＋ 添加内容」，开始搭第一块剧情积木。';
    host.appendChild(d);
    return;
  }
  ch.blocks.forEach((b, i) => {
    const el = document.createElement('div');
    el.className = 'block ' + b.type;
    el.dataset.blockId = b.id;

    const tag = document.createElement('div');
    tag.className = 'block-tag';
    const tagLabel = document.createElement('div');
    tagLabel.className = 'bt-label';
    tagLabel.textContent = b.type === 'scene' ? '场景' : '对白';
    tag.appendChild(tagLabel);
    if (b.type === 'dialogue') {
      const sp = document.createElement('div');
      sp.className = 'bt-speaker';
      sp.textContent = b.speaker || DEFAULT_SPEAKER;
      tag.appendChild(sp);
    }

    const main = document.createElement('div');
    main.className = 'block-main';
    const text = document.createElement('div');
    text.className = 'block-text';
    text.textContent = formatDialogue(b);
    main.appendChild(text);

    const ops = document.createElement('div');
    ops.className = 'block-ops';
    const mkBtn = (label, title, onClick, disabled) => {
      const btn = document.createElement('button');
      btn.className = 'btn tiny';
      btn.textContent = label;
      btn.title = title;
      btn.disabled = !!disabled;
      btn.addEventListener('click', onClick);
      ops.appendChild(btn);
    };
    mkBtn('↑', '上移', () => moveBlock(i, -1), i === 0);
    mkBtn('↓', '下移', () => moveBlock(i, 1), i === ch.blocks.length - 1);
    mkBtn('编辑', '编辑', () => openBlockEditor(b));
    if (b.type === 'dialogue') {
      const subOn = !b.subtitle || b.subtitle.on !== false;
      mkBtn('💬 字幕' + (subOn ? '' : '·关'), '字幕：开启/关闭、文字、位置、大小', () => openSubtitleEditor(b));
    }

    mkBtn('删除', '删除', () => deleteBlock(b.id));

    // 视觉素材（画面）：无 →「添加画面」按钮；有 → 预览 + 更换/移除
    const mediaWrap = document.createElement('div');
    mediaWrap.className = 'block-media';
    if (b.media && b.media.url) {
      const prev = document.createElement('div');
      prev.className = 'bm-preview';
      if (b.media.type === 'video') {
        const v = document.createElement('video');
        v.src = b.media.url;
        v.controls = true;
        v.muted = true;
        v.playsInline = true;
        v.preload = 'metadata';
        prev.appendChild(v);
        const badge = document.createElement('span');
        badge.className = 'bm-type';
        badge.textContent = 'MP4';
        prev.appendChild(badge);
      } else {
        const img = document.createElement('img');
        img.src = b.media.url;
        img.alt = '画面';
        img.loading = 'lazy';
        prev.appendChild(img);
      }
      const opsRow = document.createElement('div');
      opsRow.className = 'bm-ops';
      const chg = document.createElement('button');
      chg.className = 'btn tiny';
      chg.textContent = '更换画面';
      chg.addEventListener('click', () => pickMedia(b, chg));
      const rm = document.createElement('button');
      rm.className = 'btn tiny danger';
      rm.textContent = '移除画面';
      rm.addEventListener('click', () => removeBlockMedia(b));
      opsRow.append(chg, rm);
      mediaWrap.append(prev, opsRow);
    } else {
      const add = document.createElement('button');
      add.className = 'media-add';
      add.textContent = '🖼 添加画面';
      add.title = MEDIA_TYPES_LABEL;
      add.addEventListener('click', () => pickMedia(b, add));
      mediaWrap.appendChild(add);
    }

    // 配音：无 →「🎙 添加配音」按钮；有 → 试听条 + 更换/删除
    const audioWrap = document.createElement('div');
    audioWrap.className = 'block-audio';
    if (b.audio && b.audio.url) {
      const prev = document.createElement('div');
      prev.className = 'ba-preview';
      const au = document.createElement('audio');
      au.src = b.audio.url;
      au.controls = true;
      au.preload = 'metadata';
      prev.appendChild(au);
      const opsRow = document.createElement('div');
      opsRow.className = 'bm-ops';
      const chg = document.createElement('button');
      chg.className = 'btn tiny';
      chg.textContent = '更换配音';
      chg.addEventListener('click', () => pickAudio(b, chg));
      const rm = document.createElement('button');
      rm.className = 'btn tiny danger';
      rm.textContent = '删除配音';
      rm.addEventListener('click', () => removeBlockAudio(b));
      opsRow.append(chg, rm);
      audioWrap.append(prev, opsRow);
    } else {
      const add = document.createElement('button');
      add.className = 'media-add';
      add.textContent = '🎙 添加配音';
      add.title = AUDIO_TYPES_LABEL;
      add.addEventListener('click', () => pickAudio(b, add));
      audioWrap.appendChild(add);
    }

    el.append(tag, main, ops, mediaWrap, audioWrap);
    // 音效：无 →「🔊 添加音效」；有 → 试听条 + 更换/删除（与配音同结构）
    const sfxWrap = document.createElement('div');
    sfxWrap.className = 'block-audio';
    if (b.sfx && b.sfx.url) {
      const prev = document.createElement('div');
      prev.className = 'ba-preview';
      const au = document.createElement('audio');
      au.src = b.sfx.url;
      au.controls = true;
      au.preload = 'metadata';
      prev.appendChild(au);
      const opsRow = document.createElement('div');
      opsRow.className = 'bm-ops';
      const chg = document.createElement('button');
      chg.className = 'btn tiny';
      chg.textContent = '更换音效';
      chg.addEventListener('click', () => pickSfx(b, chg));
      const rm = document.createElement('button');
      rm.className = 'btn tiny danger';
      rm.textContent = '删除音效';
      rm.addEventListener('click', () => removeBlockSfx(b));
      opsRow.append(chg, rm);
      sfxWrap.append(prev, opsRow);
    } else {
      const add = document.createElement('button');
      add.className = 'media-add';
      add.textContent = '🔊 添加音效';
      add.title = AUDIO_TYPES_LABEL;
      add.addEventListener('click', () => pickSfx(b, add));
      sfxWrap.appendChild(add);
    }

    el.append(sfxWrap);
    host.appendChild(el);
  });
}

function renameChapter(c) {
  openModal('重命名章节', (body) => {
    const f = document.createElement('div');
    f.className = 'field';
    f.style.margin = '0';
    const l = document.createElement('label');
    l.textContent = '章节名称';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'txt';
    input.maxLength = 30;
    input.value = c.title;
    f.append(l, input);
    body.appendChild(f);
  }, () => {
    c.title = $('#modalBody input.txt').value.trim() || c.title;
    persist();
    renderEditor();
    toast('章节已重命名');
  });
}

function addBlock(type) {
  const ch = chapter();
  if (!ch) return;
  const block = { id: uid(), type, content: type === 'scene' ? '在这里写下场景描述……' : '在这里写下对白……' };
  if (type === 'dialogue') block.speaker = DEFAULT_SPEAKER;
  ch.blocks.push(block);
  persist();
  renderBlocks();
  openBlockEditor(block);
}

function openAddPicker() {
  openModal('添加内容', (body) => {
    const row = document.createElement('div');
    row.className = 'pick-row';
    const mk = (type, icon, name, desc) => {
      const b = document.createElement('button');
      b.className = 'pick-block';
      b.dataset.type = type;
      const iconEl = document.createElement('span');
      iconEl.className = 'pb-icon';
      iconEl.textContent = icon;
      const nameEl = document.createElement('span');
      nameEl.className = 'pb-name';
      nameEl.textContent = name;
      const descEl = document.createElement('span');
      descEl.className = 'pb-desc';
      descEl.textContent = desc;
      b.append(iconEl, nameEl, descEl);
      b.addEventListener('click', () => { closeModal(); addBlock(type); });
      row.appendChild(b);
    };
    mk('scene', '🏙️', '场景', '交代地点与氛围的一段描述');
    mk('dialogue', '💬', '对白', '角色说出的一句话');
    body.appendChild(row);
  }, null);
}

function moveBlock(i, dir) {
  const ch = chapter();
  const j = i + dir;
  if (!ch || j < 0 || j >= ch.blocks.length) return;
  const [b] = ch.blocks.splice(i, 1);
  ch.blocks.splice(j, 0, b);
  persist();
  renderBlocks();
}

function deleteBlock(id) {
  const ch = chapter();
  const i = ch.blocks.findIndex(b => b.id === id);
  if (i < 0) return;
  ch.blocks.splice(i, 1);
  persist();
  renderBlocks();
  toast('已删除该积木');
}

// ---------- 视觉素材（画面） ----------
function authHeaders() {
  const h = {};
  const t = localStorage.getItem('hyool_token');
  if (t) h['Authorization'] = 'Bearer ' + t;
  return h;
}
// 上传到现有 /api/upload（D1 分块存储），成功返回 {url,type}，失败返回 null 并 toast
async function uploadFile(file) {
  const kind = ALLOWED_MEDIA[file.type] || ALLOWED_AUDIO[file.type] || null;
  if (!kind) { toast('仅支持 ' + MEDIA_TYPES_LABEL + '，或 ' + AUDIO_TYPES_LABEL, true); return null; }
  if (file.size > MAX_MEDIA_SIZE) { toast('文件过大（限 5MB 以内）', true); return null; }
  if (!localStorage.getItem('hyool_token')) { toast('上传需要先登录', true); return null; }
  const fd = new FormData();
  fd.append('file', file);
  let res;
  try {
    res = await fetch('/api/upload', { method: 'POST', credentials: 'include', headers: authHeaders(), body: fd });
  } catch (e) {
    toast('网络异常，上传失败', true);
    return null;
  }
  let data = {};
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok || !data.success || !data.url) {
    if (res.status === 401) toast('上传需要先登录', true);
    else toast(data.error || '上传失败，请稍后再试。', true);
    return null;
  }
  return { url: data.url, type: kind };
}
function removeBlockMedia(b) {
  if (!b.media) return;
  delete b.media;
  persist();
  renderBlocks();
  toast('画面已移除');
}
let mediaInput = null;
function pickMedia(block, btn) {
  if (!mediaInput) {
    mediaInput = document.createElement('input');
    mediaInput.type = 'file';
    mediaInput.accept = 'image/jpeg,image/png,image/gif,image/webp,video/mp4';
    mediaInput.style.display = 'none';
    mediaInput.addEventListener('change', async () => {
      const file = mediaInput.files && mediaInput.files[0];
      mediaInput.value = '';
      if (!file) return;
      const uploading = btn;
      const oldText = uploading ? uploading.textContent : '';
      if (uploading) { uploading.disabled = true; uploading.textContent = '上传中…'; }
      const result = await uploadFile(file);
      if (uploading) { uploading.disabled = false; uploading.textContent = oldText; }
      if (result) {
        block.media = result;
        persist();
        renderBlocks();
        toast('画面已添加');
      }
    });
    document.body.appendChild(mediaInput);
  }
  mediaInput.click();
}

// ---------- 配音 ----------
function removeBlockAudio(b) {
  if (!b.audio) return;
  delete b.audio;
  persist();
  renderBlocks();
  toast('配音已删除');
}
let audioInput = null;
function pickAudio(block, btn) {
  if (!audioInput) {
    audioInput = document.createElement('input');
    audioInput.type = 'file';
    audioInput.accept = 'audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/ogg';
    audioInput.style.display = 'none';
    audioInput.addEventListener('change', async () => {
      const file = audioInput.files && audioInput.files[0];
      audioInput.value = '';
      if (!file) return;
      const uploading = btn;
      const oldText = uploading ? uploading.textContent : '';
      if (uploading) { uploading.disabled = true; uploading.textContent = '上传中…'; }
      const result = await uploadFile(file);
      if (uploading) { uploading.disabled = false; uploading.textContent = oldText; }
      if (result) {
        block.audio = result;
        persist();
        renderBlocks();
        toast('配音已添加');
      }
    });
    document.body.appendChild(audioInput);
  }
  audioInput.click();
}

// ---------- 音效 ----------
function removeBlockSfx(b) {
  if (!b.sfx) return;
  delete b.sfx;
  persist();
  renderBlocks();
  toast('音效已删除');
}
let sfxInput = null;
function pickSfx(block, btn) {
  if (!sfxInput) {
    sfxInput = document.createElement('input');
    sfxInput.type = 'file';
    sfxInput.accept = 'audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/ogg';
    sfxInput.style.display = 'none';
    sfxInput.addEventListener('change', async () => {
      const file = sfxInput.files && sfxInput.files[0];
      sfxInput.value = '';
      if (!file) return;
      const uploading = btn;
      const oldText = uploading ? uploading.textContent : '';
      if (uploading) { uploading.disabled = true; uploading.textContent = '上传中…'; }
      const result = await uploadFile(file);
      if (uploading) { uploading.disabled = false; uploading.textContent = oldText; }
      if (result) {
        block.sfx = result;
        persist();
        renderBlocks();
        toast('音效已添加');
      }
    });
    document.body.appendChild(sfxInput);
  }
  sfxInput.click();
}

// ---------- 字幕（对白积木） ----------
function openSubtitleEditor(b) {
  const cur = b.subtitle || {};
  const on = cur.on !== false;
  const text = cur.text || '';
  const pos = cur.pos || 'bottom';
  const size = cur.size || 'md';
  openModal('字幕设置', (body) => {
    const f1 = document.createElement('div');
    f1.className = 'field';
    f1.style.margin = '0';
    const l1 = document.createElement('label');
    l1.textContent = '开启字幕';
    const onSel = document.createElement('select');
    onSel.className = 'txt';
    onSel.innerHTML = '<option value="1">开启</option><option value="0">关闭</option>';
    onSel.value = on ? '1' : '0';
    f1.append(l1, onSel);
    const f2 = document.createElement('div');
    f2.className = 'field';
    f2.style.margin = '0';
    const l2 = document.createElement('label');
    l2.textContent = '字幕文字（留空 = 使用「角色名：对白内容」）';
    const ta = document.createElement('textarea');
    ta.className = 'txt';
    ta.maxLength = 120;
    ta.placeholder = '默认：' + (b.speaker || DEFAULT_SPEAKER) + '：' + (b.content || '');
    ta.value = text;
    f2.append(l2, ta);
    const f3 = document.createElement('div');
    f3.className = 'field';
    f3.style.margin = '0';
    const l3 = document.createElement('label');
    l3.textContent = '位置';
    const posSel = document.createElement('select');
    posSel.className = 'txt';
    posSel.innerHTML = '<option value="bottom">底部</option><option value="top">顶部</option><option value="mid">中部偏下</option>';
    posSel.value = pos === 'top' ? 'top' : pos === 'mid' ? 'mid' : 'bottom';
    f3.append(l3, posSel);
    const f4 = document.createElement('div');
    f4.className = 'field';
    f4.style.margin = '0';
    const l4 = document.createElement('label');
    l4.textContent = '大小';
    const sizeSel = document.createElement('select');
    sizeSel.className = 'txt';
    sizeSel.innerHTML = '<option value="sm">小</option><option value="md">中</option><option value="lg">大</option>';
    sizeSel.value = size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : 'md';
    f4.append(l4, sizeSel);
    body.append(f1, f2, f3, f4);
  }, () => {
    const sels = $('#modalBody select');
    const onNow = sels[0].value === '1';
    const textNow = $('#modalBody textarea.txt').value.trim();
    const posNow = sels[1].value;
    const sizeNow = sels[2].value;
    if (onNow && !textNow && posNow === 'bottom' && sizeNow === 'md') {
      delete b.subtitle; // 全默认 → 存空，播放端按默认处理
    } else {
      b.subtitle = { on: onNow, text: textNow, pos: posNow, size: sizeNow };
    }
    persist();
    renderBlocks();
    toast('字幕已更新');
  });
}

// ---------- 章节 BGM ----------
function removeChapterBgm(ch) {
  if (!ch.bgm) return;
  delete ch.bgm;
  persist();
  renderEditor();
  toast('BGM 已删除');
}
let bgmInput = null;
function pickBgm(ch, btn) {
  if (!bgmInput) {
    bgmInput = document.createElement('input');
    bgmInput.type = 'file';
    bgmInput.accept = 'audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/ogg';
    bgmInput.style.display = 'none';
    bgmInput.addEventListener('change', async () => {
      const file = bgmInput.files && bgmInput.files[0];
      bgmInput.value = '';
      if (!file) return;
      const uploading = btn;
      const oldText = uploading ? uploading.textContent : '';
      if (uploading) { uploading.disabled = true; uploading.textContent = '上传中…'; }
      const result = await uploadFile(file);
      if (uploading) { uploading.disabled = false; uploading.textContent = oldText; }
      if (result) {
        ch.bgm = { ...result, volume: ch.bgm && ch.bgm.volume != null ? ch.bgm.volume : 0.6 };
        persist();
        renderEditor();
        openBgmEditor(); // 重开弹窗展示新 BGM 的试听条/音量/更换/删除
        toast('BGM 已添加');
      }
    });
    document.body.appendChild(bgmInput);
  }
  bgmInput.click();
}
function openBgmEditor() {
  const ch = chapter();
  if (!ch) return;
  openModal('章节 BGM', (body) => {
    if (ch.bgm && ch.bgm.url) {
      const prev = document.createElement('div');
      prev.className = 'ba-preview';
      const au = document.createElement('audio');
      au.src = ch.bgm.url;
      au.controls = true;
      au.preload = 'metadata';
      prev.appendChild(au);
      const vol = document.createElement('div');
      vol.className = 'bgm-vol';
      const vl = document.createElement('span');
      vl.textContent = '音量';
      const range = document.createElement('input');
      range.type = 'range';
      range.min = 0;
      range.max = 100;
      range.value = Math.round((Number(ch.bgm.volume) || 0.6) * 100);
      range.addEventListener('input', () => {
        ch.bgm.volume = Number(range.value) / 100;
        persist();
      });
      vol.append(vl, range);
      const opsRow = document.createElement('div');
      opsRow.className = 'bm-ops';
      const chg = document.createElement('button');
      chg.className = 'btn tiny';
      chg.textContent = '更换 BGM';
      chg.addEventListener('click', () => pickBgm(ch, chg));
      const rm = document.createElement('button');
      rm.className = 'btn tiny danger';
      rm.textContent = '删除 BGM';
      rm.addEventListener('click', () => { removeChapterBgm(ch); closeModal(); });
      opsRow.append(chg, rm);
      body.append(prev, vol, opsRow);
    } else {
      const add = document.createElement('button');
      add.className = 'media-add';
      add.textContent = '🎵 添加 BGM';
      add.title = AUDIO_TYPES_LABEL;
      add.addEventListener('click', () => pickBgm(ch, add));
      body.appendChild(add);
    }
  });
}

function openBlockEditor(block) {
  if (block.type === 'scene') {
    openModal('编辑场景', (body) => {
      const f = document.createElement('div');
      f.className = 'field';
      f.style.margin = '0';
      const l = document.createElement('label');
      l.textContent = '场景内容';
      const ta = document.createElement('textarea');
      ta.className = 'txt';
      ta.placeholder = '例如：长安城的雨下了一整夜。';
      ta.value = block.content;
      f.append(l, ta);
      body.appendChild(f);
    }, () => {
      block.content = $('#modalBody textarea.txt').value.trim() || '……';
      persist();
      renderBlocks();
      toast('场景已更新');
    });
  } else {
    openModal('编辑对白', (body) => {
      const f1 = document.createElement('div');
      f1.className = 'field';
      f1.style.margin = '0';
      const l1 = document.createElement('label');
      l1.textContent = '角色名字';
      const sp = document.createElement('input');
      sp.type = 'text';
      sp.className = 'txt';
      sp.maxLength = 20;
      sp.value = block.speaker || '';
      f1.append(l1, sp);
      const f2 = document.createElement('div');
      f2.className = 'field';
      f2.style.margin = '0';
      const l2 = document.createElement('label');
      l2.textContent = '对白内容（播放时自动加引号）';
      const ta = document.createElement('textarea');
      ta.className = 'txt';
      ta.placeholder = '例如：他应该不会来了。';
      ta.value = block.content;
      f2.append(l2, ta);
      body.append(f1, f2);
    }, () => {
      block.speaker = $('#modalBody input.txt').value.trim() || DEFAULT_SPEAKER;
      block.content = $('#modalBody textarea.txt').value.trim() || '……';
      persist();
      renderBlocks();
      toast('对白已更新');
    });
  }
}

// ---------- 弹窗 ----------
function openModal(title, buildBody, okHandler) {
  $('#modalTitle').textContent = title;
  const body = $('#modalBody');
  body.innerHTML = '';
  buildBody(body);
  modalOk = okHandler || null;
  $('#modalOk').classList.toggle('hidden', !modalOk);
  $('#modal').classList.remove('hidden');
}
function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modalBody').innerHTML = '';
  modalOk = null;
}
function formatDialogue(b) {
  if (b.type !== 'dialogue') return b.content || '';
  const c = (b.content || '').trim();
  return /^[“"]/.test(c) ? c : `“${c}”`;
}

// ---------- 播放 ----------
function buildPlayFlat() {
  const s = story();
  const flat = [];
  for (const ch of s.chapters) {
    for (const b of ch.blocks) flat.push({ ...b, chapterTitle: ch.title, chapterId: ch.id, bgm: ch.bgm || null });
  }
  return flat;
}
function startPlay() {
  playFlat = buildPlayFlat();
  if (!playFlat.length) { toast('这个作品还没有积木，先去添加内容吧', true); return; }
  playIdx = 0;
  renderPlay();
  $('#playOverlay').classList.remove('hidden');
}
function stopPlayAudio() {
  if (playAudio) {
    try { playAudio.pause(); } catch (e) { /* ignore */ }
    playAudio.onended = null;
    playAudio.onerror = null;
    playAudio.removeAttribute('src');
    playAudio = null;
  }
}
function stopPlaySfx() {
  if (playSfx) {
    try { playSfx.pause(); } catch (e) { /* ignore */ }
    playSfx.onended = null;
    playSfx.onerror = null;
    playSfx.removeAttribute('src');
    playSfx = null;
  }
}
function stopPlayBgm() {
  if (playBgm) {
    try { playBgm.pause(); } catch (e) { /* ignore */ }
    playBgm.onended = null;
    playBgm.onerror = null;
    playBgm.removeAttribute('src');
    playBgm = null;
  }
}
function switchBgm(bgm, chapterId) {
  stopPlayBgm();
  if (bgm && bgm.url) {
    const au = new Audio(bgm.url);
    au.loop = true; // BGM 循环播放
    au.preload = 'auto';
    au.volume = Math.min(1, Math.max(0, Number(bgm.volume) || 0.6));
    au.play().catch(() => { /* 自动播放被拦截时静默，不影响推进 */ });
    playBgm = au;
  }
  playBgmChapter = chapterId;
}
function stopPlay() {
  stopPlayAudio();
  stopPlaySfx();
  stopPlayBgm();
  playBgmChapter = null;
  $('#playOverlay').classList.add('hidden');
}
function renderPlay() {
  stopPlayAudio(); // 先停掉上一幕的配音，避免两个声音同时播放
  stopPlaySfx();   // 音效：切幕时停止不需要继续播放的音效
  if (!playFlat.length) return;
  $('#playProgress').textContent = `第 ${playIdx + 1} 条 · 共 ${playFlat.length} 条`;
  $('#playChapter').textContent = playFlat[playIdx].chapterTitle;
  $('#playCount').textContent = `${playIdx + 1} / ${playFlat.length}`;
  const body = $('#playBody');
  body.innerHTML = '';
  const b = playFlat[playIdx];
  const overlay = $('#playOverlay');
  // BGM 属于章节：跨章节才切换；同章节内点击推进保持连续播放、不重新开始
  if (b.chapterId !== playBgmChapter) switchBgm(b.bgm, b.chapterId);
  // 视觉素材 → 全屏背景（图片/GIF/WebP 直接铺满；MP4 自动播放循环，播完不自动下一幕）
  if (b.media && b.media.url) {
    overlay.classList.add('has-media');
    const bg = document.createElement('div');
    bg.className = 'play-media-bg';
    if (b.media.type === 'video') {
      const v = document.createElement('video');
      v.src = b.media.url;
      v.autoplay = true;
      v.loop = true;
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      bg.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = b.media.url;
      img.alt = '';
      bg.appendChild(img);
    }
    body.appendChild(bg);
  } else {
    overlay.classList.remove('has-media');
  }
  // 前景文字/对白（点击 → 下一幕）
  const fore = document.createElement('div');
  fore.className = 'play-fore';
  fore.addEventListener('click', playNext);
  if (b.type === 'scene') {
    const d = document.createElement('div');
    d.className = 'play-scene';
    d.textContent = b.content;
    fore.appendChild(d);
  } else {
    const d = document.createElement('div');
    d.className = 'play-dialogue';
    const sp = document.createElement('div');
    sp.className = 'pd-speaker';
    sp.textContent = b.speaker || DEFAULT_SPEAKER;
    const ln = document.createElement('div');
    ln.className = 'pd-line';
    ln.textContent = formatDialogue(b);
    d.append(sp, ln);
    fore.appendChild(d);
  }
  body.appendChild(fore);
  // 字幕（对白积木）：画面前景底部/顶部/中部，不遮挡主画面；跟随当前剧情一起切换
  const subOn = !b.subtitle || b.subtitle.on !== false;
  if (b.type === 'dialogue' && subOn) {
    const sub = b.subtitle || {};
    const subEl = document.createElement('div');
    subEl.className = 'play-sub ' + (sub.pos === 'top' ? 'top' : sub.pos === 'mid' ? 'mid' : 'bot') +
      ' size-' + (sub.size === 'sm' ? 'sm' : sub.size === 'lg' ? 'lg' : 'md');
    const box = document.createElement('div');
    box.className = 'ps-box';
    const custom = (sub.text || '').trim();
    box.textContent = custom || ((b.speaker || DEFAULT_SPEAKER) + '：' + (b.content || ''));
    subEl.appendChild(box);
    body.appendChild(subEl);
  }
  $('#playPrev').disabled = playIdx === 0;
  $('#playNext').disabled = playIdx >= playFlat.length - 1;
  // 当前幕有配音 → 自动播放（无配音的积木完全保持原有逻辑）
  if (b.audio && b.audio.url) {
    const au = new Audio(b.audio.url);
    au.preload = 'auto';
    au.play().catch(() => { /* 自动播放被拦截/加载失败时静默，不影响点击推进 */ });
    playAudio = au;
  }
  // 音效：进入该积木自动播放一次
  if (b.sfx && b.sfx.url) {
    const sfx = new Audio(b.sfx.url);
    sfx.preload = 'auto';
    sfx.play().catch(() => { /* 自动播放被拦截时静默 */ });
    playSfx = sfx;
  }
}
function playNext() { if (playIdx < playFlat.length - 1) { playIdx++; renderPlay(); } }
function playPrev() { if (playIdx > 0) { playIdx--; renderPlay(); } }

// ---------- 初始化 / 事件 ----------
function init() {
  $('#createBtn').addEventListener('click', createStory);
  $('#newTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') createStory(); });
  $('#storyTitle').addEventListener('input', () => {
    const s = story();
    const v = $('#storyTitle').value.trim();
    if (v && s && s.title !== v) { s.title = v; persist(); }
  });
  $('#addChapterBtn').addEventListener('click', () => {
    const s = story();
    if (!s) return;
    const c = { id: uid(), title: `第 ${s.chapters.length + 1} 章`, blocks: [] };
    s.chapters.push(c);
    chapterId = c.id;
    persist();
    renderEditor();
    toast('已新建章节');
  });
  $('#renameChapterBtn').addEventListener('click', () => {
    const c = chapter();
    if (c) renameChapter(c);
  });
  $('#bgmBtn').addEventListener('click', openBgmEditor);
  $('#addBlockBtn').addEventListener('click', openAddPicker);
  $('#playBtn').addEventListener('click', startPlay);
  $('#playExit').addEventListener('click', stopPlay);
  $('#playNext').addEventListener('click', playNext);
  $('#playPrev').addEventListener('click', playPrev);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#modalOk').addEventListener('click', () => {
    if (modalOk) {
      const fn = modalOk;
      modalOk = null;
      try { fn(); } finally { closeModal(); }
    } else {
      closeModal();
    }
  });
  $('#libBtn').addEventListener('click', backToLibrary);
  renderLibrary();
}

// ---------- 对外测试 API ----------
window.StoryEditor = {
  ready: true,
  list: () => stories.map(s => ({
    id: s.id, title: s.title,
    chapters: s.chapters.map(c => ({ id: c.id, title: c.title, bgm: c.bgm || null, blocks: c.blocks.map(b => ({ ...b })) })),
  })),
  create: (title) => { $('#newTitle').value = title; createStory(); return story() ? story().id : null; },
  open: (id) => openStory(id),
  backToLibrary,
  current: () => {
    const s = story();
    const c = chapter();
    return s ? { storyId: s.id, title: s.title, chapterId: c ? c.id : null, chapterTitle: c ? c.title : null } : null;
  },
  addBlock: (type) => addBlock(type),
  setBlockContent: (blockId, content) => {
    const b = findBlock(blockId);
    if (b) { b.content = content; persist(); renderBlocks(); return true; }
    return false;
  },
  setBlockSpeaker: (blockId, speaker) => {
    const b = findBlock(blockId);
    if (b) { b.speaker = speaker; persist(); renderBlocks(); return true; }
    return false;
  },
  setBlockMediaById: (blockId, url, type) => {
    const b = findBlock(blockId);
    if (!b) return false;
    if (!url) { delete b.media; }
    else { b.media = { url, type: type === 'video' ? 'video' : 'image' }; }
    persist(); renderBlocks(); return true;
  },
  upload: (file) => uploadFile(file),
  removeBlockMediaById: (blockId) => {
    const b = findBlock(blockId);
    if (!b || !b.media) return false;
    delete b.media; persist(); renderBlocks(); return true;
  },
  setBlockAudioById: (blockId, url) => {
    const b = findBlock(blockId);
    if (!b) return false;
    if (!url) { delete b.audio; }
    else { b.audio = { url, type: 'audio' }; }
    persist(); renderBlocks(); return true;
  },
  removeBlockAudioById: (blockId) => {
    const b = findBlock(blockId);
    if (!b || !b.audio) return false;
    delete b.audio; persist(); renderBlocks(); return true;
  },
  setBlockSubtitleById: (blockId, subtitle) => {
    const b = findBlock(blockId);
    if (!b) return false;
    if (!subtitle) { delete b.subtitle; }
    else { b.subtitle = { on: subtitle.on !== false, text: subtitle.text || '', pos: subtitle.pos || 'bottom', size: subtitle.size || 'md' }; }
    persist(); renderBlocks(); return true;
  },
  setBlockSfxById: (blockId, url) => {
    const b = findBlock(blockId);
    if (!b) return false;
    if (!url) { delete b.sfx; }
    else { b.sfx = { url, type: 'audio' }; }
    persist(); renderBlocks(); return true;
  },
  removeBlockSfxById: (blockId) => {
    const b = findBlock(blockId);
    if (!b || !b.sfx) return false;
    delete b.sfx; persist(); renderBlocks(); return true;
  },
  setChapterBgmById: (chapterId, url, volume) => {
    const s = story();
    if (!s) return false;
    const c = s.chapters.find(x => x.id === chapterId);
    if (!c) return false;
    if (!url) { delete c.bgm; }
    else { c.bgm = { url, type: 'audio', volume: volume != null ? volume : 0.6 }; }
    persist(); renderEditor(); return true;
  },
  removeChapterBgmById: (chapterId) => {
    const s = story();
    if (!s) return false;
    const c = s.chapters.find(x => x.id === chapterId);
    if (!c || !c.bgm) return false;
    delete c.bgm; persist(); renderEditor(); return true;
  },
  moveBlockById: (blockId, dir) => {
    const i = blockIndex(blockId);
    if (i >= 0) { moveBlock(i, dir); return true; }
    return false;
  },
  deleteBlockById: (blockId) => deleteBlock(blockId),
  addChapter: () => {
    const s = story();
    if (!s) return null;
    const c = { id: uid(), title: `第 ${s.chapters.length + 1} 章`, blocks: [] };
    s.chapters.push(c);
    chapterId = c.id;
    persist();
    renderEditor();
    return c.id;
  },
  startPlay,
  stopPlay,
  play: () => ({
    idx: playIdx, total: playFlat.length,
    current: playFlat[playIdx] ? {
      type: playFlat[playIdx].type, speaker: playFlat[playIdx].speaker || '', content: playFlat[playIdx].content,
      media: playFlat[playIdx].media || null, audio: playFlat[playIdx].audio || null, sfx: playFlat[playIdx].sfx || null,
      subtitle: playFlat[playIdx].subtitle || null, chapterId: playFlat[playIdx].chapterId || null, bgm: playFlat[playIdx].bgm || null,
    } : null,
  }),
  playNext,
  playPrev,
  localStorage: () => { try { return localStorage.getItem(SAVE_KEY); } catch (e) { return null; } },
};

init();


