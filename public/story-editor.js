// story-editor.js — 作品编辑器（文字剧情积木 · 云端同步）
// 数据已上云：作品保存到 D1 stories 表（PUT /api/stories/:id），跨设备同步；
// localStorage 仅作为离线缓存与旧数据迁移来源（登录后自动把本地旧作品上传合并）。
// 数据结构：作品{id,title,chapters} → 章节{id,title,blocks} → 积木{id,type,content[,speaker][,media][,audio]}
// 类型：scene=场景 / dialogue=对白（额外字段 speaker）
// media（可选）：{url, type} —— url 为 /api/upload 上传后的 /img/xxx 引用（二进制存服务端）
//   type: 'image'（图片/GIF/WebP）| 'video'（MP4）—— 本幕全屏背景
// figure / figures（可选）：立绘叠加层。`figures` 最多 3 个；旧字段 `figure` 读取时迁入 figures[0]
//   单项 {url, type:'image', x?, y?, scale?} —— x/y 画幅百分比，锚点底中
// transition（可选）：进入本幕转场 'fade' | 'fadeblack' | 'none'（默认 fade）
// audio（可选）：{url, type:'audio'} —— 配音（MP3/WAV/M4A/OGG），同一套 /api/upload 上传与引用
// sfxList（可选）：[{id, url, offsetMs, loop, volume, label}] —— 音效轨（可多条叠加；offsetMs=进入本幕多少毫秒后触发，loop=true 持续到切幕）
//   旧字段 sfx（单对象 {url}）读取时自动迁移为 sfxList 单条
// bgmOverride（可选，积木）：{url, type:'audio', volume} —— 幕级 BGM（有则本幕替换章节 BGM；离开本幕后无覆盖的幕自动恢复章节曲）
// cast（可选，作品级）：{角色名: {kind:'tts'|'audio'|'none', voice?, url?, volume}} —— 角色声音表（AI 音色或手动音频）
// subtitle（可选，对白/场景）：{on, color?:hex, x?, y?} —— 文字显示设置
//   对白：播放时固定显示底部「聊天框」（全宽贴底、半透明深色底，角色名 + 对白内容自动加引号），无位置选项
//   场景：播放时显示「场景文字」（纯文字无框，文字来自 b.content），位置可自由拖拽（x/y 为画幅中心点百分比）；内容留空则不显示
//   字号：**全局统一**（默认 27px，可调 25~30px）——弹窗滑条修改即更新全局默认字号并立即生效，所有文字统一；对白框角色名联动 1.3x；不再逐块存储 subtitle.size（旧 size 字段忽略）
//   颜色：subtitle.color 自定义文字颜色（对白框角色名与内容同色；场景文字直接着色），选默认色即不存字段
//   对白积木「💬 对白框」弹窗承担角色编辑（角色名 + 对白内容）；场景积木「📝 场景文字」弹窗编辑场景文字
// 章节 bgm（可选）：{url, type:'audio', volume(0~1)} —— BGM（进入章节自动循环播放，同章节切幕不重启）
import { $, toast } from '/workspace/js/ui.js';
import {
  ROGUE_KIND, emptyRogue, normalizeRogue, buildRogueDemoData,
  startRogueRun, stopRogueRun,
  openCardStudio, applyStarterPack, cardGuideText,
} from '/story-rogue.js';
import { EDITOR_SAMPLES, buildSampleWork } from '/story-samples.js';
import { listAssets, addAsset, removeAsset, harvestFromStory } from '/story-assets.js';

const SAVE_KEY = 'hyool_stories_v1'; // 本地缓存键（旧数据迁移源）
const PLAY_SAVE_KEY = 'hyool_play_saves_v1'; // 播放中途存档（本机 3 槽）
const PLAY_SAVE_SLOTS = 3;
const TOKEN_KEY = 'hyool_token';
const DEFAULT_SPEAKER = '角色名';
const MAX_MEDIA_SIZE = 5 * 1024 * 1024; // 与后端 /api/upload 一致
// 全局统一字号（localStorage，默认 27px，范围 25~30px）：所有对白/场景文字统一字号，修改即全局生效
const SUB_SIZE_DEFAULT = 27;
const SUB_SIZE_MIN = 25;
const SUB_SIZE_MAX = 30;
const SUB_SIZE_KEY = 'hyool_story_subtitle_size_v1';
function getGlobalSubSize() {
  const n = Number(localStorage.getItem(SUB_SIZE_KEY));
  if (!Number.isFinite(n)) return SUB_SIZE_DEFAULT;
  return Math.min(SUB_SIZE_MAX, Math.max(SUB_SIZE_MIN, Math.round(n)));
}
function setGlobalSubSize(px) {
  localStorage.setItem(SUB_SIZE_KEY, String(Math.min(SUB_SIZE_MAX, Math.max(SUB_SIZE_MIN, Math.round(px)))));
}
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

// ---------- 作品类型（kind）：互动小说（story）默认；卡牌RPG（card_rpg）在共享编辑器中分支 ----------
const KIND_LABEL = { story: '互动小说', card_rpg: '卡牌RPG（旧）', gacha_rogue: '卡牌游戏' };
// 卡牌RPG 自动战斗：卡牌=角色，进入战斗自动互殴。以下是兜底属性（作品没配也能试玩/播放）
const DEFAULT_HERO_STATS = { name: '勇者', maxHp: 30, attack: 8 }; // 英雄缺省
const DEFAULT_CARD_STATS = { hp: 20, attack: 5 };                  // 旧「技能卡」迁移成角色卡时的兜底
const BATTLE_ROUND_MS = 850; // 自动战斗每回合间隔（点「⏩ 跳过」后 0ms 连跑）
const rpgUid = () => 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let stories = normalizeStories(loadStories());
let currentId = null;   // 当前打开的作品 id
let selectedBlockId = null; // 本幕舞台选中的积木 id
let selectedFigureIdx = 0;  // 舞台当前操作的立绘下标（缩放/清除）
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
let createKind = 'story';            // 新建：story / card_rpg / gacha_rogue
let battle = null;                   // 播放中卡牌战斗状态（battle 幕专用；null = 非战斗幕）
let battleTimer = null;              // 自动战斗回合调度（setTimeout 句柄，停止/重试时清理）

// ---------- 本地缓存（离线兜底 + 旧数据迁移源） ----------
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
    // 作品类型：默认互动小说；存量作品没有 kind 字段自动归为 story（不破坏旧数据）
    if (s.kind !== 'card_rpg' && s.kind !== 'gacha_rogue') s.kind = 'story';
    if (s.kind === 'gacha_rogue') s.rogue = normalizeRogue(s.rogue);
    if (s.miniGame) delete s.miniGame;
    // 卡牌RPG 专用结构（rpg.hero / rpg.cards / rpg.enemies）：结构兜底 + 字段清洗
    if (s.kind === 'card_rpg') {
      if (!s.rpg || typeof s.rpg !== 'object' || Array.isArray(s.rpg)) s.rpg = {};
      const rpg = s.rpg;
      if (!rpg.hero || typeof rpg.hero !== 'object') rpg.hero = {};
      rpg.hero = {
        name: String(rpg.hero.name || '勇者').slice(0, 20) || '勇者',
        maxHp: Math.max(1, Math.min(999, Number(rpg.hero.maxHp) || 30)),
        attack: Math.max(1, Math.min(99, Number(rpg.hero.attack) || 8)),
      };
      if (!Array.isArray(rpg.cards)) rpg.cards = [];
      // 卡牌=角色：{name,hp,attack,copies,desc}。旧「技能卡」（cost/type/value）自动迁移成角色卡：攻击取旧攻击型数值或兜底 5，生命兜底 20
      rpg.cards = rpg.cards.filter(c => c && c.name).map(c => {
        const oldAtk = c.type === 'attack' ? (Number(c.value) || 0) : 0;
        return {
          id: c.id || rpgUid(),
          name: String(c.name).trim().slice(0, 20) || '未名角色',
          hp: Math.max(1, Math.min(999, Number(c.hp) || 20)),
          attack: Math.max(1, Math.min(99, Number(c.attack) || (oldAtk > 0 ? oldAtk : 5))),
          copies: Math.max(1, Math.min(9, Number(c.copies) || 1)),
          desc: String(c.desc || '').trim().slice(0, 60),
        };
      });
      if (!Array.isArray(rpg.enemies)) rpg.enemies = [];
      rpg.enemies = rpg.enemies.filter(e => e && e.name).map(e => ({
        id: e.id || rpgUid(),
        name: String(e.name).trim().slice(0, 20) || '未名敌人',
        hp: Math.max(1, Math.min(999, Number(e.hp) || 10)),
        damage: Math.max(0, Math.min(999, Number(e.damage) || 3)),
      }));
    }
    if (s.orientation !== 'landscape' && s.orientation !== 'portrait') s.orientation = 'landscape'; // 旧作品默认 16:9 横屏
    if (s.imgQuality !== 'hd') s.imgQuality = 'standard'; // 默认标准画质（1280 档）
    if (!s.cast || typeof s.cast !== 'object') s.cast = {};
    s.logic = normalizeLogic(s.logic);
    if (!Array.isArray(s.chapters)) s.chapters = []; // 兜底：坏数据/旧数据不崩溃
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
        // 战斗积木（卡牌RPG）：字段兜底，缺失不崩溃
        if (b.type === 'battle') {
          if (!Array.isArray(b.enemies)) b.enemies = [];
          if (!Array.isArray(b.party)) b.party = [];
          if (typeof b.content !== 'string') b.content = '';
          if (typeof b.winContent !== 'string') b.winContent = '';
          if (typeof b.loseContent !== 'string') b.loseContent = '';
        }
        if (b.type === 'rogue') {
          if (typeof b.content !== 'string') b.content = '';
          if (typeof b.winContent !== 'string') b.winContent = '';
          if (typeof b.loseContent !== 'string') b.loseContent = '';
        }
        // 选项积木（互动小说分支）：提示 + 若干跳转选项（含 require/effect）
        if (b.type === 'choice') normalizeChoiceBlock(b);
        // 表现积木：预设台词 + 条件跳过 + 可选临场一句（不改剧情）
        if (b.type === 'perf') normalizePerfBlock(b);
        // 立绘层（舞台可视化）：figures[]；兼容旧 figure
        normalizeBlockFigures(b);
        b.transition = normalizeTransition(b.transition);
      });
    });
  });
  return arr;
}

/** 剧情变量：logic.state 为初始值表；播放时拷贝到 playState，由选项 effect 落账 */
function normalizeLogic(logic) {
  const src = logic && typeof logic === 'object' && !Array.isArray(logic) ? logic : {};
  const stateIn = src.state && typeof src.state === 'object' && !Array.isArray(src.state) ? src.state : {};
  const state = {};
  Object.keys(stateIn).forEach((k) => {
    const key = normalizeVarName(k);
    if (!key) return;
    const n = Number(stateIn[k]);
    state[key] = Number.isFinite(n) ? Math.max(-9999, Math.min(9999, Math.round(n))) : 0;
  });
  return { state, rules: src.rules && typeof src.rules === 'object' ? src.rules : {} };
}

function normalizeVarName(name) {
  const s = String(name || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,23}$/.test(s)) return '';
  return s;
}

const REQUIRE_OPS = ['>=', '<=', '==', '>', '<', '!='];
const EFFECT_OPS = ['+', '-', '='];

function normalizeCondList(list, ops) {
  if (!Array.isArray(list)) return [];
  return list.map((x) => {
    if (!x || typeof x !== 'object') return null;
    const v = normalizeVarName(x.var);
    const op = ops.includes(x.op) ? x.op : '';
    const val = Number(x.val);
    if (!v || !op || !Number.isFinite(val)) return null;
    return { var: v, op, val: Math.max(-9999, Math.min(9999, Math.round(val))) };
  }).filter(Boolean).slice(0, 3);
}

function normalizeChoiceBlock(b) {
  if (typeof b.content !== 'string') b.content = '';
  // 兼容中枢 Blueprint 旧字段 options → choices
  if ((!Array.isArray(b.choices) || !b.choices.length) && Array.isArray(b.options)) {
    b.choices = b.options.map((o, i) => ({
      id: o.id || uid(),
      label: o.label,
      jump: o.target || o.jump || 'next',
      require: o.require,
      effect: o.effect,
    }));
  }
  if (!Array.isArray(b.choices)) b.choices = [];
  b.choices = b.choices.filter(c => c && (c.label != null || c.jump != null)).map(c => ({
    id: c.id || uid(),
    label: String(c.label == null ? '' : c.label).trim().slice(0, 40) || '选项',
    jump: String(c.jump || 'next').slice(0, 96),
    require: normalizeCondList(c.require, REQUIRE_OPS),
    effect: normalizeCondList(c.effect, EFFECT_OPS),
  }));
  if (!b.choices.length) {
    b.choices = [
      { id: uid(), label: '继续', jump: 'next', require: [], effect: [] },
      { id: uid(), label: '结束', jump: 'end', require: [], effect: [] },
    ];
  }
}

function normalizePerfBlock(b) {
  if (typeof b.content !== 'string') b.content = '';
  if (typeof b.speaker !== 'string' || !b.speaker.trim()) b.speaker = DEFAULT_SPEAKER;
  b.live = !!b.live;
  b.hint = String(b.hint || '').trim().slice(0, 200);
  b.require = normalizeCondList(b.require, REQUIRE_OPS);
}

/** 立绘层：叠加在背景之上；x/y 为画幅百分比（锚点底中），scale 相对缩放 */
function normalizeFigure(fig) {
  if (!fig || typeof fig !== 'object' || !fig.url) return null;
  const x = Number(fig.x);
  const y = Number(fig.y);
  const scale = Number(fig.scale);
  return {
    url: String(fig.url),
    type: 'image',
    x: Number.isFinite(x) ? Math.max(0, Math.min(100, Math.round(x))) : 50,
    y: Number.isFinite(y) ? Math.max(0, Math.min(100, Math.round(y))) : 92,
    scale: Number.isFinite(scale) ? Math.max(0.35, Math.min(2.5, Math.round(scale * 100) / 100)) : 1,
  };
}

const MAX_FIGURES = 3;
const FIG_SLOT_X = [28, 50, 72]; // 左 / 中 / 右 默认站位

function normalizeBlockFigures(b) {
  if (!b || typeof b !== 'object') return [];
  let list = [];
  if (Array.isArray(b.figures)) {
    list = b.figures.map(normalizeFigure).filter(Boolean);
  }
  if (!list.length && b.figure) {
    const one = normalizeFigure(b.figure);
    if (one) list = [one];
  }
  list = list.slice(0, MAX_FIGURES);
  if (list.length) {
    b.figures = list;
    b.figure = list[0]; // 兼容旧读取
  } else {
    delete b.figures;
    delete b.figure;
  }
  return list;
}

function setBlockFigures(b, list) {
  const next = (list || []).map(normalizeFigure).filter(Boolean).slice(0, MAX_FIGURES);
  if (next.length) {
    b.figures = next;
    b.figure = next[0];
  } else {
    delete b.figures;
    delete b.figure;
  }
  return next;
}

const TRANSITIONS = ['fade', 'fadeblack', 'none'];
const TRANSITION_LABEL = { fade: '淡入', fadeblack: '黑场', none: '无' };

function normalizeTransition(t) {
  const s = String(t || 'fade');
  return TRANSITIONS.includes(s) ? s : 'fade';
}

/** 播放时剧情变量（开局从 logic.state 拷贝） */
let playState = {};

function resetPlayState() {
  const s = story();
  const base = (s && s.logic && s.logic.state) ? s.logic.state : {};
  playState = {};
  Object.keys(base).forEach((k) => { playState[k] = Number(base[k]) || 0; });
}

function readVar(name) {
  const k = normalizeVarName(name);
  if (!k) return 0;
  const n = Number(playState[k]);
  return Number.isFinite(n) ? n : 0;
}

function evalRequire(list) {
  const reqs = normalizeCondList(list, REQUIRE_OPS);
  if (!reqs.length) return true;
  return reqs.every((r) => {
    const cur = readVar(r.var);
    if (r.op === '>=') return cur >= r.val;
    if (r.op === '<=') return cur <= r.val;
    if (r.op === '==') return cur === r.val;
    if (r.op === '>') return cur > r.val;
    if (r.op === '<') return cur < r.val;
    if (r.op === '!=') return cur !== r.val;
    return true;
  });
}

function applyEffects(list) {
  const effects = normalizeCondList(list, EFFECT_OPS);
  effects.forEach((e) => {
    const cur = readVar(e.var);
    let next = cur;
    if (e.op === '+') next = cur + e.val;
    else if (e.op === '-') next = cur - e.val;
    else if (e.op === '=') next = e.val;
    playState[e.var] = Math.max(-9999, Math.min(9999, Math.round(next)));
  });
  updatePlayStateHud();
}

function formatPlayStateHud() {
  const keys = Object.keys(playState).filter((k) => !k.startsWith('v_'));
  if (!keys.length) return '';
  return keys.map((k) => k + ':' + playState[k]).join(' · ');
}

function updatePlayStateHud() {
  const el = $('#playVars');
  if (!el) return;
  const text = formatPlayStateHud();
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

/** 访问标记：进入积木 → playState.v_<id>=1（不写回作品；可供 require） */
function visitVarOf(blockId) {
  const raw = String(blockId || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!raw) return '';
  return normalizeVarName(('v_' + raw).slice(0, 24));
}

function markVisited(block) {
  if (!block || !block.id) return;
  const key = visitVarOf(block.id);
  if (!key) return;
  playState[key] = 1;
}

function visibleChoices(block) {
  normalizeChoiceBlock(block);
  return (block.choices || []).filter((c) => evalRequire(c.require));
}

/** 跳过条件不满足的表现积木（不改状态，只前进） */
function skipUnmetPerfBlocks() {
  let guard = 0;
  while (guard++ < 64 && playIdx < playFlat.length) {
    const cur = playFlat[playIdx];
    if (cur && cur.type === 'perf') {
      normalizePerfBlock(cur);
      if (!evalRequire(cur.require)) {
        playIdx++;
        continue;
      }
    }
    break;
  }
}

// ---------- 播放存档（本机 3 槽，对标 WebGAL/Kinexus） ----------
function readAllPlaySaves() {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAY_SAVE_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch (e) { return {}; }
}

function listPlaySlots(storyId) {
  const sid = String(storyId || '');
  const bag = (readAllPlaySaves()[sid] || []);
  const list = Array.isArray(bag) ? bag : [];
  return Array.from({ length: PLAY_SAVE_SLOTS }, (_, i) => {
    const hit = list.find((x) => x && x.slot === i);
    return hit || null;
  });
}

function writePlaySlot(storyId, slot, payload) {
  const sid = String(storyId || '');
  if (!sid || slot < 0 || slot >= PLAY_SAVE_SLOTS) return false;
  const all = readAllPlaySaves();
  const next = listPlaySlots(sid).map((x, i) => (i === slot ? payload : x)).filter(Boolean);
  all[sid] = next;
  try {
    localStorage.setItem(PLAY_SAVE_KEY, JSON.stringify(all));
    return true;
  } catch (e) {
    toast('存档失败（本机存储已满？）', true);
    return false;
  }
}

function clearPlaySlot(storyId, slot) {
  const sid = String(storyId || '');
  const all = readAllPlaySaves();
  all[sid] = listPlaySlots(sid).map((x, i) => (i === slot ? null : x)).filter(Boolean);
  try { localStorage.setItem(PLAY_SAVE_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
}

function playSaveLabel() {
  const b = playFlat[playIdx];
  if (!b) return '空';
  const t = (b.type === 'choice' ? '选项' : b.type === 'dialogue' ? '对白' : b.type === 'perf' ? '演出' : b.type === 'scene' ? '场景' : b.type);
  const bit = String(b.content || b.speaker || '').replace(/\s+/g, ' ').trim().slice(0, 28);
  return t + (bit ? ' · ' + bit : '');
}

function openPlaySaveModal(mode) {
  const s = story();
  if (!s) return;
  if (battle) { toast('战斗中请先结算再存读档', true); return; }
  const isSave = mode === 'save';
  openModal(isSave ? '存档（本机）' : '读档（本机）', (body) => {
    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:10px';
    tip.textContent = isSave
      ? '保存当前进度与变量到本机（不含云同步）。共 3 槽。'
      : '读取后覆盖当前播放进度。战斗/卡牌关进行中不可用。';
    body.appendChild(tip);
    const slots = listPlaySlots(s.id);
    slots.forEach((slot, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'btn wide';
      row.style.cssText = 'display:block;text-align:left;margin-bottom:8px';
      if (slot) {
        const when = new Date(slot.at || 0).toLocaleString();
        row.textContent = `槽 ${i + 1} · ${slot.label || '存档'} · ${when}`;
      } else {
        row.textContent = `槽 ${i + 1} · 空`;
        if (!isSave) row.disabled = true;
      }
      row.addEventListener('click', () => {
        if (isSave) {
          const ok = writePlaySlot(s.id, i, {
            slot: i,
            at: Date.now(),
            idx: playIdx,
            state: { ...playState },
            label: playSaveLabel(),
          });
          closeModal();
          if (ok) toast('已存到槽 ' + (i + 1));
        } else if (slot) {
          closeModal();
          applyPlaySave(slot);
        }
      });
      body.appendChild(row);
    });
  }, null);
}

function applyPlaySave(slot) {
  if (!slot || typeof slot !== 'object') return false;
  playFlat = buildPlayFlat();
  if (!playFlat.length) { toast('作品没有积木', true); return false; }
  const idx = Math.max(0, Math.min(playFlat.length - 1, Number(slot.idx) || 0));
  playIdx = idx;
  playState = {};
  const st = slot.state && typeof slot.state === 'object' ? slot.state : {};
  Object.keys(st).forEach((k) => {
    const key = normalizeVarName(k);
    if (!key) return;
    const n = Number(st[k]);
    playState[key] = Number.isFinite(n) ? Math.max(-9999, Math.min(9999, Math.round(n))) : 0;
  });
  $('#playBody').innerHTML = '';
  $('#playOverlay').classList.remove('hidden');
  updatePlayStateHud();
  renderPlay();
  toast('已读档');
  return true;
}

// ---------- 分支图（列表视图，对标 Tuesday/Kinexus） ----------
function analyzeStoryGraph(s) {
  const storyObj = s || story();
  if (!storyObj) return { start: null, nodes: [], dead: 0, orphan: 0, choice: 0 };
  const flat = [];
  storyObj.chapters.forEach((ch) => {
    (ch.blocks || []).forEach((b, i) => {
      flat.push({
        b,
        ch,
        nextId: (ch.blocks[i + 1] && ch.blocks[i + 1].id) || null,
      });
    });
  });
  const byId = new Map(flat.map((x) => [x.b.id, x]));
  const outs = new Map();
  flat.forEach(({ b, nextId, ch }) => {
    const edges = [];
    if (b.type === 'choice') {
      normalizeChoiceBlock(b);
      (b.choices || []).forEach((c) => {
        const j = String(c.jump || 'next');
        let to = null;
        let end = false;
        if (j === 'end') end = true;
        else if (j === 'next') to = nextId;
        else if (j.startsWith('ch:')) {
          const cid = j.slice(3);
          const tch = storyObj.chapters.find((x) => x.id === cid);
          to = tch && tch.blocks && tch.blocks[0] ? tch.blocks[0].id : null;
        } else to = j;
        edges.push({ to, end, label: (c.label || '选项').slice(0, 24), broken: !!(to && !byId.has(to)) });
      });
    } else if (!b.terminal && nextId) {
      edges.push({ to: nextId, end: false, label: '↓', broken: false });
    } else if (b.terminal) {
      edges.push({ to: null, end: true, label: '终', broken: false });
    }
    outs.set(b.id, edges);
  });
  const start = flat[0] ? flat[0].b.id : null;
  const reach = new Set();
  if (start) {
    const q = [start];
    reach.add(start);
    while (q.length) {
      const id = q.shift();
      (outs.get(id) || []).forEach((e) => {
        if (e.to && byId.has(e.to) && !reach.has(e.to)) {
          reach.add(e.to);
          q.push(e.to);
        }
      });
    }
  }
  let dead = 0, orphan = 0, choice = 0;
  const nodes = flat.map(({ b, ch }) => {
    const edges = outs.get(b.id) || [];
    const hasContinue = edges.some((e) => e.to && byId.has(e.to));
    const isDead = !hasContinue;
    const isOrphan = !!(start && b.id !== start && !reach.has(b.id));
    if (isDead) dead++;
    if (isOrphan) orphan++;
    if (b.type === 'choice') choice++;
    const preview = String(b.content || b.speaker || '').replace(/\s+/g, ' ').trim().slice(0, 48);
    return {
      id: b.id,
      type: b.type,
      chapterId: ch.id,
      chapterTitle: ch.title,
      preview,
      visit: visitVarOf(b.id),
      terminal: !!b.terminal,
      dead: isDead,
      orphan: isOrphan,
      start: b.id === start,
      edges,
    };
  });
  return { start, nodes, dead, orphan, choice };
}

function openStoryMap() {
  const s = story();
  if (!s) return;
  const g = analyzeStoryGraph(s);
  const overlay = $('#mapOverlay');
  const body = $('#mapBody');
  const stats = $('#mapStats');
  if (!overlay || !body) return;
  stats.textContent = `${g.nodes.length} 积木 · ${g.choice} 选项 · ${g.dead} 死端 · ${g.orphan} 孤儿`;
  body.innerHTML = '';
  if (!g.nodes.length) {
    body.textContent = '还没有积木。';
    overlay.classList.remove('hidden');
    return;
  }
  let lastCh = null;
  g.nodes.forEach((n) => {
    if (n.chapterTitle !== lastCh) {
      lastCh = n.chapterTitle;
      const h = document.createElement('div');
      h.className = 'map-ch';
      h.textContent = n.chapterTitle || '章节';
      body.appendChild(h);
    }
    const row = document.createElement('div');
    row.className = 'map-node' + (n.orphan ? ' orphan' : '') + (n.dead ? ' dead' : '');
    const badges = document.createElement('div');
    badges.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    const typeLab = { scene: '场景', dialogue: '对白', choice: '选项', perf: '演出', battle: '战斗', rogue: '卡牌' };
    const mkBadge = (text, cls) => {
      const sp = document.createElement('span');
      sp.className = 'mn-badge' + (cls ? ' ' + cls : '');
      sp.textContent = text;
      return sp;
    };
    badges.appendChild(mkBadge(typeLab[n.type] || n.type, n.type === 'choice' ? 'choice' : ''));
    if (n.start) badges.appendChild(mkBadge('起点', 'start'));
    if (n.dead) badges.appendChild(mkBadge(n.terminal ? '结局' : '死端', 'dead'));
    if (n.orphan) badges.appendChild(mkBadge('孤儿', 'orphan'));
    const mid = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'mn-title';
    title.textContent = n.preview || ('（空）' + n.id);
    const sub = document.createElement('div');
    sub.className = 'mn-sub';
    sub.textContent = n.id;
    mid.append(title, sub);
    if (n.edges.length) {
      const ed = document.createElement('div');
      ed.className = 'mn-edges';
      ed.textContent = n.edges.map((e) => {
        if (e.end) return '「' + e.label + '」→ 结束';
        if (e.broken) return '「' + e.label + '」→ ⚠丢失';
        if (e.to) return '「' + e.label + '」→ ' + e.to;
        return '「' + e.label + '」';
      }).join(' · ');
      mid.appendChild(ed);
    }
    const right = document.createElement('div');
    right.className = 'mn-visit';
    right.textContent = n.visit || '';
    right.title = '播放进入后可用作 require：' + (n.visit || '') + ' >= 1';
    row.append(badges, mid, right);
    row.addEventListener('click', () => {
      chapterId = n.chapterId;
      overlay.classList.add('hidden');
      renderEditor();
      const el = document.querySelector('[data-block-id="' + n.id + '"]');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1200);
      }
      toast('已定位到积木');
    });
    body.appendChild(row);
  });
  overlay.classList.remove('hidden');
}
// 保存：写本地缓存（离线兜底）+ 防抖上传云端（跨设备同步）
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(stories)); }
  catch (e) { /* 缓存失败不阻塞（云端照常保存） */ }
  scheduleUpload();
}

// ---------- 云端同步（D1 stories 表） ----------
let loggedIn = false;
let uploadTimer = null;
let saveErrorShownAt = 0;

function setLoginHint(show) {
  const el = $('#loginHint');
  if (el) el.style.display = show ? '' : 'none';
}

function showSaveError(msg) {
  const now = Date.now();
  if (now - saveErrorShownAt < 4000) return; // 4 秒内不重复弹，避免连点刷屏
  saveErrorShownAt = now;
  toast(msg, true);
}

// persist 后的防抖上传：把当前编辑中的整部作品 PUT 到云端
function scheduleUpload() {
  const s = story();
  if (!s || !loggedIn) return;
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = setTimeout(() => uploadStory(s), 800);
}
async function uploadStory(s) {
  if (!s || !loggedIn) return;
  const storyId = s.id;
  try {
    const res = await fetch('/api/stories/' + encodeURIComponent(storyId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ data: s })
    });
    const d = await res.json();
    if (!d.success) {
      if (res.status === 401) { loggedIn = false; setLoginHint(true); toast('登录已失效，请重新登录后继续保存', true); }
      else showSaveError(d.error || '云端保存失败');
      return;
    }
    if (d.story) {
      const cur = stories.find(x => x.id === storyId);
      if (cur) {
        if (d.story.status !== undefined) cur.status = d.story.status;
        if (d.story.share_id !== undefined) cur.share_id = d.story.share_id;
        cur.cover_image = d.story.cover_image || cur.cover_image;
      }
    }
  } catch (e) {
    showSaveError('云端保存失败（网络异常），内容已保留在本地');
  }
}

// 登录后与云端合并：服务端作品为准，本地未上传旧作品自动迁移上传
async function syncWithServer() {
  try {
    const res = await fetch('/api/stories', { credentials: 'include', headers: authHeaders() });
    if (res.status === 401) {
      loggedIn = false;
      setLoginHint(true);
      renderLibrary();
      handleUrlDeepLink();
      return;
    }
    const d = await res.json();
    if (!d.success) throw new Error(d.error || '加载失败');
    loggedIn = true;
    setLoginHint(false);

    const server = (d.stories || []).map(x => normalizeStories([x])[0]);
    const serverIds = new Set(server.map(x => x.id));
    // 本地缓存有而云端没有的旧作品 → 自动上传迁移（先建条目再补存完整内容）
    const localOnly = stories.filter(x => !serverIds.has(x.id));
    const migrated = [];
    for (const local of localOnly) {
      try {
        const r = await fetch('/api/stories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ title: local.title || '未名作品', orientation: local.orientation, imgQuality: local.imgQuality })
        });
        const c = await r.json();
        if (!c.success || !c.story) throw new Error(c.error || '迁移失败');
        local.id = c.story.id;
        await fetch('/api/stories/' + encodeURIComponent(local.id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ data: local })
        });
        migrated.push({ ...local, id: local.id, status: 'draft' });
      } catch (e) { /* 单条迁移失败保留本地，不阻塞整体 */ }
    }
    stories = [...server, ...migrated];
    persist();
    renderLibrary();
    handleUrlDeepLink();
  } catch (e) {
    // 网络异常：本地缓存继续可用，静默等待下次打开
    renderLibrary();
    handleUrlDeepLink();
  }
}

// URL 直达：?story=<id>[&play=1]（个人主页 / 幻灵世界广场点击进入播放）
function handleUrlDeepLink() {
  const q = new URLSearchParams(location.search);
  const targetId = q.get('story');
  if (!targetId) return;
  const local = stories.find(x => x.id === targetId);
  if (local) {
    openStory(targetId);
    if (q.get('play') === '1') startPlay();
    return;
  }
  // 列表中没有（游客浏览已发布作品）→ 走公开读取接口
  fetch('/api/stories/' + encodeURIComponent(targetId), { credentials: 'include' })
    .then(res => res.json())
    .then(d => {
      if (!d.success || !d.story) return;
      const s = normalizeStories([d.story])[0];
      s._readonly = true;
      stories.unshift(s);
      renderLibrary();
      openStory(s.id);
      if (q.get('play') === '1') startPlay();
    })
    .catch(() => { /* 静默 */ });
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
    d.textContent = loggedIn
      ? '还没有作品。\n输入名称，点击「＋ 创建作品」，开始你的第一个故事。'
      : '登录后即可在云端创作与保存作品，手机端也能同步继续。';
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
    const badge = document.createElement('span');
    badge.className = 'story-badge' + (s.status === 'published' ? ' pub' : '');
    badge.textContent = s.status === 'published' ? '已发布' : '未发布';
    badge.title = s.status === 'published' ? '已出现在幻灵世界广场' : '尚未发布，仅自己可见';
    m.prepend(badge);
    // 作品类型徽章（卡牌RPG 分支）
    const kindBadge = document.createElement('span');
    kindBadge.className = 'story-badge kind' + (s.kind === 'card_rpg' ? ' rpg' : (s.kind === 'gacha_rogue' ? ' rogue' : ''));
    kindBadge.textContent = KIND_LABEL[s.kind] || '互动小说';
    m.appendChild(kindBadge);
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
    const pubBtn = document.createElement('button');
    pubBtn.className = 'btn small' + (s.status === 'published' ? ' pub' : '');
    pubBtn.textContent = s.status === 'published' ? '下架' : '发布';
    pubBtn.addEventListener('click', async () => {
      if (!loggedIn) { toast('请先登录', true); setLoginHint(true); return; }
      const target = s.status !== 'published';
      if (target && !confirm(`发布《${s.title}》？发布后所有人都能在「幻灵世界」广场看到并播放。`)) return;
      try {
        const res = await fetch('/api/stories/' + encodeURIComponent(s.id) + '/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ published: target })
        });
        const d = await res.json();
        if (!d.success) {
          if (res.status === 401) { loggedIn = false; setLoginHint(true); }
          toast(d.error || '操作失败', true);
          return;
        }
        s.status = d.story.status;
        if (d.story.share_id !== undefined) s.share_id = d.story.share_id;
        renderLibrary();
        toast(target ? '已发布：进入幻灵世界广场。' : '已下架：从幻灵世界广场移除。');
      } catch (e) {
        toast('操作失败（网络异常）', true);
      }
    });
    const delBtn = document.createElement('button');
    delBtn.className = 'btn small danger';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`确定删除作品「${s.title}」？所有章节和积木都会被删除。`)) return;
      try {
        const res = await fetch('/api/stories/' + encodeURIComponent(s.id) + '/delete', {
          method: 'POST',
          headers: authHeaders()
        });
        const d = await res.json();
        if (!d.success) {
          if (res.status === 401) { loggedIn = false; setLoginHint(true); }
          toast(d.error || '删除失败', true);
          return;
        }
      } catch (e) {
        toast('删除失败（网络异常）', true);
        return;
      }
      stories = stories.filter(x => x.id !== s.id);
      persist();
      renderLibrary();
      toast('已删除作品');
    });
    ops.append(openBtn, playBtn, pubBtn, delBtn);
    card.append(t, m, ops);
    host.appendChild(card);
  });
}

async function createStory() {
  const input = $('#newTitle');
  const title = input.value.trim();
  if (!title) { toast('请先输入作品名称', true); input.focus(); return; }
  if (!loggedIn) { toast('请先登录后再创建作品', true); setLoginHint(true); return; }
  try {
    const res = await fetch('/api/stories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ title, orientation: createOrientation, imgQuality: 'standard', kind: createKind })
    });
    const d = await res.json();
    if (!d.success) {
      if (res.status === 401) { loggedIn = false; setLoginHint(true); }
      toast(d.error || '创建失败', true);
      return;
    }
    const s = normalizeStories([d.story])[0];
    stories.unshift(s);
    persist();
    input.value = '';
    openStory(s.id);
    toast(`已创建《${title}》`);
  } catch (e) {
    toast('创建失败（网络异常）', true);
  }
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
  selectedBlockId = null;
  const s = story();
  chapterId = (s.chapters[0] && s.chapters[0].id) || null;
  try { if (s) harvestFromStory(s); } catch (e) { /* ignore */ }
  renderEditor();
  showEditor();
}
function backToLibrary() {
  currentId = null;
  chapterId = null;
  selectedBlockId = null;
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
  // 卡牌RPG 分支：只有卡牌RPG 作品显示「卡牌库/英雄/敌人」配置区
  const rpgCfg = $('#rpgConfig');
  if (rpgCfg) rpgCfg.style.display = s.kind === 'card_rpg' ? '' : 'none';
  const rogueCfg = $('#rogueConfig');
  if (rogueCfg) rogueCfg.style.display = s.kind === 'gacha_rogue' ? '' : 'none';
  const g = $('#cardGuide');
  if (g && s.kind === 'gacha_rogue') {
    const t = cardGuideText(s);
    g.innerHTML = `<b>${t.title}</b> ${t.hint}<br>${t.counts}<br>${t.line}`;
  }
  // 方向 / 画质切换按钮高亮
  document.querySelectorAll('#storyOrient .orient-btn').forEach(b => b.classList.toggle('active', b.dataset.orient === s.orientation));
  document.querySelectorAll('#storyQual .qual-btn').forEach(b => b.classList.toggle('active', b.dataset.qual === s.imgQuality));
  const chipBattle = $('#chipBattle');
  const chipRogue = $('#chipRogue');
  if (chipBattle) chipBattle.classList.toggle('hidden', s.kind !== 'card_rpg');
  if (chipRogue) chipRogue.classList.toggle('hidden', s.kind !== 'gacha_rogue');
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

// ---------- 积木（时间线：拖排序 / 行内改字 / 拖文件挂素材） ----------
let dragBlockId = null;
let inlineEditId = null;

function reorderBlocks(fromId, toId) {
  const ch = chapter();
  if (!ch || fromId === toId) return;
  const from = ch.blocks.findIndex(b => b.id === fromId);
  const to = ch.blocks.findIndex(b => b.id === toId);
  if (from < 0 || to < 0) return;
  const [item] = ch.blocks.splice(from, 1);
  ch.blocks.splice(to, 0, item);
  persist();
  renderBlocks();
}

async function attachDroppedFile(block, file) {
  if (!file) return;
  if (ALLOWED_MEDIA[file.type]) {
    const s = story();
    const result = await uploadFile(file, { compress: { orientation: s ? s.orientation : 'landscape', quality: s ? s.imgQuality : 'standard' } });
    if (!result) return;
    block.media = result;
    persist();
    renderBlocks();
    toast('画面已挂上');
    return;
  }
  if (ALLOWED_AUDIO[file.type]) {
    const result = await uploadFile(file);
    if (!result) return;
    block.audio = { url: result.url, type: 'audio' };
    persist();
    renderBlocks();
    toast('配音已挂上');
    return;
  }
  toast('仅支持图片/视频或音频文件', true);
}

function beginInlineEdit(b, mainEl) {
  if (b.type !== 'dialogue' && b.type !== 'scene') return;
  inlineEditId = b.id;
  mainEl.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'block-inline';
  let speakerInput = null;
  if (b.type === 'dialogue') {
    speakerInput = document.createElement('input');
    speakerInput.type = 'text';
    speakerInput.className = 'txt';
    speakerInput.maxLength = 20;
    speakerInput.placeholder = '角色名';
    speakerInput.value = b.speaker || DEFAULT_SPEAKER;
    box.appendChild(speakerInput);
  }
  const ta = document.createElement('textarea');
  ta.className = 'txt';
  ta.rows = 3;
  ta.placeholder = b.type === 'scene' ? '场景文字（可留空）' : '对白内容';
  ta.value = b.content || '';
  box.appendChild(ta);
  const actions = document.createElement('div');
  actions.className = 'block-inline-actions';
  const save = document.createElement('button');
  save.className = 'btn tiny primary';
  save.textContent = '保存';
  const more = document.createElement('button');
  more.className = 'btn tiny';
  more.textContent = '字号/颜色…';
  const cancel = document.createElement('button');
  cancel.className = 'btn tiny ghost';
  cancel.textContent = '取消';
  const apply = () => {
    if (b.type === 'dialogue') b.speaker = (speakerInput.value.trim() || DEFAULT_SPEAKER);
    b.content = ta.value;
    if (!b.subtitle) b.subtitle = { on: true };
    inlineEditId = null;
    persist();
    renderBlocks();
  };
  save.addEventListener('click', apply);
  more.addEventListener('click', () => { apply(); openSubtitleEditor(b); });
  cancel.addEventListener('click', () => { inlineEditId = null; renderBlocks(); });
  actions.append(save, more, cancel);
  box.appendChild(actions);
  mainEl.appendChild(box);
  ta.focus();
}

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
  headCount.textContent = `${ch.blocks.length} 块 · 拖把手调序`;
  if (!ch.blocks.length) {
    const d = document.createElement('div');
    d.className = 'block-empty';
    d.textContent = '这一章还是空的。\n点下方「＋ 加对白 / 加场景 / 加选项 / 加演出」，或把图片拖进这里。';
    host.appendChild(d);
    return;
  }
  ch.blocks.forEach((b, i) => {
    const el = document.createElement('div');
    el.className = 'block ' + b.type;
    el.dataset.blockId = b.id;

    const handle = document.createElement('div');
    handle.className = 'block-handle';
    handle.title = '拖动调整顺序';
    handle.textContent = '⋮⋮';
    handle.draggable = true;
    handle.addEventListener('dragstart', (e) => {
      dragBlockId = b.id;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/block-id', b.id);
    });
    handle.addEventListener('dragend', () => {
      dragBlockId = null;
      el.classList.remove('dragging');
      host.querySelectorAll('.block.drag-over').forEach(n => n.classList.remove('drag-over'));
    });

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dragBlockId && dragBlockId !== b.id) el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) {
        attachDroppedFile(b, files[0]);
        return;
      }
      const fromId = (e.dataTransfer && e.dataTransfer.getData('text/block-id')) || dragBlockId;
      if (fromId) reorderBlocks(fromId, b.id);
    });

    const tag = document.createElement('div');
    tag.className = 'block-tag';
    const idx = document.createElement('div');
    idx.className = 'bt-idx';
    idx.textContent = String(i + 1);
    const tagLabel = document.createElement('div');
    tagLabel.className = 'bt-label';
    tagLabel.textContent = b.type === 'scene' ? '场景'
      : (b.type === 'choice' ? '选项'
        : (b.type === 'perf' ? '演出'
          : (b.type === 'battle' ? '战斗' : (b.type === 'rogue' ? '卡牌' : '对白'))));
    tag.append(idx, tagLabel);
    if (b.type === 'dialogue' || b.type === 'perf') {
      const sp = document.createElement('div');
      sp.className = 'bt-speaker';
      sp.textContent = b.speaker || DEFAULT_SPEAKER;
      tag.appendChild(sp);
    }

    const main = document.createElement('div');
    main.className = 'block-main';
    if (inlineEditId === b.id && (b.type === 'dialogue' || b.type === 'scene')) {
      beginInlineEdit(b, main);
    } else {
      const text = document.createElement('div');
      text.className = 'block-text';
      if (b.type === 'choice') {
        const prompt = (b.content || '').trim();
        const labels = (b.choices || []).map(c => c.label).filter(Boolean);
        const extra = (b.choices || []).some(c => (c.require && c.require.length) || (c.effect && c.effect.length));
        text.textContent = (prompt || '（点「编辑选项」写提示）') + (labels.length ? '\n→ ' + labels.join(' / ') : '') + (extra ? '\n⚙ 含条件/效果' : '');
      } else if (b.type === 'perf') {
        const displayText = formatDialogue(b);
        text.textContent = displayText.trim() ? displayText : '（点「编辑演出」写预设台词）';
        if (!displayText.trim()) text.classList.add('empty');
      } else {
        const displayText = formatDialogue(b);
        if (!displayText.trim()) {
          text.classList.add('empty');
          text.textContent = b.type === 'scene' ? '（点这里写场景文字）' : (b.type === 'battle' ? '（点「编辑战斗」设本场）' : (b.type === 'rogue' ? '（卡牌关：工作室配好后试玩）' : '（点这里写对白）'));
        } else {
          text.textContent = displayText;
        }
      }
      if (b.type === 'dialogue' || b.type === 'scene') {
        text.title = '点击直接改字';
        text.addEventListener('click', () => beginInlineEdit(b, main));
      }
      main.appendChild(text);
      if (b.type === 'battle') {
        const lib = ((story() || {}).rpg || {}).enemies || [];
        const names = (b.enemies || []).map(id => { const e = lib.find(x => x.id === id); return e ? e.name : '❓ 缺失'; });
        const sub = document.createElement('div');
        sub.className = 'block-sub';
        sub.textContent = '⚔️ 出战敌人：' + (names.length ? names.join('、') : '（未选，播放用默认史莱姆）');
        main.appendChild(sub);
      }
      if (b.type === 'rogue') {
        const sub = document.createElement('div');
        sub.className = 'block-sub';
        sub.textContent = cardGuideText(story() || {}).line;
        main.appendChild(sub);
      }
      if (b.type === 'choice') {
        const sub = document.createElement('div');
        sub.className = 'block-sub';
        const nReq = (b.choices || []).reduce((n, c) => n + ((c.require && c.require.length) || 0), 0);
        const nEff = (b.choices || []).reduce((n, c) => n + ((c.effect && c.effect.length) || 0), 0);
        sub.textContent = '🔀 ' + ((b.choices || []).length || 0) + ' 选项'
          + (nReq ? ' · ' + nReq + ' 条件' : '')
          + (nEff ? ' · ' + nEff + ' 效果' : '');
        main.appendChild(sub);
      }
      if (b.type === 'perf') {
        const sub = document.createElement('div');
        sub.className = 'block-sub';
        const bits = ['✨ 表现层'];
        if (b.require && b.require.length) bits.push(b.require.length + ' 条件跳过');
        if (b.live) bits.push('临场一句');
        sub.textContent = bits.join(' · ');
        main.appendChild(sub);
      }
    }

    const ops = document.createElement('div');
    ops.className = 'block-ops';
    const mkBtn = (label, title, onClick, disabled, cls) => {
      const btn = document.createElement('button');
      btn.className = 'btn tiny' + (cls ? ' ' + cls : '');
      btn.textContent = label;
      btn.title = title;
      btn.disabled = !!disabled;
      btn.addEventListener('click', onClick);
      ops.appendChild(btn);
    };
    mkBtn('↑', '上移', () => moveBlock(i, -1), i === 0, 'move-fallback');
    mkBtn('↓', '下移', () => moveBlock(i, 1), i === ch.blocks.length - 1, 'move-fallback');
    if (b.type === 'dialogue') {
      mkBtn('字号色', '字号/颜色等高级项', () => openSubtitleEditor(b));
    } else if (b.type === 'scene') {
      mkBtn('字号色', '字号/颜色等高级项', () => openSubtitleEditor(b));
    } else if (b.type === 'choice') {
      mkBtn('编辑选项', '编辑提示与跳转', () => openChoiceEditor(b));
    } else if (b.type === 'perf') {
      mkBtn('编辑演出', '预设台词 / 条件 / 临场', () => openPerfEditor(b));
    } else if (b.type === 'battle') {
      mkBtn('编辑', '编辑战斗', () => openBattleEditor(b));
      mkBtn('试玩', '试玩本场', () => previewBattle(b));
    } else if (b.type === 'rogue') {
      mkBtn('试玩', '试玩本关', () => previewBattle(b));
    }
    mkBtn('🎵', '本幕 BGM', () => openBlockBgmEditor(b));
    mkBtn('🎼', '声音时间轴', () => openTimelineEditor(b));
    mkBtn('删', '删除', () => deleteBlock(b.id));

    const mediaWrap = document.createElement('div');
    mediaWrap.className = 'block-media';
    if (b.media && b.media.url) {
      const prev = document.createElement('div');
      prev.className = 'bm-preview';
      if (b.media.type === 'video') {
        const v = document.createElement('video');
        v.src = b.media.url; v.controls = true; v.muted = true; v.playsInline = true; v.preload = 'metadata';
        prev.appendChild(v);
        const badge = document.createElement('span');
        badge.className = 'bm-type'; badge.textContent = 'MP4';
        prev.appendChild(badge);
      } else {
        const img = document.createElement('img');
        img.src = b.media.url; img.alt = '画面'; img.loading = 'lazy';
        prev.appendChild(img);
      }
      const opsRow = document.createElement('div');
      opsRow.className = 'bm-ops';
      const chg = document.createElement('button');
      chg.className = 'btn tiny'; chg.textContent = '换画面';
      chg.addEventListener('click', () => pickMedia(b, chg));
      const fromLib = document.createElement('button');
      fromLib.className = 'btn tiny'; fromLib.textContent = '素材库';
      fromLib.addEventListener('click', () => openAssetLibrary({
        type: 'image',
        onPick: (a) => {
          b.media = { url: a.url, type: a.type === 'video' ? 'video' : 'image' };
          persist();
          renderBlocks();
          toast('已从素材库挂上画面');
        },
      }));
      const rm = document.createElement('button');
      rm.className = 'btn tiny danger'; rm.textContent = '移除';
      rm.addEventListener('click', () => removeBlockMedia(b));
      opsRow.append(chg, fromLib, rm);
      mediaWrap.append(prev, opsRow);
    } else {
      const add = document.createElement('button');
      add.className = 'media-add';
      add.textContent = '🖼 添加画面（或拖文件到本块）';
      add.title = MEDIA_TYPES_LABEL;
      add.addEventListener('click', () => pickMedia(b, add));
      const fromLib = document.createElement('button');
      fromLib.className = 'media-add';
      fromLib.style.marginTop = '6px';
      fromLib.textContent = '📂 从素材库选用';
      fromLib.addEventListener('click', () => openAssetLibrary({
        type: 'image',
        onPick: (a) => {
          b.media = { url: a.url, type: a.type === 'video' ? 'video' : 'image' };
          persist();
          renderBlocks();
          toast('已从素材库挂上画面');
        },
      }));
      mediaWrap.append(add, fromLib);
    }

    const audioWrap = document.createElement('div');
    audioWrap.className = 'block-audio';
    if (b.audio && b.audio.url) {
      const prev = document.createElement('div');
      prev.className = 'ba-preview';
      const au = document.createElement('audio');
      au.src = b.audio.url; au.controls = true; au.preload = 'metadata';
      prev.appendChild(au);
      const opsRow = document.createElement('div');
      opsRow.className = 'bm-ops';
      const chg = document.createElement('button');
      chg.className = 'btn tiny'; chg.textContent = '换配音';
      chg.addEventListener('click', () => pickAudio(b, chg));
      const fromLib = document.createElement('button');
      fromLib.className = 'btn tiny'; fromLib.textContent = '素材库';
      fromLib.addEventListener('click', () => openAssetLibrary({
        type: 'audio',
        onPick: (a) => {
          b.audio = { url: a.url, type: 'audio' };
          persist();
          renderBlocks();
          toast('已从素材库挂上配音');
        },
      }));
      const rm = document.createElement('button');
      rm.className = 'btn tiny danger'; rm.textContent = '删除';
      rm.addEventListener('click', () => removeBlockAudio(b));
      opsRow.append(chg, fromLib, rm);
      audioWrap.append(prev, opsRow);
    } else {
      const add = document.createElement('button');
      add.className = 'media-add';
      add.textContent = '🎙 添加配音（音频也可拖入）';
      add.title = AUDIO_TYPES_LABEL;
      add.addEventListener('click', () => pickAudio(b, add));
      const fromLib = document.createElement('button');
      fromLib.className = 'media-add';
      fromLib.style.marginTop = '6px';
      fromLib.textContent = '📂 从素材库选用配音';
      fromLib.addEventListener('click', () => openAssetLibrary({
        type: 'audio',
        onPick: (a) => {
          b.audio = { url: a.url, type: 'audio' };
          persist();
          renderBlocks();
          toast('已从素材库挂上配音');
        },
      }));
      audioWrap.append(add, fromLib);
    }

    el.append(handle, tag, main, ops, mediaWrap, audioWrap);
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
      tl.className = 'btn tiny'; tl.textContent = '🎼 声音轨';
      tl.addEventListener('click', () => openTimelineEditor(b));
      const rm = document.createElement('button');
      rm.className = 'btn tiny danger'; rm.textContent = '清空';
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
    el.addEventListener('click', (e) => {
      if (e.target.closest('.block-ops, .block-media, .block-audio, .block-handle, .block-inline, button, input, textarea, select, a')) return;
      selectBlock(b.id);
    });
    if (b.id === selectedBlockId) el.classList.add('selected');
    host.appendChild(el);
  });
  // 若当前选中不在本章，自动选第一块
  if (ch.blocks.length) {
    if (!selectedBlockId || !ch.blocks.some((x) => x.id === selectedBlockId)) {
      selectedBlockId = ch.blocks[0].id;
      const first = host.querySelector('[data-block-id="' + selectedBlockId + '"]');
      if (first) first.classList.add('selected');
    }
  } else {
    selectedBlockId = null;
  }
  renderStagePreview();
}

function selectBlock(id) {
  selectedBlockId = id || null;
  document.querySelectorAll('#blockList .block.selected').forEach((n) => n.classList.remove('selected'));
  if (selectedBlockId) {
    const el = document.querySelector('#blockList [data-block-id="' + selectedBlockId + '"]');
    if (el) el.classList.add('selected');
  }
  renderStagePreview();
}

function selectedBlock() {
  return selectedBlockId ? findBlock(selectedBlockId) : null;
}

/** 舞台拖拽：写回 figure 或 subtitle 的 x/y（百分比；立绘锚点=指针位置=底中） */
function makeStageDraggable(el, frame, onCommit) {
  let moved = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    moved = false;
    el.classList.add('dragging');
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const r = frame.getBoundingClientRect();
      if (!r.width || !r.height) return;
      moved = true;
      const px = Math.round(Math.min(100, Math.max(0, (ev.clientX - r.left) / r.width * 100)));
      const py = Math.round(Math.min(100, Math.max(0, (ev.clientY - r.top) / r.height * 100)));
      el.style.left = px + '%';
      el.style.top = py + '%';
      if (el.classList.contains('sc-figure')) {
        el.style.transform = 'translate(-50%,-100%) scale(' + (el.dataset.scale || 1) + ')';
      } else {
        el.style.transform = 'translate(-50%,-50%)';
      }
      el._stagePx = px;
      el._stagePy = py;
    };
    const end = () => {
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      const px = el._stagePx;
      const py = el._stagePy;
      if (px == null || py == null) return;
      if (typeof onCommit === 'function') onCommit(px, py, moved);
    };
    move(e);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  });
}

/** 右侧本幕舞台：所见即所得预览（背景 / 多立绘 / 对白框 / 场景字 / 转场） */
function renderStagePreview() {
  const canvas = $('#stageCanvas');
  const hint = $('#stageHint');
  const transSel = $('#stageTransSel');
  if (!canvas) return;
  const s = story();
  const b = selectedBlock();
  canvas.innerHTML = '';
  canvas.classList.toggle('portrait', !!(s && s.orientation === 'portrait'));
  if (transSel) {
    if (b) {
      transSel.disabled = false;
      transSel.value = normalizeTransition(b.transition);
    } else {
      transSel.disabled = true;
      transSel.value = 'fade';
    }
  }
  if (!b) {
    if (hint) hint.textContent = '点左侧积木 · 拖立绘 · 双击改字';
    const empty = document.createElement('div');
    empty.className = 'sc-empty';
    empty.textContent = '还没有选中积木。\n点左侧时间线里的一块，这里会显示本幕画面。';
    canvas.appendChild(empty);
    return;
  }
  const figs = normalizeBlockFigures(b);
  if (selectedFigureIdx >= figs.length) selectedFigureIdx = Math.max(0, figs.length - 1);
  const typeLab = { scene: '场景', dialogue: '对白', choice: '选项', perf: '演出', battle: '战斗', rogue: '卡牌' };
  if (hint) {
    hint.textContent = (typeLab[b.type] || b.type)
      + (figs.length ? ' · 立绘' + figs.length : '')
      + ' · ' + TRANSITION_LABEL[normalizeTransition(b.transition)];
  }

  const bg = document.createElement('div');
  bg.className = 'sc-bg';
  if (b.media && b.media.url) {
    if (b.media.type === 'video') {
      const v = document.createElement('video');
      v.src = b.media.url;
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      v.loop = true;
      v.preload = 'metadata';
      bg.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = b.media.url;
      img.alt = '';
      bg.appendChild(img);
    }
  }
  canvas.appendChild(bg);

  figs.forEach((fig, fi) => {
    const wrap = document.createElement('div');
    wrap.className = 'sc-figure' + (fi === selectedFigureIdx ? ' sel' : '');
    wrap.style.left = fig.x + '%';
    wrap.style.top = fig.y + '%';
    wrap.dataset.scale = String(fig.scale);
    wrap.dataset.figIdx = String(fi);
    wrap.style.transform = 'translate(-50%,-100%) scale(' + fig.scale + ')';
    wrap.title = '拖动定位 · 滚轮缩放 · 点选后可「缩放± / 清立绘」';
    const img = document.createElement('img');
    img.src = fig.url;
    img.alt = '立绘' + (fi + 1);
    wrap.appendChild(img);
    wrap.addEventListener('pointerdown', () => { selectedFigureIdx = fi; canvas.querySelectorAll('.sc-figure').forEach((n, i) => n.classList.toggle('sel', i === fi)); });
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      selectedFigureIdx = fi;
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      stageScaleFigure(delta);
    }, { passive: false });
    makeStageDraggable(wrap, canvas, (px, py) => {
      const real = findBlock(b.id);
      if (!real) return;
      const list = normalizeBlockFigures(real).slice();
      if (!list[fi]) return;
      list[fi] = normalizeFigure({ ...list[fi], x: px, y: py });
      setBlockFigures(real, list);
      persist();
    });
    canvas.appendChild(wrap);
  });

  if (b.type === 'choice') {
    normalizeChoiceBlock(b);
    const box = document.createElement('div');
    box.className = 'sc-choice';
    const prompt = document.createElement('div');
    prompt.className = 'pc-prompt';
    prompt.textContent = (b.content || '').trim() || '请选择：';
    prompt.title = '双击编辑选项提示';
    enableStageTextEdit(prompt, () => (findBlock(b.id) || {}).content || '', (v) => {
      const real = findBlock(b.id);
      if (!real) return;
      real.content = v.slice(0, 200);
      persist();
      renderBlocks();
    });
    box.appendChild(prompt);
    (b.choices || []).slice(0, 4).forEach((c, i) => {
      const opt = document.createElement('div');
      opt.className = 'pc-opt';
      opt.textContent = c.label || ('选项 ' + (i + 1));
      box.appendChild(opt);
    });
    canvas.appendChild(box);
  } else if (b.type === 'scene') {
    const sub = b.subtitle || {};
    const st = document.createElement('div');
    st.className = 'sc-scene-text' + (!(b.content || '').trim() ? ' placeholder' : '');
    st.textContent = (b.content || '').trim() || '双击写场景文字';
    st.style.left = (sub.x != null ? sub.x : 50) + '%';
    st.style.top = (sub.y != null ? sub.y : 82) + '%';
    st.style.transform = 'translate(-50%,-50%)';
    if (sub.color) st.style.color = sub.color;
    st.title = '拖动定位 · 双击编辑';
    makeStageDraggable(st, canvas, (px, py, moved) => {
      if (moved === false) return;
      const real = findBlock(b.id);
      if (!real) return;
      real.subtitle = real.subtitle || { on: true };
      real.subtitle.x = px;
      real.subtitle.y = py;
      persist();
    });
    enableStageTextEdit(st, () => (findBlock(b.id) || {}).content || '', (v) => {
      const real = findBlock(b.id);
      if (!real) return;
      real.content = v.slice(0, 500);
      persist();
      renderBlocks();
    });
    canvas.appendChild(st);
  } else if (b.type === 'dialogue' || b.type === 'perf') {
    const sub = b.subtitle || {};
    const d = document.createElement('div');
    d.className = 'sc-dlg';
    const sp = document.createElement('div');
    sp.className = 'pd-speaker';
    sp.textContent = b.speaker || DEFAULT_SPEAKER;
    sp.title = '双击改角色名';
    const ln = document.createElement('div');
    ln.className = 'pd-line';
    ln.textContent = formatDialogue(b);
    ln.title = '双击改台词';
    if (sub.color) { sp.style.color = sub.color; ln.style.color = sub.color; }
    enableStageTextEdit(sp, () => (findBlock(b.id) || {}).speaker || DEFAULT_SPEAKER, (v) => {
      const real = findBlock(b.id);
      if (!real) return;
      real.speaker = (v.trim() || DEFAULT_SPEAKER).slice(0, 20);
      persist();
      renderBlocks();
    }, { plain: true });
    enableStageTextEdit(ln, () => (findBlock(b.id) || {}).content || '', (v) => {
      const real = findBlock(b.id);
      if (!real) return;
      real.content = v.slice(0, 500);
      persist();
      renderBlocks();
    });
    d.append(sp, ln);
    canvas.appendChild(d);
  } else if (!b.media && !figs.length) {
    const empty = document.createElement('div');
    empty.className = 'sc-empty';
    empty.textContent = '本幕还没有画面。\n点上方「背景」或「立绘」从素材库选用。';
    canvas.appendChild(empty);
  }
}

/** 双击舞台文字进入编辑；拖拽后不触发 */
function enableStageTextEdit(el, getValue, onSave, opts) {
  el.style.pointerEvents = 'auto';
  el.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (el.isContentEditable) return;
    const prev = getValue();
    el.contentEditable = 'true';
    el.classList.add('editing');
    // 编辑时显示裸文本（去掉引号外壳）
    el.textContent = prev;
    el.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (err) { /* ignore */ }
    const finish = () => {
      if (!el.isContentEditable) return;
      el.contentEditable = 'false';
      el.classList.remove('editing');
      el.removeEventListener('blur', finish);
      el.removeEventListener('keydown', onKey);
      const next = (el.textContent || '').trim();
      onSave(opts && opts.plain ? next : next);
    };
    const onKey = (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); el.blur(); }
      if (ev.key === 'Escape') { el.textContent = prev; el.blur(); }
    };
    el.addEventListener('blur', finish);
    el.addEventListener('keydown', onKey);
  });
}

function stagePickBackground() {
  const b = selectedBlock();
  if (!b) { toast('先点左侧选一块积木', true); return; }
  openAssetLibrary({
    onPick: (a) => {
      if (a.type === 'audio') { toast('背景请选图片或视频', true); return; }
      b.media = { url: a.url, type: a.type === 'video' ? 'video' : 'image' };
      persist();
      renderBlocks();
      toast('已设置本幕背景');
    },
  });
}

function stagePickFigure() {
  const b = selectedBlock();
  if (!b) { toast('先点左侧选一块积木', true); return; }
  const cur = normalizeBlockFigures(b);
  if (cur.length >= MAX_FIGURES) { toast('每幕最多 ' + MAX_FIGURES + ' 个立绘', true); return; }
  openAssetLibrary({
    type: 'image',
    onPick: (a) => {
      const list = normalizeBlockFigures(b).slice();
      const slot = list.length;
      list.push(normalizeFigure({
        url: a.url,
        x: FIG_SLOT_X[slot] != null ? FIG_SLOT_X[slot] : 50,
        y: 92,
        scale: 1,
      }));
      setBlockFigures(b, list);
      selectedFigureIdx = list.length - 1;
      persist();
      renderBlocks();
      toast('已加立绘（可拖 / 滚轮缩放），最多 ' + MAX_FIGURES + ' 个');
    },
  });
}

function stageClearFigure() {
  const b = selectedBlock();
  if (!b) { toast('先点左侧选一块积木', true); return; }
  const list = normalizeBlockFigures(b);
  if (!list.length) { toast('本幕没有立绘'); return; }
  if (list.length === 1) {
    setBlockFigures(b, []);
    selectedFigureIdx = 0;
  } else {
    const idx = Math.min(selectedFigureIdx, list.length - 1);
    list.splice(idx, 1);
    setBlockFigures(b, list);
    selectedFigureIdx = Math.max(0, idx - 1);
  }
  persist();
  renderBlocks();
  toast('已移除立绘');
}

function stageScaleFigure(delta) {
  const b = selectedBlock();
  if (!b) return;
  const list = normalizeBlockFigures(b);
  if (!list.length) { toast('先加立绘', true); return; }
  const idx = Math.min(selectedFigureIdx, list.length - 1);
  const cur = list[idx].scale || 1;
  const next = Math.max(0.35, Math.min(2.5, Math.round((cur + delta) * 100) / 100));
  list[idx] = normalizeFigure({ ...list[idx], scale: next });
  setBlockFigures(b, list);
  persist();
  renderStagePreview();
}

function stageSetTransition(val) {
  const b = selectedBlock();
  if (!b) return;
  b.transition = normalizeTransition(val);
  persist();
  renderStagePreview();
  toast('转场：' + TRANSITION_LABEL[b.transition]);
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
  if (type === 'choice') {
    block.content = '你要怎么做？';
    block.choices = [
      { id: uid(), label: '继续往前', jump: 'next' },
      { id: uid(), label: '到此结束', jump: 'end' },
    ];
  }
  if (type === 'perf') {
    block.speaker = DEFAULT_SPEAKER;
    block.content = '……刚才，谢谢你。';
    block.require = [];
    block.live = false;
    block.hint = '';
  }
  if (type === 'battle') {
    block.content = '';
    block.party = [];
    block.enemies = [];
    block.winContent = '';
    block.loseContent = '';
  }
  if (type === 'rogue') {
    block.content = '编组出发。对局内只有速度条，没有手牌。';
    block.winContent = '';
    block.loseContent = '';
  }
  ch.blocks.push(block);
  persist();
  selectedBlockId = block.id;
  renderBlocks();
  if (type === 'battle') openBattleEditor(block);
  else if (type === 'choice') openChoiceEditor(block);
  else if (type === 'perf') openPerfEditor(block);
  // dialogue / scene：右侧舞台所见即所得，不再自动弹字号窗
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
    mk('choice', '🔀', '选项', '播放时让读者点选，跳到指定积木或章节');
    mk('perf', '✨', '演出', '表现层预设台词；条件不满足则跳过；可选临场一句');
    if (story() && story().kind === 'card_rpg') {
      mk('battle', '⚔️', '卡牌战斗', '插一场自动角色战斗（角色卡进入战斗自动攻击敌人）');
    }
    if (story() && story().kind === 'gacha_rogue') {
      mk('rogue', '🂠', '卡牌关卡', '播放到这里就进入卡牌：挂机 / 排队技能 / 每局不同');
    }
    body.appendChild(row);
  }, null);
}

/** 选项积木编辑：提示 + 跳转 + 条件(require) + 效果(effect) */
function openChoiceEditor(b) {
  normalizeChoiceBlock(b);
  const s = story();
  if (s) s.logic = normalizeLogic(s.logic);
  const varNames = Object.keys((s && s.logic && s.logic.state) || {});
  openModal('编辑选项', (body) => {
    const card = $('#modal') && $('#modal').querySelector('.modal-card');
    if (card) card.classList.add('modal-wide');

    const promptLab = document.createElement('label');
    promptLab.textContent = '提示（显示在选项上方）';
    const prompt = document.createElement('textarea');
    prompt.className = 'txt';
    prompt.rows = 2;
    prompt.value = b.content || '';
    prompt.placeholder = '例如：夜晚，废弃车站。你要？';
    body.append(promptLab, prompt);

    const listLab = document.createElement('label');
    listLab.textContent = '选项（最多 6 个）· 条件不满足则隐藏 · 点选后先落账再跳转 · 可用 v_<积木id>≥1 表示「去过」';
    body.appendChild(listLab);
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:12px';
    body.appendChild(list);

    const draft = (b.choices || []).map(c => ({
      id: c.id || uid(),
      label: c.label,
      jump: c.jump || 'next',
      require: (c.require || []).map(x => ({ ...x })),
      effect: (c.effect || []).map(x => ({ ...x })),
    }));
    if (!draft.length) draft.push({ id: uid(), label: '继续', jump: 'next', require: [], effect: [] });

    const jumpOptions = buildChoiceJumpOptions(b.id);

    const mkOpSelect = (ops, value, onChange) => {
      const sel = document.createElement('select');
      sel.className = 'txt';
      ops.forEach((op) => {
        const o = document.createElement('option');
        o.value = op;
        o.textContent = op;
        sel.appendChild(o);
      });
      sel.value = ops.includes(value) ? value : ops[0];
      sel.addEventListener('change', () => onChange(sel.value));
      return sel;
    };

    const mkVarInput = (value, onChange) => {
      const inp = document.createElement('input');
      inp.className = 'txt';
      inp.placeholder = varNames[0] || 'trust';
      inp.value = value || '';
      inp.maxLength = 24;
      if (varNames.length) {
        inp.setAttribute('list', 'logicVarList');
      }
      inp.addEventListener('input', () => onChange(inp.value));
      return inp;
    };

    const mkCondRow = (arr, ops, i, render) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr auto 72px auto;gap:6px;align-items:center';
      const item = arr[i] || { var: '', op: ops[0], val: 0 };
      const vIn = mkVarInput(item.var, (v) => { item.var = v; arr[i] = item; });
      const opSel = mkOpSelect(ops, item.op, (op) => { item.op = op; arr[i] = item; });
      const valIn = document.createElement('input');
      valIn.className = 'txt';
      valIn.type = 'number';
      valIn.value = item.val != null ? item.val : 0;
      valIn.addEventListener('input', () => { item.val = Number(valIn.value) || 0; arr[i] = item; });
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'btn tiny danger';
      rm.textContent = '×';
      rm.addEventListener('click', () => { arr.splice(i, 1); render(); });
      arr[i] = item;
      row.append(vIn, opSel, valIn, rm);
      return row;
    };

    const renderRows = () => {
      list.innerHTML = '';
      if (varNames.length && !document.getElementById('logicVarList')) {
        const dl = document.createElement('datalist');
        dl.id = 'logicVarList';
        varNames.forEach((n) => {
          const o = document.createElement('option');
          o.value = n;
          dl.appendChild(o);
        });
        body.appendChild(dl);
      }
      draft.forEach((c, i) => {
        const cardEl = document.createElement('div');
        cardEl.style.cssText = 'border:1px solid var(--line);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px';
        const top = document.createElement('div');
        top.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:center';
        const lab = document.createElement('input');
        lab.className = 'txt';
        lab.placeholder = '选项文案';
        lab.value = c.label || '';
        lab.maxLength = 40;
        lab.addEventListener('input', () => { c.label = lab.value; });
        const sel = document.createElement('select');
        sel.className = 'txt';
        jumpOptions.forEach(o => {
          const opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = o.label;
          sel.appendChild(opt);
        });
        if (c.jump && ![...sel.options].some(o => o.value === c.jump)) {
          const opt = document.createElement('option');
          opt.value = c.jump;
          opt.textContent = '（已失效）' + c.jump;
          sel.appendChild(opt);
        }
        sel.value = c.jump || 'next';
        sel.addEventListener('change', () => { c.jump = sel.value; });
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn tiny danger';
        rm.textContent = '删';
        rm.disabled = draft.length <= 1;
        rm.addEventListener('click', () => {
          if (draft.length <= 1) return;
          draft.splice(i, 1);
          renderRows();
        });
        top.append(lab, sel, rm);
        cardEl.appendChild(top);

        const reqWrap = document.createElement('div');
        const reqLab = document.createElement('div');
        reqLab.style.cssText = 'font-size:11px;color:var(--muted)';
        reqLab.textContent = '出现条件 require（全满足才显示；可空）';
        reqWrap.appendChild(reqLab);
        if (!Array.isArray(c.require)) c.require = [];
        c.require.forEach((_, ri) => reqWrap.appendChild(mkCondRow(c.require, REQUIRE_OPS, ri, renderRows)));
        const addReq = document.createElement('button');
        addReq.type = 'button';
        addReq.className = 'btn tiny';
        addReq.textContent = '＋条件';
        addReq.addEventListener('click', () => {
          if (c.require.length >= 3) { toast('每选项最多 3 条条件', true); return; }
          c.require.push({ var: varNames[0] || 'trust', op: '>=', val: 1 });
          renderRows();
        });
        reqWrap.appendChild(addReq);
        cardEl.appendChild(reqWrap);

        const effWrap = document.createElement('div');
        const effLab = document.createElement('div');
        effLab.style.cssText = 'font-size:11px;color:var(--muted)';
        effLab.textContent = '选择效果 effect（点选后改变量；可空）';
        effWrap.appendChild(effLab);
        if (!Array.isArray(c.effect)) c.effect = [];
        c.effect.forEach((_, ei) => effWrap.appendChild(mkCondRow(c.effect, EFFECT_OPS, ei, renderRows)));
        const addEff = document.createElement('button');
        addEff.type = 'button';
        addEff.className = 'btn tiny';
        addEff.textContent = '＋效果';
        addEff.addEventListener('click', () => {
          if (c.effect.length >= 3) { toast('每选项最多 3 条效果', true); return; }
          c.effect.push({ var: varNames[0] || 'trust', op: '+', val: 1 });
          renderRows();
        });
        effWrap.appendChild(addEff);
        cardEl.appendChild(effWrap);

        list.appendChild(cardEl);
      });
    };
    renderRows();

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn small';
    addBtn.textContent = '＋ 加一个选项';
    addBtn.addEventListener('click', () => {
      if (draft.length >= 6) { toast('最多 6 个选项', true); return; }
      draft.push({ id: uid(), label: '新选项', jump: 'next', require: [], effect: [] });
      renderRows();
    });
    body.appendChild(addBtn);

    const tip = document.createElement('div');
    tip.className = 'hint';
    tip.style.cssText = 'font-size:12px;color:var(--muted);line-height:1.6';
    tip.innerHTML = '先在侧栏「剧情变量」声明变量（如 trust）。条件/效果用小写英文名。<br>程序落账，AI 不参与选分支。';
    body.appendChild(tip);

    body._choiceSave = () => {
      b.content = prompt.value.trim().slice(0, 200);
      b.choices = draft.map(c => ({
        id: c.id || uid(),
        label: String(c.label || '').trim().slice(0, 40) || '选项',
        jump: String(c.jump || 'next').slice(0, 96),
        require: normalizeCondList(c.require, REQUIRE_OPS),
        effect: normalizeCondList(c.effect, EFFECT_OPS),
      }));
      normalizeChoiceBlock(b);
      persist();
      renderBlocks();
      const card2 = $('#modal') && $('#modal').querySelector('.modal-card');
      if (card2) card2.classList.remove('modal-wide');
    };
  }, () => {
    const body = $('#modalBody');
    if (body && typeof body._choiceSave === 'function') body._choiceSave();
  });
}

/** 剧情变量初始值表（logic.state） */
function openLogicEditor() {
  const s = story();
  if (!s) return;
  s.logic = normalizeLogic(s.logic);
  openModal('剧情变量', (body) => {
    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:12px;color:var(--muted);line-height:1.6';
    tip.textContent = '声明作品变量与初始值。播放开始时拷贝；选项的条件/效果改的是播放中的副本，不写回作品。纯程序，无 AI。进入过的积木会自动有 v_<积木id>=1（不必在此声明）。';
    body.appendChild(tip);
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:12px';
    body.appendChild(list);
    const draft = Object.keys(s.logic.state).map((k) => ({ name: k, val: s.logic.state[k] }));
    const render = () => {
      list.innerHTML = '';
      if (!draft.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:13px;color:var(--muted)';
        empty.textContent = '还没有变量。例如 trust / fear / bond。';
        list.appendChild(empty);
      }
      draft.forEach((row, i) => {
        const el = document.createElement('div');
        el.style.cssText = 'display:grid;grid-template-columns:1fr 88px auto;gap:8px';
        const nIn = document.createElement('input');
        nIn.className = 'txt';
        nIn.placeholder = 'trust';
        nIn.value = row.name;
        nIn.maxLength = 24;
        nIn.addEventListener('input', () => { row.name = nIn.value; });
        const vIn = document.createElement('input');
        vIn.className = 'txt';
        vIn.type = 'number';
        vIn.value = row.val;
        vIn.addEventListener('input', () => { row.val = Number(vIn.value) || 0; });
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn tiny danger';
        rm.textContent = '删';
        rm.addEventListener('click', () => { draft.splice(i, 1); render(); });
        el.append(nIn, vIn, rm);
        list.appendChild(el);
      });
    };
    render();
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn small';
    add.style.marginTop = '10px';
    add.textContent = '＋ 加变量';
    add.addEventListener('click', () => {
      if (draft.length >= 24) { toast('最多 24 个变量', true); return; }
      draft.push({ name: 'var' + (draft.length + 1), val: 0 });
      render();
    });
    body.appendChild(add);
    body._logicSave = () => {
      const state = {};
      draft.forEach((row) => {
        const key = normalizeVarName(row.name);
        if (!key) return;
        const n = Number(row.val);
        state[key] = Number.isFinite(n) ? Math.max(-9999, Math.min(9999, Math.round(n))) : 0;
      });
      s.logic = { state, rules: s.logic.rules || {} };
      persist();
      toast('变量已保存 · ' + Object.keys(state).length + ' 个');
    };
  }, () => {
    const body = $('#modalBody');
    if (body && typeof body._logicSave === 'function') body._logicSave();
  });
}

/** 表现积木：预设台词 + require 跳过 + 可选临场一句（不改状态/跳转） */
function openPerfEditor(b) {
  normalizePerfBlock(b);
  const s = story();
  if (s) s.logic = normalizeLogic(s.logic);
  const varNames = Object.keys((s && s.logic && s.logic.state) || {});
  openModal('编辑演出', (body) => {
    const spLab = document.createElement('label');
    spLab.textContent = '角色';
    const sp = document.createElement('input');
    sp.className = 'txt';
    sp.value = b.speaker || DEFAULT_SPEAKER;
    sp.maxLength = 20;
    const lineLab = document.createElement('label');
    lineLab.textContent = '预设台词（必填；AI 失败时用这句）';
    const line = document.createElement('textarea');
    line.className = 'txt';
    line.rows = 3;
    line.value = b.content || '';
    line.placeholder = '例如：……刚才，谢谢你。';
    const hintLab = document.createElement('label');
    hintLab.textContent = '情境提示（给临场一句，可选）';
    const hint = document.createElement('input');
    hint.className = 'txt';
    hint.value = b.hint || '';
    hint.placeholder = 'B 刚被 A 救下，场景危险';
    hint.maxLength = 200;
    const liveRow = document.createElement('label');
    liveRow.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;margin-top:4px';
    const live = document.createElement('input');
    live.type = 'checkbox';
    live.checked = !!b.live;
    liveRow.append(live, document.createTextNode('尝试临场一句（仅改台词；失败则用预设）'));
    body.append(spLab, sp, lineLab, line, hintLab, hint, liveRow);

    const reqLab = document.createElement('div');
    reqLab.style.cssText = 'font-size:12px;color:var(--muted);margin-top:12px';
    reqLab.textContent = '出现条件（不满足则整块跳过，不播）';
    body.appendChild(reqLab);
    const reqList = document.createElement('div');
    reqList.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:6px';
    body.appendChild(reqList);
    const draftReq = (b.require || []).map((x) => ({ ...x }));
    const renderReq = () => {
      reqList.innerHTML = '';
      draftReq.forEach((item, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:grid;grid-template-columns:1fr auto 72px auto;gap:6px';
        const vIn = document.createElement('input');
        vIn.className = 'txt';
        vIn.value = item.var || '';
        vIn.placeholder = varNames[0] || 'bond';
        vIn.addEventListener('input', () => { item.var = vIn.value; });
        const opSel = document.createElement('select');
        opSel.className = 'txt';
        REQUIRE_OPS.forEach((op) => {
          const o = document.createElement('option');
          o.value = op;
          o.textContent = op;
          opSel.appendChild(o);
        });
        opSel.value = REQUIRE_OPS.includes(item.op) ? item.op : '>=';
        opSel.addEventListener('change', () => { item.op = opSel.value; });
        const valIn = document.createElement('input');
        valIn.className = 'txt';
        valIn.type = 'number';
        valIn.value = item.val != null ? item.val : 0;
        valIn.addEventListener('input', () => { item.val = Number(valIn.value) || 0; });
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn tiny danger';
        rm.textContent = '×';
        rm.addEventListener('click', () => { draftReq.splice(i, 1); renderReq(); });
        row.append(vIn, opSel, valIn, rm);
        reqList.appendChild(row);
      });
    };
    renderReq();
    const addReq = document.createElement('button');
    addReq.type = 'button';
    addReq.className = 'btn tiny';
    addReq.textContent = '＋条件';
    addReq.addEventListener('click', () => {
      if (draftReq.length >= 3) { toast('最多 3 条', true); return; }
      draftReq.push({ var: varNames[0] || 'bond', op: '>=', val: 1 });
      renderReq();
    });
    body.appendChild(addReq);

    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:12px;color:var(--muted);margin-top:12px;line-height:1.6';
    tip.textContent = '演出不改变剧情变量，也不跳转。适合吐槽、谢一句、战斗后口令。';
    body.appendChild(tip);

    body._perfSave = () => {
      b.speaker = (sp.value || '').trim().slice(0, 20) || DEFAULT_SPEAKER;
      b.content = (line.value || '').trim().slice(0, 200) || '……';
      b.hint = (hint.value || '').trim().slice(0, 200);
      b.live = !!live.checked;
      b.require = normalizeCondList(draftReq, REQUIRE_OPS);
      normalizePerfBlock(b);
      persist();
      renderBlocks();
    };
  }, () => {
    const body = $('#modalBody');
    if (body && typeof body._perfSave === 'function') body._perfSave();
  });
}

/** 选项跳转目标列表：下一块 / 结束 / 各积木 / 各章节开头 */
function buildChoiceJumpOptions(selfBlockId) {
  const opts = [
    { value: 'next', label: '下一块（时间线继续）' },
    { value: 'end', label: '结束试玩' },
  ];
  const s = story();
  if (!s) return opts;
  (s.chapters || []).forEach((ch, ci) => {
    opts.push({ value: 'ch:' + ch.id, label: `章节开头 · ${ch.title || ('第' + (ci + 1) + '章')}` });
    (ch.blocks || []).forEach((bl, bi) => {
      if (bl.id === selfBlockId) return;
      const kind = bl.type === 'scene' ? '场景' : (bl.type === 'choice' ? '选项' : (bl.type === 'perf' ? '演出' : (bl.type === 'battle' ? '战斗' : (bl.type === 'rogue' ? '卡牌' : '对白'))));
      const snippet = String(bl.type === 'dialogue' ? ((bl.speaker || '') + ' ' + (bl.content || '')) : (bl.content || '')).replace(/\s+/g, ' ').trim().slice(0, 18);
      opts.push({
        value: bl.id,
        label: `积木 · ${ch.title || ''} #${bi + 1} ${kind}${snippet ? ' · ' + snippet : ''}`,
      });
    });
  });
  return opts;
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
  if (selectedBlockId === id) selectedBlockId = null;
  persist();
  renderBlocks();
  toast('已删除该积木');
}

// ---------- 卡牌RPG 配置（分支：作品类型 = 卡牌RPG） ----------
// 战斗积木编辑：战斗前剧情 / 出战角色卡（多选）/ 出战敌人（多选）/ 胜利·战败剧情
function openBattleEditor(b) {
  const s = story();
  if (!s) return;
  openModal('⚔️ 编辑战斗', (body) => {
    const mkField = (label, tag, value, rows) => {
      const f = document.createElement('div');
      f.className = 'field rpg-field';
      const l = document.createElement('label');
      l.textContent = label;
      const input = document.createElement(tag);
      input.className = 'txt';
      if (tag === 'textarea') { input.rows = rows || 3; input.maxLength = 500; }
      input.value = value || '';
      f.append(l, input);
      body.appendChild(f);
      return input;
    };
    mkField('战斗前剧情（可留空）', 'textarea', b.content);
    const pa = document.createElement('div');
    pa.className = 'field rpg-field';
    const paL = document.createElement('label');
    paL.textContent = '出战角色卡（可多选；不选 = 全部角色卡上阵）';
    pa.append(paL);
    const cardLib = (s.rpg && s.rpg.cards) || [];
    const chosenCards = b.party || [];
    if (!cardLib.length) {
      const tip = document.createElement('div');
      tip.className = 'rpg-tip';
      tip.textContent = '还没有角色卡。先到侧边栏「🃏 卡牌库」添加角色，再回来选择出战角色。';
      pa.appendChild(tip);
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'rpg-party-check';
      cardLib.forEach(c => {
        const item = document.createElement('div');
        item.className = 'rpg-check-item';
        const label = document.createElement('label');
        label.className = 'rpg-check';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = c.id;
        cb.checked = chosenCards.includes(c.id);
        const span = document.createElement('span');
        span.textContent = `${c.name}（生命 ${c.hp} · 攻击 ${c.attack} · ×${c.copies}）`;
        label.append(cb, span);
        const gear = document.createElement('button');
        gear.type = 'button';
        gear.className = 'btn tiny rpg-gear';
        gear.textContent = '⚙';
        gear.title = '快捷改数值：生命 / 攻击 / 张数';
        const edit = document.createElement('div');
        edit.className = 'rpg-inline-edit hidden';
        const mkNum = (lab, val, max) => {
          const row = document.createElement('div');
          row.className = 'row';
          const l = document.createElement('label');
          l.textContent = lab;
          const inp = document.createElement('input');
          inp.type = 'number';
          inp.className = 'txt';
          inp.min = 1; inp.max = max;
          inp.value = val;
          row.append(l, inp);
          edit.appendChild(row);
          return inp;
        };
        const iHp = mkNum('生命', c.hp, 999);
        const iAtk = mkNum('攻击', c.attack, 99);
        const iCop = mkNum('张数', c.copies, 9);
        const opsRow = document.createElement('div');
        opsRow.className = 'row';
        const save = document.createElement('button');
        save.className = 'btn tiny primary';
        save.textContent = '保存';
        save.addEventListener('click', () => {
          c.hp = Math.max(1, Math.min(999, Number(iHp.value) || 20));
          c.attack = Math.max(1, Math.min(99, Number(iAtk.value) || 5));
          c.copies = Math.max(1, Math.min(9, Number(iCop.value) || 1));
          persist();
          span.textContent = `${c.name}（生命 ${c.hp} · 攻击 ${c.attack} · ×${c.copies}）`;
          edit.classList.add('hidden');
          toast(`「${c.name}」数值已更新`);
        });
        const cancel = document.createElement('button');
        cancel.className = 'btn tiny ghost';
        cancel.textContent = '取消';
        cancel.addEventListener('click', () => edit.classList.add('hidden'));
        opsRow.append(save, cancel);
        edit.appendChild(opsRow);
        gear.addEventListener('click', () => {
          edit.classList.toggle('hidden');
          if (!edit.classList.contains('hidden')) { iHp.value = c.hp; iAtk.value = c.attack; iCop.value = c.copies; }
        });
        item.append(label, gear, edit);
        wrap.appendChild(item);
      });
      pa.appendChild(wrap);
    }
    body.appendChild(pa);
    const en = document.createElement('div');
    en.className = 'field rpg-field';
    const enL = document.createElement('label');
    enL.textContent = '出战敌人（可多选）';
    en.append(enL);
    const lib = (s.rpg && s.rpg.enemies) || [];
    const chosen = b.enemies || [];
    if (!lib.length) {
      const tip = document.createElement('div');
      tip.className = 'rpg-tip';
      tip.textContent = '还没有敌人。先到侧边栏「👹 敌人」添加，再回来选择出战敌人。';
      en.appendChild(tip);
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'rpg-enemy-check';
      lib.forEach(e => {
        const label = document.createElement('label');
        label.className = 'rpg-check';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = e.id;
        cb.checked = chosen.includes(e.id);
        const span = document.createElement('span');
        span.textContent = `${e.name}（生命 ${e.hp} · 攻击 ${e.damage}）`;
        label.append(cb, span);
        wrap.appendChild(label);
      });
      en.appendChild(wrap);
    }
    body.appendChild(en);
    mkField('胜利后剧情（可留空）', 'textarea', b.winContent);
    mkField('战败后剧情（可留空）', 'textarea', b.loseContent);
  }, () => {
    const s2 = story();
    if (!s2) return;
    const inputs = $('#modalBody').querySelectorAll('.field textarea');
    b.content = inputs[0].value.trim();
    b.winContent = inputs[1].value.trim();
    b.loseContent = inputs[2].value.trim();
    b.party = Array.from($('#modalBody').querySelectorAll('.rpg-party-check input:checked')).map(x => x.value);
    b.enemies = Array.from($('#modalBody').querySelectorAll('.rpg-enemy-check input:checked')).map(x => x.value);
    persist();
    renderBlocks();
    toast('战斗已保存');
  });
}

// 「⚡ 一键生成卡牌RPG 示例」：拉角色库 → 选主角 → 生成完整 demo 作品（英雄/卡牌/敌人/战斗积木全配好）
// 返回纯数据对象（不含 id/status 等服务端字段），由 createRpgDemoStory 负责创建与落库
function buildRpgDemoData(heroName) {
  const n = String(heroName || '').trim().slice(0, 12) || '勇者';
  return {
    title: n + '的卡牌冒险',
    kind: 'card_rpg',
    orientation: 'landscape',
    imgQuality: 'standard',
    rpg: {
      hero: { name: n, maxHp: 40, attack: 8 },
      cards: [
        { id: 'c_knight', name: '见习骑士', hp: 26, attack: 7, copies: 2, desc: '可靠的近战先锋' },
        { id: 'c_archer', name: '森林弓手', hp: 18, attack: 10, copies: 1, desc: '远程精准打击' },
        { id: 'c_scout', name: '老练斥候', hp: 16, attack: 12, copies: 1, desc: '一击致命的老手' },
        { id: 'c_priest', name: '见习祭司', hp: 22, attack: 5, copies: 1, desc: '不擅进攻但很能扛' },
      ],
      enemies: [
        { id: 'e_slime', name: '史莱姆', hp: 12, damage: 3 },
        { id: 'e_wolf', name: '野狼', hp: 16, damage: 5 },
        { id: 'e_goblin', name: '哥布林', hp: 14, damage: 4 },
        { id: 'e_ogre', name: '食人魔', hp: 36, damage: 8 },
      ],
    },
    chapters: [
      {
        id: 'ch_demo',
        title: '山谷的清晨',
        blocks: [
          { id: uid(), type: 'scene', content: '晨雾弥漫的山谷小径，前方传来窸窣的声响。' },
          { id: uid(), type: 'battle', content: '一只史莱姆跳出来挡住了去路！', party: ['c_knight', 'c_archer', 'c_scout', 'c_priest'], enemies: ['e_slime'], winContent: '史莱姆化作一滩绿水。', loseContent: '……被史莱姆放倒了？重整旗鼓再来！' },
          { id: uid(), type: 'battle', content: '野狼和哥布林从两侧围了上来！', party: ['c_knight', 'c_archer', 'c_scout', 'c_priest'], enemies: ['e_wolf', 'e_goblin'], winContent: '你击退了野狼，哥布林连滚带爬地逃走了。', loseContent: '寡不敌众……先撤退，改天再来。' },
          { id: uid(), type: 'dialogue', speaker: n, content: '还没完……树林深处，传来更沉重的脚步声。' },
          { id: uid(), type: 'battle', content: '一只食人魔拖着巨棒走了出来，身后还跟着野狼与哥布林！', party: ['c_knight', 'c_archer', 'c_scout', 'c_priest'], enemies: ['e_ogre', 'e_wolf', 'e_goblin'], winContent: '食人魔轰然倒地，山谷终于安静了。', loseContent: '敌人太过强大……撤！' },
          { id: uid(), type: 'dialogue', speaker: n, content: '收工。这支队伍，还能走更远。' },
        ],
      },
    ],
  };
}

// 一键生成：拉取当前用户角色库 → 弹窗选主角 → 创建 demo 作品并打开
async function generateRpgDemo() {
  if (!loggedIn) { toast('请先登录后再生成示例', true); setLoginHint(true); return; }
  let chars = [];
  try {
    const res = await fetch('/api/characters', { credentials: 'include', headers: authHeaders() });
    const d = await res.json();
    if (d.success && Array.isArray(d.characters)) chars = d.characters.slice(0, 24);
  } catch (e) { /* 拉取角色失败不阻塞：走内置示例英雄 */ }
  openModal('⚡ 一键生成卡牌RPG 示例', (body) => {
    const tip = document.createElement('div');
    tip.className = 'rpg-tip';
    tip.textContent = '选一个角色库角色当主角，将自动生成一部完整的卡牌RPG demo：英雄、卡牌库、敌人、战斗积木都已配好，创建后可直接播放。';
    body.appendChild(tip);
    const list = document.createElement('div');
    list.className = 'rpg-demo-chars';
    list.id = 'rpgDemoCharList';
    body.appendChild(list);
    const syncSel = (label) => { list.querySelectorAll('.rpg-demo-char').forEach(x => x.classList.remove('sel')); label.classList.add('sel'); };
    const items = chars.map(c => ({ id: c.id, name: c.name || '未名角色', image: c.image_url || '', hook: (c.story_hook || '').slice(0, 40) }));
    items.forEach((c, i) => {
      const label = document.createElement('label');
      label.className = 'rpg-demo-char' + (i === 0 ? ' sel' : '');
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'rpgDemoHero'; radio.value = c.name;
      if (i === 0) radio.checked = true;
      radio.addEventListener('change', () => syncSel(label));
      const av = document.createElement('span');
      av.className = 'av';
      if (c.image) { const img = document.createElement('img'); img.src = c.image; img.alt = ''; av.appendChild(img); }
      else av.textContent = '👤';
      const inf = document.createElement('span');
      inf.className = 'inf';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = c.name;
      const ds = document.createElement('span'); ds.className = 'ds'; ds.textContent = c.hook || '我的角色';
      inf.append(nm, ds);
      label.append(radio, av, inf);
      list.appendChild(label);
    });
    if (items.length) {
      const sep = document.createElement('div');
      sep.className = 'rpg-demo-sep';
      sep.textContent = '—— 或 ——';
      list.appendChild(sep);
    }
    const opt = document.createElement('label');
    opt.className = 'rpg-demo-char' + (items.length ? '' : ' sel');
    const or = document.createElement('input');
    or.type = 'radio'; or.name = 'rpgDemoHero'; or.value = '';
    if (!items.length) or.checked = true;
    or.addEventListener('change', () => syncSel(opt));
    const av2 = document.createElement('span'); av2.className = 'av'; av2.textContent = '🦸';
    const inf2 = document.createElement('span'); inf2.className = 'inf';
    const nm2 = document.createElement('span'); nm2.className = 'nm'; nm2.textContent = '内置示例英雄（勇者）';
    const ds2 = document.createElement('span'); ds2.className = 'ds'; ds2.textContent = '不用角色库角色；生成后可到「🦸 英雄」里改名改属性';
    inf2.append(nm2, ds2);
    opt.append(or, av2, inf2);
    list.appendChild(opt);
  }, () => {
    const sel = $('#rpgDemoCharList');
    const picked = sel ? sel.querySelector('input[name="rpgDemoHero"]:checked') : null;
    createRpgDemoStory(picked && picked.value ? picked.value : '勇者');
  });
}

// 创建 demo 作品：POST 建条目（kind=card_rpg）→ 用返回 id 填充完整数据 PUT 落库 → 本地插入并打开
async function createRpgDemoStory(heroName) {
  const demo = buildRpgDemoData(heroName);
  try {
    const res = await fetch('/api/stories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ title: demo.title, orientation: demo.orientation, imgQuality: demo.imgQuality, kind: demo.kind })
    });
    const d = await res.json();
    if (!d.success || !d.story) throw new Error((d && d.error) || '创建失败，请重试');
    const full = normalizeStories([{ ...d.story, ...demo, id: d.story.id }])[0];
    const up = await fetch('/api/stories/' + encodeURIComponent(full.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ data: full })
    });
    const ud = await up.json();
    if (!ud.success) throw new Error((ud && ud.error) || '保存失败，请重试');
    stories.unshift(full);
    persist();
    renderLibrary();
    openStory(full.id);
    toast(`🎉 示例《${full.title}》已生成！点「▶ 播放作品」从头看剧情，或战斗积木上的「▶ 试玩本场」直接体验自动战斗。`);
  } catch (e) {
    toast((e && e.message) || '生成失败，请重试', true);
  }
}

async function generateRogueDemo() {
  openSamplePicker();
}

function openSamplePicker() {
  if (!loggedIn) { toast('请先登录后再生成样品', true); setLoginHint(true); return; }
  openModal('参考样品（能玩，缺立绘）', (body) => {
    const tip = document.createElement('div');
    tip.className = 'rpg-tip';
    tip.textContent = '从 GitHub 开源游戏里只抄「编辑器已经有的积木」：职业表、关卡表、战后三选一、场景对白。不搬引擎和图片。生成后直接播放，再自己加画面。';
    body.appendChild(tip);
    const list = document.createElement('div');
    list.className = 'rpg-demo-chars';
    list.id = 'samplePickList';
    EDITOR_SAMPLES.forEach((s, i) => {
      const label = document.createElement('label');
      label.className = 'rpg-demo-char' + (i === 0 ? ' sel' : '');
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'editorSample'; radio.value = s.id;
      if (i === 0) radio.checked = true;
      radio.addEventListener('change', () => {
        list.querySelectorAll('.rpg-demo-char').forEach(x => x.classList.remove('sel'));
        label.classList.add('sel');
      });
      const av = document.createElement('span'); av.className = 'av'; av.textContent = s.kind === 'story' ? '📖' : '🂠';
      const inf = document.createElement('span'); inf.className = 'inf';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = s.title;
      const ds = document.createElement('span'); ds.className = 'ds'; ds.textContent = s.blurb;
      inf.append(nm, ds);
      label.append(radio, av, inf);
      list.appendChild(label);
    });
    body.appendChild(list);
  }, () => {
    const picked = document.querySelector('#samplePickList input[name="editorSample"]:checked');
    createSampleStory(picked ? picked.value : 'dungeon');
  });
}

async function createSampleStory(sampleId) {
  if (!loggedIn) { toast('请先登录后再生成样品', true); setLoginHint(true); return; }
  const demo = buildSampleWork(sampleId);
  try {
    const res = await fetch('/api/stories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ title: demo.title, orientation: demo.orientation, imgQuality: demo.imgQuality, kind: demo.kind })
    });
    const d = await res.json();
    if (!d.success || !d.story) throw new Error((d && d.error) || '创建失败，请重试');
    const full = normalizeStories([{ ...d.story, ...demo, id: d.story.id, kind: demo.kind }])[0];
    const up = await fetch('/api/stories/' + encodeURIComponent(full.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ data: full })
    });
    const ud = await up.json();
    if (!ud.success) throw new Error((ud && ud.error) || '保存失败，请重试');
    stories.unshift(full);
    persist();
    renderLibrary();
    openStory(full.id);
    toast('样品已生成。点播放即可；立绘请在积木上「添加画面」。');
  } catch (e) {
    toast((e && e.message) || '生成失败，请重试', true);
  }
}

function cardStudioApi() {
  return {
    persist,
    openModal,
    toast,
    upload: (file) => uploadFile(file, { compress: { orientation: 'portrait', quality: 'standard' } }),
    onMode: () => { renderEditor(); renderLibrary(); },
  };
}
function fillCurrentCardPack() {
  const s = story();
  if (!s || s.kind !== 'gacha_rogue') return;
  applyStarterPack(s, (s.rogue && s.rogue.mode) || 'idle');
  persist();
  renderEditor();
  toast('已经填好一套能玩的。点右上角播放。');
}

// 卡牌库编辑：作品全部角色卡（名称/生命/攻击/张数）
// 两栏布局：左侧卡片列表（点击即选中编辑），右侧「队伍总览 + 编辑表单」，不再整弹窗列表⇄表单切换
let rpgCardSel = null; // 当前选中的角色卡 id（null = 新增模式）
function openRpgCardsEditor() {
  const s = story();
  if (!s) return;
  const card = document.querySelector('#modal .modal-card');
  if (card) card.classList.add('modal-wide');
  rpgCardSel = null;
  openModal('🃏 卡牌库', () => buildRpgCardsEditorBody(), null);
}
function buildRpgCardsEditorBody() {
  const s = story();
  const body = $('#modalBody');
  if (!s || !body) return;
  body.innerHTML = '';
  const split = document.createElement('div');
  split.className = 'rpg-split';
  const left = document.createElement('div');
  left.className = 'rpg-split-left';
  const add = document.createElement('button');
  add.className = 'btn tiny';
  add.textContent = '＋ 新增角色卡';
  add.addEventListener('click', () => { rpgCardSel = null; renderRpgCardsList(); renderRpgCardForm(null); });
  const list = document.createElement('div');
  list.className = 'rpg-list';
  list.id = 'rpgCardList';
  left.append(add, list);
  const right = document.createElement('div');
  right.className = 'rpg-split-right';
  const tip = document.createElement('div');
  tip.className = 'rpg-tip';
  tip.textContent = '每张卡 = 一名角色。点左侧卡片即可改数值；张数 = 这名角色几名一起上阵，战斗时全部自动攻击。';
  const ov = document.createElement('div');
  ov.id = 'rpgTeamOverview';
  ov.className = 'rpg-team';
  const form = document.createElement('div');
  form.id = 'rpgCardForm';
  right.append(tip, ov, form);
  split.append(left, right);
  body.appendChild(split);
  renderRpgCardsList();
  renderRpgTeamOverview();
  renderRpgCardForm(null);
}
function renderRpgCardsList() {
  const s = story();
  const host = $('#rpgCardList');
  if (!s || !host) return;
  host.innerHTML = '';
  const cards = (s.rpg && s.rpg.cards) || [];
  if (!cards.length) {
    host.innerHTML = '<div class="rpg-empty">还没有角色卡。点「＋ 新增角色卡」开始组队。</div>';
    return;
  }
  cards.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'rpg-row' + (rpgCardSel === c.id ? ' sel' : '');
    const info = document.createElement('div');
    info.className = 'rpg-row-info';
    const name = document.createElement('span');
    name.className = 'rpg-name';
    name.textContent = `🃏 ${c.name}`;
    const meta = document.createElement('span');
    meta.className = 'rpg-meta';
    meta.textContent = `生命 ${c.hp} · 攻击 ${c.attack} · ×${c.copies}`;
    info.append(name, meta);
    if (c.desc) {
      const d = document.createElement('div');
      d.className = 'rpg-desc';
      d.textContent = c.desc;
      info.appendChild(d);
    }
    const ops = document.createElement('div');
    ops.className = 'rpg-ops';
    const mk = (txt, title, fn) => {
      const b = document.createElement('button');
      b.className = 'btn tiny';
      b.textContent = txt;
      b.title = title;
      b.addEventListener('click', fn);
      ops.appendChild(b);
    };
    mk('↑', '上移', () => {
      if (i > 0) { const [x] = cards.splice(i, 1); cards.splice(i - 1, 0, x); persist(); renderRpgCardsList(); }
    });
    mk('↓', '下移', () => {
      if (i < cards.length - 1) { const [x] = cards.splice(i, 1); cards.splice(i + 1, 0, x); persist(); renderRpgCardsList(); }
    });
    mk('⧉', '复制一张（含张数与描述）', () => {
      cards.splice(i + 1, 0, { ...c, id: rpgUid(), name: (c.name || '角色卡') + '（复制）' });
      persist();
      renderRpgCardsList();
    });
    mk('删', '删除', () => {
      if (!confirm(`确定删除角色卡「${c.name}」？`)) return;
      cards.splice(i, 1);
      if (rpgCardSel === c.id) rpgCardSel = null;
      persist();
      renderRpgCardsList();
      renderRpgTeamOverview();
      renderRpgCardForm(null);
      toast('已删除角色卡');
    });
    row.append(info, ops);
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      rpgCardSel = c.id;
      renderRpgCardsList();
      renderRpgCardForm(c);
    });
    host.appendChild(row);
  });
}
// 队伍总览：英雄 + 每张角色卡×张数，默认「全部上阵」时的战力汇总
function renderRpgTeamOverview() {
  const s = story();
  const host = $('#rpgTeamOverview');
  if (!s || !host) return;
  const hero = (s.rpg && s.rpg.hero) || {};
  const cards = (s.rpg && s.rpg.cards) || [];
  const members = cards.map(c => ({ c, n: Math.max(1, Math.min(9, Number(c.copies) || 1)) }));
  const count = 1 + members.reduce((x, m) => x + m.n, 0);
  const hpTotal = (Number(hero.maxHp) || 30) + members.reduce((x, m) => x + (Math.max(1, Number(m.c.hp) || 20)) * m.n, 0);
  const atkTotal = (Number(hero.attack) || 8) + members.reduce((x, m) => x + (Math.max(1, Number(m.c.attack) || 5)) * m.n, 0);
  host.innerHTML = `
    <div class="rpg-team-head">🧩 队伍总览（默认全部上阵）</div>
    <div class="rpg-team-list">
      <div class="rpg-team-item"><span>🦸 ${esc(hero.name || '勇者')}</span><em>生命 ${Number(hero.maxHp) || 30}</em><em>攻击 ${Number(hero.attack) || 8}</em></div>
      ${members.map(m => `<div class="rpg-team-item"><span>🃏 ${esc(m.c.name)} ×${m.n}</span><em>生命 ${Math.max(1, Number(m.c.hp) || 20)}</em><em>攻击 ${Math.max(1, Number(m.c.attack) || 5)}</em></div>`).join('')}
    </div>
    <div class="rpg-team-total">共 ${count} 名角色 · 生命合计 ${hpTotal} · 每回合攻击合计 ${atkTotal}</div>`;
}
function renderRpgCardForm(card) {
  const s = story();
  const host = $('#rpgCardForm');
  if (!s || !host) return;
  host.innerHTML = '';
  if (!card) rpgCardSel = null;
  const isNew = !card;
  const title = document.createElement('div');
  title.className = 'rpg-form-title';
  title.textContent = isNew ? '＋ 新增角色卡' : `✎ 编辑：${card.name}`;
  host.appendChild(title);
  const mkField = (label, inputType, value, max) => {
    const f = document.createElement('div');
    f.className = 'field rpg-field';
    const l = document.createElement('label');
    l.textContent = label;
    const input = document.createElement('input');
    input.type = inputType;
    input.className = 'txt';
    if (inputType === 'number') { input.min = 0; input.max = max; }
    input.value = value;
    f.append(l, input);
    host.appendChild(f);
    return input;
  };
  const fName = mkField('角色名称', 'text', card ? card.name : '');
  fName.maxLength = 20;
  mkField('生命（1-999）', 'number', card ? card.hp : 20, 999);
  mkField('攻击（1-99）', 'number', card ? card.attack : 5, 99);
  mkField('张数（1-9，几名一起上阵）', 'number', card ? card.copies : 1, 9);
  const fDesc = document.createElement('div');
  fDesc.className = 'field rpg-field';
  const dL = document.createElement('label');
  dL.textContent = '描述（可留空）';
  const dIn = document.createElement('input');
  dIn.type = 'text';
  dIn.className = 'txt';
  dIn.maxLength = 60;
  dIn.value = card ? (card.desc || '') : '';
  fDesc.append(dL, dIn);
  host.appendChild(fDesc);
  const opsRow = document.createElement('div');
  opsRow.className = 'rpg-form-ops';
  if (card) {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn ghost';
    copyBtn.textContent = '⧉ 复制一份';
    copyBtn.addEventListener('click', () => {
      const copy = { ...card, id: rpgUid(), name: (card.name || '角色卡') + '（复制）' };
      s.rpg.cards.splice(s.rpg.cards.indexOf(card) + 1, 0, copy);
      rpgCardSel = copy.id;
      persist();
      renderRpgCardsList();
      renderRpgCardForm(copy);
      toast('已复制');
    });
    opsRow.appendChild(copyBtn);
  }
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn primary';
  saveBtn.textContent = '💾 保存';
  saveBtn.addEventListener('click', () => {
    const q = $('#rpgCardForm');
    const name = q.querySelectorAll('.field input[type=text]')[0].value.trim();
    const hp = Math.max(1, Math.min(999, Number(q.querySelectorAll('.field input[type=number]')[0].value) || 20));
    const attack = Math.max(1, Math.min(99, Number(q.querySelectorAll('.field input[type=number]')[1].value) || 5));
    const copies = Math.max(1, Math.min(9, Number(q.querySelectorAll('.field input[type=number]')[2].value) || 1));
    const desc = q.querySelectorAll('.field input[type=text]')[1].value.trim();
    if (!name) { toast('角色卡需要名称', true); return; }
    let saved;
    if (isNew) {
      saved = { id: rpgUid(), name, hp, attack, copies, desc };
      s.rpg.cards.push(saved);
      toast('已新增角色卡');
    } else {
      Object.assign(card, { name, hp, attack, copies, desc });
      saved = card;
      toast('角色卡已更新');
    }
    rpgCardSel = saved.id;
    persist();
    renderRpgCardsList();
    renderRpgTeamOverview();
    renderRpgCardForm(saved);
  });
  opsRow.appendChild(saveBtn);
  host.appendChild(opsRow);
}

// 英雄编辑：名字 / 最大生命 / 攻击
function openRpgHeroEditor() {
  const s = story();
  if (!s) return;
  openModal('🦸 英雄', (body) => {
    const tip = document.createElement('div');
    tip.className = 'rpg-tip';
    tip.textContent = '英雄是队伍的领队，永远带队出战。设置生命与攻击，进入战斗后每回合自动攻击敌人。';
    body.appendChild(tip);
    const mkField = (label, value) => {
      const f = document.createElement('div');
      f.className = 'field rpg-field';
      const l = document.createElement('label');
      l.textContent = label;
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'txt';
      input.min = 1; input.max = 999;
      input.value = value;
      f.append(l, input);
      body.appendChild(f);
      return input;
    };
    const fName = document.createElement('div');
    fName.className = 'field rpg-field';
    const nL = document.createElement('label');
    nL.textContent = '名字';
    const nIn = document.createElement('input');
    nIn.type = 'text';
    nIn.className = 'txt';
    nIn.maxLength = 20;
    nIn.value = s.rpg.hero.name;
    fName.append(nL, nIn);
    body.appendChild(fName);
    mkField('最大生命', s.rpg.hero.maxHp);
    mkField('攻击', s.rpg.hero.attack);
  }, () => {
    const q = $('#modalBody');
    const name = q.querySelector('input[type=text]').value.trim();
    if (!name) { toast('英雄需要名字', true); return; }
    s.rpg.hero.name = name;
    s.rpg.hero.maxHp = Math.max(1, Math.min(999, Number(q.querySelectorAll('input[type=number]')[0].value) || 30));
    s.rpg.hero.attack = Math.max(1, Math.min(99, Number(q.querySelectorAll('input[type=number]')[1].value) || 8));
    persist();
    renderEditor();
    toast('英雄已更新');
  });
}

// 敌人库编辑：全部敌人（名称 / 生命 / 每回合伤害）
function openRpgEnemiesEditor() {
  const s = story();
  if (!s) return;
  openModal('👹 敌人', () => buildRpgEnemiesEditorBody(), null);
}
function buildRpgEnemiesEditorBody() {
  const s = story();
  const body = $('#modalBody');
  if (!s || !body) return;
  body.innerHTML = '';
  const tip = document.createElement('div');
  tip.className = 'rpg-tip';
  tip.textContent = '敌人的属性：生命 + 攻击。战斗时每回合自动攻击我方角色一次。在「⚔️ 编辑战斗」里选择出战敌人。';
  body.appendChild(tip);
  const list = document.createElement('div');
  list.className = 'rpg-list';
  list.id = 'rpgEnemyList';
  body.appendChild(list);
  const add = document.createElement('button');
  add.className = 'btn tiny';
  add.textContent = '＋ 新增敌人';
  add.addEventListener('click', () => renderRpgEnemyForm(null));
  body.appendChild(add);
  renderRpgEnemiesList();
}
function renderRpgEnemiesList() {
  const s = story();
  const host = $('#rpgEnemyList');
  if (!s || !host) return;
  host.innerHTML = '';
  const enemies = (s.rpg && s.rpg.enemies) || [];
  if (!enemies.length) {
    host.innerHTML = '<div class="rpg-empty">还没有敌人。点「＋ 新增敌人」开始设计。</div>';
    return;
  }
  enemies.forEach(e => {
    const row = document.createElement('div');
    row.className = 'rpg-row';
    const info = document.createElement('div');
    info.className = 'rpg-row-info';
    const name = document.createElement('span');
    name.className = 'rpg-name';
    name.textContent = `👹 ${e.name}`;
    const meta = document.createElement('span');
    meta.className = 'rpg-meta';
    meta.textContent = `生命 ${e.hp} · 攻击 ${e.damage}`;
    info.append(name, meta);
    const ops = document.createElement('div');
    ops.className = 'rpg-ops';
    const ed = document.createElement('button');
    ed.className = 'btn tiny';
    ed.textContent = '编辑';
    ed.addEventListener('click', () => renderRpgEnemyForm(e));
    const del = document.createElement('button');
    del.className = 'btn tiny danger';
    del.textContent = '删';
    del.addEventListener('click', () => {
      if (!confirm(`确定删除敌人「${e.name}」？`)) return;
      s.rpg.enemies = s.rpg.enemies.filter(x => x.id !== e.id);
      persist();
      buildRpgEnemiesEditorBody();
      renderBlocks();
      toast('已删除敌人');
    });
    ops.append(ed, del);
    row.append(info, ops);
    host.appendChild(row);
  });
}
function renderRpgEnemyForm(enemy) {
  const s = story();
  const body = $('#modalBody');
  if (!s || !body) return;
  const isNew = !enemy;
  body.innerHTML = '';
  const mkField = (label, value) => {
    const f = document.createElement('div');
    f.className = 'field rpg-field';
    const l = document.createElement('label');
    l.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'txt';
    input.min = 0; input.max = 999;
    input.value = value;
    f.append(l, input);
    body.appendChild(f);
    return input;
  };
  const fName = document.createElement('div');
  fName.className = 'field rpg-field';
  const nL = document.createElement('label');
  nL.textContent = '名字';
  const nIn = document.createElement('input');
  nIn.type = 'text';
  nIn.className = 'txt';
  nIn.maxLength = 20;
  nIn.value = enemy ? enemy.name : '';
  fName.append(nL, nIn);
  body.appendChild(fName);
  mkField('生命', enemy ? enemy.hp : 10);
  mkField('攻击（每回合伤害）', enemy ? enemy.damage : 3);
  const opsRow = document.createElement('div');
  opsRow.className = 'rpg-form-ops';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn primary';
  saveBtn.textContent = '💾 保存';
  saveBtn.addEventListener('click', () => {
    const q = $('#modalBody');
    const name = q.querySelector('input[type=text]').value.trim();
    if (!name) { toast('敌人需要名字', true); return; }
    const entry = {
      name,
      hp: Math.max(1, Math.min(999, Number(q.querySelectorAll('input[type=number]')[0].value) || 10)),
      damage: Math.max(0, Math.min(999, Number(q.querySelectorAll('input[type=number]')[1].value) || 3)),
    };
    if (isNew) {
      s.rpg.enemies.push({ id: rpgUid(), ...entry });
      toast('已新增敌人');
    } else {
      Object.assign(enemy, entry);
      toast('敌人已更新');
    }
    persist();
    buildRpgEnemiesEditorBody();
    renderBlocks();
  });
  const backBtn = document.createElement('button');
  backBtn.className = 'btn ghost';
  backBtn.textContent = '↩ 返回敌人列表';
  backBtn.addEventListener('click', () => buildRpgEnemiesEditorBody());
  opsRow.append(saveBtn, backBtn);
  body.appendChild(opsRow);
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
  // 上传成功 → 记入本机素材库（只存 URL 引用）
  try {
    addAsset({
      url: data.url,
      type: kind,
      label: (file && file.name ? String(file.name).replace(/\.[^.]+$/, '') : '').slice(0, 40),
      source: 'upload',
    });
  } catch (e) { /* ignore */ }
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
// 对白：播放时固定显示底部「聊天框」（角色名 + 对白内容自动加引号），字号/文字颜色自定义。
// 场景：播放时显示「场景文字」（纯文字无框，来自 b.content），可自由拖拽位置，字号/颜色自定义；内容留空则不显示。
function openSubtitleEditor(b) {
  const cur = b.subtitle || {};
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
    // 对白/场景：字号滑条（全局统一 25~30px）+ 文字颜色（对白框固定底部聊天框无位置选项；场景位置在播放时自由拖拽）
    const f5 = document.createElement('div');
    f5.className = 'field';
    f5.style.margin = '0';
    const l5 = document.createElement('label');
    l5.textContent = '字号（全局统一，默认 27px；修改后所有文字生效）';
    const sizeRow = document.createElement('div');
    sizeRow.style.cssText = 'display:flex;align-items:center;gap:10px';
    const sizeRange = document.createElement('input');
    sizeRange.type = 'range';
    sizeRange.min = SUB_SIZE_MIN; sizeRange.max = SUB_SIZE_MAX; sizeRange.step = 1;
    sizeRange.className = 'sub-edit-size';
    sizeRange.style.flex = '1';
    const initSize = getGlobalSubSize();
    sizeRange.value = initSize;
    const sizeVal = document.createElement('span');
    sizeVal.style.cssText = 'font-size:12px;color:var(--muted);min-width:36px;text-align:right';
    sizeVal.textContent = initSize + 'px';
    sizeRange.addEventListener('input', () => { sizeVal.textContent = sizeRange.value + 'px'; });
    sizeRow.append(sizeRange, sizeVal);
    f5.append(l5, sizeRow);
    const f6 = document.createElement('div');
    f6.className = 'field';
    f6.style.margin = '0';
    const l6 = document.createElement('label');
    l6.textContent = '文字颜色（选默认色即恢复默认）';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'sub-edit-color';
    colorInput.style.cssText = 'width:44px;height:32px;padding:2px;border-radius:8px;background:var(--bg3);border:1px solid var(--line2);cursor:pointer';
    colorInput.value = cur.color || (b.type === 'dialogue' ? '#e8e8f0' : '#ffffff');
    f6.append(l6, colorInput);
    body.append(f5, f6);
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
    // 显示设置：字号全局统一（弹窗修改即更新全局默认，所有文字统一生效）+ 文字颜色；对白框固定底部聊天框；场景位置 x/y 保持不变
    setGlobalSubSize(Number(($('#modalBody .sub-edit-size') || {}).value) || SUB_SIZE_DEFAULT);
    b.subtitle = { on: true }; // 字号不再逐块存储（全局统一）
    const colorEl = $('#modalBody .sub-edit-color');
    const colorNow = colorEl ? colorEl.value : '';
    const defColor = b.type === 'dialogue' ? '#e8e8f0' : '#ffffff';
    if (colorNow && colorNow.toLowerCase() !== defColor.toLowerCase()) b.subtitle.color = colorNow;
    else delete b.subtitle.color;
    if (b.type === 'scene') {
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
function openAssetLibrary(opts) {
  const filterType = opts && opts.type ? opts.type : null;
  const onPick = opts && typeof opts.onPick === 'function' ? opts.onPick : null;
  openModal(onPick ? '从素材库选用' : '素材库', (body) => {
    const tip = document.createElement('div');
    tip.className = 'hint';
    tip.style.cssText = 'font-size:12px;color:var(--muted);line-height:1.6';
    tip.textContent = '只存 URL 引用在本机。作品画面仍走现有上传；库用于复用与粘贴外链。';
    body.appendChild(tip);

    const addRow = document.createElement('div');
    addRow.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:10px';
    const urlIn = document.createElement('input');
    urlIn.className = 'txt';
    urlIn.placeholder = '粘贴图片/音频/视频 URL';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn small';
    addBtn.textContent = '加入';
    addRow.append(urlIn, addBtn);
    body.appendChild(addRow);

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:12px;max-height:50vh;overflow:auto';
    body.appendChild(list);

    const render = () => {
      list.innerHTML = '';
      const items = listAssets(filterType ? { type: filterType } : null);
      if (!items.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size:13px;color:var(--muted);padding:12px 0';
        empty.textContent = '还没有素材。上传画面/配音，或粘贴 URL。';
        list.appendChild(empty);
        return;
      }
      items.forEach((a) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:grid;grid-template-columns:56px 1fr auto;gap:10px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:8px';
        const thumb = document.createElement('div');
        thumb.style.cssText = 'width:56px;height:40px;border-radius:6px;overflow:hidden;background:#0a0a12;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--muted)';
        if (a.type === 'image') {
          const img = document.createElement('img');
          img.src = a.url;
          img.alt = '';
          img.loading = 'lazy';
          img.style.cssText = 'width:100%;height:100%;object-fit:cover';
          thumb.appendChild(img);
        } else {
          thumb.textContent = a.type === 'video' ? 'MP4' : '♪';
        }
        const meta = document.createElement('div');
        meta.style.minWidth = '0';
        const name = document.createElement('div');
        name.style.cssText = 'font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
        name.textContent = a.label || a.type;
        const url = document.createElement('div');
        url.style.cssText = 'font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
        url.textContent = a.url;
        meta.append(name, url);
        const ops = document.createElement('div');
        ops.style.cssText = 'display:flex;flex-direction:column;gap:4px';
        if (onPick) {
          const use = document.createElement('button');
          use.type = 'button';
          use.className = 'btn tiny primary';
          use.textContent = '选用';
          use.addEventListener('click', () => {
            onPick(a);
            closeModal();
          });
          ops.appendChild(use);
        }
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn tiny danger';
        rm.textContent = '移除';
        rm.addEventListener('click', () => {
          removeAsset(a.id);
          render();
        });
        ops.appendChild(rm);
        row.append(thumb, meta, ops);
        list.appendChild(row);
      });
    };
    addBtn.addEventListener('click', () => {
      const u = (urlIn.value || '').trim();
      if (!u) { toast('先粘贴 URL', true); return; }
      let type = 'image';
      if (/\.(mp3|wav|m4a|ogg)(\?|$)/i.test(u) || u.includes('/audio')) type = 'audio';
      else if (/\.(mp4|webm)(\?|$)/i.test(u)) type = 'video';
      if (filterType === 'audio') type = 'audio';
      if (filterType === 'image') type = type === 'video' ? 'video' : 'image';
      addAsset({ url: u, type, label: '外链', source: 'url' });
      urlIn.value = '';
      render();
      toast('已加入素材库');
    });
    render();
  }, null);
}

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
  if (b.type !== 'dialogue' && b.type !== 'perf') return b.content || '';
  const c = (b.content || '').trim();
  return /^[“"]/.test(c) ? c : `“${c}”`;
}

/** 表现层临场一句：只替换台词 DOM；失败/超时静默保留预设 */
async function requestLiveLine(b, lineEl, badgeEl) {
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => { try { ac && ac.abort(); } catch (e) { /* ignore */ } }, 9000);
  try {
    const res = await fetch('/api/hub/live-line', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        speaker: b.speaker || '',
        preset: b.content || '',
        hint: b.hint || '',
        state: playState,
      }),
      signal: ac ? ac.signal : undefined,
    });
    const d = await res.json().catch(() => ({}));
    if (d.success && d.line && lineEl && lineEl.isConnected) {
      lineEl.textContent = formatDialogue({ type: 'perf', content: d.line });
    }
  } catch (e) {
    /* 预设已在画面上 */
  } finally {
    clearTimeout(timer);
    if (badgeEl && badgeEl.isConnected) badgeEl.remove();
  }
}

// ---------- 播放 ----------

// ---------- 卡牌RPG 战斗引擎（播放分支：kind=card_rpg 的 battle 幕；卡牌=角色，全自动回合制） ----------
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (cur, max) => Math.max(0, Math.min(100, Math.round(cur / Math.max(1, max) * 100)));
// battle 状态：{ block, round, party:[{id,name,maxHp,hp,attack,hero}], enemies:[{id,name,maxHp,hp,damage}],
//               phase:'running'|'won'|'lost', log[], fast }
// 出战队伍 = 英雄（领队）+ 本场选中的角色卡（每张×copies）；没选出战角色 → 全部角色卡上阵；连角色卡都没有 → 兜底一名流浪剑客
function battleParty(block) {
  const rpg = ((story() || {}).rpg) || {};
  const hero = rpg.hero || {};
  const party = [{ id: 'hero', name: hero.name || DEFAULT_HERO_STATS.name, maxHp: Math.max(1, Number(hero.maxHp) || DEFAULT_HERO_STATS.maxHp), attack: Math.max(1, Number(hero.attack) || DEFAULT_HERO_STATS.attack), hero: true }];
  const lib = rpg.cards || [];
  const want = (block.party || []).filter(id => lib.some(c => c.id === id));
  const pool = want.length ? want : lib.map(c => c.id);
  pool.forEach(id => {
    const c = lib.find(x => x.id === id);
    if (!c) return;
    const n = Math.max(1, Math.min(9, Number(c.copies) || 1));
    for (let i = 0; i < n; i++) {
      party.push({ id: c.id, name: c.name, maxHp: Math.max(1, Number(c.hp) || DEFAULT_CARD_STATS.hp), attack: Math.max(1, Number(c.attack) || DEFAULT_CARD_STATS.attack), hero: false });
    }
  });
  if (party.length <= 1) party.push({ id: 'c_warrior', name: '流浪剑客', maxHp: 20, attack: 6, hero: false });
  return party;
}
function battleEnemyList(block) {
  const lib = (((story() || {}).rpg) || {}).enemies || [];
  const list = [];
  (block.enemies || []).forEach(id => {
    const e = lib.find(x => x.id === id);
    if (e) list.push({ id: e.id, name: e.name, maxHp: Math.max(1, Number(e.hp) || 10), hp: Math.max(1, Number(e.hp) || 10), damage: Math.max(0, Number(e.damage) || 3) });
  });
  if (!list.length) list.push({ id: 'e_default', name: '史莱姆', maxHp: 10, hp: 10, damage: 3 });
  return list;
}
function startBattle(block) {
  stopBattleTimer();
  battle = {
    block,
    round: 0,
    party: battleParty(block).map(m => ({ ...m, hp: m.maxHp })),
    enemies: battleEnemyList(block),
    phase: 'running',
    log: [],
    fast: false,
  };
  // 不再设「入场确认屏」：战前剧情并入战斗日志首行，进入战斗幕即自动开打
  battle.log.push(`⚔️ 遭遇战：我方 ${battle.party.length} 名角色 vs 敌方 ${battle.enemies.length} 个敌人`);
  if (block && block.content && block.content.trim()) battle.log.push('📜 ' + block.content.trim());
  renderBattle();
  battleTimer = setTimeout(battleStep, BATTLE_ROUND_MS);
}
function stopBattleTimer() { if (battleTimer) { clearTimeout(battleTimer); battleTimer = null; } }
// 一回合：己方所有存活成员攻击最前排存活敌人 → 敌方所有存活敌人随机攻击存活成员 → 结算胜负
function battleStep() {
  if (!battle || battle.phase !== 'running') return;
  battle.round++;
  battle.log.push(`—— 第 ${battle.round} 回合 ——`);
  battle.party.forEach(m => {
    if (m.hp <= 0) return;
    const e = battle.enemies.find(x => x.hp > 0);
    if (!e) return;
    const dmg = Math.max(0, m.attack);
    e.hp = Math.max(0, e.hp - dmg);
    battle.log.push(`${m.hero ? '🦸' : '🃏'} ${m.name} 攻击 ${e.name}，造成 ${dmg} 点伤害`);
  });
  if (battle.enemies.every(e => e.hp <= 0)) { battle.phase = 'won'; battle.log.push('🏆 所有敌人已被击败！'); renderBattle(); return; }
  const aliveParty = battle.party.filter(m => m.hp > 0);
  battle.enemies.forEach(e => {
    if (e.hp <= 0 || !aliveParty.length) return;
    const t = aliveParty[Math.floor(Math.random() * aliveParty.length)];
    const dmg = Math.max(0, e.damage);
    t.hp = Math.max(0, t.hp - dmg);
    battle.log.push(`👹 ${e.name} 攻击 ${t.name}，造成 ${dmg} 点伤害`);
  });
  if (battle.party.every(m => m.hp <= 0)) { battle.phase = 'lost'; battle.log.push('💀 我方队伍全灭…'); renderBattle(); return; }
  if (battle.log.length > 40) battle.log = battle.log.slice(-40);
  if (!battle.fast) renderBattle();
  battleTimer = setTimeout(battleStep, battle.fast ? 0 : BATTLE_ROUND_MS);
}
// ⏩ 跳过动画：后续回合 0ms 连跑，直接出结果
function battleSkip() {
  if (!battle || battle.phase !== 'running') return;
  battle.fast = true;
  stopBattleTimer();
  battleTimer = setTimeout(battleStep, 0);
}

// 战斗幕不设「入场确认屏」：进入即 startBattle 自动开打，战前剧情并入战斗日志首行
// 战斗主视图：回合条 / 敌方区 / 己方队伍区 / 战斗日志 / 胜败结算
function renderBattle() {
  if (!battle) return;
  const body = $('#playBody');
  body.innerHTML = '';
  const s = story();
  const frame = document.createElement('div');
  frame.className = 'battle-view' + (battle.phase === 'won' || battle.phase === 'lost' ? ' result' : '');
  if (s && s.orientation === 'portrait') frame.classList.add('portrait');
  body.appendChild(frame);
  const block = battle.block;
  if (block && block.media && block.media.url) {
    const bg = document.createElement('div');
    bg.className = 'bt-bg';
    if (block.media.type === 'video') {
      const v = document.createElement('video');
      v.src = block.media.url; v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
      bg.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = block.media.url; img.alt = '';
      bg.appendChild(img);
    }
    frame.appendChild(bg);
  }
  // 回合条 + 跳过
  const top = document.createElement('div');
  top.className = 'bt-top';
  const round = document.createElement('div');
  round.className = 'bt-round';
  round.textContent = `⚔️ 第 ${battle.round || 1} 回合`;
  top.appendChild(round);
  if (battle.phase === 'running') {
    const skip = document.createElement('button');
    skip.className = 'btn tiny bt-skip';
    skip.textContent = '⏩ 跳过';
    skip.addEventListener('click', battleSkip);
    top.appendChild(skip);
    const quit = document.createElement('button');
    quit.className = 'btn tiny ghost bt-skip';
    quit.textContent = '✕ 退出';
    quit.title = '退出播放';
    quit.addEventListener('click', stopPlay);
    top.appendChild(quit);
  }
  frame.appendChild(top);
  // 敌方区
  const enemies = document.createElement('div');
  enemies.className = 'bt-enemies';
  battle.enemies.forEach(e => {
    const card = document.createElement('div');
    card.className = 'bt-enemy' + (e.hp <= 0 ? ' dead' : '');
    card.innerHTML = `
      <div class="bt-enemy-name">👹 ${esc(e.name)}</div>
      <div class="bt-hp-row"><div class="bt-bar"><div class="bt-bar-fill enemy" style="width:${pct(e.hp, e.maxHp)}%"></div></div><span class="bt-hp-num">${e.hp}/${e.maxHp}</span></div>
      <div class="bt-enemy-meta">⚔️ 攻击 ${e.damage}</div>
    `;
    enemies.appendChild(card);
  });
  frame.appendChild(enemies);
  // 己方队伍区（英雄带金色描边）
  const party = document.createElement('div');
  party.className = 'bt-party';
  battle.party.forEach(m => {
    const el = document.createElement('div');
    el.className = 'bt-member' + (m.hero ? ' hero' : '') + (m.hp <= 0 ? ' dead' : '');
    el.innerHTML = `
      <div class="bt-member-name">${m.hero ? '🦸' : '🃏'} ${esc(m.name)}</div>
      <div class="bt-hp-row"><div class="bt-bar"><div class="bt-bar-fill hp" style="width:${pct(m.hp, m.maxHp)}%"></div></div><span class="bt-hp-num">${m.hp}/${m.maxHp}</span></div>
      <div class="bt-member-meta">⚔️ 攻击 ${m.attack}</div>
    `;
    party.appendChild(el);
  });
  frame.appendChild(party);
  // 战斗日志（自动滚到底）
  const log = document.createElement('div');
  log.className = 'bt-log';
  battle.log.slice(-12).forEach(l => {
    const line = document.createElement('div');
    line.className = 'bt-log-line' + (l.indexOf('——') === 0 ? ' round' : '');
    line.textContent = l;
    log.appendChild(line);
  });
  log.scrollTop = log.scrollHeight;
  frame.appendChild(log);
  // 胜败结算面板
  if (battle.phase === 'won') {
    const panel = document.createElement('div');
    panel.className = 'bt-result';
    panel.innerHTML = `
      <div class="bt-result-title">🏆 战斗胜利</div>
      <div class="bt-result-text">${esc(battle.block.winContent || '你击败了所有敌人！')}</div>
      <div class="bt-result-ops">
        <button class="btn primary" id="btWinNext">继续 →</button>
        <button class="btn ghost" id="btWinExit">退出</button>
      </div>
    `;
    frame.appendChild(panel);
    panel.querySelector('#btWinNext').addEventListener('click', playNext);
    panel.querySelector('#btWinExit').addEventListener('click', stopPlay);
  } else if (battle.phase === 'lost') {
    const panel = document.createElement('div');
    panel.className = 'bt-result';
    panel.innerHTML = `
      <div class="bt-result-title lost">💀 战斗失败</div>
      <div class="bt-result-text">${esc(battle.block.loseContent || '你倒下了…重整旗鼓再试一次。')}</div>
      <div class="bt-result-ops">
        <button class="btn primary" id="btRetry">🔄 重新挑战</button>
        <button class="btn ghost" id="btLoseExit">退出</button>
      </div>
    `;
    frame.appendChild(panel);
    panel.querySelector('#btRetry').addEventListener('click', () => startBattle(battle.block));
    panel.querySelector('#btLoseExit').addEventListener('click', stopPlay);
  }
}
// 编辑器里「▶ 试玩本场」：直接跳到该战斗幕
function previewBattle(b) {
  playFlat = buildPlayFlat();
  const i = playFlat.findIndex(x => x.id === b.id);
  if (i < 0) return;
  playIdx = i;
  $('#playBody').innerHTML = '';
  $('#playOverlay').classList.remove('hidden');
  renderPlay();
}

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
  resetPlayState();
  $('#playBody').innerHTML = ''; // 进入播放先清空画幅残留（重复 startPlay 直接换画面不叠加，避免旧画幅撑出滚动条压缩新画幅）
  $('#playOverlay').classList.remove('hidden'); // 先显示再渲染，确保竖屏画幅能按实际播放区尺寸计算
  updatePlayStateHud();
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
  stopBattleTimer(); // 退出播放：停掉自动战斗回合调度
  stopRogueRun();
  battle = null; // 退出播放：清掉卡牌战斗状态
  const nav = $('#playNav');
  if (nav) nav.classList.remove('hidden');
  const nextBtn = $('#playNext');
  if (nextBtn) nextBtn.textContent = '下一条 →';
  $('#playBody').innerHTML = ''; // 清空画幅残留，避免下次播放叠加旧帧
  $('#playOverlay').classList.add('hidden');
  // 只读直达播放（个人主页 / 广场游客浏览已发布作品）：退出播放后回到作品库
  const s = story();
  if (s && s._readonly) backToLibrary();
}
// 播放场景文字拖拽：按住可自由移动，松手自动保存位置（x/y = 画幅中心点百分比，松手后按百分比定位）。
// 场景文字点击不推进下一幕（fore 全屏点击区响应推进）。
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

function renderPlay() {
  stopPlayAudio(); // 先停掉上一幕的配音，避免两个声音同时播放
  stopPlaySfxAll();   // 音效轨：切幕时停止本幕全部音效（含延迟定时器）
  skipUnmetPerfBlocks();
  if (playIdx >= playFlat.length) {
    stopPlay();
    toast('到此结束');
    return;
  }
  if (!playFlat.length) return;
  $('#playProgress').textContent = `第 ${playIdx + 1} 条 · 共 ${playFlat.length} 条`;
  $('#playChapter').textContent = playFlat[playIdx].chapterTitle;
  $('#playCount').textContent = `${playIdx + 1} / ${playFlat.length}`;
  updatePlayStateHud();
  const body = $('#playBody');
  const b = playFlat[playIdx];
  markVisited(b);
  const sPlay = story();
  // 卡牌RPG 分支：battle 幕 → 战斗视图（战前剧情并入战斗日志 → 自动战斗 → 胜败结算），不套用叙事画幅
  if (b.type === 'battle' && sPlay && sPlay.kind === 'card_rpg') {
    const nav = $('#playNav');
    if (nav) nav.classList.add('hidden');
    startBattle(b);
    return;
  }
  if (b.type === 'rogue' && sPlay && sPlay.kind === 'gacha_rogue') {
    const nav = $('#playNav');
    if (nav) nav.classList.add('hidden');
    startRogueRun(b, {
      story: sPlay,
      playBody: $('#playBody'),
      playNav: nav,
      orientation: sPlay.orientation,
      onWin: playNext,
      onExit: stopPlay,
      onPersist: persist,
    });
    return;
  }
  const navEl = $('#playNav');
  if (navEl) navEl.classList.remove('hidden');
  stopBattleTimer();
  stopRogueRun();
  battle = null; // 非战斗幕：清掉残留战斗状态（战斗幕内部由 startBattle 重置）
  // 转场交叉淡化：所有残留旧画幅淡出后延迟移除（叠加在新画幅下层），不再直接清空 DOM，避免切幕瞬间露出黑底
  body.querySelectorAll('.play-frame').forEach((f) => {
    if (!f.classList.contains('tl-leave')) f.classList.add('tl-leave');
    setTimeout(() => f.remove(), 260);
  });
  const overlay = $('#playOverlay');
  // 按作品方向适配播放画幅（16:9 横屏 / 9:16 竖屏）
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
  // 立绘层（最多 3）：叠加在背景上，锚点底中
  const playFigs = normalizeBlockFigures(b);
  playFigs.forEach((playFig) => {
    const wrap = document.createElement('div');
    wrap.className = 'play-figure';
    wrap.style.left = playFig.x + '%';
    wrap.style.top = playFig.y + '%';
    wrap.style.transform = 'translate(-50%,-100%) scale(' + playFig.scale + ')';
    const img = document.createElement('img');
    img.src = playFig.url;
    img.alt = '';
    wrap.appendChild(img);
    frame.appendChild(wrap);
  });
  // 进入本幕转场
  const tr = normalizeTransition(b.transition);
  frame.classList.remove('tl-fadeblack', 'tl-none');
  if (tr === 'none') frame.classList.add('tl-none');
  else if (tr === 'fadeblack') frame.classList.add('tl-fadeblack');
  // 前景文字/对白/选项（点击 → 下一幕；选项幕须点选跳转）
  const fore = document.createElement('div');
  fore.className = 'play-fore';
  if (b.type === 'choice') {
    normalizeChoiceBlock(b);
    fore.classList.add('dlg-fore');
    // 选项幕：不点空白推进，必须点选项；按 require 过滤
    const box = document.createElement('div');
    box.className = 'play-choice';
    const prompt = document.createElement('div');
    prompt.className = 'pc-prompt';
    prompt.textContent = (b.content || '').trim() || '请选择：';
    const opts = document.createElement('div');
    opts.className = 'pc-opts';
    const shown = visibleChoices(b);
    if (!shown.length) {
      const none = document.createElement('div');
      none.style.cssText = 'font-size:13px;color:var(--muted);padding:8px 0';
      none.textContent = '没有满足条件的选项。可返回上一条或退出。';
      opts.appendChild(none);
      const fall = document.createElement('button');
      fall.type = 'button';
      fall.className = 'pc-opt';
      fall.textContent = '继续（无可用选项）';
      fall.addEventListener('click', (e) => {
        e.stopPropagation();
        jumpPlayTo('next');
      });
      opts.appendChild(fall);
    } else {
      shown.forEach((c, ci) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pc-opt';
        let label = c.label || ('选项 ' + (ci + 1));
        if (c.effect && c.effect.length) {
          const hint = c.effect.map(e => e.var + e.op + e.val).join(',');
          // 不把数值提示硬塞文案；调试信息仅 title
          btn.title = hint;
        }
        btn.textContent = label;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          applyEffects(c.effect);
          jumpPlayTo(c.jump || 'next');
        });
        opts.appendChild(btn);
      });
    }
    box.append(prompt, opts);
    fore.appendChild(box);
    frame.appendChild(fore);
    body.appendChild(frame);
    updatePlayStateHud();
    $('#playPrev').disabled = playIdx === 0;
    $('#playNext').disabled = true; // 选项幕禁止「下一条」直线跳过
    $('#playNext').textContent = '下一条 →';
    playSfxListForBlock(b);
    return;
  }
  fore.addEventListener('click', playNext);
  if (b.type === 'scene') {
    // 场景幕：fore 退化为全屏透明点击区（整幅画面点击推进下一幕），无「点击文字进入下一条」提示、无玻璃卡片背景；
    // 场景文字（纯文字无框）单独渲染在 frame 上层，可自由拖拽
    fore.classList.add('scene-sub-mode');
  } else {
    // 对白 / 演出：底部「聊天框」；演出可异步换临场一句（失败保留预设）
    if (b.type === 'perf') normalizePerfBlock(b);
    const sub = b.subtitle || {};
    const sz = getGlobalSubSize();
    const d = document.createElement('div');
    d.className = 'play-dialogue' + (b.type === 'perf' ? ' play-perf' : '');
    const sp = document.createElement('div');
    sp.className = 'pd-speaker';
    sp.textContent = b.speaker || DEFAULT_SPEAKER;
    const ln = document.createElement('div');
    ln.className = 'pd-line';
    ln.textContent = formatDialogue(b);
    d.append(sp, ln);
    ln.style.fontSize = sz + 'px';
    sp.style.fontSize = Math.round(sz * 1.3) + 'px'; // 角色名联动 1.3x
    if (sub.color) { sp.style.color = sub.color; ln.style.color = sub.color; } // 自定义文字颜色（角色名与对白同色）
    if (b.type === 'perf' && b.live) {
      const badge = document.createElement('div');
      badge.className = 'pd-live';
      badge.textContent = '临场…';
      d.appendChild(badge);
      requestLiveLine(b, ln, badge);
    }
    fore.classList.add('dlg-fore'); // 对白幕：fore 全屏透明点击层
    fore.appendChild(d);
  }
  frame.appendChild(fore);
  // 场景文字：纯文字无框，可自由拖拽位置（x/y 播放区中心点百分比），字号全局统一、颜色自定义；内容留空则不显示
  if (b.type === 'scene' && (b.content || '').trim()) {
    const sub = b.subtitle || {};
    const sz = getGlobalSubSize();
    const st = document.createElement('div');
    st.className = 'play-scene-text';
    st.textContent = b.content;
    st.style.left = (sub.x != null ? sub.x : 50) + '%';
    st.style.top = (sub.y != null ? sub.y : 82) + '%';
    st.style.transform = 'translate(-50%,-50%)';
    st.style.fontSize = sz + 'px';
    if (sub.color) st.style.color = sub.color; // 自定义场景文字颜色
    makeTextDraggable(st, b);
    frame.appendChild(st);
  }
  body.appendChild(frame);
  $('#playPrev').disabled = playIdx === 0;
  if (b && b.terminal) {
    $('#playNext').disabled = false;
    $('#playNext').textContent = '结束 ✓';
  } else {
    $('#playNext').disabled = playIdx >= playFlat.length - 1;
    $('#playNext').textContent = '下一条 →';
  }
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
function playNext() {
  const cur = playFlat[playIdx];
  if (cur && cur.terminal) {
    stopPlay();
    toast('到此结束');
    return;
  }
  if (playIdx < playFlat.length - 1) { playIdx++; renderPlay(); }
}
function playPrev() { if (playIdx > 0) { playIdx--; renderPlay(); } }

/** 选项跳转：next=下一块；end=结束；ch:章节id=该章第一块；否则按积木 id 定位 */
function jumpPlayTo(jump) {
  const j = String(jump || 'next');
  if (j === 'end') {
    stopPlay();
    toast('到此结束');
    return;
  }
  if (j === 'next') {
    if (playIdx < playFlat.length - 1) {
      playIdx++;
      renderPlay();
    } else {
      stopPlay();
      toast('到此结束');
    }
    return;
  }
  let i = -1;
  if (j.startsWith('ch:')) {
    const cid = j.slice(3);
    i = playFlat.findIndex(x => x.chapterId === cid);
  } else {
    i = playFlat.findIndex(x => x.id === j);
  }
  if (i < 0) {
    toast('跳转目标已不存在，改为下一块', true);
    if (playIdx < playFlat.length - 1) { playIdx++; renderPlay(); }
    else { stopPlay(); }
    return;
  }
  playIdx = i;
  renderPlay();
}

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
  const logicBtn = $('#logicBtn');
  if (logicBtn) logicBtn.addEventListener('click', openLogicEditor);
  const mapBtn = $('#mapBtn');
  if (mapBtn) mapBtn.addEventListener('click', openStoryMap);
  const mapExit = $('#mapExit');
  if (mapExit) mapExit.addEventListener('click', () => { const o = $('#mapOverlay'); if (o) o.classList.add('hidden'); });
  const stageBgBtn = $('#stageBgBtn');
  if (stageBgBtn) stageBgBtn.addEventListener('click', stagePickBackground);
  const stageFigBtn = $('#stageFigBtn');
  if (stageFigBtn) stageFigBtn.addEventListener('click', stagePickFigure);
  const stageClearFigBtn = $('#stageClearFigBtn');
  if (stageClearFigBtn) stageClearFigBtn.addEventListener('click', stageClearFigure);
  const stageScaleDown = $('#stageScaleDown');
  if (stageScaleDown) stageScaleDown.addEventListener('click', () => stageScaleFigure(-0.1));
  const stageScaleUp = $('#stageScaleUp');
  if (stageScaleUp) stageScaleUp.addEventListener('click', () => stageScaleFigure(0.1));
  const stageTransSel = $('#stageTransSel');
  if (stageTransSel) stageTransSel.addEventListener('change', () => stageSetTransition(stageTransSel.value));
  const assetsBtn = $('#assetsBtn');
  if (assetsBtn) assetsBtn.addEventListener('click', () => openAssetLibrary(null));
  $('#addBlockBtn').addEventListener('click', openAddPicker);
  $('#playBtn').addEventListener('click', startPlay);
  const playInline = $('#playBtnInline');
  if (playInline) playInline.addEventListener('click', startPlay);
  // 底部芯片：一键加对白/场景/选项/战斗/卡牌关
  document.querySelectorAll('#addChipBar [data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.add;
      if (t === 'dialogue' || t === 'scene' || t === 'choice' || t === 'perf' || t === 'battle' || t === 'rogue') addBlock(t);
    });
  });
  $('#playExit').addEventListener('click', stopPlay);
  const playSaveBtn = $('#playSaveBtn');
  if (playSaveBtn) playSaveBtn.addEventListener('click', () => openPlaySaveModal('save'));
  const playLoadBtn = $('#playLoadBtn');
  if (playLoadBtn) playLoadBtn.addEventListener('click', () => openPlaySaveModal('load'));
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
  // 新建作品：作品类型（互动小说 / 卡牌RPG）；选卡牌RPG 时显示「一键生成示例」按钮
  function bindKindCards(sel) {
  document.querySelectorAll(sel).forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.kind;
      createKind = (k === 'card_rpg' || k === 'gacha_rogue') ? k : 'story';
      document.querySelectorAll('#createKindRow .kind-card, #createKindMore .kind-card').forEach(x => x.classList.toggle('active', x === btn));
      if (createKind === 'gacha_rogue') {
        createOrientation = 'portrait';
        document.querySelectorAll('#createOrient .orient-card').forEach(x => x.classList.toggle('active', x.dataset.orient === 'portrait'));
      }
      const demoBtn = $('#rpgDemoBtn');
      if (demoBtn) demoBtn.classList.toggle('hidden', createKind !== 'card_rpg');
      const rogueDemo = $('#rogueDemoBtn');
      if (rogueDemo) rogueDemo.classList.toggle('hidden', createKind !== 'gacha_rogue');
    });
  });
}
  bindKindCards('#createKindRow .kind-card');
  bindKindCards('#createKindMore .kind-card');
  // 编辑器：卡牌RPG 配置区（卡牌库 / 英雄 / 敌人）
  $('#rpgCardsBtn').addEventListener('click', openRpgCardsEditor);
  $('#rpgHeroBtn').addEventListener('click', openRpgHeroEditor);
  $('#rpgEnemiesBtn').addEventListener('click', openRpgEnemiesEditor);
  $('#cardStudioBtn').addEventListener('click', () => { const s = story(); if (s) openCardStudio(s, cardStudioApi()); });
  $('#cardFillBtn').addEventListener('click', fillCurrentCardPack);
  $('#rpgDemoBtn').addEventListener('click', generateRpgDemo);
  $('#rogueDemoBtn').addEventListener('click', generateRogueDemo);
  $('#samplePackBtn').addEventListener('click', openSamplePicker);
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
  // 启动云端同步：拉取 /api/stories 并合并本地旧作品（登录后自动迁移上传）
  syncWithServer();
}

// ---------- 对外测试 API ----------
window.StoryEditor = {
  ready: true,
  list: () => stories.map(s => ({
    id: s.id, title: s.title, orientation: s.orientation, imgQuality: s.imgQuality, cast: s.cast || {},
    chapters: s.chapters.map(c => ({ id: c.id, title: c.title, bgm: c.bgm || null, blocks: c.blocks.map(b => ({ ...b })) })),
  })),
  create: (title, orientation, kind) => {
    $('#newTitle').value = title;
    if (orientation === 'portrait' || orientation === 'landscape') {
      createOrientation = orientation;
      // API 创建路径同步新建区选择卡高亮，与点击行为一致
      document.querySelectorAll('#createOrient .orient-card').forEach(x => x.classList.toggle('active', x.dataset.orient === orientation));
    }
    if (kind === 'card_rpg' || kind === 'story' || kind === 'gacha_rogue') {
      createKind = kind;
      document.querySelectorAll('#createKindRow .kind-card').forEach(x => x.classList.toggle('active', x.dataset.kind === kind));
      const demoBtn = $('#rpgDemoBtn');
      if (demoBtn) demoBtn.classList.toggle('hidden', kind !== 'card_rpg');
      const rogueDemo = $('#rogueDemoBtn');
      if (rogueDemo) rogueDemo.classList.toggle('hidden', kind !== 'gacha_rogue');
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
    else {
      b.subtitle = { on: subtitle.on !== false }; // 字号全局统一（默认 27px），不再存 size 字段
      if (subtitle.color) b.subtitle.color = subtitle.color;
      if (subtitle.x != null) b.subtitle.x = subtitle.x;
      if (subtitle.y != null) b.subtitle.y = subtitle.y;
    }
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
  openStoryMap,
  selectBlock,
  renderStagePreview,
  analyzeStoryGraph: () => analyzeStoryGraph(story()),
  visitVarOf,
  listPlaySlots: () => { const s = story(); return s ? listPlaySlots(s.id) : []; },
  savePlaySlot: (slot) => {
    const s = story();
    if (!s || battle) return false;
    return writePlaySlot(s.id, Number(slot) || 0, {
      slot: Number(slot) || 0,
      at: Date.now(),
      idx: playIdx,
      state: { ...playState },
      label: playSaveLabel(),
    });
  },
  loadPlaySlot: (slot) => {
    const s = story();
    if (!s) return false;
    const hit = listPlaySlots(s.id)[Number(slot) || 0];
    if (!hit) return false;
    return applyPlaySave(hit);
  },
  play: () => ({
    idx: playIdx, total: playFlat.length,
    orientation: (story() || {}).orientation || 'landscape',
    imgQuality: (story() || {}).imgQuality || 'standard',
    state: { ...playState },
    current: playFlat[playIdx] ? {
      type: playFlat[playIdx].type, speaker: playFlat[playIdx].speaker || '', content: playFlat[playIdx].content,
      visit: visitVarOf(playFlat[playIdx].id),
      choices: playFlat[playIdx].type === 'choice'
        ? visibleChoices(playFlat[playIdx]).map(c => ({ id: c.id, label: c.label, jump: c.jump, require: c.require, effect: c.effect }))
        : undefined,
      media: playFlat[playIdx].media || null, audio: playFlat[playIdx].audio || null,
      sfxList: (playFlat[playIdx].sfxList || []).map(x => ({ ...x })),
      bgmOverride: playFlat[playIdx].bgmOverride || null,
      voice: voicePlanOf(playFlat[playIdx]),
      subtitle: playFlat[playIdx].subtitle || null, chapterId: playFlat[playIdx].chapterId || null, bgm: playFlat[playIdx].bgm || null,
    } : null,
  }),
  playNext,
  playPrev,
  jumpPlayTo,
  playPick: (i) => {
    const cur = playFlat[playIdx];
    if (!cur || cur.type !== 'choice') return false;
    const shown = visibleChoices(cur);
    const c = shown[i];
    if (!c) return false;
    applyEffects(c.effect);
    jumpPlayTo(c.jump || 'next');
    return true;
  },
  openChoiceEditor,
  openLogicEditor,
  openPerfEditor,
  openCastEditor,
  openAssetLibrary,
  openBattleEditor,
  openRpgCardsEditor,
  openRpgHeroEditor,
  openRpgEnemiesEditor,
  // 一键生成卡牌RPG 示例（demo 数据纯构造，可直接校验结构；生成动作走 generateRpgDemo 弹窗流程）
  rpgDemo: (heroName) => buildRpgDemoData(heroName || '勇者'),
  generateRpgDemo,
  generateRogueDemo,
  openSamplePicker,
  createSampleStory,
  rogueDemo: (mode) => buildRogueDemoData(mode || 'idle'),
  sample: (id) => buildSampleWork(id),
  setKindById: (id, kind) => {
    const s = stories.find(x => x.id === id);
    if (!s || (kind !== 'story' && kind !== 'card_rpg' && kind !== 'gacha_rogue')) return false;
    s.kind = kind;
    if (kind === 'card_rpg' && !s.rpg) s.rpg = { hero: { name: '勇者', maxHp: 30, attack: 8 }, cards: [], enemies: [] };
    if (kind === 'gacha_rogue' && !s.rogue) s.rogue = emptyRogue();
    if (s.miniGame) delete s.miniGame;
    persist(); renderEditor(); renderLibrary(); return true;
  },
  rpg: () => (story() ? { kind: story().kind, rpg: story().rpg || null } : null),
  battleState: () => battle ? {
    phase: battle.phase, round: battle.round,
    party: battle.party.map(m => ({ name: m.name, hp: m.hp, maxHp: m.maxHp, attack: m.attack, hero: !!m.hero })),
    enemyHp: battle.enemies.map(e => e.hp),
  } : null,
  startBattle,
  battleStep,
  battleSkip,
  previewBattle,
  openBlockBgmEditor,
  openTimelineEditor,
  normalizeStories,
  localStorage: () => { try { return localStorage.getItem(SAVE_KEY); } catch (e) { return null; } },
};

init();


