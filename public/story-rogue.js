// 卡牌三种玩法共用速度条战斗。编辑器面向小白：选玩法 → 填角色和敌人 → 播放。
import { $, toast } from '/workspace/js/ui.js';

export const ROGUE_KIND = 'gacha_rogue';
export const CARD_MODES = {
  idle: {
    id: 'idle',
    label: '放置挂机',
    hint: '最简单。点播放就会自动打，不用编组、不用选牌。',
    need: '至少 1 个角色、1 个敌人。',
  },
  queue: {
    id: 'queue',
    label: '排队放技能',
    hint: '市面上最常见。先选上场的人，速度条满了自动放技能，对局里不用点牌。',
    need: '角色（可写技能）+ 敌人。火克木、木克水、水克火；光暗互克。前两名是前排。',
  },
  rogue: {
    id: 'rogue',
    label: '每局都不同',
    hint: '肉鸽。同一批角色，每一把抽到的技能、遗物、事件都不一样。失败再开即可。',
    need: '角色 + 敌人。遗物和事件可空，系统会用默认。',
  },
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
    hp: clamp(c.hp, 40, 999, 120),
    atk: clamp(c.atk, 4, 99, 18),
    spd: clamp(c.spd, 6, 40, 16),
    skillIds: Array.isArray(c.skillIds) ? c.skillIds.map(String).slice(0, 8) : [],
  }));
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
    hp: clamp(e.hp, 20, 999, 80),
    atk: clamp(e.atk, 4, 80, 12),
    spd: clamp(e.spd, 6, 36, 14),
    isBoss: !!e.isBoss,
  }));
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
    ready: okC && okE,
    line: !okC ? '还差：写一个自己的角色。' : (!okE ? '还差：写一个敌人。' : '可以点右上角「播放作品」了。'),
    counts: `角色 ${r.roster.length} · 敌人 ${r.enemies.length}` + (r.mode === 'rogue' ? ` · 遗物 ${r.relics.length} · 事件 ${r.events.length}` : ''),
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
function skillsOf(r, charId) {
  return (r.skills || []).filter(s => s.ownerId === charId || !s.ownerId);
}

let run = null;
let tickTimer = null;

export function stopRogueRun() {
  if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
  run = null;
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

function stageNodes(enemies) {
  const list = enemies.length ? enemies : [{ id: 'm', name: '练习木桩', hp: 40, atk: 6, spd: 10, elem: 'wood' }];
  const normals = list.filter(e => !e.isBoss);
  const bosses = list.filter(e => e.isBoss);
  const nodes = (normals.length ? normals : list).map(e => ({ type: 'battle', enemyIds: [e.id] }));
  if (bosses.length) nodes.push({ type: 'boss', enemyIds: [bosses[0].id] });
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
  const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
  run = {
    ctx, story, block: block || {}, rogue, seed, rng: mulberry(seed),
    phase: 'pick_team', team: [], relics: [], nodes: [], nodeIdx: 0,
    speed: 1, battle: null, pickOpts: null,
  };
  if (!rogue.roster.length) { run.phase = 'empty'; paint(); return; }
  if (rogue.mode === 'idle' || rogue.roster.length <= rogue.teamSize) {
    beginRun(rogue.roster.slice(0, rogue.teamSize).map(c => c.id));
    return;
  }
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
      <div class="bt-result-text">打开「卡牌工作室」，加一个角色和一个敌人；或点「帮我填一套能玩的」。</div>
      <div class="bt-result-ops"><button class="btn ghost" id="rgExit">退出</button></div></div>`;
    frame.querySelector('#rgExit').addEventListener('click', run.ctx.onExit);
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
      <div class="meta">${elemLabel(c.elem)} · 生命${c.hp} 攻${c.atk} 速${c.spd}</div>`;
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
  run.team = ids.map((id, slot) => {
    const c = r.roster.find(x => x.id === id) || r.roster[0];
    return {
      id: c.id, name: c.name, elem: c.elem, slot, front: slot < 2,
      maxHp: c.hp, hp: c.hp, atk: c.atk, spd: c.spd,
      gauge: 0, buff: 0, next: 0, cards: charCards(r, c, rng),
    };
  });
  run.nodes = r.mode === 'rogue'
    ? buildRogueMap(rng, r.floors, r.enemies)
    : stageNodes(r.enemies);
  run.nodeIdx = 0;
  run.relics = [];
  run.phase = 'map';
  paint();
}

function paintMap(frame) {
  const node = run.nodes[run.nodeIdx];
  const mode = run.rogue.mode;
  const title = mode === 'idle' ? '挂机关卡' : (mode === 'queue' ? '对战列表' : '这一局的路');
  const sub = mode === 'rogue' ? `每局不同 · 种子 ${run.seed.toString(16)}` : '对局里不用点，速度条满了会动手';
  frame.innerHTML = `<div class="rg-head"><b>${title}</b><span>${sub}</span>
    <button class="btn tiny ghost" id="rgExit">退出</button></div>
    <div class="rg-teamline" id="rgTeam"></div>
    <div class="rg-map" id="rgMap"></div>
    <div class="rg-ops"><button class="btn primary" id="rgEnter">${node ? '开始：' + (NODE_LABEL[node.type] || node.type) : '结束'}</button></div>`;
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
    el.textContent = `${i + 1}. ${NODE_LABEL[n.type] || n.type}`;
    frame.querySelector('#rgMap').appendChild(el);
  });
  frame.querySelector('#rgEnter').addEventListener('click', enterNode);
}

function enterNode() {
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
  run.battle = { enemies: livingEnemiesFrom(node), log: [`⚔️ ${NODE_LABEL[node.type]}`], phase: 'running' };
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

function finishBattle(win) {
  if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
  run.battle.phase = win ? 'won' : 'lost';
  paint();
}

function afterWin() {
  run.team.forEach(m => { if (m.hp > 0) m.hp = Math.min(m.maxHp, m.hp + Math.round(m.maxHp * 0.12)); });
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
  if (run.nodeIdx >= run.nodes.length) { run.phase = 'won'; paint(); return; }
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
    <div class="bt-enemy${e.hp <= 0 ? ' dead' : ''}">
      <div class="bt-enemy-name">${esc(e.name)} · ${elemLabel(e.elem)}</div>
      <div class="bt-hp-row"><div class="bt-bar"><div class="bt-bar-fill enemy" style="width:${pct(e.hp, e.maxHp)}%"></div></div><span class="bt-hp-num">${e.hp}/${e.maxHp}</span></div>
      <div class="bt-bar rg-spd"><div class="bt-bar-fill spd" style="width:${Math.min(100, e.gauge || 0)}%"></div></div>
    </div>`).join('');
  const party = run.team.map(m => `
    <div class="bt-member${m.hp <= 0 ? ' dead' : ''}${m.front ? ' hero' : ''}">
      <div class="bt-member-name">${m.front ? '前' : '后'} ${esc(m.name)} · ${elemLabel(m.elem)}</div>
      <div class="bt-hp-row"><div class="bt-bar"><div class="bt-bar-fill hp" style="width:${pct(m.hp, m.maxHp)}%"></div></div><span class="bt-hp-num">${m.hp}/${m.maxHp}</span></div>
      <div class="bt-bar rg-spd"><div class="bt-bar-fill spd" style="width:${Math.min(100, m.gauge || 0)}%"></div></div>
    </div>`).join('');
  const log = (b.log || []).slice(-10).map(l => `<div class="bt-log-line">${esc(l)}</div>`).join('');
  let result = '';
  if (b.phase === 'won') {
    result = `<div class="bt-result"><div class="bt-result-title">赢了</div>
      <div class="bt-result-text">${winHint}</div>
      <div class="bt-result-ops"><button class="btn primary" id="rgNext">继续</button></div></div>`;
  } else if (b.phase === 'lost') {
    result = `<div class="bt-result"><div class="bt-result-title lost">倒下了</div>
      <div class="bt-result-text">${loseHint}</div>
      <div class="bt-result-ops"><button class="btn primary" id="rgRetry">再来一次</button>
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
  if (rt) rt.addEventListener('click', () => startRogueRun(run.block, run.ctx));
  const e2 = frame.querySelector('#rgExit2');
  if (e2) e2.addEventListener('click', run.ctx.onExit);
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
  frame.innerHTML = `<div class="bt-result">
    <div class="bt-result-title${win ? '' : ' lost'}">${win ? '打完了' : '没打过'}</div>
    <div class="bt-result-text">${win ? (run.block.winContent || '可以改角色数值，或换一种玩法再试。') : (run.block.loseContent || '把敌人生命调低，或把角色攻击调高。')}</div>
    <div class="bt-result-ops">
      <button class="btn primary" id="rgA">${win ? '回到剧情' : '再来一次'}</button>
      <button class="btn ghost" id="rgB">退出</button>
    </div></div>`;
  frame.querySelector('#rgB').addEventListener('click', run.ctx.onExit);
  frame.querySelector('#rgA').addEventListener('click', () => {
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
  const c1 = { id: 'c_a', name: '小火', elem: 'fire', hp: 120, atk: 18, spd: 16, skillIds: ['sk_a'] };
  const c2 = { id: 'c_b', name: '小水', elem: 'water', hp: 130, atk: 16, spd: 15, skillIds: ['sk_b'] };
  const skills = [
    { id: 'sk_a', name: '火球', kind: 'atk', power: 120, elem: 'fire', ownerId: 'c_a' },
    { id: 'sk_b', name: '水花', kind: 'atk', power: 110, elem: 'water', ownerId: 'c_b' },
    { id: 'sk_h', name: '喝水', kind: 'heal', power: 90, elem: 'water', ownerId: 'c_b' },
  ];
  const enemies = [
    { id: 'e1', name: '木桩精', elem: 'wood', hp: 50, atk: 8, spd: 12 },
    { id: 'e2', name: '大木桩', elem: 'wood', hp: 90, atk: 12, spd: 11, isBoss: mode !== 'idle' },
  ];
  if (mode === 'idle') {
    return { roster: [c1], skills: [skills[0]], enemies: [enemies[0]], relics: [], events: [] };
  }
  if (mode === 'queue') {
    return { roster: [c1, c2], skills, enemies, relics: [], events: [] };
  }
  return {
    roster: [c1, c2, { id: 'c_c', name: '小木', elem: 'wood', hp: 140, atk: 15, spd: 14, skillIds: ['sk_c'] }],
    skills: skills.concat([{ id: 'sk_c', name: '藤鞭', kind: 'atk', power: 105, elem: 'wood', ownerId: 'c_c' }]),
    enemies: enemies.concat([{ id: 'eb', name: '深坑', elem: 'dark', hp: 200, atk: 16, spd: 12, isBoss: true }]),
    relics: [{ id: 'rl1', name: '小刀', desc: '大家打得重一点', effect: { type: 'atk_pct', val: 10 } }],
    events: [{ id: 'ev1', title: '泉水', text: '要喝吗？', choices: [{ label: '喝（回血）', kind: 'heal' }, { label: '不喝', kind: 'none' }] }],
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

export function openCardStudio(story, api) {
  ensureRogue(story);
  const card = document.querySelector('#modal .modal-card');
  if (card) card.classList.add('modal-wide');
  api.openModal('卡牌工作室', (body) => renderStudio(body, story, api), null);
}

function renderStudio(body, story, api) {
  body.innerHTML = '';
  const r = story.rogue;
  const tip = document.createElement('div');
  tip.className = 'rpg-tip';
  tip.textContent = CARD_MODES[r.mode].hint + ' ' + CARD_MODES[r.mode].need;
  body.appendChild(tip);

  const modes = document.createElement('div');
  modes.className = 'orient-pick';
  modes.style.margin = '8px 0 14px';
  Object.values(CARD_MODES).forEach(m => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'orient-card kind-card' + (r.mode === m.id ? ' active' : '');
    b.innerHTML = `${m.label}<span>${m.id === 'idle' ? '放上去就打' : (m.id === 'queue' ? '速度条自动放技能' : '每局随机牌和事件')}</span>`;
    b.addEventListener('click', () => {
      r.mode = m.id;
      api.persist();
      renderStudio(body, story, api);
      if (api.onMode) api.onMode();
    });
    modes.appendChild(b);
  });
  body.appendChild(modes);

  const h1 = document.createElement('h3');
  h1.textContent = '1. 你的角色（名字就行，数字可以以后再改）';
  body.appendChild(h1);
  const listC = document.createElement('div');
  listC.className = 'rpg-list';
  r.roster.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'rpg-row';
    const mine = skillsOf(r, c.id).filter(s => s.ownerId === c.id);
    row.innerHTML = `<div class="rpg-row-info"><span class="rpg-name">${esc(c.name)}</span>
      <span class="rpg-meta">${elemLabel(c.elem)} 生命${c.hp} 攻${c.atk} 速${c.spd} · ${mine.map(s => s.name).join('、') || '普攻'}</span></div>`;
    const del = document.createElement('button');
    del.className = 'btn tiny danger'; del.textContent = '删';
    del.addEventListener('click', () => {
      r.skills = r.skills.filter(s => s.ownerId !== c.id);
      r.roster.splice(i, 1);
      api.persist();
      renderStudio(body, story, api);
    });
    row.appendChild(del);
    listC.appendChild(row);
  });
  body.appendChild(listC);

  const name = inp('');
  const elem = sel('fire', ELEMS.map(e => [e, elemLabel(e)]));
  const skn = inp('普攻');
  const skk = sel('atk', [['atk', '打人'], ['heal', '救人'], ['buff', '蓄力']]);
  body.append(field('角色名字', name), field('属性', elem), field('他会的一招', skn), field('这一招干什么', skk));
  const addC = document.createElement('button');
  addC.className = 'btn primary'; addC.textContent = '加上这个角色';
  addC.addEventListener('click', () => {
    const n = name.value.trim();
    if (!n) { toast('先写个名字，例如：小火', true); return; }
    const id = uid();
    const sid = uid();
    r.roster.push({ id, name: n.slice(0, 16), elem: elem.value, hp: 120, atk: 18, spd: 16, skillIds: [sid] });
    r.skills.push({
      id: sid, name: (skn.value.trim() || '普攻').slice(0, 16),
      kind: skk.value, power: 110, elem: elem.value, ownerId: id, desc: '',
    });
    api.persist();
    name.value = '';
    renderStudio(body, story, api);
    toast('加上了。生命/攻击以后想改再改。');
  });
  body.appendChild(addC);

  const h2 = document.createElement('h3');
  h2.textContent = '2. 要打的人';
  h2.style.marginTop = '18px';
  body.appendChild(h2);
  const listE = document.createElement('div');
  listE.className = 'rpg-list';
  r.enemies.forEach((e, i) => {
    const row = document.createElement('div');
    row.className = 'rpg-row';
    row.innerHTML = `<div class="rpg-row-info"><span class="rpg-name">${e.isBoss ? '最后要打的 · ' : ''}${esc(e.name)}</span>
      <span class="rpg-meta">${elemLabel(e.elem)} 生命${e.hp} 攻${e.atk}</span></div>`;
    const del = document.createElement('button');
    del.className = 'btn tiny danger'; del.textContent = '删';
    del.addEventListener('click', () => { r.enemies.splice(i, 1); api.persist(); renderStudio(body, story, api); });
    row.appendChild(del);
    listE.appendChild(row);
  });
  body.appendChild(listE);
  const en = inp('');
  const ee = sel('wood', ELEMS.map(x => [x, elemLabel(x)]));
  const boss = document.createElement('input'); boss.type = 'checkbox';
  body.append(field('敌人名字', en), field('属性', ee), field('这是最后的大怪', boss));
  const addE = document.createElement('button');
  addE.className = 'btn primary'; addE.textContent = '加上这个敌人';
  addE.addEventListener('click', () => {
    const n = en.value.trim();
    if (!n) { toast('先写敌人名字，例如：木桩', true); return; }
    r.enemies.push({
      id: uid(), name: n.slice(0, 16), elem: ee.value,
      hp: boss.checked ? 180 : 60, atk: boss.checked ? 16 : 10, spd: 13, isBoss: boss.checked,
    });
    api.persist();
    en.value = '';
    renderStudio(body, story, api);
  });
  body.appendChild(addE);

  if (r.mode === 'rogue') {
    const h3 = document.createElement('h3');
    h3.textContent = '3. 每局彩蛋（可空着，系统有默认）';
    h3.style.marginTop = '18px';
    body.appendChild(h3);
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
    toast('已经填好，关掉窗口点播放即可。');
  });
  body.appendChild(fill);
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
