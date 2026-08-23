// story-editor.js — 作品编辑器（文字剧情积木 · 纯前端 localStorage）
// 数据结构：作品{id,title,chapters} → 章节{id,title,blocks} → 积木{id,type,content[,speaker][,media][,audio]}
// 类型：scene=场景 / dialogue=对白（额外字段 speaker）
// media（可选）：{url, type} —— url 为 /api/upload 上传后的 /img/xxx 引用（二进制存服务端，localStorage 只存引用）
//   type: 'image'（图片/GIF/WebP）| 'video'（MP4）
// audio（可选）：{url, type:'audio'} —— 配音（MP3/WAV/M4A/OGG），同一套 /api/upload 上传与引用
// sfxList（可选）：[{id, url, offsetMs, loop, volume, label}] —— 音效轨（可多条叠加；offsetMs=进入本幕多少毫秒后触发，loop=true 持续到切幕）
//   旧字段 sfx（单对象 {url}）读取时自动迁移为 sfxList 单条
// bgmOverride（可选，积木）：{url, type:'audio', volume} —— 幕级 BGM（有则本幕替换章节 BGM；离开本幕后无覆盖的幕自动恢复章节曲）
// cast（可选，作品级）：{角色名: {kind:'tts'|'audio'|'none', voice?, url?, volume}} —— 角色声音表（AI 音色或手动音频）
// subtitle（可选，对白/场景）：{pos:'bottom'|'top'|'mid'|'custom', size:数字px(12~72)或旧'sm'|'md'|'lg', x?, y?} —— 文字显示设置
//   对白：播放时始终显示「对白框」（角色名 + 对白内容自动加引号），位置 = 弹窗三档预设（底/顶/中偏下）或播放中自由拖拽（x/y 百分比）
//   场景：播放时显示「场景文字」（纯文字无框，文字来自 b.content），位置可自由拖拽（x/y 为画幅中心点百分比）；内容留空则不显示
//   字号：弹窗滑条自定义（12~72px），或播放中按住文字右下角「拉大小」手柄拖动实时调整、松手自动保存（对白框角色名联动 1.3x）
//   对白积木「💬 对白框」弹窗承担角色编辑（角色名 + 对白内容）；场景积木「📝 场景文字」弹窗编辑场景文字
// 章节 bgm（可选）：{url, type:'audio', volume(0~1)} —— BGM（进入章节自动循环播放，同章节切幕不重启）
import { $, toast } from '/workspace/js/ui.js';

const SAVE_KEY = 'hyool_stories_v1';
const DEFAULT_SPEAKER = '角色名';
const MAX_MEDIA_SIZE = 5 * 1024 * 1024; // 与后端 /api/upload 一致
// 画面压缩目标（上传前按作品「方向 × 画质」前端自动等比 cover 压缩；standard=默认档，hd=高清档）
const IMG_TARGETS = {
  landscape: { standard: { w: 1280, h: 720 }, hd: { w: 1920, h: 1080 } },
  portrait:  { standard: { w: 1080, h: 1920 }, hd: { w: 1440, h: 2560 } },
};
const IMG_COMPRESS_QUALITY = 0.85; // 图片压缩质量（webp，回退 jpeg）
const ORIENT_LABEL = { landscape: '🖥 16:9 横屏', portrait: '📱 9:16 竖屏' };
const QUAL_LABEL = { standard: '标准', hd: '高清' };
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

let stories = normalizeStories(loadStories());
let currentId = null;   // 当前打开的作品 id
let chapterId = null;   // 当前打开的章节 id
let playFlat = [];      // 播放列表（跨章节展开后的积木）
let playIdx = 0;
let modalOk = null;     // 当前弹窗的「确定」回调
let playAudio = null;   // 播放中积木的配音（Audio 实例，切幕/退出时先停掉避免叠音）
let playSfxSet = new Set();  // 当前幕音效实例集合（多轨可叠加，切幕全部停止）
let playSfxTimers = [];      // 当前幕音效的延迟触发定时器（offsetMs 调度）
let playBgm = null;     // 当前章节 BGM（Audio 实例，同章节连续播放）
let playBgmUrl = null;  // 当前 BGM 的 url（判断是否真的需要切换）
let playBgmChapter = null; // 当前 BGM 所属章节 id（跨章节才切换）
let ttsCache = new Map();  // TTS 预合成缓存：key(story|block|voice|content前40字) → blobUrl
let ttsVoices = [];        // /api/tts/voices 列表缓存
let selectedSfxId = null;  // 时间轴弹窗中当前选中的音效条目 id
let createOrientation = 'landscape'; // 新建作品时选定的画面方向

// ---------- 本地存储 ----------
function loadStories() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
// 兼容迁移：旧字段 sfx（单对象）→ sfxList（音效轨数组）；补全 sfxList 条目与 cast/bgmOverride 结构
function normalizeStories(arr) {
  if (!Array.isArray(arr)) return [];
  arr.forEach(s => {
    if (s.orientation !== 'landscape' && s.orientation !== 'portrait') s.orientation = 'landscape'; // 旧作品默认 16:9 横屏
    if (s.imgQuality !== 'hd') s.imgQuality = 'standard'; // 默认标准画质（1280 档）
    if (!s.cast || typeof s.cast !== 'object') s.cast = {};
    (s.chapters || []).forEach(c => {
      (c.blocks || []).forEach(b => {
        if (b.sfx && b.sfx.url) {
          b.sfxList = [{ id: 'sfx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url: b.sfx.url, type: 'audio', offsetMs: 0, loop: false, volume: 0.8 }];
          delete b.sfx;
        }
        if (!Array.isArray(b.sfxList)) b.sfxList = [];
        b.sfxList = b.sfxList.map(sf => sf && sf.url ? {
          id: sf.id || 'sfx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          url: sf.url, type: 'audio',
          offsetMs: Math.max(0, Number(sf.offsetMs) || 0),
          loop: !!sf.loop,
          volume: Math.min(1, Math.max(0, Number(sf.volume) || 0.8)),
          label: sf.label || '',
        } : null).filter(Boolean);
        if (b.bgmOverride && !b.bgmOverride.url) delete b.bgmOverride;
      });
    });
  });
  return arr;
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
    m.textContent = `${s.chapters.length} 章 · ${total} 块积木 · ${ORIENT_LABEL[s.orientation] || '🖥 16:9 横屏'} · ${QUAL_LABEL[s.imgQuality] || '标准'}画质`;
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
  const s = { id: uid(), title, orientation: createOrientation, imgQuality: 'standard', cast: {}, chapters: [{ id: uid(), title: '第一章', blocks: [] }] };
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
  // 方向 / 画质切换按钮高亮
  document.querySelectorAll('#storyOrient .orient-btn').forEach(b => b.classList.toggle('active', b.dataset.orient === s.orientation));
  document.querySelectorAll('#storyQual .qual-btn').forEach(b => b.classList.toggle('active', b.dataset.qual === s.imgQuality));
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
    const displayText = formatDialogue(b);
    if (!displayText.trim()) {
      text.classList.add('empty');
      text.textContent = b.type === 'scene' ? '（暂无场景文字，点击 📝 场景文字 设置）' : '（对白内容为空）';
    } else {
      text.textContent = displayText;
    }
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
    if (b.type === 'dialogue') {
      mkBtn('💬 对白框', '设置对白框：角色名 + 对白内容（播放时自动加引号）、位置（底/顶/中偏下）、字号', () => openSubtitleEditor(b));
    } else if (b.type === 'scene') {
      mkBtn('📝 场景文字', '设置场景文字（播放时可拖拽到任意位置）与字号；留空则不显示', () => openSubtitleEditor(b));
    }
    mkBtn('🎵', '本幕 BGM（可覆盖章节曲）', () => openBlockBgmEditor(b));
    mkBtn('🎼', '声音时间轴（配音 / 音效 / BGM 三轨可视化）', () => openTimelineEditor(b));

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
    // 音效轨：摘要 + 打开声音时间轴（三轨可视化编辑）
    const sfxWrap = document.createElement('div');
    sfxWrap.className = 'block-audio';
    const sfxList = b.sfxList || [];
    if (sfxList.length) {
      const prev = document.createElement('div');
      prev.className = 'ba-preview';
      const sum = document.createElement('div');
      sum.className = 'sfx-summary';
      sum.textContent = '🔊 ' + sfxList.length + ' 条音效' + sfxList.map(sf => ' · ' + (sf.offsetMs ? (sf.offsetMs / 1000).toFixed(1) + 's' : '0s') + (sf.loop ? ' 循环' : '')).join('');
      prev.appendChild(sum);
      const opsRow = document.createElement('div');
      opsRow.className = 'bm-ops';
      const tl = document.createElement('button');
      tl.className = 'btn tiny';
      tl.textContent = '🎼 打开声音轨';
      tl.addEventListener('click', () => openTimelineEditor(b));
      const rm = document.createElement('button');
      rm.className = 'btn tiny danger';
      rm.textContent = '清空音效';
      rm.addEventListener('click', () => removeBlockSfx(b));
      opsRow.append(tl, rm);
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
  const block = { id: uid(), type, content: type === 'scene' ? '' : '在这里写下对白……' };
  if (type === 'dialogue') block.speaker = DEFAULT_SPEAKER;
  ch.blocks.push(block);
  persist();
  renderBlocks();
  openSubtitleEditor(block); // 新建积木直接进弹窗（对白：角色/内容/位置/字号；场景：场景文字/字号）
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
// 按作品「方向 × 画质」压缩图片（cover 居中裁剪到目标比例；GIF 保留动画、SVG 保持矢量、解析失败或压缩无收益时回退原文件）
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解析失败')); };
    img.src = url;
  });
}
function blobToCanvasCover(img, tw, th) {
  const sw = img.naturalWidth, sh = img.naturalHeight;
  const tr = tw / th;
  let sx = 0, sy = 0, sw2 = sw, sh2 = sh;
  if (sw / sh > tr) { sw2 = sh * tr; sx = (sw - sw2) / 2; }       // 源太宽 → 裁左右
  else if (sw / sh < tr) { sh2 = sw / tr; sy = (sh - sh2) / 2; }  // 源太高 → 裁上下
  const scale = Math.min(1, tw / sw2, th / sh2);                  // 只缩不放
  const dw = Math.max(1, Math.round(sw2 * scale));
  const dh = Math.max(1, Math.round(sh2 * scale));
  const c = document.createElement('canvas');
  c.width = dw; c.height = dh;
  c.getContext('2d').drawImage(img, sx, sy, sw2, sh2, 0, 0, dw, dh);
  return c;
}
async function compressImageFile(file, orientation, quality) {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  const t = (IMG_TARGETS[orientation] || IMG_TARGETS.landscape)[quality === 'hd' ? 'hd' : 'standard'];
  try {
    const img = await loadImageFromFile(file);
    const canvas = blobToCanvasCover(img, t.w, t.h);
    let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', IMG_COMPRESS_QUALITY));
    if (!blob) blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', IMG_COMPRESS_QUALITY));
    if (!blob || blob.size <= 0 || blob.size >= file.size) return file; // 压缩无收益 → 原样上传
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: blob.type });
  } catch (e) {
    return file; // 解析失败等异常 → 原样上传，不阻断
  }
}
// 上传到现有 /api/upload（D1 分块存储），成功返回 {url,type}，失败返回 null 并 toast
// opts.compress = { orientation, quality }：图片画面按作品方向/画质前端压缩后再上传（GIF/视频/音频不压缩）
async function uploadFile(file, opts) {
  const kind = ALLOWED_MEDIA[file.type] || ALLOWED_AUDIO[file.type] || null;
  if (!kind) { toast('仅支持 ' + MEDIA_TYPES_LABEL + '，或 ' + AUDIO_TYPES_LABEL, true); return null; }
  if (file.size > MAX_MEDIA_SIZE) { toast('文件过大（限 5MB 以内）', true); return null; }
  if (!localStorage.getItem('hyool_token')) { toast('上传需要先登录', true); return null; }
  if (kind === 'image' && opts && opts.compress) {
    const compressed = await compressImageFile(file, opts.compress.orientation, opts.compress.quality);
    if (compressed !== file) file = compressed; // 压缩成功则上传压缩结果
  }
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
let mediaPickBlock = null;
let mediaPickBtn = null;
function pickMedia(block, btn) {
  mediaPickBlock = block; // input 为单例，change 回调须用「本次点击」的目标，避免写错积木
  mediaPickBtn = btn;
  if (!mediaInput) {
    mediaInput = document.createElement('input');
    mediaInput.type = 'file';
    mediaInput.accept = 'image/jpeg,image/png,image/gif,image/webp,video/mp4';
    mediaInput.style.display = 'none';
    mediaInput.addEventListener('change', async () => {
      const file = mediaInput.files && mediaInput.files[0];
      mediaInput.value = '';
      if (!file) return;
      const sCur = story();
      const uploading = mediaPickBtn;
      const oldText = uploading ? uploading.textContent : '';
      if (uploading) { uploading.disabled = true; uploading.textContent = '上传中…'; }
      const result = await uploadFile(file, { compress: { orientation: sCur ? sCur.orientation : 'landscape', quality: sCur ? sCur.imgQuality : 'standard' } });
      if (uploading) { uploading.disabled = false; uploading.textContent = oldText; }
      if (result && mediaPickBlock) {
        mediaPickBlock.media = result;
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
let audioPickBlock = null;
let audioPickBtn = null;
function pickAudio(block, btn) {
  audioPickBlock = block;
  audioPickBtn = btn;
  if (!audioInput) {
    audioInput = document.createElement('input');
    audioInput.type = 'file';
    audioInput.accept = 'audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/ogg';
    audioInput.style.display = 'none';
    audioInput.addEventListener('change', async () => {
      const file = audioInput.files && audioInput.files[0];
      audioInput.value = '';
      if (!file) return;
      const uploading = audioPickBtn;
      const oldText = uploading ? uploading.textContent : '';
      if (uploading) { uploading.disabled = true; uploading.textContent = '上传中…'; }
      const result = await uploadFile(file);
      if (uploading) { uploading.disabled = false; uploading.textContent = oldText; }
      if (result && audioPickBlock) {
        audioPickBlock.audio = result;
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
  if (!b.sfxList || !b.sfxList.length) return;
  b.sfxList = [];
  persist();
  renderBlocks();
  toast('音效已清空');
}
let sfxInput = null;
let sfxPickBlock = null;
let sfxPickBtn = null;
function pickSfx(block, btn) {
  sfxPickBlock = block;
  sfxPickBtn = btn;
  if (!sfxInput) {
    sfxInput = document.createElement('input');
    sfxInput.type = 'file';
    sfxInput.accept = 'audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/ogg';
    sfxInput.style.display = 'none';
    sfxInput.addEventListener('change', async () => {
      const file = sfxInput.files && sfxInput.files[0];
      sfxInput.value = '';
      if (!file) return;
      const uploading = sfxPickBtn;
      const oldText = uploading ? uploading.textContent : '';
      if (uploading) { uploading.disabled = true; uploading.textContent = '上传中…'; }
      const result = await uploadFile(file);
      if (uploading) { uploading.disabled = false; uploading.textContent = oldText; }
      if (result && sfxPickBlock) {
        if (!Array.isArray(sfxPickBlock.sfxList)) sfxPickBlock.sfxList = [];
        sfxPickBlock.sfxList.push({ id: 'sfx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url: result.url, type: 'audio', offsetMs: 0, loop: false, volume: 0.8 });
        persist();
        renderBlocks();
        toast('音效已添加');
      }
    });
    document.body.appendChild(sfxInput);
  }
  sfxInput.click();
}

// ---------- 对白框 / 场景文字（对白 / 场景积木） ----------
// 对白：播放时始终显示「对白框」（角色名 + 对白内容自动加引号），位置三档（底/顶/中偏下）+ 字号三档。
// 场景：播放时显示「场景文字」（纯文字无框，来自 b.content），可自由拖拽位置，字号三档；内容留空则不显示。
function openSubtitleEditor(b) {
  const cur = b.subtitle || {};
  const pos = cur.pos || 'bottom';
  const size = cur.size || 'md';
  openModal(b.type === 'scene' ? '场景文字' : '对白框', (body) => {
    // 对白：角色编辑（角色名 + 对白内容）—— 文字即对白内容，播放时自动加引号
    if (b.type === 'dialogue') {
      const f1 = document.createElement('div');
      f1.className = 'field';
      f1.style.margin = '0';
      const l1 = document.createElement('label');
      l1.textContent = '角色名字';
      const sp = document.createElement('input');
      sp.type = 'text';
      sp.className = 'txt sub-edit-speaker';
      sp.maxLength = 20;
      sp.value = b.speaker || '';
      f1.append(l1, sp);
      const f2 = document.createElement('div');
      f2.className = 'field';
      f2.style.margin = '0';
      const l2 = document.createElement('label');
      l2.textContent = '对白内容（播放时自动加引号）';
      const taC = document.createElement('textarea');
      taC.className = 'txt sub-edit-content';
      taC.placeholder = '例如：他应该不会来了。';
      taC.value = b.content || '';
      f2.append(l2, taC);
      body.append(f1, f2);
    }
    // 场景：场景文字（内容即画面文字，留空则不显示；播放时可拖拽到任意位置）
    if (b.type === 'scene') {
      const f3 = document.createElement('div');
      f3.className = 'field';
      f3.style.margin = '0';
      const l3 = document.createElement('label');
      l3.textContent = '场景文字（留空则不显示；播放时可拖拽到任意位置）';
      const ta = document.createElement('textarea');
      ta.className = 'txt sub-edit-scene-content';
      ta.placeholder = '例如：雨下了一整夜，街上空无一人。';
      ta.value = b.content || '';
      f3.append(l3, ta);
      body.append(f3);
    }
    // 对白：位置三档 + 字号三档；场景：仅字号三档（位置在播放时自由拖拽）
    const f4 = document.createElement('div');
    f4.className = 'field';
    f4.style.margin = '0';
    const l4 = document.createElement('label');
    l4.textContent = '位置';
    const posSel = document.createElement('select');
    posSel.className = 'txt sub-edit-pos';
    posSel.innerHTML = '<option value="bottom">底部</option><option value="top">顶部</option><option value="mid">中部偏下</option><option value="custom">自由（播放中拖拽）</option>';
    posSel.value = cur.x != null ? 'custom' : (pos === 'top' ? 'top' : pos === 'mid' ? 'mid' : 'bottom');
    f4.append(l4, posSel);
    const f5 = document.createElement('div');
    f5.className = 'field';
    f5.style.margin = '0';
    const l5 = document.createElement('label');
    l5.textContent = '字号（滑条自定义；播放中也可按住文字右下角手柄拉大小）';
    const sizeRow = document.createElement('div');
    sizeRow.style.cssText = 'display:flex;align-items:center;gap:10px';
    const sizeRange = document.createElement('input');
    sizeRange.type = 'range';
    sizeRange.min = 12; sizeRange.max = 72; sizeRange.step = 1;
    sizeRange.className = 'sub-edit-size';
    sizeRange.style.flex = '1';
    const initSize = typeof size === 'number' ? size : (size === 'sm' ? 15 : size === 'lg' ? 22 : 17);
    sizeRange.value = initSize;
    const sizeVal = document.createElement('span');
    sizeVal.style.cssText = 'font-size:12px;color:var(--muted);min-width:36px;text-align:right';
    sizeVal.textContent = initSize + 'px';
    sizeRange.addEventListener('input', () => { sizeVal.textContent = sizeRange.value + 'px'; });
    sizeRow.append(sizeRange, sizeVal);
    f5.append(l5, sizeRow);
    if (b.type === 'dialogue') body.append(f4, f5);
    else body.append(f5);
  }, () => {
    // 对白：角色名 + 对白内容
    if (b.type === 'dialogue') {
      b.speaker = $('#modalBody .sub-edit-speaker').value.trim() || DEFAULT_SPEAKER;
      b.content = $('#modalBody .sub-edit-content').value.trim() || '……';
    }
    // 场景：场景文字存回 content
    if (b.type === 'scene') {
      const ta = $('#modalBody .sub-edit-scene-content');
      b.content = ta ? ta.value.trim() : (b.content || '');
    }
    // 显示设置：对白 = 位置（三档/自由）+ 字号（自定义 px）；场景 = 字号（位置为拖拽坐标 x/y，保持不变）
    const sizeNow = Number(($('#modalBody .sub-edit-size') || {}).value) || 17;
    b.subtitle = { on: true, size: sizeNow };
    if (b.type === 'dialogue') {
      const posNow = $('#modalBody .sub-edit-pos').value;
      b.subtitle.pos = posNow;
      if (posNow === 'custom') {
        if (b.subtitle.x == null) { b.subtitle.x = 50; b.subtitle.y = 82; } // 自由位置默认底部居中，播放中再拖拽微调
      } else {
        delete b.subtitle.x;
        delete b.subtitle.y;
      }
    } else {
      if (cur.x != null) b.subtitle.x = cur.x;
      if (cur.y != null) b.subtitle.y = cur.y;
    }
    persist();
    renderBlocks();
    toast('已更新');
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

// ---------- 角色声音表 + 幕级 BGM + 三轨时间轴 ----------
// 收集当前故事中出现的对白角色（去重）
function castSpeakers() {
  const s = story();
  const out = [];
  (s.chapters || []).forEach(c => (c.blocks || []).forEach(b => {
    if (b.type !== 'dialogue') return;
    const sp = (b.speaker || DEFAULT_SPEAKER).trim();
    if (sp && !out.includes(sp)) out.push(sp);
  }));
  return out;
}
// 读取音频真实时长（loadedmetadata；3 秒超时返回 0）
function loadAudioDuration(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(0); return; }
    const a = new Audio();
    a.preload = 'metadata';
    const done = () => { clearTimeout(t); try { a.removeAttribute('src'); } catch (e) {} resolve(isFinite(a.duration) ? a.duration : 0); };
    a.onloadedmetadata = done;
    a.onerror = done;
    const t = setTimeout(done, 3000);
    a.src = url;
  });
}
// 试听一段文本的 AI 音色
let castPreviewAudio = null;
async function playVoicePreviewText(text, voice, btn) {
  if (castPreviewAudio) { try { castPreviewAudio.pause(); } catch (e) {} castPreviewAudio = null; }
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = '⋯';
  try {
    const t = localStorage.getItem('hyool_token');
    const res = await fetch('/api/tts', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
      body: JSON.stringify({ text, voice }),
    });
    if (!res.ok) throw new Error('tts fail');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    castPreviewAudio = new Audio(url);
    const done = () => { URL.revokeObjectURL(url); if (btn) { btn.disabled = false; btn.textContent = '▶ 试听'; } };
    castPreviewAudio.addEventListener('ended', done);
    castPreviewAudio.addEventListener('error', done);
    await castPreviewAudio.play();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '▶ 试听'; }
    toast('AI 音色试听失败：请确认已登录', true);
  }
}
// 角色声音表弹窗：列出作品全部对白角色，逐个配置声音
function openCastEditor() {
  const s = story();
  if (!s) return;
  openModal('🎭 角色声音表', (body) => {
    const tip = document.createElement('div');
    tip.className = 'cast-tip';
    tip.textContent = '为角色统一配置声音。播放优先级：积木配音 > 角色声音表。AI 音色需登录，未就绪时该角色静音。';
    body.appendChild(tip);
    const host = document.createElement('div');
    host.className = 'cast-list';
    host.id = 'castList';
    body.appendChild(host);
    const refresh = document.createElement('button');
    refresh.className = 'btn tiny';
    refresh.textContent = '↻ 重新收集角色';
    refresh.addEventListener('click', () => { closeModal(); openCastEditor(); });
    body.appendChild(refresh);
    buildCastList(host);
  });
  loadTtsVoices();
}
async function buildCastList(host) {
  const s = story();
  if (!s) return;
  const speakers = castSpeakers();
  if (!speakers.length) {
    const d = document.createElement('div');
    d.className = 'cast-empty';
    d.textContent = '还没有对白角色。先在对白积木里填写角色名字，再回来配置声音。';
    host.appendChild(d);
    return;
  }
  const voices = await loadTtsVoices();
  speakers.forEach(sp => host.appendChild(buildCastRow(sp, voices)));
}
function buildCastRow(sp, voices) {
  const s = story();
  const entry = (s.cast || {})[sp];
  const row = document.createElement('div');
  row.className = 'cast-row';
  const name = document.createElement('div');
  name.className = 'cast-name';
  name.textContent = sp;
  const kindSel = document.createElement('select');
  kindSel.className = 'txt cast-kind';
  kindSel.innerHTML = '<option value="none">无声音</option><option value="tts">AI 音色</option><option value="audio">上传音频</option>';
  kindSel.value = entry ? entry.kind : 'none';
  row.append(name, kindSel);
  const conf = document.createElement('div');
  conf.className = 'cast-conf';
  row.appendChild(conf);
  const renderConf = () => {
    conf.innerHTML = '';
    const kind = kindSel.value;
    if (kind === 'tts') {
      const vs = document.createElement('select');
      vs.className = 'txt';
      const mk = (g) => {
        const grp = document.createElement('optgroup');
        grp.label = g === 'female' ? '女声' : '男声';
        voices.filter(v => (v.gender || '') === g).forEach(v => {
          const o = document.createElement('option');
          o.value = v.id; o.textContent = v.name; grp.appendChild(o);
        });
        if (grp.children.length) vs.appendChild(grp);
      };
      mk('female'); mk('male');
      if (entry && entry.voice) vs.value = entry.voice;
      const play = document.createElement('button');
      play.className = 'btn tiny';
      play.textContent = '▶ 试听';
      play.addEventListener('click', () => playVoicePreviewText('这是一句用于试听的声音。', vs.value, play));
      const vol = makeVolSlider(entry && entry.volume, (v) => { saveCast(sp, { kind: 'tts', voice: vs.value, volume: v }); });
      const rm = makeRemoveCast(sp, row);
      conf.append(vs, play, vol, rm);
    } else if (kind === 'audio') {
      const add = document.createElement('button');
      add.className = 'btn tiny';
      add.textContent = entry && entry.url ? '更换音频' : '上传音频';
      add.addEventListener('click', () => pickCastAudio(sp, add));
      const play = document.createElement('button');
      play.className = 'btn tiny';
      play.textContent = '▶ 试听';
      play.addEventListener('click', () => {
        if (entry && entry.url) {
          if (castPreviewAudio) { try { castPreviewAudio.pause(); } catch (e) {} }
          castPreviewAudio = new Audio(entry.url);
          castPreviewAudio.play().catch(() => {});
        }
      });
      const vol = makeVolSlider(entry && entry.volume, (v) => { saveCast(sp, { kind: 'audio', url: entry && entry.url, volume: v }); });
      const rm = makeRemoveCast(sp, row);
      conf.append(add, play, vol, rm);
    }
  };
  kindSel.addEventListener('change', () => {
    const kind = kindSel.value;
    if (kind === 'none') { removeCastEntry(sp); row.remove(); return; }
    if (kind === 'tts') saveCast(sp, { kind: 'tts', voice: '', volume: 0.8 });
    if (kind === 'audio') saveCast(sp, { kind: 'audio', url: '', volume: 0.8 });
    renderConf();
  });
  renderConf();
  return row;
}
// 角色声音表：保存/移除/通用控件
function saveCast(sp, entry) {
  const s = story();
  if (!s) return;
  if (!s.cast || typeof s.cast !== 'object') s.cast = {};
  s.cast[sp] = entry;
  persist();
  clearTtsCache();
}
function removeCastEntry(sp) {
  const s = story();
  if (!s) return;
  delete s.cast[sp];
  persist();
  clearTtsCache();
  toast('已移除「' + sp + '」的声音');
}
function makeVolSlider(cur, onInput) {
  const wrap = document.createElement('div');
  wrap.className = 'bgm-vol';
  const l = document.createElement('span');
  l.textContent = '音量';
  const range = document.createElement('input');
  range.type = 'range'; range.min = 0; range.max = 100;
  range.value = Math.round((Number(cur) || 0.8) * 100);
  range.addEventListener('input', () => onInput(Number(range.value) / 100));
  wrap.append(l, range);
  return wrap;
}
function makeRemoveCast(sp, row) {
  const rm = document.createElement('button');
  rm.className = 'btn tiny danger';
  rm.textContent = '移除声音';
  rm.addEventListener('click', () => { removeCastEntry(sp); row.remove(); });
  return rm;
}
let castAudioInput = null;
let castPickBtn = null;
let castPickSp = null;
function pickCastAudio(sp, btn) {
  castPickBtn = btn;
  castPickSp = sp; // input 为单例，change 回调须用「本次点击」的角色，避免写错角色
  if (!castAudioInput) {
    castAudioInput = document.createElement('input');
    castAudioInput.type = 'file';
    castAudioInput.accept = 'audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/ogg';
    castAudioInput.style.display = 'none';
    castAudioInput.addEventListener('change', async () => {
      const file = castAudioInput.files && castAudioInput.files[0];
      castAudioInput.value = '';
      if (!file) return;
      const uploading = castPickBtn;
      const oldText = uploading ? uploading.textContent : '';
      if (uploading) { uploading.disabled = true; uploading.textContent = '上传中…'; }
      const result = await uploadFile(file);
      if (uploading) { uploading.disabled = false; uploading.textContent = oldText; }
      if (result) {
        const s = story();
        if (!s.cast || typeof s.cast !== 'object') s.cast = {};
        const cur = s.cast[castPickSp] || {};
        s.cast[castPickSp] = { kind: 'audio', url: result.url, volume: cur.volume || 0.8 };
        persist();
        clearTtsCache();
        toast('角色音频已设置');
      }
    });
    document.body.appendChild(castAudioInput);
  }
  castAudioInput.click();
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
// 幕级 BGM（积木上覆盖章节 BGM）
let blockBgmInput = null;
let bgmPickBlock = null;
let bgmPickBtn = null;
function pickBlockBgm(b, btn) {
  bgmPickBlock = b;
  bgmPickBtn = btn;
  if (!blockBgmInput) {
    blockBgmInput = document.createElement('input');
    blockBgmInput.type = 'file';
    blockBgmInput.accept = 'audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/ogg';
    blockBgmInput.style.display = 'none';
    blockBgmInput.addEventListener('change', async () => {
      const file = blockBgmInput.files && blockBgmInput.files[0];
      blockBgmInput.value = '';
      if (!file) return;
      const uploading = bgmPickBtn;
      const oldText = uploading ? uploading.textContent : '';
      if (uploading) { uploading.disabled = true; uploading.textContent = '上传中…'; }
      const result = await uploadFile(file);
      if (uploading) { uploading.disabled = false; uploading.textContent = oldText; }
      if (result && bgmPickBlock) {
        bgmPickBlock.bgmOverride = { ...result, volume: bgmPickBlock.bgmOverride && bgmPickBlock.bgmOverride.volume != null ? bgmPickBlock.bgmOverride.volume : 0.6 };
        persist();
        renderBlocks();
        toast('本幕 BGM 已设置');
      }
    });
    document.body.appendChild(blockBgmInput);
  }
  blockBgmInput.click();
}
function openBlockBgmEditor(b) {
  const ch = chapter();
  if (!ch) return;
  openModal('🎵 本幕 BGM', (body) => {
    const tip = document.createElement('div');
    tip.className = 'cast-tip';
    tip.textContent = '章节 BGM：' + (ch.bgm && ch.bgm.url ? '已设置（本幕默认跟随章节曲）' : '未设置');
    body.appendChild(tip);
    const mode = document.createElement('div');
    mode.className = 'field';
    const l = document.createElement('label');
    l.textContent = '本幕 BGM';
    const sel = document.createElement('select');
    sel.className = 'txt';
    sel.innerHTML = '<option value="follow">跟随章节 BGM</option><option value="override">本幕指定 BGM</option>';
    sel.value = b.bgmOverride ? 'override' : 'follow';
    mode.append(l, sel);
    body.appendChild(mode);
    const conf = document.createElement('div');
    body.appendChild(conf);
    const renderConf = () => {
      conf.innerHTML = '';
      if (sel.value !== 'override') return;
      if (b.bgmOverride && b.bgmOverride.url) {
        const prev = document.createElement('div');
        prev.className = 'ba-preview';
        const au = document.createElement('audio');
        au.src = b.bgmOverride.url; au.controls = true; au.preload = 'metadata';
        prev.appendChild(au);
        const vol = makeVolSlider(b.bgmOverride.volume, (v) => { b.bgmOverride.volume = v; persist(); });
        const opsRow = document.createElement('div');
        opsRow.className = 'bm-ops';
        const chg = document.createElement('button');
        chg.className = 'btn tiny';
        chg.textContent = '更换 BGM';
        chg.addEventListener('click', () => pickBlockBgm(b, chg));
        const rm = document.createElement('button');
        rm.className = 'btn tiny danger';
        rm.textContent = '移除覆盖（回到章节曲）';
        rm.addEventListener('click', () => { delete b.bgmOverride; persist(); renderBlocks(); renderConf(); });
        opsRow.append(chg, rm);
        conf.append(prev, vol, opsRow);
      } else {
        const add = document.createElement('button');
        add.className = 'media-add';
        add.textContent = '🎵 选择本幕 BGM';
        add.addEventListener('click', () => pickBlockBgm(b, add));
        conf.appendChild(add);
      }
    };
    sel.addEventListener('change', () => {
      if (sel.value === 'follow') { delete b.bgmOverride; persist(); renderBlocks(); }
      else if (!b.bgmOverride) { b.bgmOverride = { url: '', type: 'audio', volume: 0.6 }; persist(); }
      renderConf();
    });
    renderConf();
  }, () => { persist(); renderBlocks(); });
}

function closeModal() {
  $('#modal').classList.add('hidden');
  const card = document.querySelector('#modal .modal-card');
  if (card) card.classList.remove('modal-wide');
  $('#modalBody').innerHTML = '';
  $('#modalBody').className = 'modal-body';
  modalOk = null;
}
// ---------- 三轨时间轴（配音 / 音效 / BGM 可视化） ----------
let tlState = null; // 时间轴弹窗运行状态
function openTimelineEditor(b) {
  if (!b) return;
  const card = document.querySelector('#modal .modal-card');
  if (card) card.classList.add('modal-wide');
  selectedSfxId = null;
  tlState = { b, totalMs: 10000, playing: false, voiceDur: 0, sfxDurs: [], bgm: null, voice: null, sfx: [], sfxTimers: [], raf: 0 };
  openModal('🎼 声音时间轴（三轨）', (body) => {
    body.innerHTML = `
      <div class="tl">
        <div class="tl-head">
          <button class="btn tiny" id="tlPlayBtn">▶ 试听本幕</button>
          <button class="btn tiny hidden" id="tlStopBtn">⏹ 停止</button>
          <span class="tl-time" id="tlTime">0.00s</span>
          <span class="tl-total" id="tlTotal"></span>
          <span style="flex:1"></span>
          <button class="btn tiny" id="tlAddSfx">＋ 添加音效</button>
        </div>
        <div class="tl-board">
          <div class="tl-playhead" id="tlPlayhead"></div>
          <div class="tl-lane">
            <div class="tl-label"></div>
            <div class="tl-track"><div class="tl-ruler" id="tlRuler"></div></div>
          </div>
          <div class="tl-lane">
            <div class="tl-label">🎵 BGM</div>
            <div class="tl-track"><div class="tl-clip tl-bgm" id="tlBgmClip"></div></div>
          </div>
          <div class="tl-lane">
            <div class="tl-label">🎙 配音</div>
            <div class="tl-track"><div class="tl-clip tl-voice" id="tlVoiceClip"></div></div>
          </div>
          <div class="tl-lane">
            <div class="tl-label">🔊 音效</div>
            <div class="tl-track" id="tlSfxTrack"></div>
          </div>
        </div>
        <div class="tl-edit" id="tlEdit"></div>
      </div>`;
    $('#tlPlayBtn').addEventListener('click', tlPlay);
    $('#tlStopBtn').addEventListener('click', tlStop);
    $('#tlAddSfx').addEventListener('click', () => pickTimelineSfx(b));
    // 加载音频真实时长后首绘
    const ch = chapter();
    const bgm = b.bgmOverride || (ch && ch.bgm) || null;
    const voice = resolveBlockVoice(b);
    const durJobs = (b.sfxList || []).map(sf => loadAudioDuration(sf.url));
    Promise.all([loadAudioDuration(bgm && bgm.url), loadAudioDuration(voice && voice.url), Promise.all(durJobs)])
      .then(([bgmDur, voiceDur, sfxDurs]) => {
        tlState.voiceDur = voiceDur || 0;
        tlState.sfxDurs = (b.sfxList || []).map((sf, i) => ({ id: sf.id, dur: sfxDurs[i] || 0 }));
        const maxSfxEnd = Math.max(0, ...(b.sfxList || []).map((sf, i) => {
          const d = sf.loop ? 2000 : Math.max(300, sf.durationMs || (sfxDurs[i] || 0) * 1000 || 800);
          return (sf.offsetMs || 0) + d;
        }));
        const voiceEnd = Math.round((voiceDur || 0) * 1000) + 600;
        tlState.totalMs = Math.max(10000, maxSfxEnd, voiceEnd);
        tlRender(b);
      });
  }, () => { tlStop(); persist(); renderBlocks(); });
}
function tlRender(b) {
  const st = tlState;
  if (!st || !st.b) return;
  const totalSec = st.totalMs / 1000;
  const totalEl = $('#tlTotal');
  if (totalEl) totalEl.textContent = '总长 ' + totalSec.toFixed(1) + 's';
  // 标尺
  const ruler = $('#tlRuler');
  if (ruler) {
    ruler.innerHTML = '';
    const step = totalSec <= 12 ? 1 : totalSec <= 30 ? 2 : totalSec <= 60 ? 5 : 10;
    for (let s = 0; s <= totalSec + 0.001; s += step) {
      const m = document.createElement('div');
      m.className = 'tl-tick';
      m.style.left = (s / totalSec * 100) + '%';
      m.textContent = s + 's';
      ruler.appendChild(m);
    }
  }
  // BGM 轨：幕级覆盖 > 章节曲
  const ch = chapter();
  const bgm = b.bgmOverride || (ch && ch.bgm) || null;
  const bgmClip = $('#tlBgmClip');
  if (bgmClip) {
    if (bgm && bgm.url) {
      bgmClip.style.display = 'block';
      bgmClip.style.left = '0';
      bgmClip.style.width = '100%';
      bgmClip.textContent = (b.bgmOverride ? '本幕 BGM · ' : '章节 BGM · ') + (bgm.url.split('/').pop() || '');
    } else bgmClip.style.display = 'none';
  }
  // 配音轨
  const voice = resolveBlockVoice(b);
  const voiceClip = $('#tlVoiceClip');
  if (voiceClip) {
    if (voice && voice.url) {
      const label = voice.kind === 'tts' ? 'AI 音色' : voice.kind === 'block' ? '积木配音' : '角色音频';
      voiceClip.style.display = 'block';
      const width = Math.max(3, st.voiceDur / totalSec * 100);
      voiceClip.style.left = '0';
      voiceClip.style.width = Math.min(width, 100) + '%';
      voiceClip.classList.toggle('tl-est', !st.voiceDur);
      voiceClip.textContent = (b.speaker || DEFAULT_SPEAKER) + ' · ' + label + (st.voiceDur ? '（' + st.voiceDur.toFixed(1) + 's）' : '');
    } else voiceClip.style.display = 'none';
  }
  // 音效轨
  renderSfxClips();
  renderSfxEdit();
}
function formatDialogue(b) {
  if (b.type !== 'dialogue') return b.content || '';
  const c = (b.content || '').trim();
  return /^[“"]/.test(c) ? c : `“${c}”`;
}

// ---------- 播放 ----------

// ---------- AI 音色（角色声音表 · TTS 预合成） ----------
const FALLBACK_VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural', name: '普通话 · 晓晓', gender: 'female' },
  { id: 'zh-CN-XiaoyiNeural', name: '普通话 · 晓伊', gender: 'female' },
  { id: 'zh-CN-YunjianNeural', name: '普通话 · 云健', gender: 'male' },
  { id: 'zh-CN-YunxiNeural', name: '普通话 · 云希', gender: 'male' },
];
async function loadTtsVoices() {
  if (ttsVoices.length) return ttsVoices;
  try {
    const t = localStorage.getItem('hyool_token');
    const res = await fetch('/api/tts/voices', {
      credentials: 'include',
      headers: t ? { Authorization: 'Bearer ' + t } : {},
    });
    if (res.ok) {
      const d = await res.json();
      if (d && Array.isArray(d.voices) && d.voices.length) ttsVoices = d.voices;
    }
  } catch (e) { /* 离线/未登录时用内置音色兜底 */ }
  if (!ttsVoices.length) ttsVoices = FALLBACK_VOICES;
  return ttsVoices;
}
function ttsKey(b) {
  const s = story();
  const entry = s && s.cast && s.cast[b.speaker || DEFAULT_SPEAKER];
  return `${currentId}|${b.id}|${(entry && entry.voice) || ''}|${(b.content || '').slice(0, 40)}`;
}
async function synthTts(b) {
  const s = story();
  if (!s || !s.cast) return null;
  const entry = s.cast[b.speaker || DEFAULT_SPEAKER];
  if (!entry || entry.kind !== 'tts' || !entry.voice) return null;
  const key = ttsKey(b);
  if (ttsCache.has(key)) return ttsCache.get(key);
  const t = localStorage.getItem('hyool_token');
  if (!t) return null; // 未登录：静默降级，不阻塞播放
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: JSON.stringify({ text: b.content || '', voice: entry.voice }),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    ttsCache.set(key, url);
    return url;
  } catch (e) { return null; }
}
// 选中音效的编辑表单
function renderSfxEdit() {
  const host = $('#tlEdit');
  if (!host) return;
  const b = tlState && tlState.b;
  if (!b) { host.innerHTML = ''; return; }
  const sf = (b.sfxList || []).find(x => x.id === selectedSfxId);
  if (!sf) {
    host.innerHTML = '<div class="tl-edit-empty">点击音效条选中编辑：拖动条身调整触发时间，拖动条右侧小柄调整时长；＋ 添加音效上传新音效。</div>';
    return;
  }
  host.innerHTML = '';
  const row1 = document.createElement('div');
  row1.className = 'tl-edit-row';
  const fOffset = tlField('延迟触发（毫秒）', sf.offsetMs || 0);
  fOffset.input.addEventListener('change', () => { sf.offsetMs = Math.max(0, Number(fOffset.input.value) || 0); persist(); renderSfxClips(); });
  const fDur = tlField('时长（毫秒，循环忽略）', sf.durationMs || Math.round(durMsOf(sf)));
  fDur.input.addEventListener('change', () => { sf.durationMs = Math.max(300, Number(fDur.input.value) || 800); persist(); renderSfxClips(); });
  const loopWrap = document.createElement('div');
  loopWrap.className = 'field tl-field-check';
  const lLoop = document.createElement('label');
  lLoop.textContent = '循环';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!sf.loop;
  cb.addEventListener('change', () => { sf.loop = cb.checked; persist(); renderSfxClips(); });
  loopWrap.append(lLoop, cb);
  row1.append(fOffset.wrap, fDur.wrap, loopWrap);
  const row2 = document.createElement('div');
  row2.className = 'tl-edit-row';
  const prev = document.createElement('audio');
  prev.src = sf.url; prev.controls = true; prev.preload = 'metadata';
  const vol = makeVolSlider(sf.volume, (v) => { sf.volume = v; persist(); });
  const ops = document.createElement('div');
  ops.className = 'bm-ops';
  const chg = document.createElement('button');
  chg.className = 'btn tiny';
  chg.textContent = '更换';
  chg.addEventListener('click', () => pickTimelineSfx(tlState.b, sf));
  const rm = document.createElement('button');
  rm.className = 'btn tiny danger';
  rm.textContent = '删除音效';
  rm.addEventListener('click', () => {
    tlState.b.sfxList = tlState.b.sfxList.filter(x => x.id !== sf.id);
    selectedSfxId = null;
    persist();
    renderBlocks();
    tlRender(tlState.b);
  });
  ops.append(chg, rm);
  row2.append(prev, vol, ops);
  host.append(row1, row2);
}
function tlField(label, value) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const l = document.createElement('label');
  l.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = 0;
  input.value = value;
  wrap.append(l, input);
  return { wrap, input };
}
function clearTtsCache() {
  ttsCache.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } });
  ttsCache.clear();
}
// 添加/更换音效（时间轴弹窗内）
let tlSfxInput = null;
let tlSfxTarget = null; // 本次点击目标：更换=目标音效对象，添加=null（单例 input 回调闭包不能用首次调用的 targetSfx）
function pickTimelineSfx(b, targetSfx) {
  tlSfxTarget = targetSfx || null;
  if (!tlSfxInput) {
    tlSfxInput = document.createElement('input');
    tlSfxInput.type = 'file';
    tlSfxInput.accept = 'audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/ogg';
    tlSfxInput.style.display = 'none';
    tlSfxInput.addEventListener('change', async () => {
      const file = tlSfxInput.files && tlSfxInput.files[0];
      tlSfxInput.value = '';
      if (!file) return;
      const result = await uploadFile(file);
      if (!result) return;
      const cur = tlState && tlState.b;
      if (!cur) return;
      const target = tlSfxTarget;
      if (target) {
        target.url = result.url;
        delete target.durationMs;
        toast('音效已更换');
      } else {
        if (!Array.isArray(cur.sfxList)) cur.sfxList = [];
        const sf = { id: 'sfx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url: result.url, type: 'audio', offsetMs: 0, loop: false, volume: 0.8 };
        cur.sfxList.push(sf);
        selectedSfxId = sf.id;
        toast('音效已添加，可在轨道上拖动调整');
      }
      persist();
      renderBlocks();
      const dur = await loadAudioDuration(result.url);
      const targetId = target ? target.id : selectedSfxId;
      tlState.sfxDurs = tlState.sfxDurs.filter(x => x.id !== targetId);
      tlState.sfxDurs.push({ id: targetId, dur });
      tlRender(cur);
    });
    document.body.appendChild(tlSfxInput);
  }
  tlSfxInput.click();
}
// 时间轴试听：配音 + 音效（带 offset 调度）+ BGM 同步播放，播放头动画
function tlStop() {
  const st = tlState;
  if (!st) return;
  st.playing = false;
  if (st.raf) cancelAnimationFrame(st.raf);
  if (st.bgm) { try { st.bgm.pause(); } catch (e) {} st.bgm = null; }
  if (st.voice) { try { st.voice.pause(); } catch (e) {} st.voice = null; }
  (st.sfx || []).forEach(a => { try { a.pause(); } catch (e) {} });
  st.sfx = [];
  (st.sfxTimers || []).forEach(t => clearTimeout(t));
  st.sfxTimers = [];
  const playBtn = $('#tlPlayBtn');
  if (playBtn) { playBtn.classList.remove('hidden'); playBtn.textContent = '▶ 试听本幕'; }
  const stopBtn = $('#tlStopBtn');
  if (stopBtn) stopBtn.classList.add('hidden');
}
function tlPlay() {
  const st = tlState;
  if (!st || !st.b) return;
  tlStop();
  const b = st.b;
  const ch = chapter();
  const bgm = b.bgmOverride || (ch && ch.bgm) || null;
  const voice = resolveBlockVoice(b);
  st.playing = true;
  const playBtn = $('#tlPlayBtn');
  const stopBtn = $('#tlStopBtn');
  if (playBtn) playBtn.classList.add('hidden');
  if (stopBtn) stopBtn.classList.remove('hidden');
  const t0 = performance.now();
  if (voice && voice.url) {
    st.voice = new Audio(voice.url);
    st.voice.volume = Math.min(1, Math.max(0, Number(voice.volume) || 1));
    st.voice.play().catch(() => {});
  }
  if (bgm && bgm.url) {
    st.bgm = new Audio(bgm.url);
    st.bgm.loop = true;
    st.bgm.volume = Math.min(1, Math.max(0, Number(bgm.volume) || 0.6));
    st.bgm.play().catch(() => {});
  }
  st.sfx = [];
  st.sfxTimers = [];
  (b.sfxList || []).forEach(sf => {
    if (!sf.url) return;
    const t = setTimeout(() => {
      const a = new Audio(sf.url);
      a.loop = !!sf.loop;
      a.volume = Math.min(1, Math.max(0, Number(sf.volume) || 0.8));
      a.play().catch(() => {});
      st.sfx.push(a);
    }, Math.max(0, Number(sf.offsetMs) || 0));
    st.sfxTimers.push(t);
  });
  const tick = () => {
    if (!st.playing) return;
    const el = Math.min(1, (performance.now() - t0) / st.totalMs);
    const ph = $('#tlPlayhead');
    if (ph) ph.style.left = (el * 100) + '%';
    const tEl = $('#tlTime');
    if (tEl) tEl.textContent = (el * st.totalMs / 1000).toFixed(2) + 's';
    if (el >= 1) { tlStop(); if (tEl) tEl.textContent = (st.totalMs / 1000).toFixed(1) + 's'; return; }
    st.raf = requestAnimationFrame(tick);
  };
  tick();
}
// 开始播放时后台预合成所有 AI 音色对白（并发 2 防限流），未就绪的幕静默降级
async function prewarmTts(s) {
  const jobs = [];
  (s.chapters || []).forEach(c => (c.blocks || []).forEach(b => {
    if (b.type !== 'dialogue') return;
    const entry = s.cast && s.cast[b.speaker || DEFAULT_SPEAKER];
    if (entry && entry.kind === 'tts' && entry.voice) jobs.push(b);
  }));
  let idx = 0;
  const workers = Array.from({ length: Math.min(2, jobs.length) }, async () => {
    while (idx < jobs.length) { const b = jobs[idx++]; try { await synthTts(b); } catch (e) { /* ignore */ } }
  });
  await Promise.all(workers);
}

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
  $('#playBody').innerHTML = ''; // 进入播放先清空画幅残留（重复 startPlay 直接换画面不叠加，避免旧画幅撑出滚动条压缩新画幅）
  $('#playOverlay').classList.remove('hidden'); // 先显示再渲染，确保竖屏画幅能按实际播放区尺寸计算
  renderPlay();
  prewarmTts(story()); // 后台预合成 AI 音色对白（异步不阻塞播放）
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
function stopPlaySfxAll() {
  playSfxTimers.forEach(t => clearTimeout(t));
  playSfxTimers = [];
  playSfxSet.forEach(a => {
    try { a.pause(); } catch (e) { /* ignore */ }
    a.onended = null;
    a.onerror = null;
    try { a.removeAttribute('src'); } catch (e) { /* ignore */ }
  });
  playSfxSet.clear();
}
// 音效轨调度：进入本幕时按 offsetMs 依次触发（loop 持续到切幕），多轨可叠加
function playSfxListForBlock(b) {
  const list = (b && b.sfxList) || [];
  list.forEach(sf => {
    if (!sf || !sf.url) return;
    const delay = Math.max(0, Number(sf.offsetMs) || 0);
    const t = setTimeout(() => {
      const a = new Audio(sf.url);
      a.loop = !!sf.loop;
      a.preload = 'auto';
      a.volume = Math.min(1, Math.max(0, Number(sf.volume) || 0.8));
      a.play().catch(() => { /* 自动播放被拦截/加载失败时静默 */ });
      playSfxSet.add(a);
    }, delay);
    playSfxTimers.push(t);
  });
}
// 声音配置信息（供 play() 快照 / 时间轴展示；含 ready 标志，tts 未合成时 url 为 null）
function voicePlanOf(b) {
  if (b.audio && b.audio.url) return { kind: 'block', url: b.audio.url, ready: true };
  const s = story();
  if (!s || !s.cast) return null;
  const entry = s.cast[b.speaker || DEFAULT_SPEAKER];
  if (!entry) return null;
  if (entry.kind === 'audio' && entry.url) return { kind: 'audio', url: entry.url, ready: true, volume: entry.volume };
  if (entry.kind === 'tts' && entry.voice) {
    const url = ttsCache.get(ttsKey(b)) || null;
    return { kind: 'tts', voice: entry.voice, url, ready: !!url, volume: entry.volume };
  }
  return null;
}
// 角色声音解析：积木配音 > cast[角色]（audio / tts），都无 → 静音
function resolveBlockVoice(b) {
  if (b.audio && b.audio.url) return { url: b.audio.url, kind: 'block' };
  const s = story();
  if (!s || !s.cast) return null;
  const entry = s.cast[b.speaker || DEFAULT_SPEAKER];
  if (!entry) return null;
  if (entry.kind === 'audio' && entry.url) return { url: entry.url, kind: 'audio', volume: entry.volume };
  if (entry.kind === 'tts' && entry.voice) {
    const url = ttsCache.get(ttsKey(b));
    if (url) return { url, kind: 'tts', volume: entry.volume };
  }
  return null;
}
// 音效轨渲染：每条音效一个横条（可拖动位置 / 拖右缘调时长 / 循环标记）
function durMsOf(sf) {
  const rec = (tlState.sfxDurs || []).find(x => x.id === sf.id);
  return sf.loop ? 2000 : (sf.durationMs || (rec ? rec.dur * 1000 : 0) || 800);
}
function renderSfxClips() {
  const track = $('#tlSfxTrack');
  if (!track) return;
  track.innerHTML = '';
  const b = tlState.b;
  const totalSec = tlState.totalMs / 1000;
  (b.sfxList || []).forEach(sf => {
    const clip = document.createElement('div');
    clip.className = 'tl-clip tl-sfx' + (sf.loop ? ' loop' : '') + (selectedSfxId === sf.id ? ' sel' : '');
    const left = ((sf.offsetMs || 0) / 1000 / totalSec) * 100;
    const width = Math.max(2, Math.min(durMsOf(sf) / 1000 / totalSec * 100, 100 - left));
    clip.style.left = left + '%';
    clip.style.width = width + '%';
    const label = document.createElement('span');
    label.className = 'tl-clip-label';
    label.textContent = (sf.label || sf.url.split('/').pop() || '音效') + (sf.loop ? ' ∞' : '');
    clip.appendChild(label);
    const handle = document.createElement('div');
    handle.className = 'tl-handle';
    handle.title = '拖动调整时长';
    clip.appendChild(handle);
    clip.addEventListener('pointerdown', (e) => tlDragStart(e, sf));
    clip.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedSfxId = sf.id;
      renderSfxClips();
      renderSfxEdit();
    });
    track.appendChild(clip);
  });
}
let tlDrag = null;
function tlDragStart(e, sf) {
  e.stopPropagation();
  if (!tlState) return;
  const resizing = e.target.classList.contains('tl-handle');
  const track = $('#tlSfxTrack');
  const rect = track.getBoundingClientRect();
  const totalSec = tlState.totalMs / 1000;
  const pxPerSec = rect.width / totalSec;
  const startX = e.clientX;
  const startOffset = sf.offsetMs || 0;
  const startDur = durMsOf(sf);
  tlDrag = { sf, resizing, startX, startOffset, startDur, pxPerSec };
  track.setPointerCapture(e.pointerId);
  const onMove = (ev) => {
    if (!tlDrag) return;
    const dx = (ev.clientX - startX) / pxPerSec * 1000;
    if (tlDrag.resizing) {
      tlDrag.sf.durationMs = Math.max(300, Math.min(20000, Math.round(startDur + dx)));
    } else {
      tlDrag.sf.offsetMs = Math.max(0, Math.min(tlState.totalMs - 300, Math.round(startOffset + dx)));
    }
    renderSfxClips();
  };
  const onUp = () => {
    if (!tlDrag) return;
    tlDrag = null;
    track.removeEventListener('pointermove', onMove);
    track.removeEventListener('pointerup', onUp);
    persist();
    renderSfxClips();
    renderSfxEdit();
  };
  track.addEventListener('pointermove', onMove);
  track.addEventListener('pointerup', onUp);
}
function playVoiceForBlock(b) {
  const v = resolveBlockVoice(b);
  if (!v || !v.url) return;
  const au = new Audio(v.url);
  au.preload = 'auto';
  au.volume = Math.min(1, Math.max(0, Number(v.volume) || 1));
  au.play().catch(() => { /* 自动播放被拦截/加载失败时静默，不影响点击推进 */ });
  playAudio = au;
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
    playBgmUrl = bgm.url;
  } else {
    playBgmUrl = null;
  }
  playBgmChapter = chapterId;
}
function stopPlay() {
  stopPlayAudio();
  stopPlaySfxAll();
  stopPlayBgm();
  playBgmChapter = null;
  playBgmUrl = null;
  $('#playBody').innerHTML = ''; // 清空画幅残留，避免下次播放叠加旧帧
  $('#playOverlay').classList.add('hidden');
}
// 播放文字拖拽：按住可自由移动，松手自动保存位置（x/y = 画幅中心点百分比，松手后按百分比定位）。
// 场景文字：点击不推进下一幕；对白框：opts.onClick 传入 playNext（点击推进、拖拽后不误触）。
// 位置写回真实积木数据（playFlat 是浅拷贝，直接改 b.subtitle 不回写原数据）。
function makeTextDraggable(el, b, opts = {}) {
  let sx = 0, sy = 0, ox = 0, oy = 0, moved = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    moved = false;
    sx = e.clientX; sy = e.clientY;
    ox = el.offsetLeft; oy = el.offsetTop;
    el.classList.add('dragging');
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!el.classList.contains('dragging')) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    el.style.left = (ox + dx) + 'px';
    el.style.top = (oy + dy) + 'px';
    el.style.transform = 'none';
  });
  const endDrag = (e) => {
    if (!el.classList.contains('dragging')) return;
    el.classList.remove('dragging');
    const frame = el.parentElement;
    if (!frame) return;
    const r = frame.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const l = parseFloat(el.style.left) || 0;
    const t = parseFloat(el.style.top) || 0;
    const px = Math.round(Math.min(100, Math.max(0, (l + el.offsetWidth / 2) / r.width * 100)));
    const py = Math.round(Math.min(100, Math.max(0, (t + el.offsetHeight / 2) / r.height * 100)));
    el.style.left = px + '%';
    el.style.top = py + '%';
    el.style.transform = 'translate(-50%,-50%)';
    const real = findBlock(b.id);
    if (real) {
      real.subtitle = real.subtitle || { on: true };
      real.subtitle.x = px;
      real.subtitle.y = py;
      if (real.type === 'dialogue') real.subtitle.pos = 'custom';
      persist();
    }
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('click', (e) => {
    if (moved) { moved = false; e.stopPropagation(); return; } // 拖拽后的 click 不触发推进
    if (opts.onClick) opts.onClick(e);
    else e.stopPropagation(); // 场景文字：点击不推进下一幕
  });
}

// 播放文字「拉大小」手柄：按住右下角手柄拖动实时调字号（对白框联动角色名），松手保存 subtitle.size（数字 px）。
// 位置拖拽在文字主体上（makeTextDraggable），手柄事件独立 stopPropagation 互不干扰。
function attachSizeHandle(el, b) {
  const isDialogue = el.classList.contains('play-dialogue');
  const h = document.createElement('span');
  h.className = 'rz-handle';
  h.title = '按住拖动调整字号';
  el.appendChild(h);
  const lineOf = () => isDialogue ? el.querySelector('.pd-line') : el;
  const currentSize = () => {
    const ln = lineOf();
    if (ln && ln.style.fontSize) return Math.round(parseFloat(ln.style.fontSize));
    if (el.classList.contains('size-sm')) return 15;
    if (el.classList.contains('size-lg')) return 22;
    return 17;
  };
  const applySize = (n) => {
    const px = Math.min(72, Math.max(12, Math.round(n)));
    const ln = lineOf();
    if (!ln) return;
    ln.style.fontSize = px + 'px';
    if (isDialogue) {
      const sp = el.querySelector('.pd-speaker');
      if (sp) sp.style.fontSize = Math.round(px * 1.3) + 'px';
    }
  };
  let sx = 0, sy = 0, start = 17;
  h.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    start = currentSize();
    sx = e.clientX; sy = e.clientY;
    h.classList.add('dragging');
    h.setPointerCapture(e.pointerId);
  });
  h.addEventListener('pointermove', (e) => {
    if (!h.classList.contains('dragging')) return;
    applySize(start + ((e.clientX - sx) + (e.clientY - sy)) / 2);
  });
  const end = (e) => {
    if (!h.classList.contains('dragging')) return;
    h.classList.remove('dragging');
    const n = currentSize();
    const real = findBlock(b.id);
    if (real) {
      real.subtitle = real.subtitle || { on: true };
      real.subtitle.size = n;
      persist();
    }
  };
  h.addEventListener('pointerup', end);
  h.addEventListener('pointercancel', end);
  h.addEventListener('click', (e) => e.stopPropagation()); // 手柄点击不触发文字点击推进
}
function renderPlay() {
  stopPlayAudio(); // 先停掉上一幕的配音，避免两个声音同时播放
  stopPlaySfxAll();   // 音效轨：切幕时停止本幕全部音效（含延迟定时器）
  if (!playFlat.length) return;
  $('#playProgress').textContent = `第 ${playIdx + 1} 条 · 共 ${playFlat.length} 条`;
  $('#playChapter').textContent = playFlat[playIdx].chapterTitle;
  $('#playCount').textContent = `${playIdx + 1} / ${playFlat.length}`;
  const body = $('#playBody');
  // 转场交叉淡化：所有残留旧画幅淡出后延迟移除（叠加在新画幅下层），不再直接清空 DOM，避免切幕瞬间露出黑底
  body.querySelectorAll('.play-frame').forEach((f) => {
    if (!f.classList.contains('tl-leave')) f.classList.add('tl-leave');
    setTimeout(() => f.remove(), 260);
  });
  const b = playFlat[playIdx];
  const overlay = $('#playOverlay');
  // 按作品方向适配播放画幅（16:9 横屏 / 9:16 竖屏）
  const sPlay = story();
  // 画幅容器：横屏铺满播放区；竖屏（9:16）时按播放区可用尺寸精确计算，居中收窄、比例恒定
  const frame = document.createElement('div');
  frame.className = 'play-frame';
  if (sPlay && sPlay.orientation === 'portrait') {
    const fw = body.clientWidth;
    const fh = body.clientHeight;
    const pw = Math.min(fw, Math.round(fh * 9 / 16));
    frame.style.width = pw + 'px';
    frame.style.height = Math.round(pw * 16 / 9) + 'px';
  }
  overlay.classList.toggle('orient-portrait', !!(sPlay && sPlay.orientation === 'portrait'));
  overlay.classList.toggle('orient-landscape', !(sPlay && sPlay.orientation === 'portrait'));
  // BGM：默认跟随章节（同章节连续不重启）；幕级 bgmOverride 优先，覆盖仅本幕生效（离开本幕后自动恢复章节曲）
  const targetBgm = b.bgmOverride || b.bgm || null;
  const targetUrl = targetBgm && targetBgm.url ? targetBgm.url : null;
  if (targetUrl !== playBgmUrl) {
    switchBgm(targetBgm, b.chapterId);
  } else if (b.chapterId !== playBgmChapter) {
    playBgmChapter = b.chapterId; // 同一首曲跨章节不重启，仅更新章节标记
  }
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
    frame.appendChild(bg);
  } else {
    overlay.classList.remove('has-media');
  }
  // 前景文字/对白（点击 → 下一幕）
  const fore = document.createElement('div');
  fore.className = 'play-fore';
  fore.addEventListener('click', playNext);
  if (b.type === 'scene') {
    // 场景幕：fore 退化为全屏透明点击区（整幅画面点击推进下一幕），无「点击文字进入下一条」提示、无玻璃卡片背景；
    // 场景文字（纯文字无框）单独渲染在 frame 上层，可自由拖拽
    fore.classList.add('scene-sub-mode');
  } else {
    // 对白框：始终显示（角色名 + 对白内容自动加引号）；位置 = 弹窗三档预设（底/顶/中偏下）或播放中自由拖拽（存了 x/y = 自由位置）；字号 = 三档或自定义 px（可拖手柄拉大小）
    const sub = b.subtitle || {};
    const sizeNum = typeof sub.size === 'number' ? sub.size : null;
    const isFree = sub.x != null;
    const d = document.createElement('div');
    d.className = 'play-dialogue' + (sizeNum ? '' : ' size-' + (sub.size === 'sm' ? 'sm' : sub.size === 'lg' ? 'lg' : 'md')) +
      (isFree ? ' free' : (sub.pos === 'mid' ? ' mid' : ''));
    if (!isFree) {
      if (sub.pos === 'top') fore.classList.add('dlg-top');
      else if (sub.pos !== 'mid') fore.classList.add('dlg-bot');
    }
    const sp = document.createElement('div');
    sp.className = 'pd-speaker';
    sp.textContent = b.speaker || DEFAULT_SPEAKER;
    const ln = document.createElement('div');
    ln.className = 'pd-line';
    ln.textContent = formatDialogue(b);
    d.append(sp, ln);
    if (sizeNum) { ln.style.fontSize = sizeNum + 'px'; sp.style.fontSize = Math.round(sizeNum * 1.3) + 'px'; }
    if (isFree) {
      d.style.left = sub.x + '%';
      d.style.top = sub.y + '%';
      d.style.transform = 'translate(-50%,-50%)';
      makeTextDraggable(d, b, { onClick: playNext });
      frame.appendChild(d);
    } else {
      fore.appendChild(d);
    }
    attachSizeHandle(d, b); // 拉大小手柄（对白框：拖动实时调整个框的字号）
  }
  frame.appendChild(fore);
  // 场景文字：纯文字无框，可自由拖拽位置（x/y 播放区中心点百分比），字号三档或自定义 px（可拖手柄拉大小）；内容留空则不显示
  if (b.type === 'scene' && (b.content || '').trim()) {
    const sub = b.subtitle || {};
    const sizeNum = typeof sub.size === 'number' ? sub.size : null;
    const st = document.createElement('div');
    st.className = 'play-scene-text' + (sizeNum ? '' : ' size-' + (sub.size === 'sm' ? 'sm' : sub.size === 'lg' ? 'lg' : 'md'));
    st.textContent = b.content;
    st.style.left = (sub.x != null ? sub.x : 50) + '%';
    st.style.top = (sub.y != null ? sub.y : 82) + '%';
    st.style.transform = 'translate(-50%,-50%)';
    if (sizeNum) st.style.fontSize = sizeNum + 'px';
    makeTextDraggable(st, b);
    attachSizeHandle(st, b); // 拉大小手柄（场景文字：拖动实时调字号）
    frame.appendChild(st);
  }
  body.appendChild(frame);
  $('#playPrev').disabled = playIdx === 0;
  $('#playNext').disabled = playIdx >= playFlat.length - 1;
  // 配音：积木配音 > 角色声音表（AI 音色 / 手动音频），都无则静音；播放失败不影响点击推进
  playVoiceForBlock(b);
  // 音效轨：按 sfxList 调度（offsetMs 延迟触发、loop 持续到切幕、多轨叠加）
  playSfxListForBlock(b);
  // 预取下一幕视觉素材（图片/视频进浏览器缓存），渐入期间立即可见，进一步消除黑屏窗口
  const nxt = playFlat[playIdx + 1];
  if (nxt && nxt.media && nxt.media.url) {
    if (nxt.media.type === 'video') {
      const pv = document.createElement('video');
      pv.preload = 'auto'; pv.muted = true;
      pv.src = nxt.media.url;
    } else {
      const pi = new Image();
      pi.src = nxt.media.url;
    }
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
  $('#castBtn').addEventListener('click', openCastEditor);
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
  // 新建作品：分辨率选择卡（16:9 横屏 / 9:16 竖屏）
  document.querySelectorAll('#createOrient .orient-card').forEach(btn => {
    btn.addEventListener('click', () => {
      createOrientation = btn.dataset.orient === 'portrait' ? 'portrait' : 'landscape';
      document.querySelectorAll('#createOrient .orient-card').forEach(x => x.classList.toggle('active', x === btn));
    });
  });
  // 编辑器：画面方向（影响播放画幅与后续上传压缩）
  document.querySelectorAll('#storyOrient .orient-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = story();
      if (!s) return;
      s.orientation = btn.dataset.orient === 'portrait' ? 'portrait' : 'landscape';
      persist(); renderEditor(); renderLibrary();
      toast('画面方向：' + ORIENT_LABEL[s.orientation]);
    });
  });
  // 编辑器：画质（标准 1280 / 高清 1920，影响后续上传图片压缩规格）
  document.querySelectorAll('#storyQual .qual-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = story();
      if (!s) return;
      s.imgQuality = btn.dataset.qual === 'hd' ? 'hd' : 'standard';
      persist(); renderEditor(); renderLibrary();
      toast('画质：' + QUAL_LABEL[s.imgQuality] + '（此后新上传的画面按此规格压缩）');
    });
  });
  renderLibrary();
}

// ---------- 对外测试 API ----------
window.StoryEditor = {
  ready: true,
  list: () => stories.map(s => ({
    id: s.id, title: s.title, orientation: s.orientation, imgQuality: s.imgQuality, cast: s.cast || {},
    chapters: s.chapters.map(c => ({ id: c.id, title: c.title, bgm: c.bgm || null, blocks: c.blocks.map(b => ({ ...b })) })),
  })),
  create: (title, orientation) => {
    $('#newTitle').value = title;
    if (orientation === 'portrait' || orientation === 'landscape') {
      createOrientation = orientation;
      // API 创建路径同步新建区选择卡高亮，与点击行为一致
      document.querySelectorAll('#createOrient .orient-card').forEach(x => x.classList.toggle('active', x.dataset.orient === orientation));
    }
    createStory();
    return story() ? story().id : null;
  },
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
  // 带当前作品方向/画质的压缩上传（供测试与需要按作品规格压缩的调用）
  uploadCompressed: (file) => {
    const s = story();
    return uploadFile(file, { compress: { orientation: s ? s.orientation : 'landscape', quality: s ? s.imgQuality : 'standard' } });
  },
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
    else { b.subtitle = { on: subtitle.on !== false, pos: subtitle.pos || 'bottom', size: subtitle.size || 'md' }; }
    persist(); renderBlocks(); return true;
  },
  setBlockSfxById: (blockId, url) => {
    const b = findBlock(blockId);
    if (!b) return false;
    if (!url) { b.sfxList = []; }
    else {
      b.sfxList = [{ id: 'sfx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url, type: 'audio', offsetMs: 0, loop: false, volume: 0.8 }];
    }
    persist(); renderBlocks(); return true;
  },
  removeBlockSfxById: (blockId) => {
    const b = findBlock(blockId);
    if (!b || !b.sfxList || !b.sfxList.length) return false;
    b.sfxList = []; persist(); renderBlocks(); return true;
  },
  setBlockSfxListById: (blockId, list) => {
    const b = findBlock(blockId);
    if (!b) return false;
    b.sfxList = normalizeStories([{ chapters: [{ blocks: [{ sfxList: list }] }] }])[0].chapters[0].blocks[0].sfxList;
    persist(); renderBlocks(); return true;
  },
  addBlockSfxById: (blockId, entry) => {
    const b = findBlock(blockId);
    if (!b || !entry || !entry.url) return false;
    if (!Array.isArray(b.sfxList)) b.sfxList = [];
    b.sfxList.push({ id: 'sfx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url: entry.url, type: 'audio', offsetMs: entry.offsetMs || 0, loop: !!entry.loop, volume: entry.volume != null ? entry.volume : 0.8 });
    persist(); renderBlocks(); return true;
  },
  setCastEntry: (speaker, entry) => {
    const s = story();
    if (!s || !speaker) return false;
    if (!s.cast || typeof s.cast !== 'object') s.cast = {};
    s.cast[speaker] = entry;
    persist(); clearTtsCache(); renderBlocks(); return true;
  },
  removeCastEntry,
  setStoryOrientationById: (id, orientation) => {
    if (orientation !== 'landscape' && orientation !== 'portrait') return false;
    const s = stories.find(x => x.id === id);
    if (!s) return false;
    s.orientation = orientation; persist(); renderEditor(); renderLibrary();
    return true;
  },
  setStoryImgQualityById: (id, quality) => {
    if (quality !== 'standard' && quality !== 'hd') return false;
    const s = stories.find(x => x.id === id);
    if (!s) return false;
    s.imgQuality = quality; persist(); renderEditor(); renderLibrary();
    return true;
  },
  setBlockBgmOverrideById: (blockId, override) => {
    const b = findBlock(blockId);
    if (!b) return false;
    if (!override) { delete b.bgmOverride; }
    else { b.bgmOverride = { url: override.url, type: 'audio', volume: override.volume != null ? override.volume : 0.6 }; }
    persist(); renderBlocks(); return true;
  },
  removeBlockBgmOverrideById: (blockId) => {
    const b = findBlock(blockId);
    if (!b || !b.bgmOverride) return false;
    delete b.bgmOverride; persist(); renderBlocks(); return true;
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
    orientation: (story() || {}).orientation || 'landscape',
    imgQuality: (story() || {}).imgQuality || 'standard',
    current: playFlat[playIdx] ? {
      type: playFlat[playIdx].type, speaker: playFlat[playIdx].speaker || '', content: playFlat[playIdx].content,
      media: playFlat[playIdx].media || null, audio: playFlat[playIdx].audio || null,
      sfxList: (playFlat[playIdx].sfxList || []).map(x => ({ ...x })),
      bgmOverride: playFlat[playIdx].bgmOverride || null,
      voice: voicePlanOf(playFlat[playIdx]),
      subtitle: playFlat[playIdx].subtitle || null, chapterId: playFlat[playIdx].chapterId || null, bgm: playFlat[playIdx].bgm || null,
    } : null,
  }),
  playNext,
  playPrev,
  openCastEditor,
  openBlockBgmEditor,
  openTimelineEditor,
  normalizeStories,
  localStorage: () => { try { return localStorage.getItem(SAVE_KEY); } catch (e) { return null; } },
};

init();


