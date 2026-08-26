// 卡牌内核：数据表驱动（角色/关卡/羁绊），战斗是速度条自动出手。
// 不整仓搬 GPL 游戏；表结构参考常见 MIT 自动战斗原型（单位+关卡+加成）。
import { toast } from '/workspace/js/ui.js';
import {
  paintIdleShell,
  normalizeIdleProgress,
  idleProgressOf,
  rewardIdleStage,
  portraitHtml,
  pullGacha,
  levelUpChar,
  starUpChar,
  ownedOf,
  fightHp,
  fightAtk,
  renderGachaResult,
  bindPortraitZoom,
  makePortraitZoomCtx,
  buildCharSheet,
  CARD_FRAMES,
  normalizeCardFrame,
  frameLabel,
  frameLabelFor,
  frameOverlayHtml,
  cardFrameClass,
  portraitKindOf,
  portraitThumbHtml,
  portraitMediaInner,
} from '/story-idle.js';

export const ROGUE_KIND = 'gacha_rogue';
export const CARD_MODES = {
  idle: {
    id: 'idle',
    label: '女神挂机',
    hint: '竖屏挂机：主城立绘 · 召唤卡池 · 升级升星 · 挂机推关。',
    need: '至少 1 个角色（可上传立绘）、1 关。',
  },
  queue: {
    id: 'queue',
    label: '修仙自动战',
    hint: '像回合卡牌：选阵容，速度条自动放技能。积木 = 角色 + 羁绊 + 关卡。',
    need: '角色、关卡；羁绊可空。指定几人上场会加成。',
  },
  rogue: {
    id: 'rogue',
    label: '每局都不同',
    hint: '肉鸽副本：每局随机技能/遗物。积木仍是角色和关卡。',
    need: '角色 + 敌人。遗物和事件可空。',
  },
};
const FACTIONS = {
  idle: [['light', '光明'], ['dark', '暗影']],
  queue: [['ren', '人族'], ['dao', '道族'], ['fo', '佛族'], ['yao', '妖族']],
  rogue: [['fire', '火'], ['water', '水'], ['wood', '木'], ['light', '光'], ['dark', '暗']],
};

const ELEM = {
  fire: { id: 'fire', label: '火', beats: 'wood' },
  water: { id: 'water', label: '水', beats: 'fire' },
  wood: { id: 'wood', label: '木', beats: 'water' },
  light: { id: 'light', label: '光', beats: 'dark' },
  dark: { id: 'dark', label: '暗', beats: 'light' },
};
const ELEMS = Object.keys(ELEM);
const SKILL_KINDS = ['atk', 'heal', 'buff'];
const SKILL_KIND_ZH = { atk: '攻击', heal: '治疗', buff: '强化' };
const RELIC_TYPES = ['atk_pct', 'spd', 'hp_pct', 'elem_bonus'];
const NODE_LABEL = {
  battle: '战斗', elite: '精英', event: '事件', relic: '遗物', rest: '休整', boss: 'BOSS',
};

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export function isRogueKind(k) { return k === ROGUE_KIND; }
export function modeOf(r) {
  const m = r && r.mode;
  return CARD_MODES[m] ? m : 'idle';
}

export function emptyRogue() {
  return {
    mode: 'idle',
    teamSize: 4,
    floors: 3,
    roster: [],
    skills: [],
    relics: [],
    events: [],
    enemies: [],
    bonds: [],
    stages: [],
    progress: { stageIdx: 0, gold: 500, teamIds: [], chars: {} },
    gacha: { cost: 80 },
  };
}

export function normalizeRogue(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = emptyRogue();
  const looksRogue = (r.mode === 'rogue') || (!r.mode && ((r.relics || []).length || (r.events || []).length));
  out.mode = CARD_MODES[r.mode] ? r.mode : (looksRogue ? 'rogue' : 'idle');
  out.teamSize = clamp(r.teamSize, 1, 6, 4);
  out.floors = clamp(r.floors, 2, 8, 3);
  out.roster = (Array.isArray(r.roster) ? r.roster : []).filter(x => x && x.name).map(c => ({
    id: c.id || uid(),
    name: String(c.name).trim().slice(0, 16) || '未名',
    elem: ELEMS.includes(c.elem) ? c.elem : 'fire',
    faction: String(c.faction || '').slice(0, 12),
    star: clamp(c.star, 1, 5, 1),
    hp: clamp(c.hp, 40, 99999, 120),
    atk: clamp(c.atk, 4, 99, 18),
    spd: clamp(c.spd, 6, 40, 16),
    skillIds: Array.isArray(c.skillIds) ? c.skillIds.map(String).slice(0, 8) : [],
    portrait: String(c.portrait || '').trim().slice(0, 512),
    portraitKind: c.portraitKind === 'video' ? 'video' : 'image',
    desc: String(c.desc || '').trim().slice(0, 120),
    frame: normalizeCardFrame(c.frame, c.star),
    frameAssetId: String(c.frameAssetId || '').trim().slice(0, 64),
  }));
  out.roster.forEach(c => {
    if (out.mode === 'rogue') {
      c.faction = ELEMS.includes(c.elem) ? c.elem : 'fire';
    } else if (out.mode === 'idle') {
      c.faction = (c.faction === 'dark' || c.elem === 'dark') ? 'dark' : 'light';
      c.elem = c.faction;
    } else {
      const ids = factionPairs('queue').map(x => x[0]);
      if (!ids.includes(c.faction)) c.faction = 'ren';
      c.elem = elemFromFaction('queue', c.faction);
    }
  });
  let skills = (Array.isArray(r.skills) ? r.skills : []).filter(x => x && x.name).map(s => ({
    id: s.id || uid(),
    name: String(s.name).trim().slice(0, 16) || '技能',
    kind: SKILL_KINDS.includes(s.kind) ? s.kind : 'atk',
    power: clamp(s.power, 40, 240, 100),
    elem: ELEMS.includes(s.elem) ? s.elem : '',
    ownerId: String(s.ownerId || ''),
    desc: String(s.desc || '').trim().slice(0, 60),
  }));
  (Array.isArray(r.roster) ? r.roster : []).forEach(c => {
    if (!c || !Array.isArray(c.skills)) return;
    c.skills.filter(x => x && x.name).forEach(s => {
      skills.push({
        id: s.id || uid(),
        name: String(s.name).trim().slice(0, 16),
        kind: SKILL_KINDS.includes(s.kind) ? s.kind : 'atk',
        power: clamp(s.power, 40, 240, 100),
        elem: ELEMS.includes(s.elem) ? s.elem : (c.elem || ''),
        ownerId: c.id || '',
        desc: '',
      });
    });
  });
  const seen = new Set();
  out.skills = skills.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  out.roster.forEach(c => {
    if (!c.skillIds.length) {
      c.skillIds = out.skills.filter(s => s.ownerId === c.id).map(s => s.id);
    }
  });
  out.relics = (Array.isArray(r.relics) ? r.relics : []).filter(x => x && x.name).map(x => ({
    id: x.id || uid(),
    name: String(x.name).trim().slice(0, 16) || '遗物',
    desc: String(x.desc || '').trim().slice(0, 80),
    effect: {
      type: RELIC_TYPES.includes((x.effect || {}).type) ? x.effect.type : 'atk_pct',
      val: clamp((x.effect || {}).val, 1, 50, 10),
    },
  }));
  out.events = (Array.isArray(r.events) ? r.events : []).filter(x => x && x.title).map(e => ({
    id: e.id || uid(),
    title: String(e.title).trim().slice(0, 24) || '事件',
    text: String(e.text || '').trim().slice(0, 160),
    choices: (Array.isArray(e.choices) ? e.choices : []).slice(0, 3).map(c => ({
      label: String((c && c.label) || '继续').slice(0, 16),
      kind: ['heal', 'relic', 'card', 'none'].includes(c && c.kind) ? c.kind : 'none',
    })),
  }));
  out.enemies = (Array.isArray(r.enemies) ? r.enemies : []).filter(x => x && x.name).map(e => ({
    id: e.id || uid(),
    name: String(e.name).trim().slice(0, 16) || '敌人',
    elem: ELEMS.includes(e.elem) ? e.elem : 'wood',
    hp: clamp(e.hp, 20, 99999, 80),
    atk: clamp(e.atk, 4, 80, 12),
    spd: clamp(e.spd, 6, 36, 14),
    isBoss: !!e.isBoss,
    portrait: String(e.portrait || '').trim().slice(0, 240),
  }));
  out.bonds = (Array.isArray(r.bonds) ? r.bonds : []).filter(b => b && b.name).map(b => ({
    id: b.id || uid(),
    name: String(b.name).trim().slice(0, 20) || '羁绊',
    unitIds: Array.isArray(b.unitIds) ? b.unitIds.map(String).slice(0, 6) : [],
    atkPct: clamp(b.atkPct, 5, 80, 15),
  }));
  out.stages = (Array.isArray(r.stages) ? r.stages : []).filter(s => s && (s.title || (s.enemyIds || []).length)).map((s, i) => ({
    id: s.id || uid(),
    title: String(s.title || ('第' + (i + 1) + '关')).trim().slice(0, 20),
    enemyIds: Array.isArray(s.enemyIds) ? s.enemyIds.map(String).slice(0, 8) : [],
  }));
  if (!out.stages.length && out.enemies.length) {
    out.stages = out.enemies.map((e, i) => ({
      id: 'st_' + e.id,
      title: e.isBoss ? '首领 · ' + e.name : '第' + (i + 1) + '关 · ' + e.name,
      enemyIds: [e.id],
    }));
  }
  // 必须带上已存进度，否则通关金币/等级每次进游戏都会被 emptyRogue 的默认 500 盖掉
  if (r.progress && typeof r.progress === 'object') {
    out.progress = r.progress;
  }
  out.progress = normalizeIdleProgress(out, out.stages.length);
  return out;
}

export function cardGuideText(story) {
  const r = normalizeRogue(story && story.rogue);
  const m = CARD_MODES[r.mode];
  const okC = r.roster.length > 0;
  const okE = r.enemies.length > 0;
  return {
    mode: r.mode,
    title: m.label,
    hint: m.hint,
    need: m.need,
    ready: okC && (okE || r.stages.length > 0),
    line: !okC ? '还差：加一块「角色」。' : (!okE ? '还差：加一块「关卡」。' : '积木齐了，点右上角播放。'),
    counts: `角色 ${r.roster.length} · 关卡 ${r.stages.length || r.enemies.length} · 羁绊 ${r.bonds.length}` + (r.mode === 'rogue' ? ` · 遗物 ${r.relics.length}` : ''),
  };
}

function uid() { return 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function clamp(n, lo, hi, d) {
  const v = Number(n);
  if (!Number.isFinite(v)) return d;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
function elemMul(a, d) {
  if (!a || !d || !ELEM[a]) return 1;
  if (ELEM[a].beats === d) return 1.35;
  if (ELEM[d] && ELEM[d].beats === a) return 0.75;
  return 1;
}
function mulberry(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(rng, arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.max(0, n));
}
function elemLabel(id) { return (ELEM[id] && ELEM[id].label) || '—'; }
function factionPairs(mode) { return FACTIONS[mode] || FACTIONS.rogue; }
function factionLabel(mode, id) {
  const hit = factionPairs(mode).find(x => x[0] === id);
  return hit ? hit[1] : (id || '—');
}
function elemFromFaction(mode, faction) {
  if (mode === 'idle') return faction === 'dark' ? 'dark' : 'light';
  if (mode === 'queue') {
    if (faction === 'dao') return 'water';
    if (faction === 'fo') return 'light';
    if (faction === 'yao') return 'wood';
    return 'fire';
  }
  return ELEMS.includes(faction) ? faction : 'fire';
}
function skillsOf(r, charId) {
  return (r.skills || []).filter(s => s.ownerId === charId || !s.ownerId);
}
function bondAtkMul(r, teamIds) {
  const set = new Set(teamIds);
  let mul = 1;
  (r.bonds || []).forEach(b => {
    if (!b.unitIds || b.unitIds.length < 2) return;
    if (b.unitIds.every(id => set.has(id))) mul += (Number(b.atkPct) || 0) / 100;
  });
  return mul;
}

let run = null;
let tickTimer = null;
let autoTimer = null;

export function stopRogueRun() {
  if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  run = null;
}
function later(fn, ms) {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = setTimeout(fn, ms);
}

function relicMods(relics) {
  const m = { atk: 1, spd: 0, hp: 1, elem: 0 };
  (relics || []).forEach(x => {
    const t = (x.effect || {}).type, v = Number((x.effect || {}).val) || 0;
    if (t === 'atk_pct') m.atk += v / 100;
    if (t === 'spd') m.spd += v;
    if (t === 'hp_pct') m.hp += v / 100;
    if (t === 'elem_bonus') m.elem += v / 100;
  });
  return m;
}

function stageNodes(r) {
  if ((r.stages || []).length) {
    return r.stages.map((s) => {
      const ids = (s.enemyIds || []).filter(Boolean);
      const hasBossEnemy = ids.some((id) => {
        const e = r.enemies.find((x) => x.id === id);
        return e && e.isBoss;
      });
      const bossTitle = /首领|boss/i.test(String(s.title || ''));
      const type = hasBossEnemy || bossTitle ? 'boss' : 'battle';
      return { type, enemyIds: ids, title: s.title };
    });
  }
  const enemies = r.enemies || [];
  const list = enemies.length ? enemies : [{ id: 'm', name: '练习木桩', hp: 40, atk: 6, spd: 10, elem: 'wood' }];
  const normals = list.filter(e => !e.isBoss);
  const bosses = list.filter(e => e.isBoss);
  const nodes = (normals.length ? normals : list).map(e => ({ type: 'battle', enemyIds: [e.id], title: e.name }));
  if (bosses.length) nodes.push({ type: 'boss', enemyIds: [bosses[0].id], title: bosses[0].name });
  return nodes;
}

function buildRogueMap(rng, floors, enemies) {
  const normals = enemies.filter(e => !e.isBoss);
  const bosses = enemies.filter(e => e.isBoss);
  const nodes = [];
  for (let f = 1; f <= floors; f++) {
    const last = f === floors;
    if (last) {
      nodes.push({ type: 'rest' });
      const boss = bosses[0] || normals[0] || { id: 'boss', name: '门卫', hp: 220, atk: 18, spd: 12, elem: 'dark', isBoss: true };
      nodes.push({ type: 'boss', enemyIds: [boss.id] });
    } else {
      const a = pick(rng, normals.length ? normals : [{ id: 'm1', name: '杂兵', hp: 60, atk: 10, spd: 12, elem: 'wood' }], 1);
      nodes.push({ type: 'battle', enemyIds: a.map(x => x.id) });
      nodes.push({ type: 'event' });
      nodes.push({ type: f % 2 === 0 ? 'elite' : 'battle', enemyIds: pick(rng, normals.length ? normals : a, 1).map(x => x.id) });
      nodes.push({ type: 'relic' });
    }
  }
  return nodes;
}

export function startRogueRun(block, ctx) {
  stopRogueRun();
  const story = ctx.story;
  const rogue = normalizeRogue(story && story.rogue);
  if (story) story.rogue = rogue;
  const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
  run = {
    ctx, story, block: block || {}, rogue, seed, rng: mulberry(seed),
    phase: 'pick_team', team: [], relics: [], nodes: [], nodeIdx: 0,
    speed: 1, battle: null, pickOpts: null, idleTab: 'home',
  };
  bindIdleCtx(ctx);
  if (!rogue.roster.length) { run.phase = 'empty'; paint(); return; }
  if (rogue.mode === 'idle') {
    run.phase = 'home';
    paint();
    return;
  }
  if (rogue.roster.length <= rogue.teamSize) {
    beginRun(rogue.roster.slice(0, rogue.teamSize).map(c => c.id));
    return;
  }
  paint();
}

function bindIdleCtx(ctx) {
  ctx.onIdleTab = (tab) => {
    if (!run || run.rogue.mode !== 'idle') return;
    const ok = tab === 'book' || tab === 'stages' || tab === 'gacha';
    run.idleTab = ok ? tab : 'home';
    run.phase = run.idleTab === 'home' ? 'home' : run.idleTab;
    paint();
  };
  ctx.onIdlePush = (teamIds) => {
    if (!run || run.rogue.mode !== 'idle') return;
    const ids = (teamIds && teamIds.length)
      ? teamIds
      : (run.rogue.progress.teamIds || []).slice(0, run.rogue.teamSize);
    if (!ids.length) { toast('先在女神册选人', true); return; }
    beginRun(ids);
  };
  ctx.onIdleToggleTeam = (id) => {
    if (!run || run.rogue.mode !== 'idle') return;
    const r = run.rogue;
    const prog = normalizeIdleProgress(r, (r.stages || []).length);
    if (!prog.chars[id]) { toast('先召唤到这个角色', true); return; }
    const i = prog.teamIds.indexOf(id);
    if (i >= 0) prog.teamIds.splice(i, 1);
    else if (prog.teamIds.length < (r.teamSize || 4)) prog.teamIds.push(id);
    else { toast('阵容已满，先点掉一个', true); return; }
    r.progress = prog;
    if (run.story) run.story.rogue = r;
    if (run.ctx.onPersist) run.ctx.onPersist();
    run.phase = 'book';
    run.idleTab = 'book';
    paint();
  };
  ctx.onIdleGacha = (n) => {
    if (!run || run.rogue.mode !== 'idle') return;
    const res = pullGacha(run.rogue, n);
    if (!res.ok) { toast(res.error || '抽卡失败', true); return; }
    run.gachaLast = res.results;
    if (run.story) run.story.rogue = run.rogue;
    if (run.ctx.onPersist) run.ctx.onPersist();
    toast(n >= 10 ? '十连完成' : '抽到了！');
    run.phase = 'gacha';
    run.idleTab = 'gacha';
    paint();
  };
  ctx.onIdleLevelUp = (id) => {
    if (!run || run.rogue.mode !== 'idle') return;
    const res = levelUpChar(run.rogue, id);
    if (!res.ok) { toast(res.error || '升级失败', true); return; }
    if (run.story) run.story.rogue = run.rogue;
    if (run.ctx.onPersist) run.ctx.onPersist();
    toast('升到 Lv.' + res.level);
    run.idleCharId = id;
    run.phase = 'book';
    run.idleTab = 'book';
    paint();
  };
  ctx.onIdleStarUp = (id) => {
    if (!run || run.rogue.mode !== 'idle') return;
    const res = starUpChar(run.rogue, id);
    if (!res.ok) { toast(res.error || '升星失败', true); return; }
    if (run.story) run.story.rogue = run.rogue;
    if (run.ctx.onPersist) run.ctx.onPersist();
    toast('升到 ' + res.star + '★');
    run.idleCharId = id;
    run.phase = 'book';
    run.idleTab = 'book';
    paint();
  };
}

function goIdleHome() {
  if (!run) return;
  run.phase = 'home';
  run.idleTab = 'home';
  run.battle = null;
  paint();
}

function paint() {
  if (!run) return;
  if (run.ctx.playNav) run.ctx.playNav.classList.add('hidden');
  const body = run.ctx.playBody;
  body.innerHTML = '';
  const frame = document.createElement('div');
  frame.className = 'battle-view rogue-view' + (run.ctx.orientation === 'portrait' ? ' portrait' : '');
  body.appendChild(frame);
  if (run.phase === 'empty') {
    frame.innerHTML = `<div class="bt-result"><div class="bt-result-title">还没有角色</div>
      <div class="bt-result-text">打开「卡牌工作室」，加一块角色和一块关卡；或点「帮我填一套能玩的」。</div>
      <div class="bt-result-ops"><button class="btn ghost" id="rgExit">退出</button></div></div>`;
    frame.querySelector('#rgExit').addEventListener('click', run.ctx.onExit);
    return;
  }
  if (run.phase === 'home' || run.phase === 'book' || run.phase === 'stages' || run.phase === 'gacha') {
    paintIdleShell(frame, run, run.phase === 'home' ? 'home' : run.phase);
    if (run.phase === 'gacha' && run.gachaLast && run.gachaLast.length) {
      renderGachaResult(frame, run.rogue, run.gachaLast);
    }
    return;
  }
  if (run.phase === 'pick_team') return paintPick(frame);
  if (run.phase === 'map') return paintMap(frame);
  if (run.phase === 'battle') return paintBattle(frame);
  if (run.phase === 'card_pick' || run.phase === 'relic_pick') return paintPick3(frame);
  if (run.phase === 'event') return paintEvent(frame);
  if (run.phase === 'rest') return paintRest(frame);
  if (run.phase === 'won' || run.phase === 'lost') return paintEnd(frame);
}

function paintPick(frame) {
  const r = run.rogue;
  const n = r.teamSize;
  const goTxt = r.mode === 'rogue' ? '出发（本局随机技能）' : '上阵开战';
  frame.innerHTML = `<div class="rg-head"><b>选出场的人</b><span>最多 ${n} 人。点选的前两个是前排（受伤多、打得也重一点）。</span>
    <button class="btn tiny ghost" id="rgExit">退出</button></div>
    <div class="rg-pick" id="rgPick"></div>
    <div class="rg-ops"><button class="btn primary" id="rgGo">${goTxt}</button></div>`;
  frame.querySelector('#rgExit').addEventListener('click', run.ctx.onExit);
  const host = frame.querySelector('#rgPick');
  const selected = [];
  r.roster.forEach(c => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'rg-unit';
    el.innerHTML = `<div class="nm">${esc(c.name)}</div>
      <div class="meta">${factionLabel(r.mode, c.faction)} · ${c.star || 1}星 · 生命${c.hp} 攻${c.atk}</div>`;
    el.addEventListener('click', () => {
      const i = selected.indexOf(c.id);
      if (i >= 0) selected.splice(i, 1);
      else if (selected.length < n) selected.push(c.id);
      host.querySelectorAll('.rg-unit').forEach((x, idx) => {
        const id = r.roster[idx].id;
        const p = selected.indexOf(id);
        x.classList.toggle('sel', p >= 0);
        x.classList.toggle('front', p >= 0 && p < 2);
      });
    });
    host.appendChild(el);
  });
  frame.querySelector('#rgGo').addEventListener('click', () => {
    if (!selected.length) { toast('点一下角色，选谁上场', true); return; }
    beginRun(selected);
  });
}

function charCards(r, c, rng) {
  const mine = r.skills.filter(s => s.ownerId === c.id);
  const pool = mine.length ? mine : r.skills.filter(s => !s.ownerId);
  const fallback = [{ id: 'basic_' + c.id, name: '普攻', kind: 'atk', power: 100, elem: c.elem }];
  const src = pool.length ? pool : fallback;
  if (r.mode === 'rogue') return pick(rng, src, Math.min(2, src.length)).map(s => s.id);
  if (r.mode === 'idle') return [src[0].id];
  return src.map(s => s.id);
}

function beginRun(ids) {
  const r = run.rogue;
  const rng = run.rng;
  const bond = bondAtkMul(r, ids);
  const prog = normalizeIdleProgress(r, (r.stages || []).length);
  run.team = ids.map((id, slot) => {
    const c = r.roster.find(x => x.id === id) || r.roster[0];
    const owned = prog.chars[id] || { level: 1, exp: 0, star: c.star || 1, copies: 0 };
    const atk = Math.round(fightAtk(c, owned) * bond);
    const hp = fightHp(c, owned);
    return {
      id: c.id, name: c.name, elem: c.elem, slot, front: slot < 2,
      maxHp: hp, hp, atk, spd: c.spd, portrait: c.portrait || '',
      portraitKind: portraitKindOf(c), star: c.star || 1,
      frame: normalizeCardFrame(c.frame, c.star),
      gauge: 0, buff: 0, next: 0, cards: charCards(r, c, rng),
    };
  });
  run.nodes = r.mode === 'rogue'
    ? buildRogueMap(rng, r.floors, r.enemies)
    : stageNodes(r);
  run.nodeIdx = (r.mode === 'idle')
    ? Math.min(prog.stageIdx, Math.max(0, run.nodes.length - 1))
    : 0;
  if (r.mode === 'idle' && prog.stageIdx >= run.nodes.length) {
    toast('已经通关了，可在工作室加更多关卡');
    goIdleHome();
    return;
  }
  run.relics = [];
  run.phase = 'map';
  paint();
}

function paintMap(frame) {
  const node = run.nodes[run.nodeIdx];
  const mode = run.rogue.mode;
  const title = mode === 'idle' ? '推关（自动连打）' : (mode === 'queue' ? '关卡' : '这一局的路');
  const sub = mode === 'rogue' ? `每局不同 · 种子 ${run.seed.toString(16)}` : (mode === 'idle' ? '不用点，关卡会自己进' : '对局里不用点，速度条满了会动手');
  frame.innerHTML = `<div class="rg-head"><b>${title}</b><span>${sub}</span>
    <button class="btn tiny ghost" id="rgExit">退出</button></div>
    <div class="rg-teamline" id="rgTeam"></div>
    <div class="rg-map" id="rgMap"></div>
    <div class="rg-ops"><button class="btn primary" id="rgEnter">${node ? '开始：' + (node.title || NODE_LABEL[node.type] || node.type) : '结束'}</button></div>`;
  frame.querySelector('#rgExit').addEventListener('click', run.ctx.onExit);
  run.team.forEach(m => {
    const d = document.createElement('div');
    d.className = 'rg-chip' + (m.hp <= 0 ? ' dead' : '');
    d.textContent = `${m.front ? '前' : '后'} ${m.name} ${m.hp}/${m.maxHp}`;
    frame.querySelector('#rgTeam').appendChild(d);
  });
  run.nodes.forEach((n, i) => {
    const el = document.createElement('div');
    el.className = 'rg-node' + (i === run.nodeIdx ? ' cur' : '') + (i < run.nodeIdx ? ' done' : '');
    el.textContent = `${i + 1}. ${n.title || NODE_LABEL[n.type] || n.type}`;
    frame.querySelector('#rgMap').appendChild(el);
  });
  frame.querySelector('#rgEnter').addEventListener('click', enterNode);
  if (mode === 'idle') later(() => { if (run && run.phase === 'map') enterNode(); }, 450);
}

function enterNode() {
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  const node = run.nodes[run.nodeIdx];
  if (!node) { run.phase = 'won'; paint(); return; }
  if (node.type === 'rest') { run.phase = 'rest'; paint(); return; }
  if (node.type === 'event') { startEvent(); return; }
  if (node.type === 'relic') { startRelicPick(); return; }
  startBattleNode(node);
}

function livingEnemiesFrom(node) {
  const r = run.rogue;
  let list = (node.enemyIds || []).map(id => r.enemies.find(e => e.id === id)).filter(Boolean);
  if (!list.length) list = [{ name: '练习木桩', hp: 40, atk: 6, spd: 10, elem: 'wood' }];
  if (node.type === 'elite') list = list.map(e => ({ ...e, hp: Math.round(e.hp * 1.35), atk: Math.round(e.atk * 1.15) }));
  if (node.type === 'boss') list = list.map(e => ({ ...e, hp: Math.max(e.hp, 160), isBoss: true }));
  return list.map((e, i) => ({
    id: (e.id || 'e') + '_' + i, name: e.name, elem: e.elem || 'wood',
    maxHp: e.hp, hp: e.hp, atk: e.atk, spd: e.spd, gauge: 0, isEnemy: true,
    portrait: e.portrait || '',
  }));
}

function startBattleNode(node) {
  if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
  const mods = relicMods(run.relics);
  run.team.forEach(m => {
    if (m.hp > 0) {
      m.gauge = 0;
      m.spdBattle = m.spd + mods.spd;
      m.maxHpBattle = Math.round(m.maxHp * mods.hp);
      if (m.hp > m.maxHpBattle) m.hp = m.maxHpBattle;
    }
  });
  run.battle = {
    enemies: livingEnemiesFrom(node),
    log: [`⚔️ ${NODE_LABEL[node.type]}`],
    phase: 'running',
    majorFight: isMajorFightNode(node),
  };
  run.phase = 'battle';
  paint();
  tickTimer = setTimeout(battleTick, 80);
}

function skillOf(id) {
  return run.rogue.skills.find(s => s.id === id) || { name: '普攻', kind: 'atk', power: 100, elem: '' };
}
function nextSkill(m) {
  if (!m.cards || !m.cards.length) return { name: '普攻', kind: 'atk', power: 90, elem: m.elem };
  const id = m.cards[m.next % m.cards.length];
  m.next = (m.next + 1) % Math.max(1, m.cards.length);
  return skillOf(id);
}
function posTakenMul(m) { return m.front ? 1.15 : 0.85; }
function posAtkMul(m) { return m.front ? 1.05 : 0.95; }

function battleTick() {
  if (!run || run.phase !== 'battle' || !run.battle || run.battle.phase !== 'running') return;
  const mods = relicMods(run.relics);
  const party = run.team.filter(m => m.hp > 0);
  const foes = run.battle.enemies.filter(e => e.hp > 0);
  if (!foes.length) { finishBattle(true); return; }
  if (!party.length) { finishBattle(false); return; }
  const units = [...party.map(m => ({ who: m, enemy: false })), ...foes.map(e => ({ who: e, enemy: true }))];
  const step = (4 + run.speed * 3);
  units.forEach(u => { u.who.gauge = (u.who.gauge || 0) + (u.who.spdBattle || u.who.spd || 12) * step / 20; });
  let actor = null;
  units.forEach(u => {
    if (u.who.gauge >= 100 && (!actor || u.who.gauge > actor.who.gauge)) actor = u;
  });
  if (actor) {
    actor.who.gauge -= 100;
    resolveAct(actor.who, actor.enemy, mods);
    if (run.battle.log.length > 36) run.battle.log = run.battle.log.slice(-36);
  }
  paint();
  if (run.phase === 'battle' && run.battle.phase === 'running') {
    tickTimer = setTimeout(battleTick, run.speed >= 4 ? 16 : (run.speed === 2 ? 40 : 80));
  }
}

function resolveAct(who, isEnemy, mods) {
  const party = run.team.filter(m => m.hp > 0);
  const foes = run.battle.enemies.filter(e => e.hp > 0);
  if (isEnemy) {
    const t = party[Math.floor(Math.random() * party.length)];
    if (!t) return;
    const dmg = Math.max(1, Math.round(who.atk * posTakenMul(t) * elemMul(who.elem, t.elem)));
    t.hp = Math.max(0, t.hp - dmg);
    run.battle.log.push(`${who.name} → ${t.name} ${dmg}`);
    return;
  }
  const sk = nextSkill(who);
  if (sk.kind === 'heal') {
    const t = party.slice().sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
    const heal = Math.max(1, Math.round((who.atk * (sk.power / 100)) * 0.8));
    t.hp = Math.min(t.maxHpBattle || t.maxHp, t.hp + heal);
    run.battle.log.push(`${who.name} 治疗 ${t.name} +${heal}`);
    return;
  }
  if (sk.kind === 'buff') {
    who.buff = (who.buff || 0) + 1;
    run.battle.log.push(`${who.name} 蓄力`);
    return;
  }
  const t = foes[0];
  if (!t) return;
  const elem = sk.elem || who.elem;
  let mul = elemMul(elem, t.elem) + (mods.elem || 0);
  if (who.buff > 0) { mul *= 1.35; who.buff -= 1; }
  const dmg = Math.max(1, Math.round(who.atk * posAtkMul(who) * mods.atk * (sk.power / 100) * mul));
  t.hp = Math.max(0, t.hp - dmg);
  run.battle.log.push(`${who.name}「${sk.name}」→ ${t.name} ${dmg}`);
}

function isMajorFightNode(node) {
  if (!node) return false;
  if (node.type === 'boss' || node.type === 'elite') return true;
  const ids = node.enemyIds || [];
  return ids.some((id) => {
    const e = run.rogue.enemies.find((x) => x.id === id);
    return e && e.isBoss;
  });
}

function finishBattle(win) {
  if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
  const major = !!(run.battle && run.battle.majorFight);
  if (!win) {
    run.battle.phase = 'lost';
    paint();
    return;
  }
  // 普通小怪：不进入「赢了」界面，直接发奖并推进
  if (!major) {
    afterWin({ quiet: true });
    return;
  }
  run.battle.phase = 'won';
  paint();
}

function afterWin(opts) {
  const quiet = !!(opts && opts.quiet);
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  run.team.forEach(m => { if (m.hp > 0) m.hp = Math.min(m.maxHp, m.hp + Math.round(m.maxHp * 0.12)); });
  if (run.rogue.mode === 'idle') {
    const reward = rewardIdleStage(run.rogue, run.nodeIdx);
    if (run.story) run.story.rogue = run.rogue;
    if (run.ctx.onPersist) run.ctx.onPersist();
    if (!quiet) toast('通关 +' + reward.gold + ' 金币，上阵角色 +' + reward.exp + ' 经验');
  }
  if (run.rogue.mode === 'rogue') startCardPick();
  else advanceNode();
}

function startCardPick() {
  const pool = run.rogue.skills.filter(s => run.team.some(m => m.hp > 0 && (!s.ownerId || s.ownerId === m.id)));
  const src = pool.length ? pool : run.rogue.skills;
  run.pickOpts = pick(run.rng, src.length ? src : [{ id: 'x', name: '余烬', kind: 'atk', power: 110, elem: 'fire' }], 3);
  run.pickKind = 'card';
  run.phase = 'card_pick';
  paint();
}
function startRelicPick() {
  const have = new Set(run.relics.map(x => x.id));
  const left = run.rogue.relics.filter(x => !have.has(x.id));
  const src = left.length ? left : run.rogue.relics;
  run.pickOpts = pick(run.rng, src.length ? src : [{ id: 'r', name: '旧徽章', desc: '攻击变高一点', effect: { type: 'atk_pct', val: 8 } }], 3);
  run.pickKind = 'relic';
  run.phase = 'relic_pick';
  paint();
}
function startEvent() {
  run.event = pick(run.rng, run.rogue.events.length ? run.rogue.events : [{
    title: '路边', text: '要不要歇一下？',
    choices: [{ label: '歇一下（回血）', kind: 'heal' }, { label: '继续走', kind: 'none' }],
  }], 1)[0];
  run.phase = 'event';
  paint();
}
function advanceNode() {
  run.nodeIdx++;
  if (run.nodeIdx >= run.nodes.length) {
    if (run.rogue.mode === 'idle') {
      toast('全部关卡打完了');
      goIdleHome();
      return;
    }
    run.phase = 'won';
    paint();
    return;
  }
  run.phase = 'map';
  paint();
}

function paintBattle(frame) {
  const b = run.battle;
  const winHint = run.rogue.mode === 'rogue' ? '选一张技能带进后面。' : '下一关自动开始。';
  const loseHint = run.rogue.mode === 'rogue' ? '再开一局会换一套技能和事件。' : '改改角色或敌人数值再试。';
  const top = `<div class="bt-top"><div class="bt-round">自动中 · ${run.speed}x</div>
    <div class="rg-speeds">
      <button class="btn tiny ${run.speed === 1 ? 'primary' : ''}" data-sp="1">1x</button>
      <button class="btn tiny ${run.speed === 2 ? 'primary' : ''}" data-sp="2">2x</button>
      <button class="btn tiny ${run.speed === 4 ? 'primary' : ''}" data-sp="4">4x</button>
    </div>
    <button class="btn tiny ghost" id="rgExit">退出</button></div>`;
  const foes = (b.enemies || []).map(e => `
    <div class="bt-enemy${e.hp <= 0 ? ' dead' : ''}" data-enemy-id="${esc(e.id)}">
      ${e.portrait ? `<div class="bt-portrait"><div class="card-art">${portraitMediaInner(e)}</div></div>` : ''}
      <div class="bt-enemy-name">${esc(e.name)} · ${elemLabel(e.elem)}</div>
      <div class="bt-hp-row"><div class="bt-bar"><div class="bt-bar-fill enemy" style="width:${pct(e.hp, e.maxHp)}%"></div></div><span class="bt-hp-num">${e.hp}/${e.maxHp}</span></div>
      <div class="bt-bar rg-spd"><div class="bt-bar-fill spd" style="width:${Math.min(100, e.gauge || 0)}%"></div></div>
    </div>`).join('');
  const party = run.team.map(m => {
    const assets = (run.story && run.story.assets) || [];
    const fcls = cardFrameClass(m, assets);
    const overlay = frameOverlayHtml(m, assets);
    return `
    <div class="bt-member${m.hp <= 0 ? ' dead' : ''}${m.front ? ' hero' : ''}" data-char-id="${esc(m.id)}">
      ${m.portrait ? `<div class="bt-portrait ${fcls}"><div class="card-art">${portraitMediaInner(m)}</div>${overlay}</div>` : ''}
      <div class="bt-member-name">${m.front ? '前' : '后'} ${esc(m.name)} · ${elemLabel(m.elem)}</div>
      <div class="bt-hp-row"><div class="bt-bar"><div class="bt-bar-fill hp" style="width:${pct(m.hp, m.maxHp)}%"></div></div><span class="bt-hp-num">${m.hp}/${m.maxHp}</span></div>
      <div class="bt-bar rg-spd"><div class="bt-bar-fill spd" style="width:${Math.min(100, m.gauge || 0)}%"></div></div>
    </div>`;
  }).join('');
  const log = (b.log || []).slice(-10).map(l => `<div class="bt-log-line">${esc(l)}</div>`).join('');
  let result = '';
  if (b.phase === 'won') {
    result = `<div class="bt-result"><div class="bt-result-title">${b.majorFight ? '首领战胜利' : '赢了'}</div>
      <div class="bt-result-text">${winHint}</div>
      <div class="bt-result-ops"><button class="btn primary" id="rgNext">继续</button></div></div>`;
  } else if (b.phase === 'lost') {
    result = `<div class="bt-result"><div class="bt-result-title lost">倒下了</div>
      <div class="bt-result-text">${loseHint}</div>
      <div class="bt-result-ops"><button class="btn primary" id="rgRetry">${run.rogue.mode === 'idle' ? '回主城' : '再来一次'}</button>
      <button class="btn ghost" id="rgExit2">退出</button></div></div>`;
  }
  frame.innerHTML = `${top}<div class="bt-enemies">${foes}</div><div class="bt-party">${party}</div>
    <div class="bt-log">${log}</div>${result}`;
  frame.querySelectorAll('[data-sp]').forEach(btn => {
    btn.addEventListener('click', () => { run.speed = Number(btn.dataset.sp) || 1; });
  });
  const ex = frame.querySelector('#rgExit');
  if (ex) ex.addEventListener('click', () => {
    const c = run && run.ctx;
    stopRogueRun();
    if (c && c.onExit) c.onExit();
  });
  const nx = frame.querySelector('#rgNext');
  if (nx) nx.addEventListener('click', afterWin);
  const rt = frame.querySelector('#rgRetry');
  if (rt) rt.addEventListener('click', () => {
    if (run.rogue.mode === 'idle') goIdleHome();
    else startRogueRun(run.block, run.ctx);
  });
  const e2 = frame.querySelector('#rgExit2');
  if (e2) e2.addEventListener('click', run.ctx.onExit);
  bindPortraitZoom(frame, makePortraitZoomCtx(run));
}

function pct(a, b) { return b ? Math.max(0, Math.min(100, Math.round(a / b * 100))) : 0; }

function paintPick3(frame) {
  const card = run.pickKind === 'card';
  frame.innerHTML = `<div class="rg-head"><b>${card ? '带一张技能走' : '带一件遗物走'}</b>
    <span>三选一。对局里仍然是自动放，不用点牌。</span></div>
    <div class="rg-pick3" id="rg3"></div>
    <div class="rg-ops"><button class="btn ghost" id="rgSkip">不要</button></div>`;
  (run.pickOpts || []).forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rg-opt';
    if (card) {
      btn.innerHTML = `<div class="nm">${esc(opt.name)}</div>
        <div class="meta">${SKILL_KIND_ZH[opt.kind] || '攻击'} · ${elemLabel(opt.elem)}</div>`;
      btn.addEventListener('click', () => takeCard(opt));
    } else {
      btn.innerHTML = `<div class="nm">${esc(opt.name)}</div><div class="ds">${esc(opt.desc || '')}</div>`;
      btn.addEventListener('click', () => takeRelic(opt));
    }
    frame.querySelector('#rg3').appendChild(btn);
  });
  frame.querySelector('#rgSkip').addEventListener('click', advanceNode);
}
function takeCard(sk) {
  const owner = run.team.filter(m => m.hp > 0).find(m => !sk.ownerId || m.id === sk.ownerId) || run.team[0];
  if (owner) owner.cards.push(sk.id);
  toast('得到「' + sk.name + '」');
  advanceNode();
}
function takeRelic(r) {
  run.relics.push(r);
  toast('得到「' + r.name + '」');
  advanceNode();
}
function paintEvent(frame) {
  const ev = run.event || { title: '路上', text: '', choices: [{ label: '继续', kind: 'none' }] };
  frame.innerHTML = `<div class="rg-head"><b>${esc(ev.title)}</b></div>
    <div class="rg-event">${esc(ev.text || '')}</div><div class="rg-ops" id="rgCh"></div>`;
  (ev.choices && ev.choices.length ? ev.choices : [{ label: '继续', kind: 'none' }]).forEach(c => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = c.label;
    b.addEventListener('click', () => applyChoice(c.kind));
    frame.querySelector('#rgCh').appendChild(b);
  });
}
function applyChoice(kind) {
  if (kind === 'heal') {
    run.team.forEach(m => { if (m.hp > 0) m.hp = Math.min(m.maxHp, m.hp + Math.round(m.maxHp * 0.35)); });
    toast('回了点血');
    advanceNode();
  } else if (kind === 'relic') startRelicPick();
  else if (kind === 'card') startCardPick();
  else advanceNode();
}
function paintRest(frame) {
  frame.innerHTML = `<div class="rg-head"><b>歇一口气</b></div>
    <div class="rg-event">回 40% 血，然后打最后的对手。</div>
    <div class="rg-ops"><button class="btn primary" id="rgRest">好</button></div>`;
  frame.querySelector('#rgRest').addEventListener('click', () => {
    run.team.forEach(m => { if (m.hp > 0) m.hp = Math.min(m.maxHp, m.hp + Math.round(m.maxHp * 0.4)); });
    advanceNode();
  });
}
function paintEnd(frame) {
  const win = run.phase === 'won';
  const idle = run.rogue.mode === 'idle';
  frame.innerHTML = `<div class="bt-result">
    <div class="bt-result-title${win ? '' : ' lost'}">${win ? '打完了' : '没打过'}</div>
    <div class="bt-result-text">${win ? (run.block.winContent || (idle ? '回主城继续养成和推关。' : '可以改角色数值，或换一种玩法再试。')) : (run.block.loseContent || '把敌人生命调低，或把角色攻击调高。')}</div>
    <div class="bt-result-ops">
      <button class="btn primary" id="rgA">${idle ? (win ? '回主城' : '回主城再试') : (win ? '回到剧情' : '再来一次')}</button>
      <button class="btn ghost" id="rgB">退出</button>
    </div></div>`;
  frame.querySelector('#rgB').addEventListener('click', run.ctx.onExit);
  frame.querySelector('#rgA').addEventListener('click', () => {
    if (idle) { goIdleHome(); return; }
    if (win) { const n = run.ctx.onWin; stopRogueRun(); if (n) n(); }
    else startRogueRun(run.block, run.ctx);
  });
}

function ensureRogue(story) {
  story.rogue = normalizeRogue(story.rogue);
}

function ensureRogueBlock(story) {
  if (!Array.isArray(story.chapters) || !story.chapters.length) {
    story.chapters = [{ id: 'ch_1', title: '第一章', blocks: [] }];
  }
  const has = story.chapters.some(c => (c.blocks || []).some(b => b.type === 'rogue'));
  if (!has) {
    story.chapters[0].blocks.push({
      id: uid(), type: 'rogue',
      content: CARD_MODES[story.rogue.mode].hint,
      winContent: '', loseContent: '',
    });
  }
}

export function applyStarterPack(story, mode) {
  ensureRogue(story);
  if (mode && CARD_MODES[mode]) story.rogue.mode = mode;
  const pack = starterByMode(story.rogue.mode);
  story.rogue = normalizeRogue({ ...story.rogue, ...pack, mode: story.rogue.mode });
  ensureRogueBlock(story);
}

function starterByMode(mode) {
  if (mode === 'idle') {
    return {
      roster: [
        { id: 'c_yue', name: '月华', elem: 'light', faction: 'light', star: 4, hp: 140, atk: 20, spd: 16, skillIds: ['sk_yue'], portrait: '', desc: '神殿骑士，以月华之光斩灭暗影。' },
        { id: 'c_ye', name: '夜羽', elem: 'dark', faction: 'dark', star: 4, hp: 130, atk: 22, spd: 18, skillIds: ['sk_ye'], portrait: '', desc: '暗影刺客，擅长高速突袭。' },
        { id: 'c_xia', name: '绯霞', elem: 'light', faction: 'light', star: 3, hp: 125, atk: 19, spd: 17, skillIds: ['sk_xia'], portrait: '', desc: '治愈修女，能在战斗中抚慰队友。' },
        { id: 'c_ling', name: '铃兰', elem: 'dark', faction: 'dark', star: 3, hp: 135, atk: 18, spd: 15, skillIds: ['sk_ling'], portrait: '', desc: '铃兰骑士，攻守均衡。' },
      ],
      skills: [
        { id: 'sk_yue', name: '月辉', kind: 'atk', power: 118, elem: 'light', ownerId: 'c_yue', desc: '单体光属性斩击。' },
        { id: 'sk_ye', name: '影刺', kind: 'atk', power: 122, elem: 'dark', ownerId: 'c_ye', desc: '高速暗刺，伤害偏高。' },
        { id: 'sk_xia', name: '霞光', kind: 'heal', power: 100, elem: 'light', ownerId: 'c_xia', desc: '为生命最低的队友回血。' },
        { id: 'sk_ling', name: '铃斩', kind: 'atk', power: 115, elem: 'dark', ownerId: 'c_ling', desc: '暗属性斩击。' },
      ],
      enemies: [
        { id: 'e1', name: '残影', elem: 'dark', hp: 45, atk: 8, spd: 12 },
        { id: 'e2', name: '石卫', elem: 'wood', hp: 70, atk: 10, spd: 11 },
        { id: 'e3', name: '深渊使', elem: 'dark', hp: 140, atk: 14, spd: 12, isBoss: true },
      ],
      stages: [
        { id: 'st1', title: '第1关 残影', enemyIds: ['e1'] },
        { id: 'st2', title: '第2关 石卫', enemyIds: ['e2'] },
        { id: 'st3', title: '首领 深渊使', enemyIds: ['e3'] },
      ],
      bonds: [], relics: [], events: [],
      progress: {
        stageIdx: 0,
        gold: 800,
        teamIds: ['c_yue', 'c_ye', 'c_xia', 'c_ling'],
        chars: {
          c_yue: { level: 1, exp: 0, star: 4, copies: 0 },
          c_ye: { level: 1, exp: 0, star: 4, copies: 0 },
          c_xia: { level: 1, exp: 0, star: 3, copies: 0 },
          c_ling: { level: 1, exp: 0, star: 3, copies: 0 },
        },
      },
      gacha: { cost: 80 },
    };
  }
  if (mode === 'queue') {
    return {
      roster: [
        { id: 'c_ren', name: '陈行', elem: 'fire', faction: 'ren', star: 3, hp: 125, atk: 19, spd: 16, skillIds: ['sk_ren'] },
        { id: 'c_dao', name: '青玄', elem: 'water', faction: 'dao', star: 3, hp: 120, atk: 17, spd: 18, skillIds: ['sk_dao'] },
        { id: 'c_fo', name: '了尘', elem: 'light', faction: 'fo', star: 2, hp: 140, atk: 15, spd: 14, skillIds: ['sk_fo'] },
        { id: 'c_yao', name: '狐九', elem: 'wood', faction: 'yao', star: 3, hp: 115, atk: 21, spd: 17, skillIds: ['sk_yao'] },
      ],
      skills: [
        { id: 'sk_ren', name: '剑气', kind: 'atk', power: 118, elem: 'fire', ownerId: 'c_ren' },
        { id: 'sk_dao', name: '符水', kind: 'atk', power: 110, elem: 'water', ownerId: 'c_dao' },
        { id: 'sk_fo', name: '诵经', kind: 'heal', power: 95, elem: 'light', ownerId: 'c_fo' },
        { id: 'sk_yao', name: '妖火', kind: 'atk', power: 122, elem: 'wood', ownerId: 'c_yao' },
      ],
      enemies: [
        { id: 'e1', name: '山魈', elem: 'wood', hp: 55, atk: 9, spd: 12 },
        { id: 'e2', name: '散修', elem: 'fire', hp: 80, atk: 12, spd: 14 },
        { id: 'e3', name: '门卫', elem: 'dark', hp: 180, atk: 16, spd: 13, isBoss: true },
      ],
      stages: [
        { id: 'st1', title: '山道', enemyIds: ['e1'] },
        { id: 'st2', title: '坊市', enemyIds: ['e2'] },
        { id: 'st3', title: '宗门', enemyIds: ['e3'] },
      ],
      bonds: [
        { id: 'bd1', name: '人道路遇', unitIds: ['c_ren', 'c_dao'], atkPct: 18 },
        { id: 'bd2', name: '佛妖因果', unitIds: ['c_fo', 'c_yao'], atkPct: 15 },
      ],
      relics: [], events: [],
    };
  }
  return {
    roster: [
      { id: 'c_a', name: '小火', elem: 'fire', faction: 'fire', star: 2, hp: 120, atk: 18, spd: 16, skillIds: ['sk_a'] },
      { id: 'c_b', name: '小水', elem: 'water', faction: 'water', star: 2, hp: 130, atk: 16, spd: 15, skillIds: ['sk_b'] },
      { id: 'c_c', name: '小木', elem: 'wood', faction: 'wood', star: 2, hp: 140, atk: 15, spd: 14, skillIds: ['sk_c'] },
    ],
    skills: [
      { id: 'sk_a', name: '火球', kind: 'atk', power: 120, elem: 'fire', ownerId: 'c_a' },
      { id: 'sk_b', name: '水花', kind: 'atk', power: 110, elem: 'water', ownerId: 'c_b' },
      { id: 'sk_h', name: '喝水', kind: 'heal', power: 90, elem: 'water', ownerId: 'c_b' },
      { id: 'sk_c', name: '藤鞭', kind: 'atk', power: 105, elem: 'wood', ownerId: 'c_c' },
    ],
    enemies: [
      { id: 'e1', name: '木桩精', elem: 'wood', hp: 50, atk: 8, spd: 12 },
      { id: 'e2', name: '大木桩', elem: 'wood', hp: 90, atk: 12, spd: 11 },
      { id: 'eb', name: '深坑', elem: 'dark', hp: 200, atk: 16, spd: 12, isBoss: true },
    ],
    stages: [
      { id: 'st1', title: '第1层', enemyIds: ['e1'] },
      { id: 'st2', title: '第2层', enemyIds: ['e2'] },
      { id: 'st3', title: '最深处', enemyIds: ['eb'] },
    ],
    relics: [{ id: 'rl1', name: '小刀', desc: '大家打得重一点', effect: { type: 'atk_pct', val: 10 } }],
    events: [{ id: 'ev1', title: '泉水', text: '要喝吗？', choices: [{ label: '喝（回血）', kind: 'heal' }, { label: '不喝', kind: 'none' }] }],
    bonds: [],
  };
}

export function buildRogueDemoData(mode) {
  const m = CARD_MODES[mode] ? mode : 'idle';
  const pack = starterByMode(m);
  if (m === 'rogue') {
    Object.assign(pack, {
      roster: [
        { id: 'c_yan', name: '炎', elem: 'fire', hp: 130, atk: 22, spd: 15, skillIds: ['sk_ball'] },
        { id: 'c_lan', name: '澜', elem: 'water', hp: 140, atk: 18, spd: 17, skillIds: ['sk_tide'] },
        { id: 'c_qing', name: '青', elem: 'wood', hp: 150, atk: 16, spd: 14, skillIds: ['sk_heal'] },
        { id: 'c_yao', name: '曜', elem: 'light', hp: 120, atk: 20, spd: 18, skillIds: ['sk_ray'] },
      ],
      skills: [
        { id: 'sk_ball', name: '火球', kind: 'atk', power: 120, elem: 'fire', ownerId: 'c_yan' },
        { id: 'sk_tide', name: '潮涌', kind: 'atk', power: 110, elem: 'water', ownerId: 'c_lan' },
        { id: 'sk_heal', name: '回春', kind: 'heal', power: 100, elem: 'wood', ownerId: 'c_qing' },
        { id: 'sk_ray', name: '辉光', kind: 'atk', power: 125, elem: 'light', ownerId: 'c_yao' },
      ],
    });
  }
  return {
    kind: ROGUE_KIND,
    orientation: 'landscape',
    imgQuality: 'standard',
    cast: {},
    rogue: normalizeRogue({ mode: m, teamSize: 4, floors: 3, ...pack }),
    chapters: [{
      id: 'ch_card',
      title: CARD_MODES[m].label,
      blocks: [
        { id: 'b_in', type: 'scene', content: CARD_MODES[m].hint },
        { id: 'b_run', type: 'rogue', content: CARD_MODES[m].need, winContent: '', loseContent: '' },
      ],
    }],
  };
}

function field(label, el) {
  const w = document.createElement('div');
  w.className = 'rpg-field';
  const l = document.createElement('label');
  l.textContent = label;
  w.append(l, el);
  return w;
}
function inp(val, type) {
  const i = document.createElement('input');
  i.className = 'txt';
  i.type = type || 'text';
  i.value = val == null ? '' : val;
  return i;
}
function sel(val, opts) {
  const s = document.createElement('select');
  s.className = 'txt';
  opts.forEach(([v, t]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = t; if (v === val) o.selected = true;
    s.appendChild(o);
  });
  return s;
}

function pickPortrait(char, done, api) {
  const tip = (msg, err) => {
    try {
      if (api && typeof api.toast === 'function') api.toast(msg, !!err);
      else toast(msg, !!err);
    } catch (_) { /* ignore */ }
  };
  if (!api || typeof api.upload !== 'function') {
    tip('当前环境不能上传立绘', true);
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm';
  input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    try { input.remove(); } catch (_) {}
    if (!file) return;
    tip('正在上传立绘…（图片 / GIF / MP4 / WebM，≤5MB）');
    try {
      const res = await api.upload(file);
      if (!res || !res.url) { tip('立绘上传失败（需登录，且文件 ≤5MB）', true); return; }
      char.portrait = res.url;
      char.portraitKind = (res.type === 'video' || String(file.type || '').startsWith('video/')) ? 'video' : 'image';
      tip(char.portraitKind === 'video' ? '动图立绘已挂上' : '立绘已挂上');
      if (done) done();
    } catch (e) {
      tip((e && e.message) || '立绘上传失败', true);
    }
  });
  // 同步触发：必须在用户点击回调栈内，否则部分浏览器会吞掉文件框
  input.click();
}

async function genLocalPortrait(char, done, api) {
  const hint = (char && char.name) ? `角色「${char.name}」的立绘描述` : '立绘描述';
  const text = window.prompt(hint + '（留空则用名字）', char && char.name ? char.name + ', character portrait, face clearly visible' : '');
  if (text == null) return;
  const prompt = String(text).trim() || ((char && char.name) || 'character') + ', upper body portrait, face clearly visible, high quality';
  toast('本机生图中…');
  try {
    const mod = await import('/image-provider.js');
    const r = await mod.generateAndResolveUrl({ prompt, width: 576, height: 1024 });
    if (!r || !r.url) { toast('生图失败', true); return; }
    char.portrait = r.url;
    char.portraitKind = 'image';
    toast('立绘已挂上');
    if (done) done();
  } catch (e) {
    toast((e && e.message) || '本机生图失败', true);
  }
}

export function openCardStudio(story, api) {
  ensureRogue(story);
  const card = document.querySelector('#modal .modal-card');
  if (card) card.classList.add('modal-wide');
  api.openModal('卡牌工作室', (body) => renderStudio(body, story, api), null);
}

function renderStudio(body, story, api) {
  body.innerHTML = '';
  const r = story.rogue;
  if (!Array.isArray(r.bonds)) r.bonds = [];
  if (!Array.isArray(r.stages)) r.stages = [];
  if (!Array.isArray(r.relics)) r.relics = [];

  const steps = document.createElement('div');
  steps.className = 'rpg-tip';
  steps.innerHTML = r.mode === 'idle'
    ? '<b>女神挂机：</b>① 加角色并点「立绘」上传 → ② 加关卡 → 关掉窗口点试玩进主城。'
    : '<b>三步：</b>① 角色表 → ② 关卡表 → ③ 羁绊/遗物（可空）→ 关掉窗口点「试玩」。拖 ⋮⋮ 可调顺序。';
  body.appendChild(steps);

  const modes = document.createElement('div');
  modes.className = 'orient-pick';
  modes.style.margin = '8px 0 14px';
  Object.values(CARD_MODES).forEach(m => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'orient-card kind-card' + (r.mode === m.id ? ' active' : '');
    b.innerHTML = `${m.label}<span>${m.hint}</span>`;
    b.addEventListener('click', () => {
      story.rogue = normalizeRogue({ ...r, mode: m.id });
      api.persist();
      renderStudio(body, story, api);
      if (api.onMode) api.onMode();
    });
    modes.appendChild(b);
  });
  body.appendChild(modes);

  // 试玩进度（金币等）：挂机模式可直接改
  if (r.mode === 'idle') {
    if (!r.progress || typeof r.progress !== 'object') {
      r.progress = { stageIdx: 0, gold: 500, teamIds: [], chars: {} };
    }
    const progBox = document.createElement('div');
    progBox.className = 'rpg-tip';
    progBox.style.marginBottom = '12px';
    const goldInp = inp(String(r.progress.gold ?? 500), 'number');
    goldInp.min = '0'; goldInp.max = '999999'; goldInp.step = '1';
    const stageInp = inp(String(r.progress.stageIdx ?? 0), 'number');
    stageInp.min = '0'; stageInp.max = '99'; stageInp.step = '1';
    const saveProg = document.createElement('button');
    saveProg.type = 'button';
    saveProg.className = 'btn tiny primary';
    saveProg.textContent = '保存进度';
    saveProg.addEventListener('click', () => {
      r.progress.gold = Math.max(0, Math.min(999999, Math.round(Number(goldInp.value) || 0)));
      r.progress.stageIdx = Math.max(0, Math.min(99, Math.round(Number(stageInp.value) || 0)));
      api.persist();
      toast('进度已保存（金币 ' + r.progress.gold + '）');
      renderStudio(body, story, api);
    });
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-top:8px';
    row.append(field('试玩金币', goldInp), field('已通关数', stageInp), saveProg);
    progBox.innerHTML = '<b>试玩进度：</b>改金币/关卡后点「保存进度」。重新点播放才会带着新数值进主城。';
    progBox.appendChild(row);
    body.appendChild(progBox);
  }

  const mkTable = (headers) => {
    const table = document.createElement('table');
    table.className = 'studio-table';
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    headers.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    return { table, tbody };
  };

  const bindRowDrag = (tbody, arr, onDone) => {
    let from = -1;
    tbody.querySelectorAll('tr[data-i]').forEach(tr => {
      const handle = tr.querySelector('.row-handle');
      if (!handle) return;
      handle.draggable = true;
      handle.addEventListener('dragstart', (e) => {
        from = Number(tr.dataset.i);
        tr.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      handle.addEventListener('dragend', () => {
        tr.classList.remove('dragging');
        from = -1;
      });
      tr.addEventListener('dragover', (e) => { e.preventDefault(); tr.classList.add('drag-over'); });
      tr.addEventListener('dragleave', () => tr.classList.remove('drag-over'));
      tr.addEventListener('drop', (e) => {
        e.preventDefault();
        tr.classList.remove('drag-over');
        const to = Number(tr.dataset.i);
        if (from < 0 || to < 0 || from === to) return;
        const [item] = arr.splice(from, 1);
        arr.splice(to, 0, item);
        api.persist();
        onDone();
      });
    });
  };

  const h1 = document.createElement('h3');
  h1.textContent = '① 角色表';
  body.appendChild(h1);
  const { table: tableC, tbody: bodyC } = mkTable(['', '立绘', '名字', '装饰', '阵营', '星', '招式', '']);
  r.roster.forEach((c, i) => {
    const mine = skillsOf(r, c.id).filter(s => s.ownerId === c.id);
    const tr = document.createElement('tr');
    tr.dataset.i = String(i);
    tr.dataset.charId = c.id;
    const thumb = portraitThumbHtml(c);
    tr.innerHTML = `<td class="row-handle" title="拖动排序">⋮⋮</td>
      <td>${thumb}</td>
      <td>${esc(c.name)}</td>
      <td>${esc(frameLabelFor(c, story.assets))}</td>
      <td>${factionLabel(r.mode, c.faction)}</td>
      <td>${c.star || 1}</td>
      <td>${mine.map(s => s.name).join('、') || '普攻'}</td>
      <td></td>`;
    const ops = tr.lastElementChild;
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'btn tiny'; up.textContent = '立绘';
    up.title = '上传角色立绘';
    up.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pickPortrait(c, () => {
        api.persist();
        renderStudio(body, story, api);
      }, api);
    });
    const gen = document.createElement('button');
    gen.type = 'button';
    gen.className = 'btn tiny'; gen.textContent = '本地生图';
    gen.title = '本机 Comfy / Pollinations 生成立绘';
    gen.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      genLocalPortrait(c, () => {
        api.persist();
        renderStudio(body, story, api);
      }, api);
    });
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn tiny'; edit.textContent = '改';
    edit.title = '修改名字 / 阵营 / 星级等';
    edit.addEventListener('click', () => {
      body.dataset.editId = c.id;
      renderStudio(body, story, api);
      const form = body.querySelector('#studioCharForm');
      if (form) form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    const del = document.createElement('button');
    del.className = 'btn tiny danger'; del.textContent = '删';
    del.addEventListener('click', () => {
      r.skills = r.skills.filter(s => s.ownerId !== c.id);
      r.bonds.forEach(b => { b.unitIds = (b.unitIds || []).filter(id => id !== c.id); });
      if (r.progress && r.progress.chars) delete r.progress.chars[c.id];
      if (r.progress && Array.isArray(r.progress.teamIds)) {
        r.progress.teamIds = r.progress.teamIds.filter(id => id !== c.id);
      }
      r.roster.splice(i, 1);
      if (body.dataset.editId === c.id) delete body.dataset.editId;
      api.persist();
      renderStudio(body, story, api);
    });
    ops.append(up, gen, edit, del);
    bodyC.appendChild(tr);
  });
  body.appendChild(tableC);
  bindRowDrag(bodyC, r.roster, () => renderStudio(body, story, api));

  const editing = r.roster.find(c => c.id === body.dataset.editId) || null;
  const editSkill = editing
    ? (r.skills || []).find(s => s.ownerId === editing.id) || null
    : null;
  const formWrap = document.createElement('div');
  formWrap.id = 'studioCharForm';
  formWrap.style.cssText = editing
    ? 'margin:10px 0 12px;padding:10px;border:1px solid rgba(180,140,255,.35);border-radius:10px;background:rgba(40,30,70,.35)'
    : 'margin:8px 0 12px';
  if (editing) {
    const tip = document.createElement('div');
    tip.className = 'rpg-tip';
    tip.textContent = '正在修改「' + editing.name + '」——改完点「保存修改」。';
    formWrap.appendChild(tip);
  }
  const name = inp(editing ? editing.name : '');
  const fac = sel(
    editing ? (editing.faction || factionPairs(r.mode)[0][0]) : factionPairs(r.mode)[0][0],
    factionPairs(r.mode)
  );
  const star = sel(
    String(editing ? (editing.star || 3) : 3),
    [['1', '1星'], ['2', '2星'], ['3', '3星'], ['4', '4星'], ['5', '5星']]
  );
  const assets = (story && story.assets) || [];
  const frameAssets = assets.filter((a) => a && a.category === 'frame' && a.url);
  const frame = sel(
    editing ? normalizeCardFrame(editing.frame, editing.star) : 'white',
    [['auto', '自动（跟星级）'], ...Object.keys(CARD_FRAMES).map((id) => [id, CARD_FRAMES[id].label + '（CSS）'])]
  );
  const frameAsset = sel(
    editing ? (editing.frameAssetId || '') : '',
    [['', '不用素材边框'], ...frameAssets.map((a) => [a.id, '素材 · ' + a.name])]
  );
  const hp = inp(String(editing ? (editing.hp || 120) : 120), 'number');
  const atk = inp(String(editing ? (editing.atk || 18) : 18), 'number');
  const spd = inp(String(editing ? (editing.spd || 16) : 16), 'number');
  const skn = inp(editSkill ? editSkill.name : '普攻');
  const skd = inp(editSkill ? (editSkill.desc || '') : '');
  const skk = sel(
    editSkill ? (editSkill.kind || 'atk') : 'atk',
    [['atk', '打人'], ['heal', '救人'], ['buff', '蓄力']]
  );
  formWrap.append(
    field('名字', name),
    field(r.mode === 'queue' ? '门派' : (r.mode === 'idle' ? '阵营' : '属性'), fac),
    field('星级', star),
    field('卡牌装饰框', frame),
    field('素材边框（优先）', frameAsset),
    field('生命', hp),
    field('攻击', atk),
    field('速度', spd),
    field('会的一招', skn),
    field('技能说明', skd),
    field('这一招干什么', skk)
  );
  const intro = document.createElement('textarea');
  intro.rows = 2;
  intro.placeholder = '角色介绍，例如：月华是神殿骑士…';
  intro.value = editing ? (editing.desc || '') : '';
  intro.style.cssText = 'width:100%;max-width:360px;padding:8px 10px;border-radius:8px;border:1px solid var(--line2);background:var(--bg3);color:var(--text);font-family:inherit;font-size:13px;resize:vertical';
  formWrap.append(field('角色介绍', intro));
  if (editing) {
    const porRow = document.createElement('div');
    porRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0';
    const thumb = document.createElement('div');
    thumb.innerHTML = portraitThumbHtml(editing);
    const upP = document.createElement('button');
    upP.type = 'button'; upP.className = 'btn tiny'; upP.textContent = '上传立绘';
    upP.addEventListener('click', (ev) => {
      ev.preventDefault();
      pickPortrait(editing, () => { api.persist(); renderStudio(body, story, api); }, api);
    });
    const genP = document.createElement('button');
    genP.type = 'button'; genP.className = 'btn tiny'; genP.textContent = '本地生图';
    genP.addEventListener('click', (ev) => {
      ev.preventDefault();
      genLocalPortrait(editing, () => { api.persist(); renderStudio(body, story, api); }, api);
    });
    const clrP = document.createElement('button');
    clrP.type = 'button'; clrP.className = 'btn tiny danger'; clrP.textContent = '清立绘';
    clrP.addEventListener('click', () => {
      editing.portrait = '';
      delete editing.portraitKind;
      api.persist();
      renderStudio(body, story, api);
    });
    porRow.append(thumb, upP, genP, clrP);
    formWrap.appendChild(porRow);
  }
  const addC = document.createElement('button');
  addC.className = 'btn primary';
  addC.textContent = editing ? '保存修改' : '加上角色';
  addC.addEventListener('click', () => {
    const n = name.value.trim();
    if (!n) { toast('先写名字，例如：月华', true); return; }
    const starN = Math.max(1, Math.min(5, Number(star.value) || 3));
    const hpN = Math.max(40, Math.min(99999, Number(hp.value) || 120));
    const atkN = Math.max(4, Math.min(99, Number(atk.value) || 18));
    const spdN = Math.max(6, Math.min(40, Number(spd.value) || 16));
    const elem = elemFromFaction(r.mode, fac.value);
    if (editing) {
      editing.name = n.slice(0, 16);
      editing.faction = fac.value;
      editing.elem = elem;
      editing.star = starN;
      editing.frameAssetId = frameAsset.value || '';
      editing.frame = frameAsset.value ? '' : (frame.value === 'auto' ? '' : frame.value);
      editing.hp = hpN;
      editing.atk = atkN;
      editing.spd = spdN;
      editing.desc = intro.value.trim().slice(0, 120);
      let sk = (r.skills || []).find(s => s.ownerId === editing.id);
      if (!sk) {
        sk = { id: uid(), name: '普攻', kind: 'atk', power: 110, elem, ownerId: editing.id, desc: '' };
        r.skills.push(sk);
        if (!Array.isArray(editing.skillIds)) editing.skillIds = [];
        if (!editing.skillIds.includes(sk.id)) editing.skillIds.push(sk.id);
      }
      sk.name = (skn.value.trim() || '普攻').slice(0, 16);
      sk.kind = skk.value;
      sk.elem = elem;
      sk.desc = skd.value.trim().slice(0, 60);
      if (r.progress && r.progress.chars && r.progress.chars[editing.id]) {
        r.progress.chars[editing.id].star = Math.max(
          r.progress.chars[editing.id].star || 1,
          starN
        );
      }
      delete body.dataset.editId;
      api.persist();
      renderStudio(body, story, api);
      toast('角色已更新。');
      return;
    }
    const id = uid();
    const sid = uid();
    r.roster.push({
      id, name: n.slice(0, 16), elem, faction: fac.value,
      star: starN, hp: hpN, atk: atkN, spd: spdN, skillIds: [sid], portrait: '',
      desc: intro.value.trim().slice(0, 120),
      frame: frameAsset.value ? '' : (frame.value === 'auto' ? '' : frame.value),
      frameAssetId: frameAsset.value || '',
    });
    r.skills.push({
      id: sid, name: (skn.value.trim() || '普攻').slice(0, 16),
      kind: skk.value, power: 110, elem, ownerId: id,
      desc: skd.value.trim().slice(0, 60),
    });
    api.persist();
    renderStudio(body, story, api);
    toast('角色已加上。');
  });
  formWrap.appendChild(addC);
  if (editing) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn tiny';
    cancel.textContent = '取消';
    cancel.style.marginLeft = '8px';
    cancel.addEventListener('click', () => {
      delete body.dataset.editId;
      renderStudio(body, story, api);
    });
    formWrap.appendChild(cancel);
  }
  body.appendChild(formWrap);

  const h2 = document.createElement('h3');
  h2.textContent = '② 关卡表';
  h2.style.marginTop = '18px';
  body.appendChild(h2);
  const { table: tableS, tbody: bodyS } = mkTable(['', '立绘', '关卡', '敌人(1~8)', '']);
  r.stages.forEach((st, i) => {
    const en = (st.enemyIds || []).map(id => r.enemies.find(x => x.id === id)).filter(Boolean);
    const e0 = en[0];
    const names = en.map(e => e.name).join('、') || '还没指定敌人';
    const stats = en.length
      ? (en.length + '人 · ' + names)
      : names;
    const thumb = portraitThumbHtml(e0 || {});
    const tr = document.createElement('tr');
    tr.dataset.i = String(i);
    tr.innerHTML = `<td class="row-handle" title="拖动排序">⋮⋮</td>
      <td>${thumb}</td>
      <td>${esc(st.title)}</td>
      <td>${esc(stats)}</td>
      <td></td>`;
    const ops = tr.lastElementChild;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn tiny'; edit.textContent = '改';
    edit.title = '改关卡名 / 敌人数量与数值 / 立绘';
    edit.addEventListener('click', () => {
      body.dataset.editStage = st.id;
      renderStudio(body, story, api);
      const form = body.querySelector('#studioStageForm');
      if (form) form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'btn tiny'; up.textContent = '立绘';
    up.disabled = !e0;
    up.title = e0 ? '上传第1个敌人立绘' : '先保存关卡敌人';
    up.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!e0) return;
      pickPortrait(e0, () => { api.persist(); renderStudio(body, story, api); }, api);
    });
    const gen = document.createElement('button');
    gen.type = 'button';
    gen.className = 'btn tiny'; gen.textContent = '生图';
    gen.disabled = !e0;
    gen.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!e0) return;
      genLocalPortrait(e0, () => { api.persist(); renderStudio(body, story, api); }, api);
    });
    const del = document.createElement('button');
    del.className = 'btn tiny danger'; del.textContent = '删';
    del.addEventListener('click', () => {
      const ids = new Set(st.enemyIds || []);
      r.stages.splice(i, 1);
      r.enemies = r.enemies.filter(e => {
        if (!ids.has(e.id)) return true;
        return r.stages.some(s => (s.enemyIds || []).includes(e.id));
      });
      if (body.dataset.editStage === st.id) delete body.dataset.editStage;
      api.persist();
      renderStudio(body, story, api);
    });
    ops.append(edit, up, gen, del);
    bodyS.appendChild(tr);
  });
  body.appendChild(tableS);
  bindRowDrag(bodyS, r.stages, () => renderStudio(body, story, api));

  const editingSt = r.stages.find(s => s.id === body.dataset.editStage) || null;
  const editingEns = editingSt
    ? (editingSt.enemyIds || []).map(id => r.enemies.find(e => e.id === id)).filter(Boolean)
    : [];
  const stageForm = document.createElement('div');
  stageForm.id = 'studioStageForm';
  stageForm.style.cssText = editingSt
    ? 'margin:10px 0 12px;padding:10px;border:1px solid rgba(255,160,120,.35);border-radius:10px;background:rgba(60,30,20,.35)'
    : 'margin:8px 0 12px';
  if (editingSt) {
    const tip = document.createElement('div');
    tip.className = 'rpg-tip';
    tip.textContent = '正在修改关卡「' + editingSt.title + '」——敌人 1~8 人，改完点「保存关卡」。';
    stageForm.appendChild(tip);
  }
  const stTitle = inp(editingSt ? editingSt.title : ('第' + (r.stages.length + 1) + '关'));
  const countSel = sel(
    String(Math.max(1, Math.min(8, editingEns.length || 1))),
    [1, 2, 3, 4, 5, 6, 7, 8].map(n => [String(n), n + ' 人'])
  );
  stageForm.append(field('关卡名字', stTitle), field('敌人数量', countSel));

  const enemyEditors = [];
  const enemyBox = document.createElement('div');
  enemyBox.id = 'studioEnemyEditors';
  enemyBox.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin:8px 0';

  function makeEnemyEditor(idx, base) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:8px;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(0,0,0,.2)';
    const head = document.createElement('div');
    head.style.cssText = 'font-size:12px;opacity:.75;margin-bottom:6px';
    head.textContent = '敌人 #' + (idx + 1);
    wrap.appendChild(head);
    const nameEl = inp(base ? base.name : (idx === 0 ? '' : ('小怪' + (idx + 1))));
    const hpEl = inp(String(base ? (base.hp || 60) : Math.max(30, 60 - idx * 4)), 'number');
    const atkEl = inp(String(base ? (base.atk || 10) : Math.max(6, 10 - idx)), 'number');
    const spdEl = inp(String(base ? (base.spd || 13) : 13), 'number');
    const bossEl = document.createElement('input');
    bossEl.type = 'checkbox';
    bossEl.checked = !!(base && base.isBoss);
    wrap.append(
      field('名字', nameEl),
      field('生命', hpEl),
      field('攻击', atkEl),
      field('速度', spdEl),
      field('首领', bossEl)
    );
    if (base) {
      const porRow = document.createElement('div');
      porRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px';
      const thumbEl = document.createElement('div');
      thumbEl.innerHTML = portraitThumbHtml(base || {});
      const up2 = document.createElement('button');
      up2.type = 'button'; up2.className = 'btn tiny'; up2.textContent = '上传立绘';
      up2.addEventListener('click', (ev) => {
        ev.preventDefault();
        pickPortrait(base, () => { api.persist(); renderStudio(body, story, api); }, api);
      });
      const gen2 = document.createElement('button');
      gen2.type = 'button'; gen2.className = 'btn tiny'; gen2.textContent = '本地生图';
      gen2.addEventListener('click', (ev) => {
        ev.preventDefault();
        genLocalPortrait(base, () => { api.persist(); renderStudio(body, story, api); }, api);
      });
      const clr = document.createElement('button');
      clr.type = 'button'; clr.className = 'btn tiny danger'; clr.textContent = '清立绘';
      clr.addEventListener('click', () => {
        base.portrait = '';
        delete base.portraitKind;
        api.persist();
        renderStudio(body, story, api);
      });
      porRow.append(thumbEl, up2, gen2, clr);
      wrap.appendChild(porRow);
    }
    enemyBox.appendChild(wrap);
    enemyEditors.push({ nameEl, hpEl, atkEl, spdEl, bossEl, base });
  }

  function rebuildEnemyEditors(n) {
    enemyEditors.length = 0;
    enemyBox.innerHTML = '';
    const count = Math.max(1, Math.min(8, n));
    for (let i = 0; i < count; i++) makeEnemyEditor(i, editingEns[i] || null);
  }
  rebuildEnemyEditors(Number(countSel.value) || 1);
  countSel.addEventListener('change', () => {
    rebuildEnemyEditors(Number(countSel.value) || 1);
  });
  stageForm.appendChild(enemyBox);

  const addE = document.createElement('button');
  addE.className = 'btn primary';
  addE.textContent = editingSt ? '保存关卡' : '加上关卡';
  addE.addEventListener('click', () => {
    const title = (stTitle.value.trim() || '关卡').slice(0, 20);
    const count = Math.max(1, Math.min(8, enemyEditors.length));
    const drafts = [];
    for (let i = 0; i < count; i++) {
      const ed = enemyEditors[i];
      const n = ed.nameEl.value.trim() || ('敌人' + (i + 1));
      drafts.push({
        name: n.slice(0, 16),
        hp: Math.max(20, Math.min(99999, Math.round(Number(ed.hpEl.value) || 60))),
        atk: Math.max(4, Math.min(80, Math.round(Number(ed.atkEl.value) || 10))),
        spd: Math.max(6, Math.min(36, Math.round(Number(ed.spdEl.value) || 13))),
        isBoss: !!ed.bossEl.checked,
        base: ed.base || null,
      });
    }
    if (editingSt) {
      editingSt.title = title;
      const oldIds = (editingSt.enemyIds || []).slice();
      const newIds = [];
      drafts.forEach((d) => {
        let e = d.base && r.enemies.find(x => x.id === d.base.id);
        if (!e) {
          e = {
            id: uid(), name: d.name, elem: r.mode === 'idle' ? 'dark' : 'wood',
            hp: d.hp, atk: d.atk, spd: d.spd, isBoss: d.isBoss, portrait: '',
          };
          r.enemies.push(e);
        } else {
          e.name = d.name;
          e.hp = d.hp;
          e.atk = d.atk;
          e.spd = d.spd;
          e.isBoss = d.isBoss;
          e.elem = r.mode === 'idle' ? 'dark' : (e.elem || 'wood');
        }
        newIds.push(e.id);
      });
      editingSt.enemyIds = newIds;
      const dropped = oldIds.filter(id => !newIds.includes(id));
      if (dropped.length) {
        r.enemies = r.enemies.filter(e => {
          if (!dropped.includes(e.id)) return true;
          return r.stages.some(s => (s.enemyIds || []).includes(e.id));
        });
      }
      delete body.dataset.editStage;
      api.persist();
      renderStudio(body, story, api);
      toast('关卡已更新（' + newIds.length + ' 个敌人）。');
      return;
    }
    const ids = drafts.map((d) => {
      const id = uid();
      r.enemies.push({
        id, name: d.name, elem: r.mode === 'idle' ? 'dark' : 'wood',
        hp: d.hp, atk: d.atk, spd: d.spd, isBoss: d.isBoss, portrait: '',
      });
      return id;
    });
    r.stages.push({ id: uid(), title, enemyIds: ids });
    api.persist();
    renderStudio(body, story, api);
    toast('关卡已加上（' + ids.length + ' 个敌人）。');
  });
  stageForm.appendChild(addE);
  if (editingSt) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn tiny';
    cancel.textContent = '取消';
    cancel.style.marginLeft = '8px';
    cancel.addEventListener('click', () => {
      delete body.dataset.editStage;
      renderStudio(body, story, api);
    });
    stageForm.appendChild(cancel);
  }
  body.appendChild(stageForm);

  if (r.mode === 'queue') {
    const hB = document.createElement('h3');
    hB.textContent = '③ 羁绊表（可空）';
    hB.style.marginTop = '18px';
    body.appendChild(hB);
    const { table: tableB, tbody: bodyB } = mkTable(['名字', '成员', '加成', '']);
    r.bonds.forEach((b, i) => {
      const names = (b.unitIds || []).map(id => {
        const c = r.roster.find(x => x.id === id);
        return c ? c.name : '?';
      }).join('、');
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(b.name)}</td><td>${names}</td><td>攻击+${b.atkPct}%</td><td></td>`;
      const del = document.createElement('button');
      del.className = 'btn tiny danger'; del.textContent = '删';
      del.addEventListener('click', () => { r.bonds.splice(i, 1); api.persist(); renderStudio(body, story, api); });
      tr.lastElementChild.appendChild(del);
      bodyB.appendChild(tr);
    });
    body.appendChild(tableB);
    const bn = inp('同门');
    const wrap = document.createElement('div');
    wrap.className = 'rpg-list';
    wrap.style.margin = '8px 0';
    const checks = [];
    r.roster.forEach(c => {
      const lab = document.createElement('label');
      lab.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:13px;margin:4px 0';
      const ck = document.createElement('input');
      ck.type = 'checkbox';
      ck.value = c.id;
      lab.append(ck, document.createTextNode(c.name + ' · ' + factionLabel(r.mode, c.faction)));
      wrap.appendChild(lab);
      checks.push(ck);
    });
    body.append(field('羁绊名字', bn), wrap);
    const addB = document.createElement('button');
    addB.className = 'btn'; addB.textContent = '加上羁绊';
    addB.addEventListener('click', () => {
      const ids = checks.filter(c => c.checked).map(c => c.value);
      if (ids.length < 2) { toast('至少勾选两个人', true); return; }
      r.bonds.push({ id: uid(), name: (bn.value.trim() || '羁绊').slice(0, 20), unitIds: ids, atkPct: 15 });
      api.persist();
      renderStudio(body, story, api);
    });
    body.appendChild(addB);
  }

  if (r.mode === 'rogue') {
    const h3 = document.createElement('h3');
    h3.textContent = '③ 遗物表（可空）';
    h3.style.marginTop = '18px';
    body.appendChild(h3);
    const { table: tableR, tbody: bodyR } = mkTable(['名字', '说明', '']);
    r.relics.forEach((rel, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(rel.name)}</td><td>${esc(rel.desc || '')}</td><td></td>`;
      const del = document.createElement('button');
      del.className = 'btn tiny danger'; del.textContent = '删';
      del.addEventListener('click', () => { r.relics.splice(i, 1); api.persist(); renderStudio(body, story, api); });
      tr.lastElementChild.appendChild(del);
      bodyR.appendChild(tr);
    });
    body.appendChild(tableR);
    const rn = inp('');
    const rd = inp('打得更痛一点');
    const addR = document.createElement('button');
    addR.className = 'btn'; addR.textContent = '加一件遗物';
    addR.addEventListener('click', () => {
      if (!rn.value.trim()) { toast('给遗物起个名', true); return; }
      r.relics.push({
        id: uid(), name: rn.value.trim().slice(0, 16), desc: rd.value.trim().slice(0, 80),
        effect: { type: 'atk_pct', val: 10 },
      });
      api.persist(); rn.value = ''; renderStudio(body, story, api);
    });
    body.append(field('遗物名字', rn), field('玩家看到的说明', rd), addR);
  }

  const fill = document.createElement('button');
  fill.className = 'btn ghost';
  fill.style.marginTop = '16px';
  fill.textContent = '我懒得填，请给一套能玩的';
  fill.addEventListener('click', () => {
    applyStarterPack(story, r.mode);
    api.persist();
    renderStudio(body, story, api);
    if (api.onMode) api.onMode();
    toast('已经填好角色和关卡，关掉窗口点试玩即可。');
  });
  body.appendChild(fill);
  bindPortraitZoom(body, {
    resolveSheet(el) {
      const tr = el.closest('tr[data-char-id]');
      if (tr && tr.dataset.charId) return buildCharSheet(r, tr.dataset.charId);
      return null;
    },
  });
}

export function setCardMode(story, mode) {
  ensureRogue(story);
  if (!CARD_MODES[mode]) return;
  story.rogue.mode = mode;
}

// 兼容旧调用名（工作室已替代分项弹窗）
export function openRogueRosterEditor(story, api) { openCardStudio(story, api); }
export function openRogueSkillsEditor(story, api) { openCardStudio(story, api); }
export function openRogueRelicsEditor(story, api) { openCardStudio(story, api); }
export function openRogueEventsEditor(story, api) { openCardStudio(story, api); }
export function openRogueEnemiesEditor(story, api) { openCardStudio(story, api); }
