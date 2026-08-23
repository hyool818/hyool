// story-editor.js — 作品编辑器（文字剧情积木 · 纯前端 localStorage）
// 数据结构：作品{id,title,chapters} → 章节{id,title,blocks} → 积木{id,type,content[,speaker][,media]}
// 类型：scene=场景 / dialogue=对白（额外字段 speaker）
// media（可选）：{url, type} —— url 为 /api/upload 上传后的 /img/xxx 引用（二进制存服务端，localStorage 只存引用）
//   type: 'image'（图片/GIF/WebP）| 'video'（MP4）
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

let stories = loadStories();
let currentId = null;   // 当前打开的作品 id
let chapterId = null;   // 当前打开的章节 id
let playFlat = [];      // 播放列表（跨章节展开后的积木）
let playIdx = 0;
let modalOk = null;     // 当前弹窗的「确定」回调

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

    el.append(tag, main, ops, mediaWrap);
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
  const kind = ALLOWED_MEDIA[file.type];
  if (!kind) { toast('仅支持 ' + MEDIA_TYPES_LABEL, true); return null; }
  if (file.size > MAX_MEDIA_SIZE) { toast('文件过大（限 5MB 以内）', true); return null; }
  if (!localStorage.getItem('hyool_token')) { toast('上传画面需要先登录', true); return null; }
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
    if (res.status === 401) toast('上传画面需要先登录', true);
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
    for (const b of ch.blocks) flat.push({ ...b, chapterTitle: ch.title });
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
function stopPlay() {
  $('#playOverlay').classList.add('hidden');
}
function renderPlay() {
  if (!playFlat.length) return;
  $('#playProgress').textContent = `第 ${playIdx + 1} 条 · 共 ${playFlat.length} 条`;
  $('#playChapter').textContent = playFlat[playIdx].chapterTitle;
  $('#playCount').textContent = `${playIdx + 1} / ${playFlat.length}`;
  const body = $('#playBody');
  body.innerHTML = '';
  const b = playFlat[playIdx];
  const overlay = $('#playOverlay');
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
  $('#playPrev').disabled = playIdx === 0;
  $('#playNext').disabled = playIdx >= playFlat.length - 1;
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
    chapters: s.chapters.map(c => ({ id: c.id, title: c.title, blocks: c.blocks.map(b => ({ ...b })) })),
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
    current: playFlat[playIdx] ? { type: playFlat[playIdx].type, speaker: playFlat[playIdx].speaker || '', content: playFlat[playIdx].content, media: playFlat[playIdx].media || null } : null,
  }),
  playNext,
  playPrev,
  localStorage: () => { try { return localStorage.getItem(SAVE_KEY); } catch (e) { return null; } },
};

init();


