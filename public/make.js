// make.js — HYOOL 主创作应用（视觉小说：图片镜 + 视频镜 + 卡牌战）
import { $, $$, toast } from '/workspace/js/ui.js';
import { purgeLocalStory } from '/story-local-cache.js';
import {
  normalizeRogue,
  applyStarterPack,
  startRogueRun,
  stopRogueRun,
  openCardStudio,
  CARD_MODES,
} from '/story-rogue.js?v=20260828vn1';

const PAGE = '/make.html';
const WORK_KIND = 'story';

const TOKEN_KEY = 'hyool_token';
const DEFAULT_SPEAKER = '角色名';
const MAX_FILE = 5 * 1024 * 1024;
const TYPE_LABEL = { scene: '场景', dialogue: '对白', choice: '选项', rogue: '卡牌战' };
const KIND_LABEL = {
  story: '视觉小说',
  interactive_video: '视觉小说',
  comic: '漫画',
  gacha_rogue: '卡牌',
  card_rpg: '卡牌RPG',
  h5_game: 'H5',
};
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
const VIDEO_MODES = {
  background: { label: '背景循环', hint: '静音循环，适合 Galgame 动态背景' },
  clip: { label: '视频镜', hint: '保留原声，播完自动进下一镜（点击可跳过）' },
};

let loggedIn = false;
let works = [];
let work = null;
let playReturnTo = null;
let selectedId = null;
/** 正在编辑选项下的子镜头 { choiceBlockId, choiceId, blockId } */
let editBranch = null;
let createOrient = 'landscape';
let createKind = 'story';
let createStep = 1;
let uploadTimer = null;
let saveLabel = '';

let playing = false;
let playMainFlat = [];
let playMainIdx = 0;
/** 选项子镜头播放栈；null 表示在主线 */
let playBranchFlat = null;
let playBranchIdx = 0;
let playBranchEnd = 'main';
let playChoiceBlockId = null;
let playTakenChoiceId = null;
let playResumeMainIdx = 0;
/** 当前选项未走到的支线入口（block id），顺序播放时自动跳过 */
let playSiblingJumps = null;
let playAudio = null;
let playBgm = null;
let playBgmUrl = null;
let playBgmChapter = null;
/** 试玩剧情变量 / 物品数量（开局从 work.logic.state 拷贝） */
let playState = {};
/** 本局已结算过效果的选项 id，防止后退/重选反复获得物品 */
let playEffectGranted = new Set();

const ITEM_PRESETS = [
  { id: 'key', label: '钥匙' },
  { id: 'herb', label: '草药' },
  { id: 'letter', label: '信件' },
  { id: 'gold', label: '银两' },
  { id: 'token', label: '令牌' },
  { id: 'bond', label: '好感' },
  { id: 'battle_win', label: '战斗胜利标记' },
];
const ITEM_LABEL = Object.fromEntries(ITEM_PRESETS.map((x) => [x.id, x.label]));
const REQUIRE_OPS = ['>=', '<=', '==', '>', '<', '!='];
const EFFECT_OPS = ['+', '-', '='];

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
  if (editBranch) {
    const ch = blocks().find((b) => b.id === editBranch.choiceBlockId);
    const opt = (ch?.choices || []).find((c) => c.id === editBranch.choiceId);
    if (editBranch.isEndShot) return opt?.endShot || null;
    return (opt?.branch || []).find((b) => b.id === editBranch.blockId) || null;
  }
  return blocks().find((b) => b.id === selectedId) || null;
}

function parentChoiceBlock() {
  if (!editBranch) return null;
  return blocks().find((b) => b.id === editBranch.choiceBlockId) || null;
}

function setSave(st) {
  saveLabel = st;
  const el = $('#mkSave');
  if (!el) return;
  el.textContent = st === 'saving' ? '保存中…' : st === 'ok' ? '已保存 ✓' : st === 'err' ? '保存失败' : '';
  el.style.color = st === 'err' ? 'var(--bad)' : st === 'ok' ? 'var(--good)' : 'var(--muted)';
}

function isStoryKind(k) {
  return !k || k === 'story' || k === 'interactive_video';
}

function videoMode(media) {
  if (!media || media.type !== 'video') return null;
  return media.videoMode === 'clip' ? 'clip' : 'background';
}

function ensureVideoMode(media) {
  if (!media || media.type !== 'video') return;
  if (media.videoMode !== 'clip' && media.videoMode !== 'background') {
    media.videoMode = 'background';
  }
}

function normalizeWork(s) {
  if (!s || typeof s !== 'object') return null;
  if (!isStoryKind(s.kind)) return s;
  const wasVideoKind = s.kind === 'interactive_video';
  if (wasVideoKind) s.kind = WORK_KIND;
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
      if (b.type === 'choice') normalizeChoice(b, c.blocks);
      if (b.type === 'rogue') {
        if (typeof b.content !== 'string') b.content = '遭遇战';
        if (typeof b.winContent !== 'string') b.winContent = '';
        if (typeof b.loseContent !== 'string') b.loseContent = '';
      }
      if (b.media?.type === 'video') {
        ensureVideoMode(b.media);
        if (wasVideoKind) b.media.videoMode = 'clip';
      }
    });
  });
  ensureWorkLogic(s);
  if (s.rogue) s.rogue = normalizeRogue(s.rogue);
  s.kind = WORK_KIND;
  return s;
}

function normalizeVarName(name) {
  let s = String(name || '').trim().toLowerCase();
  const cnMap = {
    '钥匙': 'key', '草药': 'herb', '信件': 'letter', '银两': 'gold', '令牌': 'token', '好感': 'bond',
    '金钱': 'gold', '金币': 'gold',
  };
  if (cnMap[String(name || '').trim()]) return cnMap[String(name || '').trim()];
  s = s.replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
  if (!/^[a-z][a-z0-9_]{0,23}$/.test(s)) return '';
  return s;
}

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

function ensureWorkLogic(s) {
  const w = s || work;
  if (!w) return;
  if (!w.logic || typeof w.logic !== 'object') w.logic = { state: {} };
  if (!w.logic.state || typeof w.logic.state !== 'object') w.logic.state = {};
  const state = {};
  Object.keys(w.logic.state).forEach((k) => {
    const key = normalizeVarName(k);
    if (!key) return;
    const n = Number(w.logic.state[k]);
    state[key] = Number.isFinite(n) ? Math.max(-9999, Math.min(9999, Math.round(n))) : 0;
  });
  // 从选项里登记用到的变量，缺省 0
  (w.chapters || []).forEach((ch) => {
    (ch.blocks || []).forEach((b) => {
      if (b.type !== 'choice') return;
      (b.choices || []).forEach((c) => {
        [...(c.effect || []), ...(c.require || [])].forEach((row) => {
          const key = normalizeVarName(row?.var);
          if (key && state[key] == null) state[key] = 0;
        });
      });
    });
  });
  if (state.battle_win == null) state.battle_win = 0;
  w.logic.state = state;
}

/** 视觉小说内嵌卡牌数据（与 make-card / story-rogue 同一套） */
function ensureWorkRogue(opts = {}) {
  if (!work) return null;
  const forceStarter = !!opts.forceStarter;
  work.rogue = normalizeRogue(work.rogue);
  // VN 内嵌默认用「修仙自动战」：打完可回到剧情（idle 会停在主城）
  if (!work.rogue.mode || (opts.preferQueue && work.rogue.mode === 'idle' && !work.rogue.roster?.length)) {
    work.rogue.mode = 'queue';
  }
  if (forceStarter || !work.rogue.roster?.length) {
    applyStarterPack(work, work.rogue.mode === 'idle' ? 'queue' : work.rogue.mode);
    work.rogue = normalizeRogue(work.rogue);
    if (work.rogue.mode === 'idle') work.rogue.mode = 'queue';
  }
  return work.rogue;
}

function openMakeCardStudio() {
  if (!work) return;
  ensureWorkRogue({ preferQueue: true });
  openCardStudio(work, {
    persist: () => { ensureWorkLogic(); scheduleSave(); },
    openModal: makeOpenModal,
    toast,
  });
}

function makeOpenModal(title, buildBody) {
  let modal = $('#modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal';
    modal.className = 'modal hidden';
    modal.innerHTML =
      '<div class="modal-card modal-wide">' +
      '<div class="modal-title" id="modalTitle"></div>' +
      '<div class="modal-body" id="modalBody"></div>' +
      '<div class="modal-actions"><button type="button" class="btn ghost" id="modalCancel">关闭</button></div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.querySelector('#modalCancel').addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  }
  $('#modalTitle').textContent = title || '卡牌工作室';
  const body = $('#modalBody');
  body.innerHTML = '';
  buildBody(body);
  modal.classList.remove('hidden');
}

function itemLabel(id) {
  const k = normalizeVarName(id);
  return ITEM_LABEL[k] || k || id;
}

function resetPlayState() {
  ensureWorkLogic();
  playState = {};
  const base = work?.logic?.state || {};
  Object.keys(base).forEach((k) => {
    playState[k] = Number(base[k]) || 0;
  });
}

function getPlayVar(name) {
  const k = normalizeVarName(name);
  if (!k) return 0;
  const n = Number(playState[k]);
  return Number.isFinite(n) ? n : 0;
}

function evalRequire(list) {
  const reqs = normalizeCondList(list, REQUIRE_OPS);
  if (!reqs.length) return true;
  return reqs.every((r) => {
    const cur = getPlayVar(r.var);
    if (r.op === '>=') return cur >= r.val;
    if (r.op === '<=') return cur <= r.val;
    if (r.op === '>') return cur > r.val;
    if (r.op === '<') return cur < r.val;
    if (r.op === '!=') return cur !== r.val;
    return cur === r.val;
  });
}

function applyEffects(list) {
  const effects = normalizeCondList(list, EFFECT_OPS);
  const gained = [];
  effects.forEach((e) => {
    const cur = getPlayVar(e.var);
    let next = cur;
    if (e.op === '+') next = cur + e.val;
    else if (e.op === '-') next = cur - e.val;
    else next = e.val;
    playState[e.var] = Math.max(-9999, Math.min(9999, Math.round(next)));
    if (e.op === '+' && e.val > 0) gained.push('获得 ' + itemLabel(e.var) + (e.val > 1 ? ' ×' + e.val : ''));
    else if (e.op === '-' && e.val > 0) gained.push('失去 ' + itemLabel(e.var) + (e.val > 1 ? ' ×' + e.val : ''));
    else if (e.op === '=' && e.val > 0) gained.push('获得 ' + itemLabel(e.var) + (e.val > 1 ? ' ×' + e.val : ''));
  });
  return gained;
}

/** 同一选项本局只结算一次物品效果 */
function grantChoiceEffectsOnce(choiceBlockId, option) {
  const key = String(choiceBlockId || '') + ':' + String(option?.id || '');
  if (!option?.id || playEffectGranted.has(key)) return [];
  playEffectGranted.add(key);
  return applyEffects(option.effect);
}

function formatPlayInventory() {
  const keys = Object.keys(playState).filter((k) => !String(k).startsWith('v_') && getPlayVar(k) !== 0);
  if (!keys.length) return '背包：空';
  return '背包：' + keys.map((k) => itemLabel(k) + '×' + getPlayVar(k)).join(' · ');
}

function updatePlayInventoryHud() {
  const el = $('#playInv');
  if (!el) return;
  el.textContent = formatPlayInventory();
}

function fillChoiceButton(btnEl, c) {
  btnEl.textContent = '';
  const lab = document.createElement('span');
  lab.className = 'pc-opt-lab';
  lab.textContent = c.label || '选项';
  btnEl.appendChild(lab);
}

function mountChoicePreview(stage, b) {
  const box = document.createElement('div');
  box.className = 'play-choice mk-choice-preview';
  box.innerHTML = '<div class="pc-prompt">' + escapeHtml(b.content || '请选择：') + '</div>';
  const opts = document.createElement('div');
  opts.className = 'pc-opts';
  (b.choices || []).forEach((c) => {
    const btnEl = document.createElement('div');
    btnEl.className = 'pc-opt';
    fillChoiceButton(btnEl, c);
    opts.appendChild(btnEl);
  });
  box.appendChild(opts);
  stage.appendChild(box);
}

function normalizeBranchBlock(bl) {
  if (!bl || typeof bl !== 'object') return { id: uid(), type: 'dialogue', speaker: DEFAULT_SPEAKER, content: '' };
  if (!bl.id) bl.id = uid();
  if (bl.type !== 'scene' && bl.type !== 'dialogue') bl.type = 'dialogue';
  if (bl.type === 'dialogue' && !bl.speaker) bl.speaker = DEFAULT_SPEAKER;
  return bl;
}

function normalizeChoice(b, mainBlocks) {
  if (!Array.isArray(b.choices) || !b.choices.length) {
    b.choices = [
      { id: uid(), label: '继续', jump: 'next', branch: [], branchEnd: 'main', require: [], effect: [] },
      { id: uid(), label: '结束', jump: 'end', branch: [], branchEnd: 'shot', require: [], effect: [] },
    ];
    return;
  }
  b.choices.forEach((c) => {
    if (!c.id) c.id = uid();
    c.label = String(c.label || '选项').slice(0, 40);
    if (!c.jump) c.jump = 'next';
    c.branch = Array.isArray(c.branch) ? c.branch.map(normalizeBranchBlock) : [];
    if (c.endShot) c.endShot = normalizeBranchBlock(c.endShot);
    c.require = normalizeCondList(c.require, REQUIRE_OPS);
    c.effect = normalizeCondList(c.effect, EFFECT_OPS);

    if (c.branchEndJump && !c.endShot && Array.isArray(mainBlocks)) {
      const src = mainBlocks.find((x) => x.id === c.branchEndJump);
      if (src) {
        c.endShot = normalizeBranchBlock({
          id: uid(),
          type: src.type,
          content: src.content,
          speaker: src.speaker,
          media: src.media ? { ...src.media } : undefined,
        });
      }
      delete c.branchEndJump;
      c.branchEnd = 'shot';
    }
    if (c.branchEnd && String(c.branchEnd).startsWith('b_')) {
      delete c.branchEnd;
    }
    if (c.branchEnd === 'end') c.branchEnd = 'shot';
    if (c.endShot && c.branchEnd !== 'choice') c.branchEnd = 'shot';
    if (c.branchEnd !== 'main' && c.branchEnd !== 'choice' && c.branchEnd !== 'shot') {
      c.branchEnd = (c.branch.length || c.endShot) ? 'main' : undefined;
    }
    if (c.branchEnd !== 'shot') delete c.branchEndJump;
    else delete c.branchEndJump;
  });
}

function resolveOptionBranchEnd(c) {
  if (!c) return 'main';
  let end = c.branchEnd || 'main';
  if (end === 'end') end = 'shot';
  if (c.endShot && end !== 'choice') end = 'shot';
  return end;
}

function buildBranchPlayFlat(c) {
  const flat = [...(c.branch || [])];
  if (resolveOptionBranchEnd(c) === 'shot' && c.endShot) flat.push(c.endShot);
  return flat;
}

function ensureEndShot(c) {
  if (!c.endShot) {
    c.endShot = { id: uid(), type: 'scene', content: '失败结局……' };
  }
  c.branchEnd = 'shot';
  return c.endShot;
}

function optionUsesBranch(c) {
  if (Array.isArray(c.branch) && c.branch.length > 0) return true;
  if (resolveOptionBranchEnd(c) === 'shot' && c.endShot) return true;
  return false;
}

function shotPreview(b) {
  if (!b) return '';
  if (b.type === 'dialogue') return (b.speaker + '：' + (b.content || '')).slice(0, 28);
  return (b.content || TYPE_LABEL[b.type] || '').slice(0, 28);
}

function jumpTargetOptions(fromBlockId) {
  const opts = [
    { value: 'next', label: '下一镜（顺序）' },
    { value: 'end', label: '结束' },
  ];
  blocks().forEach((b, i) => {
    if (b.id === fromBlockId) return;
    opts.push({
      value: b.id,
      label: '第 ' + (i + 1) + ' 镜 · ' + (TYPE_LABEL[b.type] || b.type) + ' · ' + shotPreview(b),
    });
  });
  return opts;
}

function makeJumpSelect(value, fromBlockId, onChange) {
  const sel = document.createElement('select');
  jumpTargetOptions(fromBlockId).forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if ((value || 'next') === o.value) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function chapter() {
  return work?.chapters?.[0] || null;
}

function chapterForBlock(b) {
  for (const ch of work?.chapters || []) {
    if ((ch.blocks || []).some((x) => x.id === b.id)) return ch;
    for (const blk of ch.blocks || []) {
      if (blk.type !== 'choice') continue;
      for (const c of blk.choices || []) {
        if ((c.branch || []).some((x) => x.id === b.id)) return ch;
        if (c.endShot?.id === b.id) return ch;
      }
    }
  }
  return chapter();
}

function playCurrentFlat() {
  return playBranchFlat || playMainFlat;
}

function playCurrentIdx() {
  return playBranchFlat ? playBranchIdx : playMainIdx;
}

function currentPlayBlock() {
  const flat = playCurrentFlat();
  const idx = playCurrentIdx();
  return flat[idx];
}

function redirectOtherKind(w) {
  const kind = w.kind || 'story';
  if (isStoryKind(kind)) return false;
  const q = new URLSearchParams(location.search);
  const play = q.get('play') === '1' ? '&play=1' : '';
  if (kind === 'h5_game') {
    location.replace('/h5-game.html#edit=' + encodeURIComponent(w.id));
    return true;
  }
  if (kind === 'gacha_rogue' || kind === 'card_rpg') {
    location.replace('/make-card.html?story=' + encodeURIComponent(w.id) + play);
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
  return String(sub.label || '').trim();
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
  const b1 = { id: uid(), type: 'scene', content: '某个寻常的下课铃后，走廊里只剩下你的脚步声。' };
  const b2 = { id: uid(), type: 'dialogue', speaker: '你', content: '……今天，好像有什么不一样。' };
  const b6 = { id: uid(), type: 'scene', content: '雨夜，你独自走在回家的路上。' };
  const b3 = {
    id: uid(),
    type: 'choice',
    content: '你要怎么做？',
    choices: [
      {
        id: uid(),
        label: '推开教室的门',
        jump: 'next',
        branchEnd: 'main',
        branch: [
          { id: uid(), type: 'dialogue', speaker: '你', content: '推开门，教室里空无一人，只有窗外雨声。' },
        ],
      },
      {
        id: uid(),
        label: '先回家再说',
        jump: 'end',
        branchEnd: 'shot',
        branch: [
          { id: uid(), type: 'dialogue', speaker: '你', content: '……还是回去吧。' },
        ],
        endShot: { id: uid(), type: 'scene', content: '你错过了时机。故事在此告一段落。' },
      },
    ],
  };
  normalizeChoice(b3, [b1, b2, b3, b6]);
  return [b1, b2, b3, b6];
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
  const prevKind = d.story.kind;
  const s = normalizeWork({ ...d.story });
  if (prevKind === 'interactive_video') s._needsKindMigrate = true;
  return s;
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
  ensureWorkLogic();
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

async function createWork(title, orientation, kind = WORK_KIND) {
  const res = await fetch('/api/stories', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ title, orientation, imgQuality: 'standard', kind }),
  });
  const d = await res.json();
  if (!d.success) throw new Error(d.error || '创建失败');
  const s = normalizeWork({ ...d.story });
  if (kind === WORK_KIND || kind === 'story' || kind === 'interactive_video') {
    if (!s.chapters?.[0]) {
      s.chapters = [{ id: uid(), title: '第一章', blocks: [] }];
    }
    s.chapters[0].blocks = starterBlocks();
    await fetch('/api/stories/' + encodeURIComponent(s.id), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ data: s }),
    });
  }
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
    const d = await res.json().catch(() => ({}));
    if (!d.success) {
      if (res.status === 404) purgeLocalStory(id);
      throw new Error(d.error || (res.status === 404 ? '云端已不存在，已从本地清除' : '删除失败'));
    }
    purgeLocalStory(id);
    toast('已删除');
    await showHome();
  } catch (e) {
    toast(e.message || '删除失败', true);
    if (String(e.message || '').includes('本地清除')) await showHome();
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

async function uploadAudioFile(file) {
  const mime = file.type || '';
  if (!/^audio\//.test(mime)) { toast('请选 MP3 / WAV / M4A / OGG 音频', true); return null; }
  if (file.size > MAX_FILE) { toast('音频不能超过 5MB', true); return null; }
  if (!loggedIn) { toast('请先登录再上传', true); return null; }
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', credentials: 'include', headers: authHeaders(), body: fd });
    const d = await res.json();
    if (!d.success || !d.url) { toast(d.error || '上传失败', true); return null; }
    return { url: d.url, type: 'audio' };
  } catch (e) {
    toast('上传失败', true);
    return null;
  }
}

function pickAudio(onDone) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/ogg';
  inp.addEventListener('change', async () => {
    const f = inp.files?.[0];
    if (!f) return;
    toast('上传中…');
    const audio = await uploadAudioFile(f);
    if (audio) onDone(audio);
  });
  inp.click();
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
    au.loop = true;
    au.preload = 'auto';
    au.volume = Math.min(1, Math.max(0, Number(bgm.volume) || 0.6));
    au.play().catch(() => {});
    playBgm = au;
    playBgmUrl = bgm.url;
  } else {
    playBgmUrl = null;
  }
  playBgmChapter = chapterId;
}

function resolveBlockVoice(b) {
  if (b.audio && b.audio.url) return { url: b.audio.url, volume: b.audio.volume };
  return null;
}

function playVoiceForBlock(b) {
  stopPlayAudio();
  const v = resolveBlockVoice(b);
  if (!v || !v.url) return;
  const au = new Audio(v.url);
  au.preload = 'auto';
  au.volume = Math.min(1, Math.max(0, Number(v.volume) || 1));
  au.play().catch(() => {});
  playAudio = au;
}

// ---------- 视图 ----------
async function showHome() {
  work = null;
  selectedId = null;
  editBranch = null;
  history.replaceState(null, '', PAGE);
  $('#viewHome').classList.remove('hidden');
  $('#viewEdit').classList.remove('show');
  $('#mkPlayBtn').style.display = 'none';
  $('#mkPubBtn').style.display = 'none';
  $('#mkDelBtn').style.display = 'none';
  $('#mkAddBtnTop').style.display = 'none';
  $('#mkBrand').textContent = '创建作品';
  $('#mkBrandSub').textContent = 'MAKE';
  $('#mkBack').href = '/';
  $('#mkBack').textContent = '← 首页';
  try {
    works = await loadWorksList();
  } catch (e) {
    if (e.message === 'login') {
      $('#mkLogin').classList.remove('hidden');
      $('#mkApp').classList.add('hidden');
      return;
    }
  }
  renderHome();
}

function showEdit() {
  $('#viewHome').classList.add('hidden');
  $('#viewEdit').classList.add('show');
  $('#mkPlayBtn').style.display = '';
  $('#mkPubBtn').style.display = '';
  $('#mkDelBtn').style.display = '';
  $('#mkAddBtnTop').style.display = '';
  $('#mkBrand').textContent = work?.title || '未命名';
  $('#mkBrandSub').textContent = '编辑中';
  $('#mkBack').href = PAGE;
  $('#mkBack').textContent = '← 作品列表';
  $('#mkPubBtn').textContent = work?.status === 'published' ? '下架' : '发布';
  renderEdit();
  history.replaceState(null, '', PAGE + '?story=' + encodeURIComponent(work.id));
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
  const mine = works.filter((w) => isStoryKind(w.kind));
  const others = works.filter((w) => !isStoryKind(w.kind));
  const all = [...mine, ...others];
  $('#mkEmpty').classList.toggle('hidden', mine.length > 0);
  all.forEach((w) => grid.appendChild(homeCard(w)));
}

function kindLabel(kind) {
  return KIND_LABEL[kind] || kind || '作品';
}

function homeCard(w) {
  const card = document.createElement('div');
  card.className = 'mk-card';
  const cover = w.cover_image
    ? '<img src="' + escapeHtml(w.cover_image) + '" alt="">'
    : (w.kind === 'h5_game' ? '🎮' : '📖');
  const pub = w.status === 'published';
  card.innerHTML =
    '<div class="row">' +
      '<div class="thumb">' + cover + '</div>' +
      '<div class="info">' +
        '<div class="title">' + escapeHtml(w.title) + '</div>' +
        '<div class="meta">' + kindLabel(w.kind) + ' · ' + (pub ? '已发布' : '草稿') + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="ops">' +
      '<button type="button" class="btn primary play-btn">▶ 试玩</button>' +
      '<button type="button" class="btn edit-btn">编辑</button>' +
      '<button type="button" class="btn danger del-btn">删除</button>' +
    '</div>';
  card.querySelector('.edit-btn').addEventListener('click', (e) => { e.stopPropagation(); openWork(w.id, false); });
  card.querySelector('.play-btn').addEventListener('click', (e) => { e.stopPropagation(); openWork(w.id, true); });
  card.querySelector('.del-btn').addEventListener('click', (e) => { e.stopPropagation(); deleteWorkById(w.id, w.title); });
  card.addEventListener('click', () => openWork(w.id, false));
  return card;
}

function safeReturnPath(raw) {
  if (!raw) return null;
  const s = String(raw);
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('://')) return null;
  return s;
}

async function openWork(id, play) {
  try {
    const w = await loadWork(id);
    if (redirectOtherKind(w)) return;
    work = w;
    selectedId = blocks()[0]?.id || null;
    editBranch = null;
    const returnTo = safeReturnPath(new URLSearchParams(location.search).get('from'));
    if (play && returnTo) {
      playReturnTo = returnTo;
      $('#viewHome')?.classList.add('hidden');
      $('#viewEdit')?.classList.remove('show');
      const top = document.querySelector('.topbar');
      if (top) top.style.display = 'none';
      history.replaceState(
        null,
        '',
        PAGE + '?story=' + encodeURIComponent(id) + '&play=1&from=' + encodeURIComponent(returnTo)
      );
      startPlay();
      return;
    }
    showEdit();
    if (work._needsKindMigrate) {
      delete work._needsKindMigrate;
      scheduleSave();
    }
    if (play) startPlay();
  } catch (e) {
    toast(e.message || '打不开作品', true);
  }
}

// ---------- 编辑 ----------
function renderEdit() {
  renderChapterAudio();
  renderShots();
  renderPreview();
  renderPanel();
  updateSteps();
  const stage = $('#mkStage');
  stage.classList.toggle('portrait', work?.orientation === 'portrait');
}

function renderChapterAudio() {
  const el = $('#mkChapterAudio');
  if (!el || !work) return;
  el.innerHTML = '';
  const ch = chapter();
  if (!ch) return;
  const sec = document.createElement('div');
  sec.className = 'mk-panel-inner mk-chapter-audio';
  const lab = document.createElement('label');
  lab.textContent = '章节背景音乐（试玩时循环）';
  sec.appendChild(lab);
  if (ch.bgm?.url) {
    const row = document.createElement('div');
    row.className = 'mk-audio-row';
    row.innerHTML = '<span class="mk-audio-name">🎵 已设 BGM</span>';
    const ops = document.createElement('div');
    ops.className = 'mk-bg-ops';
    const vol = document.createElement('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.value = String(Math.round((Number(ch.bgm.volume) || 0.6) * 100));
    vol.title = '音量';
    vol.style.flex = '1';
    vol.addEventListener('input', () => {
      ch.bgm.volume = Number(vol.value) / 100;
      scheduleSave();
    });
    const replaceBtn = document.createElement('button');
    replaceBtn.type = 'button';
    replaceBtn.className = 'btn';
    replaceBtn.textContent = '更换';
    replaceBtn.addEventListener('click', () => {
      pickAudio((audio) => {
        ch.bgm = { url: audio.url, type: 'audio', volume: ch.bgm?.volume ?? 0.6 };
        scheduleSave();
        renderChapterAudio();
        toast('BGM 已更新');
      });
    });
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn danger';
    rm.textContent = '移除';
    rm.addEventListener('click', () => {
      delete ch.bgm;
      scheduleSave();
      renderChapterAudio();
    });
    ops.append(vol, replaceBtn, rm);
    row.appendChild(ops);
    sec.appendChild(row);
  } else {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mk-bg-btn';
    btn.style.padding = '10px';
    btn.textContent = '🎵 上传 BGM';
    btn.addEventListener('click', () => {
      pickAudio((audio) => {
        ch.bgm = { url: audio.url, type: 'audio', volume: 0.6 };
        scheduleSave();
        renderChapterAudio();
        toast('BGM 已添加');
      });
    });
    sec.appendChild(btn);
  }
  el.appendChild(sec);
}

function renderShots() {
  const list = $('#mkShotsList');
  list.innerHTML = '';
  const bs = blocks();
  $('#mkShotCount').textContent = bs.length ? bs.length + ' 镜' : '';
  let dragFrom = -1;
  bs.forEach((b, i) => {
    const row = document.createElement('div');
    const onMain = b.id === selectedId && (!editBranch || editBranch.choiceBlockId === b.id);
    row.className = 'mk-shot' + (onMain ? ' on' : '');
    row.dataset.i = String(i);
    row.dataset.id = b.id;
    if (b.type === 'choice' && (b.choices || []).some(optionUsesBranch)) row.classList.add('has-branch');
    const preview = b.type === 'dialogue'
      ? (b.speaker + '：' + (b.content || '')).slice(0, 40)
      : (b.content || TYPE_LABEL[b.type] || '').slice(0, 40);
    row.innerHTML =
      '<span class="handle" title="拖动排序">⋮⋮</span>' +
      '<span class="num">' + (i + 1) + '</span>' +
      '<div class="body">' +
        '<div class="type">' + (TYPE_LABEL[b.type] || b.type) + mediaShotTag(b) +
          (b.imagePrompt && String(b.imagePrompt).trim() ? ' · 有提示词' : '') + '</div>' +
        '<div class="txt">' + escapeHtml(preview || '（空）') + '</div>' +
      '</div>';
    row.addEventListener('click', () => { editBranch = null; selectedId = b.id; renderEdit(); });
    const handle = row.querySelector('.handle');
    handle.draggable = true;
    handle.addEventListener('dragstart', (e) => {
      dragFrom = i;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', b.id);
      e.stopPropagation();
    });
    handle.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      dragFrom = -1;
      list.querySelectorAll('.mk-shot.drag-over').forEach((el) => el.classList.remove('drag-over'));
    });
    handle.addEventListener('click', (e) => e.stopPropagation());
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('drag-over');
      const to = Number(row.dataset.i);
      if (dragFrom < 0 || to < 0 || dragFrom === to) return;
      moveBlockTo(dragFrom, to);
    });
    list.appendChild(row);
  });
}

function mediaShotTag(b) {
  if (!b.media?.url) return '';
  if (b.media.type === 'video') {
    return videoMode(b.media) === 'clip' ? ' · 视频镜' : ' · 背景视频';
  }
  return ' · 有图';
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
  if (b.type === 'rogue') {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.innerHTML = '⚔️ 卡牌战<br><span style="font-size:12px;opacity:.85">' +
      escapeHtml((b.content || '试玩时进入自动战斗').slice(0, 48)) + '</span>';
    stage.appendChild(hint);
  } else if (hasCaption(b)) {
    mountCaption(stage, b, true);
  } else if (b.type === 'choice') {
    mountChoicePreview(stage, b);
  } else if (!b.media?.url) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = b.type === 'scene'
      ? '写场景文字后，字幕会出现在这里'
      : '对白会显示在底部';
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
  const panelBody = document.createElement('div');
  panelBody.className = 'mk-panel-body';
  panel.appendChild(panelBody);

  if (editBranch) {
    const parent = parentChoiceBlock();
    const opt = (parent?.choices || []).find((c) => c.id === editBranch.choiceId);
    const crumb = document.createElement('div');
    crumb.className = 'mk-panel-crumb';
    crumb.textContent = editBranch.isEndShot
      ? '← 返回选项（失败结局镜）'
      : '← 返回「' + (opt?.label || '选项') + '」';
    crumb.addEventListener('click', () => { editBranch = null; renderEdit(); });
    panelBody.appendChild(crumb);
  }

  const typeRow = document.createElement('div');
  typeRow.className = 'field';
  typeRow.innerHTML = '<label>镜头类型</label>';
  const sel = document.createElement('select');
  const branchTypes = ['scene', 'dialogue'];
  const typeChoices = editBranch ? branchTypes : ['scene', 'dialogue', 'choice', 'rogue'];
  typeChoices.forEach((t) => {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = TYPE_LABEL[t];
    if (b.type === t) o.selected = true;
    sel.appendChild(o);
  });
  if (editBranch) sel.disabled = true;
  sel.addEventListener('change', () => {
    b.type = sel.value;
    if (b.type === 'dialogue' && !b.speaker) b.speaker = DEFAULT_SPEAKER;
    if (b.type === 'choice') normalizeChoice(b, blocks());
    if (b.type === 'rogue') {
      if (typeof b.winContent !== 'string') b.winContent = '你赢了。';
      if (typeof b.loseContent !== 'string') b.loseContent = '你败了，重整旗鼓再来。';
      if (!b.content) b.content = '一只敌人挡住了去路！';
      ensureWorkRogue({ preferQueue: true });
    }
    scheduleSave();
    renderEdit();
  });
  typeRow.appendChild(sel);
  panelBody.appendChild(typeRow);

  if (b.type === 'dialogue') {
    const sp = field('角色名', 'text', b.speaker || DEFAULT_SPEAKER, (v) => { b.speaker = v; scheduleSave(); renderPreview(); updateSteps(); });
    panelBody.appendChild(sp);
  }

  const contentLabel = b.type === 'scene' ? '字幕内容' : b.type === 'choice' ? '选项提示' : b.type === 'rogue' ? '战前说明' : '对白内容';
  panelBody.appendChild(field(contentLabel, 'textarea', b.content || '', (v) => {
    b.content = v;
    scheduleSave();
    renderPreview();
    renderShots();
    updateSteps();
  }));

  if (b.type === 'scene' || b.type === 'dialogue') {
    panelBody.appendChild(imagePromptPanel(b));
  }

  if ((b.type === 'scene' || b.type === 'dialogue') && !editBranch) {
    panelBody.appendChild(textStylePanel(b));
    panelBody.appendChild(afterJumpPanel(b));
  } else if (b.type === 'scene' || b.type === 'dialogue') {
    panelBody.appendChild(textStylePanel(b));
  }

  if (b.type === 'choice' && !editBranch) {
    panelBody.appendChild(choiceEditor(b));
  }

  if (b.type === 'rogue' && !editBranch) {
    panelBody.appendChild(rogueShotPanel(b));
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
    if (b.media.type === 'video') bgSec.appendChild(videoModePanel(b));
  } else {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mk-bg-btn';
    btn.textContent = '🖼 上传图片或视频';
    btn.addEventListener('click', () => pickMedia(b));
    bgSec.appendChild(btn);
  }
  panelBody.appendChild(bgSec);

  if (b.type === 'dialogue') {
    const voiceSec = document.createElement('div');
    voiceSec.className = 'field';
    voiceSec.innerHTML = '<label>配音（可选）</label>';
    if (b.audio?.url) {
      const row = document.createElement('div');
      row.className = 'mk-audio-row';
      row.innerHTML = '<span class="mk-audio-name">🔊 已上传配音</span>';
      const ops = document.createElement('div');
      ops.className = 'mk-bg-ops';
      const replaceBtn = document.createElement('button');
      replaceBtn.type = 'button';
      replaceBtn.className = 'btn';
      replaceBtn.textContent = '更换';
      replaceBtn.addEventListener('click', () => {
        pickAudio((audio) => {
          b.audio = { url: audio.url, type: 'audio', volume: b.audio?.volume ?? 1 };
          scheduleSave();
          renderPanel();
          toast('配音已更新');
        });
      });
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'btn danger';
      rm.textContent = '移除';
      rm.addEventListener('click', () => {
        delete b.audio;
        scheduleSave();
        renderPanel();
      });
      ops.append(replaceBtn, rm);
      row.appendChild(ops);
      voiceSec.appendChild(row);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mk-bg-btn';
      btn.style.padding = '10px';
      btn.textContent = '🔊 上传配音';
      btn.addEventListener('click', () => {
        pickAudio((audio) => {
          b.audio = { url: audio.url, type: 'audio', volume: 1 };
          scheduleSave();
          renderPanel();
          toast('配音已添加');
        });
      });
      voiceSec.appendChild(btn);
    }
    panelBody.appendChild(voiceSec);
  }

  const foot = document.createElement('div');
  foot.className = 'mk-panel-foot';
  if (editBranch) {
    const parent = parentChoiceBlock();
    const opt = (parent?.choices || []).find((c) => c.id === editBranch.choiceId);
    if (editBranch.isEndShot) {
      foot.append(btn('删除失败结局', () => removeEndShot(editBranch.choiceBlockId, editBranch.choiceId), true));
    } else {
      const branch = opt?.branch || [];
      const bi = branch.findIndex((x) => x.id === b.id);
      const up = btn('↑ 上移', () => moveBranchBlock(editBranch.choiceBlockId, editBranch.choiceId, b.id, -1));
      const down = btn('↓ 下移', () => moveBranchBlock(editBranch.choiceBlockId, editBranch.choiceId, b.id, 1));
      const del = btn('删除子镜头', () => removeBranchBlock(editBranch.choiceBlockId, editBranch.choiceId, b.id), true);
      if (bi <= 0) up.disabled = true;
      if (bi < 0 || bi >= branch.length - 1) down.disabled = true;
      foot.append(up, down, del);
    }
  } else {
    foot.append(
      btn('↑ 上移', () => moveBlock(b.id, -1)),
      btn('↓ 下移', () => moveBlock(b.id, 1)),
      btn('删除镜头', () => removeBlock(b.id), true),
    );
  }
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

function imagePromptPanel(b) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const empty = !String(b.imagePrompt || '').trim() && !String(b.imagePromptZh || '').trim();

  const lab = document.createElement('label');
  lab.textContent = '生图提示词（画面，不是字幕）';
  wrap.appendChild(lab);

  const hint = document.createElement('p');
  hint.style.cssText = 'font-size:11px;color:var(--muted);line-height:1.55;margin:4px 0 8px';
  hint.textContent = empty
    ? '手动加的镜头不会自动带提示词。写好字幕后点「AI 生成提示词」，会出中英两版（不照抄原句）。'
    : '已有提示词时可手改，或点「AI 重新改写」。也可用左侧「✦ 补提示词」批量补全。';
  wrap.appendChild(hint);

  const zhLab = document.createElement('div');
  zhLab.style.cssText = 'font-size:11px;color:var(--muted);margin:6px 0 4px';
  zhLab.textContent = '中文版';
  const zhTa = document.createElement('textarea');
  zhTa.rows = 2;
  zhTa.placeholder = '枯骨嶙峋的荒岭关隘，黄昏冷风，无人，阴森压抑…';
  zhTa.value = b.imagePromptZh || '';
  zhTa.addEventListener('input', () => {
    b.imagePromptZh = zhTa.value.slice(0, 400);
    scheduleSave();
  });

  const enLab = document.createElement('div');
  enLab.style.cssText = 'font-size:11px;color:var(--muted);margin:8px 0 4px';
  enLab.textContent = '英文版（默认用于生图）';
  const enTa = document.createElement('textarea');
  enTa.rows = 3;
  enTa.placeholder = 'ominous bone-strewn mountain ridge at dusk, cold wind…';
  enTa.value = b.imagePrompt || '';
  enTa.addEventListener('input', () => {
    b.imagePrompt = enTa.value.slice(0, 700);
    scheduleSave();
  });

  const ops = document.createElement('div');
  ops.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px';
  const rewrite = document.createElement('button');
  rewrite.type = 'button';
  rewrite.className = empty ? 'btn primary' : 'btn';
  rewrite.textContent = empty ? 'AI 生成提示词' : 'AI 重新改写';
  rewrite.title = '根据当前字幕生成中英画面提示词，禁止照抄原句';
  rewrite.addEventListener('click', () => rewriteBlockImagePrompts(b, rewrite, zhTa, enTa));

  const inherit = document.createElement('button');
  inherit.type = 'button';
  inherit.className = 'btn';
  inherit.textContent = '用上一镜提示词';
  inherit.title = '复制上一镜头的中英生图词';
  inherit.addEventListener('click', () => {
    const bs = blocks();
    const idx = bs.findIndex((x) => x.id === b.id);
    let prev = null;
    for (let i = idx - 1; i >= 0; i--) {
      const p = bs[i];
      if (p && (p.imagePrompt || p.imagePromptZh)) { prev = p; break; }
    }
    if (!prev) { toast('前面没有可用的提示词', true); return; }
    b.imagePrompt = prev.imagePrompt || '';
    b.imagePromptZh = prev.imagePromptZh || '';
    zhTa.value = b.imagePromptZh;
    enTa.value = b.imagePrompt;
    scheduleSave();
    toast('已复制上一镜提示词');
    renderEdit();
  });

  const gen = document.createElement('button');
  gen.type = 'button';
  gen.className = empty ? 'btn' : 'btn primary';
  gen.textContent = '用英文生图';
  gen.addEventListener('click', () => genBlockBackground(b, gen, 'en'));
  const genZh = document.createElement('button');
  genZh.type = 'button';
  genZh.className = 'btn';
  genZh.textContent = '用中文生图';
  genZh.addEventListener('click', () => genBlockBackground(b, genZh, 'zh'));
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn';
  copy.textContent = '复制两版';
  copy.addEventListener('click', async () => {
    const zh = (b.imagePromptZh || '').trim();
    const en = (b.imagePrompt || '').trim();
    if (!zh && !en) { toast('还没有生图提示词', true); return; }
    const t = (zh ? '【中文】\n' + zh + '\n\n' : '') + (en ? '【English】\n' + en : '');
    try {
      await navigator.clipboard.writeText(t);
      toast('已复制中英提示词');
    } catch (_) {
      toast('复制失败，请手动选中', true);
    }
  });
  ops.append(rewrite, inherit, gen, genZh, copy);
  wrap.append(zhLab, zhTa, enLab, enTa, ops);
  return wrap;
}

async function rewriteBlockImagePrompts(b, btn, zhTa, enTa) {
  const content = String(b.content || '').trim();
  if (!content || content === '新场景……' || content === '在这里写下对白……') {
    toast('请先写好字幕内容，再生成提示词', true);
    return;
  }
  const old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
  try {
    const res = await fetch('/api/hub/novel-prompt-rewrite', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success) throw new Error(d.error || '生成失败');
    const row = (d.items && d.items[0]) || {};
    if (row.imagePromptZh) {
      b.imagePromptZh = String(row.imagePromptZh).slice(0, 400);
      if (zhTa) zhTa.value = b.imagePromptZh;
    }
    if (row.imagePrompt) {
      b.imagePrompt = String(row.imagePrompt).slice(0, 700);
      if (enTa) enTa.value = b.imagePrompt;
    }
    scheduleSave();
    toast(d.provider === 'deepseek' ? '提示词已生成（DeepSeek）' : '提示词已生成');
    renderEdit();
    renderShots();
  } catch (e) {
    toast((e && e.message) || '生成失败', true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old || 'AI 生成提示词'; }
  }
}

/** 批量为缺少提示词的场景生成中英 Prompt */
async function genMissingScenePrompts() {
  if (!work || !loggedIn) { toast('请先登录并打开作品', true); return; }
  const need = blocks().filter((b) => {
    if (b.type !== 'scene') return false;
    const c = String(b.content || '').trim();
    if (!c || c === '新场景……') return false;
    return !String(b.imagePrompt || '').trim() || !String(b.imagePromptZh || '').trim();
  });
  if (!need.length) {
    toast('没有需要补提示词的场景（对白可用「用上一镜提示词」）');
    return;
  }
  const btn = $('#mkGenPromptsBtn');
  const old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
  toast('正在为 ' + need.length + ' 个场景生成提示词…');
  try {
    const res = await fetch('/api/hub/novel-prompt-rewrite', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        items: need.map((b) => ({ id: b.id, content: b.content })),
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success) throw new Error(d.error || '批量生成失败');
    const byId = new Map((d.items || []).map((row) => [String(row.id), row]));
    let n = 0;
    need.forEach((b) => {
      const row = byId.get(String(b.id));
      if (!row) return;
      if (row.imagePrompt) b.imagePrompt = String(row.imagePrompt).slice(0, 700);
      if (row.imagePromptZh) b.imagePromptZh = String(row.imagePromptZh).slice(0, 400);
      n++;
    });
    // 对白若空则继承最近场景提示词
    let lastEn = '';
    let lastZh = '';
    blocks().forEach((b) => {
      if (b.type === 'scene') {
        if (b.imagePrompt) lastEn = b.imagePrompt;
        if (b.imagePromptZh) lastZh = b.imagePromptZh;
        return;
      }
      if (b.type === 'dialogue') {
        if (!String(b.imagePrompt || '').trim() && lastEn) b.imagePrompt = lastEn;
        if (!String(b.imagePromptZh || '').trim() && lastZh) b.imagePromptZh = lastZh;
      }
    });
    scheduleSave();
    renderEdit();
    renderShots();
    toast('已为 ' + n + ' 个场景补上提示词');
  } catch (e) {
    toast((e && e.message) || '批量生成失败', true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old || '✦ 补提示词'; }
  }
}

async function genBlockBackground(b, btn, lang) {
  const prompt = lang === 'zh'
    ? String(b.imagePromptZh || b.imagePrompt || b.content || '').trim()
    : String(b.imagePrompt || b.imagePromptZh || b.content || '').trim();
  if (!prompt) { toast('请先生图提示词', true); return; }
  const old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '生图中…'; }
  toast('生图中（本机 Comfy 或云端，视设置而定）…');
  try {
    const mod = await import('/image-provider.js');
    const portrait = work?.orientation === 'portrait';
    const r = await mod.generateAndResolveUrl({
      prompt,
      width: portrait ? 768 : 1280,
      height: portrait ? 1280 : 720,
    });
    if (!r?.url) throw new Error('生图失败');
    b.media = { url: r.url, type: 'image' };
    scheduleSave();
    renderEdit();
    renderPreview();
    renderShots();
    toast('背景已挂上');
  } catch (e) {
    toast((e && e.message) || '生图失败', true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old || '生图'; }
  }
}

function videoModePanel(b) {
  const wrap = document.createElement('div');
  wrap.className = 'field mk-video-mode';
  wrap.style.marginTop = '8px';
  const lab = document.createElement('label');
  lab.textContent = '视频用法';
  wrap.appendChild(lab);
  const sel = document.createElement('select');
  Object.entries(VIDEO_MODES).forEach(([id, meta]) => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = meta.label;
    if (videoMode(b.media) === id) o.selected = true;
    sel.appendChild(o);
  });
  const hint = document.createElement('p');
  hint.style.cssText = 'font-size:11px;color:var(--muted);line-height:1.55;margin-top:6px';
  const syncHint = () => {
    hint.textContent = VIDEO_MODES[videoMode(b.media)]?.hint || '';
  };
  syncHint();
  sel.addEventListener('change', () => {
    b.media.videoMode = sel.value;
    scheduleSave();
    syncHint();
    renderShots();
    renderPreview();
    if (playing) renderPlay();
  });
  wrap.append(sel, hint);
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

  wrap.appendChild(field('标题（可选）', 'text', sub.label || '', (v) => {
    const t = v.trim();
    if (t) sub.label = t;
    else delete sub.label;
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

function addBranchBlock(choiceBlock, choiceId, type) {
  normalizeChoice(choiceBlock, blocks());
  const c = choiceBlock.choices.find((x) => x.id === choiceId);
  if (!c) return;
  if (!Array.isArray(c.branch)) c.branch = [];
  const bl = { id: uid(), type, content: type === 'scene' ? '新场景……' : '在这里写下对白……' };
  if (type === 'dialogue') bl.speaker = DEFAULT_SPEAKER;
  c.branch.push(bl);
  if (!c.branchEnd) c.branchEnd = 'main';
  selectedId = choiceBlock.id;
  editBranch = { choiceBlockId: choiceBlock.id, choiceId: c.id, blockId: bl.id };
  scheduleSave();
  renderEdit();
}

function removeEndShot(choiceBlockId, choiceId) {
  if (!confirm('删除这条选项的失败结局镜？')) return;
  const ch = blocks().find((b) => b.id === choiceBlockId);
  const c = ch?.choices?.find((x) => x.id === choiceId);
  if (!c) return;
  delete c.endShot;
  if (c.branchEnd === 'shot') c.branchEnd = c.branch?.length ? 'main' : undefined;
  if (editBranch?.isEndShot) editBranch = null;
  scheduleSave();
  renderEdit();
}

function selectEndShot(choiceBlock, choiceId) {
  selectedId = choiceBlock.id;
  editBranch = { choiceBlockId: choiceBlock.id, choiceId, isEndShot: true };
  renderEdit();
}

function removeBranchBlock(choiceBlockId, choiceId, blockId) {
  if (!confirm('删除这个子镜头？')) return;
  const ch = blocks().find((b) => b.id === choiceBlockId);
  const c = ch?.choices?.find((x) => x.id === choiceId);
  if (!c?.branch) return;
  c.branch = c.branch.filter((b) => b.id !== blockId);
  if (editBranch?.blockId === blockId) editBranch = null;
  scheduleSave();
  renderEdit();
}

function moveBranchBlock(choiceBlockId, choiceId, blockId, dir) {
  const ch = blocks().find((b) => b.id === choiceBlockId);
  const c = ch?.choices?.find((x) => x.id === choiceId);
  const branch = c?.branch;
  if (!branch) return;
  const i = branch.findIndex((b) => b.id === blockId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= branch.length) return;
  const tmp = branch[i];
  branch[i] = branch[j];
  branch[j] = tmp;
  scheduleSave();
  renderEdit();
}

function deleteSelectedShot() {
  const b = selectedBlock();
  if (!b) return;
  if (editBranch?.isEndShot) {
    removeEndShot(editBranch.choiceBlockId, editBranch.choiceId);
    return;
  }
  if (editBranch) {
    removeBranchBlock(editBranch.choiceBlockId, editBranch.choiceId, b.id);
    return;
  }
  removeBlock(b.id);
}

function branchShotRow({ num, preview, on, extraClass, onSelect, onDelete }) {
  const row = document.createElement('div');
  row.className = 'mk-branch-shot-row';
  const shot = document.createElement('button');
  shot.type = 'button';
  shot.className = 'mk-branch-shot' + (extraClass ? ' ' + extraClass : '') + (on ? ' on' : '');
  shot.innerHTML = '<span class="n">' + num + '</span><span class="t">' + escapeHtml(preview || '（空）') + '</span>';
  shot.addEventListener('click', onSelect);
  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'btn danger mk-branch-shot-del';
  rm.title = '删除镜头';
  rm.textContent = '×';
  rm.addEventListener('click', (e) => { e.stopPropagation(); onDelete(); });
  row.append(shot, rm);
  return row;
}

function afterJumpPanel(b) {
  const wrap = document.createElement('div');
  wrap.className = 'field mk-after-jump';
  wrap.innerHTML = '<label>点过后跳到</label><p class="mk-branch-hint">分支的最后一镜可设「跳到」汇合镜头，避免误入另一条线。</p>';
  const val = b.afterJump || 'next';
  wrap.appendChild(makeJumpSelect(val, b.id, (v) => {
    b.afterJump = v === 'next' ? '' : v;
    scheduleSave();
  }));
  return wrap;
}

function choiceEditor(b) {
  normalizeChoice(b, blocks());
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.innerHTML = '<label>选项（读者点选）</label>';
  const hint = document.createElement('p');
  hint.className = 'mk-branch-hint';
  hint.textContent = '每条选项下方可建子镜头与失败结局镜，都在支线里、不占主线。播完后可回归主线或回到选项镜。未建子镜头时仍可用「跳到」指定主线镜头。';
  wrap.appendChild(hint);
  b.choices.forEach((c, i) => {
    const card = document.createElement('div');
    card.className = 'mk-opt-card';
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
      if (editBranch?.choiceBlockId === b.id && editBranch?.choiceId === c.id) editBranch = null;
      b.choices.splice(i, 1);
      scheduleSave();
      renderEdit();
    });
    row.append(inp, rm);
    card.appendChild(row);
    card.appendChild(choiceItemPanel(c));

    const branchSec = document.createElement('div');
    branchSec.className = 'mk-branch';
    const bl = document.createElement('div');
    bl.className = 'mk-branch-label';
    bl.textContent = '子镜头';
    branchSec.appendChild(bl);
    if (!Array.isArray(c.branch)) c.branch = [];
    const shots = document.createElement('div');
    shots.className = 'mk-branch-shots';
    c.branch.forEach((sub, si) => {
      const preview = sub.type === 'dialogue'
        ? (sub.speaker + '：' + (sub.content || '')).slice(0, 36)
        : (sub.content || TYPE_LABEL[sub.type] || '').slice(0, 36);
      const on = editBranch?.choiceBlockId === b.id && editBranch?.choiceId === c.id && !editBranch.isEndShot && editBranch?.blockId === sub.id;
      shots.appendChild(branchShotRow({
        num: si + 1,
        preview,
        on,
        onSelect: () => {
          selectedId = b.id;
          editBranch = { choiceBlockId: b.id, choiceId: c.id, blockId: sub.id };
          renderEdit();
        },
        onDelete: () => removeBranchBlock(b.id, c.id, sub.id),
      }));
    });
    branchSec.appendChild(shots);
    const addRow = document.createElement('div');
    addRow.className = 'mk-branch-add';
    addRow.append(
      btn('+ 对白', () => addBranchBlock(b, c.id, 'dialogue')),
      btn('+ 场景', () => addBranchBlock(b, c.id, 'scene')),
    );
    branchSec.appendChild(addRow);

    const endShotLab = document.createElement('div');
    endShotLab.className = 'mk-branch-label';
    endShotLab.style.marginTop = '10px';
    endShotLab.textContent = '失败结局镜';
    branchSec.appendChild(endShotLab);
    const endShots = document.createElement('div');
    endShots.className = 'mk-branch-shots';
    if (c.endShot) {
      const preview = c.endShot.type === 'dialogue'
        ? (c.endShot.speaker + '：' + (c.endShot.content || '')).slice(0, 36)
        : (c.endShot.content || TYPE_LABEL[c.endShot.type] || '').slice(0, 36);
      const onEnd = editBranch?.choiceBlockId === b.id && editBranch?.choiceId === c.id && editBranch.isEndShot;
      endShots.appendChild(branchShotRow({
        num: '✦',
        preview,
        on: onEnd,
        extraClass: 'fail',
        onSelect: () => selectEndShot(b, c.id),
        onDelete: () => removeEndShot(b.id, c.id),
      }));
    }
    branchSec.appendChild(endShots);
    const endShotAdd = document.createElement('div');
    endShotAdd.className = 'mk-branch-add';
    if (!c.endShot) {
      endShotAdd.append(
        btn('+ 失败结局', () => {
          ensureEndShot(c);
          scheduleSave();
          selectEndShot(b, c.id);
        }),
      );
    }
    branchSec.appendChild(endShotAdd);

    const endWrap = document.createElement('div');
    endWrap.className = 'mk-branch-end';
    endWrap.innerHTML = '<label>子镜头播完后</label>';
    const endSel = document.createElement('select');
    [
      ['main', '回归主线（选项下一镜）'],
      ['choice', '回归选项镜'],
      ['shot', '播放失败结局镜'],
    ].forEach(([v, lab]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = lab;
      if ((c.branchEnd || 'main') === v) o.selected = true;
      endSel.appendChild(o);
    });
    endSel.addEventListener('change', () => {
      c.branchEnd = endSel.value;
      if (c.branchEnd === 'shot' && !c.endShot) ensureEndShot(c);
      scheduleSave();
      renderEdit();
    });
    endWrap.appendChild(endSel);
    branchSec.appendChild(endWrap);
    if (!optionUsesBranch(c)) {
      const jmpRow = document.createElement('div');
      jmpRow.className = 'field';
      jmpRow.style.marginTop = '8px';
      const jmpLab = document.createElement('label');
      jmpLab.style.cssText = 'font-size:11px;color:var(--muted)';
      jmpLab.textContent = '无子镜头时跳到';
      jmpRow.appendChild(jmpLab);
      jmpRow.appendChild(makeJumpSelect(c.jump, b.id, (v) => {
        c.jump = v;
        scheduleSave();
      }));
      branchSec.appendChild(jmpRow);
    }
    card.appendChild(branchSec);
    wrap.appendChild(card);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn';
  add.style.marginTop = '6px';
  add.textContent = '＋ 加选项';
  add.addEventListener('click', () => {
    b.choices.push({ id: uid(), label: '新选项', jump: 'next', branch: [], branchEnd: 'main', require: [], effect: [] });
    scheduleSave();
    renderEdit();
  });
  wrap.appendChild(add);
  return wrap;
}

/** 选项：获得 / 需要物品（写入 effect / require，与专业编辑器兼容） */
function choiceItemPanel(c) {
  if (!Array.isArray(c.effect)) c.effect = [];
  if (!Array.isArray(c.require)) c.require = [];
  const wrap = document.createElement('div');
  wrap.className = 'mk-item-panel';

  const gain = (c.effect || []).find((e) => e.op === '+' || e.op === '=') || null;
  const need = (c.require || []).find((r) => r.op === '>=' || r.op === '>') || null;

  const row1 = document.createElement('div');
  row1.className = 'mk-item-row';
  row1.innerHTML = '<span class="mk-item-lab">获得物品</span>';
  const gainSel = document.createElement('select');
  const none1 = document.createElement('option');
  none1.value = '';
  none1.textContent = '无';
  gainSel.appendChild(none1);
  ITEM_PRESETS.forEach((it) => {
    const o = document.createElement('option');
    o.value = it.id;
    o.textContent = it.label;
    if (gain && gain.var === it.id) o.selected = true;
    gainSel.appendChild(o);
  });
  const gainAmt = document.createElement('input');
  gainAmt.type = 'number';
  gainAmt.min = '1';
  gainAmt.max = '99';
  gainAmt.value = String(gain && gain.val > 0 ? gain.val : 1);
  gainAmt.title = '数量';
  const syncGain = () => {
    const id = gainSel.value;
    const n = Math.max(1, Math.min(99, Math.round(Number(gainAmt.value) || 1)));
    gainAmt.value = String(n);
    c.effect = (c.effect || []).filter((e) => !(e.op === '+' || e.op === '='));
    if (id) {
      c.effect.push({ var: id, op: '+', val: n });
      ensureWorkLogic();
      if (work.logic.state[id] == null) work.logic.state[id] = 0;
    }
    scheduleSave();
  };
  gainSel.addEventListener('change', () => { syncGain(); renderPreview(); });
  gainAmt.addEventListener('change', () => { syncGain(); renderPreview(); });
  row1.append(gainSel, gainAmt);
  wrap.appendChild(row1);

  const row2 = document.createElement('div');
  row2.className = 'mk-item-row';
  row2.innerHTML = '<span class="mk-item-lab">需要物品</span>';
  const needSel = document.createElement('select');
  const none2 = document.createElement('option');
  none2.value = '';
  none2.textContent = '无（始终显示）';
  needSel.appendChild(none2);
  ITEM_PRESETS.forEach((it) => {
    const o = document.createElement('option');
    o.value = it.id;
    o.textContent = '有「' + it.label + '」才显示';
    if (need && need.var === it.id) o.selected = true;
    needSel.appendChild(o);
  });
  const needAmt = document.createElement('input');
  needAmt.type = 'number';
  needAmt.min = '1';
  needAmt.max = '99';
  needAmt.value = String(need && need.val > 0 ? need.val : 1);
  needAmt.title = '至少拥有';
  const syncNeed = () => {
    const id = needSel.value;
    const n = Math.max(1, Math.min(99, Math.round(Number(needAmt.value) || 1)));
    needAmt.value = String(n);
    c.require = (c.require || []).filter((r) => !(r.op === '>=' || r.op === '>'));
    if (id) {
      c.require.push({ var: id, op: '>=', val: n });
      ensureWorkLogic();
      if (work.logic.state[id] == null) work.logic.state[id] = 0;
    }
    scheduleSave();
  };
  needSel.addEventListener('change', () => { syncNeed(); renderPreview(); });
  needAmt.addEventListener('change', () => { syncNeed(); renderPreview(); });
  row2.append(needSel, needAmt);
  wrap.appendChild(row2);
  return wrap;
}

function rogueShotPanel(b) {
  ensureWorkRogue({ preferQueue: true });
  const r = work.rogue;
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const tip = document.createElement('p');
  tip.style.cssText = 'font-size:11px;color:var(--muted);line-height:1.55;margin:0 0 10px';
  tip.textContent = '试玩播到本镜时进入与卡牌游戏相同的自动战斗。打完可回到剧情；可用「战斗胜利标记」做后续选项条件。';
  wrap.appendChild(tip);

  const meta = document.createElement('p');
  meta.style.cssText = 'font-size:12px;color:var(--text);margin:0 0 10px';
  meta.textContent =
    '玩法：' + (CARD_MODES[r.mode]?.label || r.mode) +
    ' · 角色 ' + (r.roster?.length || 0) +
    ' · 关卡 ' + (r.stages?.length || r.enemies?.length || 0);
  wrap.appendChild(meta);

  wrap.appendChild(field('胜利后旁白', 'textarea', b.winContent || '', (v) => {
    b.winContent = v;
    scheduleSave();
  }));
  wrap.appendChild(field('失败后旁白', 'textarea', b.loseContent || '', (v) => {
    b.loseContent = v;
    scheduleSave();
  }));

  const ops = document.createElement('div');
  ops.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px';
  const studio = document.createElement('button');
  studio.type = 'button';
  studio.className = 'btn primary';
  studio.textContent = '卡牌工作室（角色/关卡）';
  studio.addEventListener('click', () => openMakeCardStudio());
  const pack = document.createElement('button');
  pack.type = 'button';
  pack.className = 'btn';
  pack.textContent = '载入默认卡组';
  pack.addEventListener('click', () => {
    if (work.rogue?.roster?.length && !confirm('将覆盖当前卡牌配置，继续？')) return;
    ensureWorkRogue({ forceStarter: true, preferQueue: true });
    scheduleSave();
    renderEdit();
    toast('已载入默认卡组（修仙自动战）');
  });
  ops.append(studio, pack);
  wrap.appendChild(ops);
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
    b.media = { ...media, videoMode: 'background' };
    scheduleSave();
    renderEdit();
    toast('视频已添加，可在下方切换「视频镜」');
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
  const block = {
    id: uid(),
    type,
    content: type === 'scene' ? '新场景……' : type === 'choice' ? '你要怎么做？' : type === 'rogue' ? '一只敌人挡住了去路！' : '在这里写下对白……',
  };
  if (type === 'dialogue') block.speaker = DEFAULT_SPEAKER;
  if (type === 'choice') normalizeChoice(block, blocks());
  if (type === 'rogue') {
    block.winContent = '你赢了。';
    block.loseContent = '你败了，重整旗鼓再来。';
    ensureWorkRogue({ preferQueue: true });
  }
  ch.blocks.push(block);
  selectedId = block.id;
  scheduleSave();
  renderEdit();
  if (type === 'scene' || type === 'dialogue') {
    toast('写好字幕后，在下方点「AI 生成提示词」');
  }
  if (type === 'rogue') toast('已加入卡牌战镜头，可在右侧打开卡牌工作室');
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
  if (i < 0) return;
  moveBlockTo(i, i + dir);
}

function moveBlockTo(from, to) {
  const ch = work.chapters[0];
  const arr = ch.blocks;
  if (from < 0 || to < 0 || from >= arr.length || to >= arr.length || from === to) return;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
  scheduleSave();
  renderEdit();
}

function openAddPicker() {
  const types = [
    ['dialogue', '💬 对白'],
    ['scene', '🏙 场景'],
    ['choice', '🔀 选项'],
    ['rogue', '⚔️ 卡牌战（同卡牌自动战斗）'],
  ];
  const m = document.createElement('div');
  m.className = 'mk-modal mk-picker-modal show';
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
      if (['scene', 'dialogue', 'choice', 'rogue'].includes(b.type)) flat.push(b);
    });
  });
  return flat;
}

function startPlay() {
  stopRogueRun();
  playMainFlat = buildPlayFlat();
  if (!playMainFlat.length) { toast('还没有可播放的镜头，先加对白或场景', true); return; }
  playMainIdx = 0;
  playBranchFlat = null;
  playBranchIdx = 0;
  playBranchEnd = 'main';
  playChoiceBlockId = null;
  playTakenChoiceId = null;
  playResumeMainIdx = 0;
  playSiblingJumps = null;
  playEffectGranted = new Set();
  resetPlayState();
  playing = true;
  $('#playOverlay').classList.add('show');
  $('#playTitle').textContent = work.title || '';
  updatePlayInventoryHud();
  const ov = $('#playOverlay');
  ov.classList.toggle('orient-portrait', work.orientation === 'portrait');
  ov.classList.toggle('orient-landscape', work.orientation !== 'portrait');
  renderPlay();
  updateSteps();
}

function stopPlay() {
  playing = false;
  playBranchFlat = null;
  playBranchIdx = 0;
  playSiblingJumps = null;
  stopRogueRun();
  stopPlayAudio();
  stopPlayBgm();
  playBgmUrl = null;
  playBgmChapter = null;
  $('#playOverlay').classList.remove('show');
  $('#playBody').innerHTML = '';
  const nav = $('#playNav');
  if (nav) nav.classList.remove('hidden');
  updateSteps();
  const to = playReturnTo;
  playReturnTo = null;
  if (to) location.assign(to);
}

function finishBranchPlay() {
  let end = playBranchEnd;
  const choiceBlockId = playChoiceBlockId;
  const choiceBlock = playMainFlat.find((b) => b.id === choiceBlockId);
  const taken = choiceBlock?.choices?.find((o) => o.id === playTakenChoiceId);
  if (taken) end = resolveOptionBranchEnd(taken);

  playBranchFlat = null;
  playBranchIdx = 0;
  playSiblingJumps = null;

  if (end === 'shot') {
    if (!taken?.endShot) toast('请先添加失败结局镜', true);
    else toast('试玩结束');
    stopPlay();
    return;
  }

  if (end === 'choice' && choiceBlockId) {
    const idx = playBlockIndex(choiceBlockId);
    if (idx >= 0) {
      playMainIdx = idx;
      renderPlay();
      return;
    }
  }

  playMainIdx = playResumeMainIdx;
  if (playMainIdx >= playMainFlat.length) {
    stopPlay();
    toast('试玩结束');
    return;
  }
  renderPlay();
}

function renderPlay() {
  const body = $('#playBody');
  body.innerHTML = '';
  const b = currentPlayBlock();
  if (!b) { stopPlay(); return; }
  const idx = playCurrentIdx();
  const nav = $('#playNav');

  if (b.type === 'rogue') {
    stopRogueRun();
    ensureWorkRogue({ preferQueue: true });
    if (nav) nav.classList.add('hidden');
    startRogueRun(b, {
      story: work,
      playBody: body,
      playNav: nav,
      orientation: work.orientation,
      onWin: () => {
        playState.battle_win = 1;
        updatePlayInventoryHud();
        if (nav) nav.classList.remove('hidden');
        toast('战斗胜利');
        playNext();
      },
      onLose: () => {
        playState.battle_win = 0;
        updatePlayInventoryHud();
        if (nav) nav.classList.remove('hidden');
        toast('战斗失败，继续剧情');
        playNext();
      },
      onExit: () => {
        if (nav) nav.classList.remove('hidden');
        stopPlay();
      },
      onPersist: () => { scheduleSave(); },
    });
    return;
  }

  if (nav) nav.classList.remove('hidden');
  stopRogueRun();

  const ch = chapterForBlock(b);
  const targetBgm = b.bgmOverride || ch?.bgm || null;
  const targetUrl = targetBgm?.url || null;
  if (targetUrl !== playBgmUrl) {
    switchBgm(targetBgm, ch?.id);
  } else if (ch?.id !== playBgmChapter) {
    playBgmChapter = ch?.id;
  }
  playVoiceForBlock(b);

  const frame = document.createElement('div');
  frame.className = 'play-frame';

  if (b.media?.url) {
    const bg = document.createElement('div');
    bg.className = 'play-media-bg';
    if (b.media.type === 'video') {
      const mode = videoMode(b.media);
      const v = document.createElement('video');
      v.src = b.media.url;
      v.autoplay = true;
      v.loop = mode === 'background';
      v.muted = mode === 'background';
      v.playsInline = true;
      v.preload = 'auto';
      if (mode === 'clip') {
        v.onended = () => {
          if (!playing || currentPlayBlock() !== b) return;
          playNext();
        };
      }
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
    fore.classList.add('dlg-fore');
    const box = document.createElement('div');
    box.className = 'play-choice';
    box.innerHTML = '<div class="pc-prompt">' + escapeHtml(b.content || '请选择：') + '</div>';
    const opts = document.createElement('div');
    opts.className = 'pc-opts';
    const visible = (b.choices || []).filter((c) => evalRequire(c.require));
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'pc-opt';
      empty.style.opacity = '0.65';
      empty.textContent = '（没有可选项——可能缺少物品）';
      opts.appendChild(empty);
    }
    visible.forEach((c) => {
      const btnEl = document.createElement('button');
      btnEl.type = 'button';
      btnEl.className = 'pc-opt';
      fillChoiceButton(btnEl, c);
      btnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const gained = grantChoiceEffectsOnce(b.id, c);
        updatePlayInventoryHud();
        if (optionUsesBranch(c)) {
          setPlayChoiceContext(b, c);
          playResumeMainIdx = resolvePlayNextIndex(playMainIdx);
          playChoiceBlockId = b.id;
          playTakenChoiceId = c.id;
          playBranchFlat = buildBranchPlayFlat(c);
          playBranchIdx = 0;
          playBranchEnd = resolveOptionBranchEnd(c);
          renderPlay();
        } else {
          setPlayChoiceContext(b, c);
          jumpPlay(c.jump || 'next');
        }
        if (gained.length) toast(gained.join('，'));
      });
      opts.appendChild(btnEl);
    });
    box.appendChild(opts);
    fore.appendChild(box);
    frame.appendChild(fore);
    body.appendChild(frame);
    $('#playPrev').disabled = playMainIdx === 0 && !playBranchFlat;
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
  $('#playPrev').disabled = idx === 0 && !playBranchFlat;
  $('#playNext').disabled = !hasPlayNext();
}

function setPlayChoiceContext(choiceBlock, takenOption) {
  const jumps = new Set();
  (choiceBlock.choices || []).forEach((o) => {
    if (o === takenOption) return;
    const j = o.jump || 'next';
    if (j !== 'next' && j !== 'end') jumps.add(j);
  });
  playSiblingJumps = jumps.size ? jumps : null;
}

function playBlockIndex(id) {
  return playMainFlat.findIndex((b) => b.id === id);
}

/** 从 sibling 支线入口起，跳到该线 afterJump 汇合点或列表末尾 */
function skipSiblingBranchFrom(startIdx) {
  let i = startIdx;
  while (i < playMainFlat.length) {
    const blk = playMainFlat[i];
    if (blk.afterJump && blk.afterJump !== 'next') {
      const mergeIdx = playBlockIndex(blk.afterJump);
      return mergeIdx >= 0 ? mergeIdx : playMainFlat.length;
    }
    if (i > startIdx && blk.type === 'choice') return i;
    i++;
  }
  return playMainFlat.length;
}

function resolvePlayNextIndex(fromIdx) {
  const cur = playMainFlat[fromIdx];
  if (cur?.afterJump && cur.afterJump !== 'next') {
    const mergeIdx = playBlockIndex(cur.afterJump);
    if (mergeIdx >= 0) return mergeIdx;
  }
  let nextIdx = fromIdx + 1;
  while (nextIdx < playMainFlat.length && playSiblingJumps?.has(playMainFlat[nextIdx].id)) {
    nextIdx = skipSiblingBranchFrom(nextIdx);
  }
  return nextIdx;
}

function hasPlayNext() {
  const b = currentPlayBlock();
  if (!b || b.type === 'choice') return false;
  if (playBranchFlat) {
    if (playBranchIdx < playBranchFlat.length - 1) return true;
    if (playBranchEnd === 'shot') return false;
    return true;
  }
  return resolvePlayNextIndex(playMainIdx) < playMainFlat.length;
}

function playNext() {
  if (playBranchFlat) {
    if (playBranchIdx < playBranchFlat.length - 1) {
      playBranchIdx++;
      renderPlay();
      return;
    }
    finishBranchPlay();
    return;
  }
  const nextIdx = resolvePlayNextIndex(playMainIdx);
  if (nextIdx >= playMainFlat.length) {
    stopPlay();
    toast('试玩结束');
    return;
  }
  playMainIdx = nextIdx;
  renderPlay();
}

function playPrev() {
  if (playBranchFlat) {
    if (playBranchIdx > 0) {
      playBranchIdx--;
      renderPlay();
      return;
    }
    playBranchFlat = null;
    playBranchIdx = 0;
    playTakenChoiceId = null;
    renderPlay();
    return;
  }
  if (playMainIdx > 0) {
    playMainIdx--;
    renderPlay();
  }
}

function jumpPlay(jump) {
  playBranchFlat = null;
  playBranchIdx = 0;
  const j = String(jump || 'next');
  if (j === 'end') { stopPlay(); toast('到此结束'); return; }
  if (j === 'next') { playNext(); return; }
  const idx = playMainFlat.findIndex((b) => b.id === j);
  if (idx >= 0) { playMainIdx = idx; renderPlay(); }
  else playNext();
}

// ---------- 新建弹窗 ----------
function setCreateStep(step) {
  createStep = step;
  $('#mkModalStep1').classList.toggle('hidden', step !== 1);
  $('#mkModalStep2').classList.toggle('hidden', step !== 2);
  $('#mkModalBack').classList.toggle('hidden', step !== 2);
  $('#mkModalNext').classList.toggle('hidden', step !== 1);
  $('#mkModalOk').classList.toggle('hidden', step !== 2);
  $('#mkModalTitle').textContent = step === 1 ? '新建作品' : '选择类型';
}

function openCreateModal() {
  $('#mkNewTitle').value = '';
  createOrient = 'landscape';
  createKind = 'story';
  createStep = 1;
  $$('#mkCreateOrient button').forEach((b) => b.classList.toggle('on', b.dataset.o === createOrient));
  $$('.mk-kind button').forEach((b) => b.classList.toggle('on', b.dataset.k === createKind));
  setCreateStep(1);
  $('#mkModal').classList.add('show');
  setTimeout(() => $('#mkNewTitle').focus(), 100);
}

function goCreateStep2() {
  const title = $('#mkNewTitle').value.trim();
  if (!title) { toast('请输入作品名称', true); return; }
  if (!loggedIn) { toast('请先登录', true); return; }
  setCreateStep(2);
}

async function confirmCreate() {
  const title = $('#mkNewTitle').value.trim();
  if (!title) { toast('请输入作品名称', true); setCreateStep(1); return; }
  if (!loggedIn) { toast('请先登录', true); return; }
  $('#mkModalOk').disabled = true;
  try {
    const s = await createWork(title, createOrient, createKind);
    $('#mkModal').classList.remove('show');
    if (isStoryKind(createKind)) {
      work = s;
      selectedId = blocks()[0]?.id || null;
      showEdit();
      toast('已创建《' + title + '》');
    } else if (createKind === 'gacha_rogue') {
      location.href = '/make-card.html?story=' + encodeURIComponent(s.id);
    } else {
      location.href = '/story-editor.html?pro=1&story=' + encodeURIComponent(s.id);
    }
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
  if (q.get('new') === '1' || q.get('new') === 'story' || q.get('new') === 'video') {
    openCreateModal();
  }
  if (q.get('hint') === 'video') {
    setTimeout(() => toast('上传 MP4 后，在右侧选「视频镜」：保留原声，播完自动下一镜'), 500);
  }
  renderHome();
}

// ---------- AI 小说 / 提取镜头 ----------
let novelOrient = 'landscape';
let novelBusy = false;

function setNovelStatus(msg, isErr) {
  const el = $('#mkNovelStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isErr ? '#ff8a7a' : 'var(--muted)';
}

function openNovelModal(tab) {
  if (!loggedIn) { toast('请先登录', true); return; }
  const modal = $('#mkNovelModal');
  if (!modal) return;
  setNovelTab(tab === 'ext' ? 'ext' : 'gen');
  setNovelStatus('');
  refreshNovelProviderHint();
  updateNovelSelHint();
  modal.classList.add('show');
  setTimeout(() => {
    const focus = tab === 'ext' ? $('#mkNovelText') : $('#mkNovelPremise');
    if (focus) focus.focus();
  }, 80);
}

async function refreshNovelProviderHint() {
  const el = $('#mkNovelProvider');
  if (!el) return;
  el.textContent = '模型：Workers AI（默认）';
  try {
    const res = await fetch('/api/hub/meta', { credentials: 'include', headers: { ...authHeaders() } });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.deepseekConfigured) {
      el.textContent = '模型：DeepSeek（已接入，Key 仅存 Cloudflare Secret）';
    }
  } catch (_) { /* ignore */ }
}

function setNovelTab(tab) {
  $$('#mkNovelTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('#mkNovelGenPane')?.classList.toggle('hidden', tab !== 'gen');
  $('#mkNovelExtPane')?.classList.toggle('hidden', tab !== 'ext');
}

async function runNovelGenerate() {
  if (novelBusy) return;
  const premise = ($('#mkNovelPremise')?.value || '').trim();
  if (!premise) { toast('请先写故事想法', true); return; }
  novelBusy = true;
  const btn = $('#mkNovelGenBtn');
  if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
  setNovelStatus('正在写小说，约需十几秒…');
  try {
    const res = await fetch('/api/hub/novel-generate', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        premise,
        genre: ($('#mkNovelGenre')?.value || '都市奇幻').trim(),
        chapterCount: Number($('#mkNovelChCount')?.value || 2),
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success) throw new Error(d.error || '生成失败');
    if ($('#mkNovelText')) $('#mkNovelText').value = d.text || '';
    if ($('#mkNovelTitle') && d.title) $('#mkNovelTitle').value = d.title;
    setNovelTab('ext');
    const via = d.provider === 'deepseek' ? '（DeepSeek）' : '';
    setNovelStatus('已生成《' + (d.title || '未命名') + '》' + via + '。可改字后点「提取为互动镜头」。');
    toast('小说已生成');
  } catch (e) {
    setNovelStatus(e.message || '生成失败', true);
    toast(e.message || '生成失败', true);
  } finally {
    novelBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = '生成小说'; }
  }
}

function getNovelExtractText() {
  const ta = $('#mkNovelText');
  if (!ta) return { text: '', selected: false, fullLen: 0 };
  const full = String(ta.value || '');
  const a = ta.selectionStart|0;
  const b = ta.selectionEnd|0;
  const selected = a !== b ? full.slice(Math.min(a, b), Math.max(a, b)).trim() : '';
  if (selected.length >= 40) {
    return { text: selected, selected: true, fullLen: full.trim().length, selLen: selected.length };
  }
  return { text: full.trim(), selected: false, fullLen: full.trim().length, selLen: 0 };
}

function updateNovelSelHint() {
  const el = $('#mkNovelSelHint');
  if (!el) return;
  const info = getNovelExtractText();
  if (info.selected) {
    el.textContent = '已选中 ' + info.selLen + ' 字，将只压缩这一段。';
  } else if (info.fullLen > 1200) {
    el.textContent = '未选中；全文 ' + info.fullLen + ' 字偏长，建议先拖选一段再压缩。';
  } else if (info.fullLen >= 40) {
    el.textContent = '未选中，将压缩全文（' + info.fullLen + ' 字）。';
  } else {
    el.textContent = '';
  }
  const ap = $('#mkNovelAppend');
  if (ap) {
    ap.disabled = !work;
    if (!work) ap.checked = false;
  }
}

async function runNovelExtract() {
  if (novelBusy) return;
  const info = getNovelExtractText();
  const text = info.text;
  if (text.length < 40) {
    toast('请先选中或粘贴一段要改编的文字（至少约 40 字）', true);
    return;
  }
  if (!info.selected && text.length > 1200) {
    toast('请先在正文里拖选一段（约 100～800 字），不要整章硬压', true);
    updateNovelSelHint();
    return;
  }
  const append = !!(work && $('#mkNovelAppend')?.checked);
  const withChoice = !!$('#mkNovelWithChoice')?.checked;
  novelBusy = true;
  const btn = $('#mkNovelExtBtn');
  if (btn) { btn.disabled = true; btn.textContent = '压缩中…'; }
  setNovelStatus(
    (info.selected ? '正在压缩所选 ' + info.selLen + ' 字' : '正在压缩全文 ' + text.length + ' 字') +
      ' → 少量短旁白/对白…'
  );
  try {
    const res = await fetch('/api/hub/novel-extract', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        text,
        mode: 'compress',
        withChoice,
        title: ($('#mkNovelTitle')?.value || '').trim() || (work && work.title) || '',
        orientation: novelOrient,
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success || !d.work) throw new Error(d.error || '压缩失败');
    if (d.warning) toast(d.warning, true);

    const draftBlocks = normalizeWork({ ...d.work, kind: WORK_KIND })?.chapters?.[0]?.blocks || [];
    if (!draftBlocks.length) throw new Error('没有生成镜头');

    if (append && work) {
      if (!work.chapters?.[0]) {
        work.chapters = [{ id: 'ch_' + uid().slice(2), title: '第一章', blocks: [] }];
      }
      const ch = work.chapters[0];
      if (!Array.isArray(ch.blocks)) ch.blocks = [];
      draftBlocks.forEach((b) => {
        if (!b.id) b.id = uid();
        ch.blocks.push(b);
      });
      selectedId = draftBlocks[0].id;
      editBranch = null;
      scheduleSave();
      $('#mkNovelModal')?.classList.remove('show');
      showEdit();
      toast('已追加 ' + draftBlocks.length + ' 个压缩镜头');
      return;
    }

    const draft = normalizeWork({ ...d.work, kind: WORK_KIND });
    const title = (draft.title || '互动改编').slice(0, 40);
    const created = await fetch('/api/stories', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        title,
        orientation: draft.orientation || novelOrient,
        imgQuality: 'standard',
        kind: WORK_KIND,
      }),
    });
    const cd = await created.json().catch(() => ({}));
    if (!created.ok || !cd.success || !cd.story) throw new Error(cd.error || '创建作品失败');
    draft.id = cd.story.id;
    draft.title = title;
    draft.status = cd.story.status || 'draft';
    if (!draft.chapters?.[0]) {
      draft.chapters = [{ id: 'ch_' + uid().slice(2), title: '第一章', blocks: [] }];
    }
    const put = await fetch('/api/stories/' + encodeURIComponent(draft.id), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ data: draft }),
    });
    const pd = await put.json().catch(() => ({}));
    if (!put.ok || !pd.success) throw new Error(pd.error || '保存镜头失败');
    $('#mkNovelModal')?.classList.remove('show');
    work = normalizeWork(draft);
    selectedId = blocks()[0]?.id || null;
    editBranch = null;
    showEdit();
    toast('已压缩为《' + title + '》· ' + draftBlocks.length + ' 镜');
  } catch (e) {
    setNovelStatus(e.message || '压缩失败', true);
    toast(e.message || '压缩失败', true);
  } finally {
    novelBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = '压缩所选为镜头'; }
  }
}

function bindNovelUi() {
  const openBtn = $('#mkNovelBtn');
  if (openBtn) openBtn.addEventListener('click', () => openNovelModal('gen'));
  $('#mkNovelClose')?.addEventListener('click', () => $('#mkNovelModal')?.classList.remove('show'));
  $('#mkNovelGenBtn')?.addEventListener('click', runNovelGenerate);
  $('#mkNovelExtBtn')?.addEventListener('click', runNovelExtract);
  const novelTa = $('#mkNovelText');
  if (novelTa) {
    novelTa.addEventListener('mouseup', updateNovelSelHint);
    novelTa.addEventListener('keyup', updateNovelSelHint);
    novelTa.addEventListener('select', updateNovelSelHint);
  }
  $$('#mkNovelTabs button').forEach((b) => {
    b.addEventListener('click', () => {
      setNovelTab(b.dataset.tab);
      if (b.dataset.tab === 'ext') updateNovelSelHint();
    });
  });
  $$('#mkNovelOrient button').forEach((b) => {
    b.addEventListener('click', () => {
      novelOrient = b.dataset.o === 'portrait' ? 'portrait' : 'landscape';
      $$('#mkNovelOrient button').forEach((x) => x.classList.toggle('on', x.dataset.o === novelOrient));
    });
  });
}

function bind() {
  bindNovelUi();
  $('#mkNewBtn').addEventListener('click', openCreateModal);
  $('#mkModalCancel').addEventListener('click', () => $('#mkModal').classList.remove('show'));
  $('#mkModalBack').addEventListener('click', () => setCreateStep(1));
  $('#mkModalNext').addEventListener('click', goCreateStep2);
  $('#mkModalOk').addEventListener('click', confirmCreate);
  $('#mkNewTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (createStep === 1) goCreateStep2();
      else confirmCreate();
    }
  });
  $$('#mkCreateOrient button').forEach((b) => {
    b.addEventListener('click', () => {
      createOrient = b.dataset.o === 'portrait' ? 'portrait' : 'landscape';
      $$('#mkCreateOrient button').forEach((x) => x.classList.toggle('on', x.dataset.o === createOrient));
    });
  });
  $$('.mk-kind button').forEach((b) => {
    b.addEventListener('click', () => {
      createKind = b.dataset.k;
      $$('.mk-kind button').forEach((x) => x.classList.toggle('on', x.dataset.k === createKind));
    });
  });
  ['mkAddBtn', 'mkAddBtnTop', 'mkAddBtnHead'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', openAddPicker);
  });
  const genPromptsBtn = document.getElementById('mkGenPromptsBtn');
  if (genPromptsBtn) genPromptsBtn.addEventListener('click', genMissingScenePrompts);
  $('#mkPlayBtn').addEventListener('click', startPlay);
  $('#mkPubBtn').addEventListener('click', togglePublish);
  $('#mkDelBtn').addEventListener('click', () => {
    if (!work || !selectedBlock()) return;
    deleteSelectedShot();
  });
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
