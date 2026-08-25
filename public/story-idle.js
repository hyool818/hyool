// 女神挂机壳：主城 / 女神册（养成）/ 召唤卡池 / 关卡。
// 由 story-rogue.js 在 mode===idle 时调用。

export function idleProgressOf(r) {
  const p = (r && r.progress) || {};
  const stageIdx = Math.max(0, Math.min(99, Math.round(Number(p.stageIdx) || 0)));
  const gold = Math.max(0, Math.min(999999, Math.round(Number(p.gold) || 0)));
  const teamIds = Array.isArray(p.teamIds) ? p.teamIds.map(String).slice(0, 6) : [];
  const chars = {};
  const raw = p.chars && typeof p.chars === 'object' ? p.chars : {};
  Object.keys(raw).forEach((id) => {
    const c = raw[id] || {};
    chars[id] = {
      level: Math.max(1, Math.min(60, Math.round(Number(c.level) || 1))),
      exp: Math.max(0, Math.min(99999, Math.round(Number(c.exp) || 0))),
      star: Math.max(1, Math.min(5, Math.round(Number(c.star) || 1))),
      copies: Math.max(0, Math.min(99, Math.round(Number(c.copies) || 0))),
    };
  });
  return { stageIdx, gold, teamIds, chars };
}

export function normalizeIdleProgress(r, stageLen) {
  const p = idleProgressOf(r);
  const maxTeam = Math.max(1, Math.min(6, Number(r.teamSize) || 4));
  const rosterIds = new Set((r.roster || []).map((c) => c.id));
  const chars = {};
  Object.keys(p.chars).forEach((id) => {
    if (rosterIds.has(id)) chars[id] = p.chars[id];
  });
  let teamIds = p.teamIds.filter((id) => chars[id]);
  if (!Object.keys(chars).length && (r.roster || []).length) {
    (r.roster || []).slice(0, maxTeam).forEach((c) => {
      chars[c.id] = { level: 1, exp: 0, star: starOf(c.star), copies: 0 };
    });
  }
  const owned = Object.keys(chars);
  teamIds = teamIds.filter((id) => owned.includes(id));
  if (!teamIds.length && owned.length) teamIds = owned.slice(0, maxTeam);
  teamIds = teamIds.slice(0, maxTeam);
  teamIds.forEach((id) => {
    if (!chars[id]) {
      const base = (r.roster || []).find((c) => c.id === id);
      chars[id] = { level: 1, exp: 0, star: starOf(base && base.star), copies: 0 };
    }
  });
  return {
    stageIdx: Math.max(0, Math.min(Math.max(0, stageLen), p.stageIdx)),
    gold: p.gold,
    teamIds,
    chars,
  };
}

function starOf(n) {
  const v = Math.round(Number(n) || 1);
  return Math.max(1, Math.min(5, v));
}

export function expNeed(level) {
  return 40 + level * 25;
}
export function levelUpCost(level) {
  return 30 + level * 20;
}
export function starUpNeed(star) {
  return star;
}

export function fightHp(base, owned) {
  if (!base) return 120;
  const lv = (owned && owned.level) || 1;
  const star = (owned && owned.star) || base.star || 1;
  return Math.round(base.hp * (1 + (lv - 1) * 0.08) * (1 + (star - 1) * 0.06));
}
export function fightAtk(base, owned) {
  if (!base) return 18;
  const lv = (owned && owned.level) || 1;
  const star = (owned && owned.star) || base.star || 1;
  return Math.round(base.atk * (1 + (lv - 1) * 0.09) * (1 + (star - 1) * 0.08));
}

export function ownedOf(r, id) {
  const prog = normalizeIdleProgress(r, (r.stages || []).length);
  const base = (r.roster || []).find((c) => c.id === id);
  const o = prog.chars[id];
  if (!base || !o) return null;
  return {
    ...base,
    level: o.level,
    exp: o.exp,
    star: o.star,
    copies: o.copies,
    fightHp: fightHp(base, o),
    fightAtk: fightAtk(base, o),
  };
}

export function portraitHtml(c, cls) {
  const name = (c && c.name) || '?';
  const ch = name.slice(0, 1);
  const url = c && c.portrait;
  const star = (c && c.star) || 1;
  if (url) {
    return `<div class="${cls} has-img"><img src="${escAttr(url)}" alt=""/><span class="star">${star}★</span><span class="nm">${escHtml(name)}</span></div>`;
  }
  const tone = (c && c.faction) === 'dark' ? 'dark' : 'light';
  return `<div class="${cls} tone-${tone}"><span class="ch">${escHtml(ch)}</span><span class="star">${star}★</span><span class="nm">${escHtml(name)}</span></div>`;
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escAttr(s) {
  return String(s || '').replace(/"/g, '&quot;');
}

function tabsHtml(active) {
  const item = (id, label) =>
    `<button type="button" class="idle-tab${active === id ? ' active' : ''}" data-tab="${id}">${label}</button>`;
  return `<div class="idle-tabs">${item('home', '主城')}${item('book', '女神册')}${item('gacha', '召唤')}${item('stages', '关卡')}</div>`;
}

export function paintIdleShell(frame, run, tab) {
  const r = run.rogue;
  const stages = r.stages || [];
  const prog = normalizeIdleProgress(r, stages.length);
  r.progress = prog;

  if (tab === 'book') return paintBook(frame, run, prog);
  if (tab === 'gacha') return paintGacha(frame, run, prog);
  if (tab === 'stages') return paintStages(frame, run, prog);

  const team = prog.teamIds.map((id) => ownedOf(r, id)).filter(Boolean);
  const slots = [];
  for (let i = 0; i < (r.teamSize || 4); i++) {
    const c = team[i];
    slots.push(c
      ? portraitHtml(c, 'goddess-card slot')
      : `<div class="goddess-card slot empty"><span class="ch">+</span><span class="nm">空位</span></div>`);
  }
  const cur = stages[prog.stageIdx];
  const cleared = prog.stageIdx >= stages.length && stages.length > 0;
  const stageLine = !stages.length
    ? '还没有关卡，去工作室加关'
    : (cleared ? '已通关全部关卡' : `当前：${cur ? cur.title : ('第' + (prog.stageIdx + 1) + '关')}`);

  frame.classList.add('idle-shell');
  frame.innerHTML = `
    <div class="idle-top">
      <div class="idle-brand">女神挂机</div>
      <div class="idle-gold">🪙 ${prog.gold}</div>
      <button type="button" class="btn tiny ghost" id="idleExit">退出</button>
    </div>
    <div class="idle-stage-banner">
      <div class="idle-stage-title">${escHtml(stageLine)}</div>
      <div class="idle-stage-sub">召唤抽卡 · 升级升星 · 挂机推关</div>
    </div>
    <div class="idle-party">${slots.join('')}</div>
    <div class="idle-cta">
      <button type="button" class="btn primary wide" id="idlePush" ${(!stages.length || cleared || !team.length) ? 'disabled' : ''}>
        ${cleared ? '已通关' : (team.length ? '▶ 挂机推关' : '先去女神册选人')}
      </button>
    </div>
    ${tabsHtml('home')}`;
  bindChrome(frame, run);
  const push = frame.querySelector('#idlePush');
  if (push && !push.disabled) {
    push.addEventListener('click', () => {
      if (run.ctx.onIdlePush) run.ctx.onIdlePush(prog.teamIds.slice());
    });
  }
}

function paintBook(frame, run, prog) {
  const r = run.rogue;
  const selected = new Set(prog.teamIds);
  const ownedIds = Object.keys(prog.chars);
  frame.classList.add('idle-shell');
  frame.innerHTML = `
    <div class="idle-top">
      <div class="idle-brand">女神册</div>
      <div class="idle-gold">🪙 ${prog.gold} · 上阵 ${selected.size}/${r.teamSize || 4}</div>
      <button type="button" class="btn tiny ghost" id="idleExit">退出</button>
    </div>
    <div class="idle-book" id="idleBook"></div>
    <div class="idle-detail" id="idleDetail"></div>
    ${tabsHtml('book')}`;
  const host = frame.querySelector('#idleBook');
  if (!ownedIds.length) {
    host.innerHTML = '<div class="idle-empty">还没有女神。去「召唤」抽卡，或工作室点「帮我填一套」。</div>';
  }
  ownedIds.forEach((id) => {
    const c = ownedOf(r, id);
    if (!c) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'goddess-card book' + (selected.has(id) ? ' sel' : '');
    const wrap = document.createElement('div');
    wrap.innerHTML = portraitHtml(c, 'inner');
    if (wrap.firstChild) btn.appendChild(wrap.firstChild);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `Lv.${c.level} · 攻${c.fightAtk} 血${c.fightHp}`;
    btn.appendChild(meta);
    btn.addEventListener('click', () => {
      run.idleCharId = id;
      paintDetail(frame, run, prog, id);
    });
    host.appendChild(btn);
  });
  bindChrome(frame, run);
  const focus = run.idleCharId && prog.chars[run.idleCharId] ? run.idleCharId : ownedIds[0];
  if (focus) paintDetail(frame, run, prog, focus);
}

function paintDetail(frame, run, prog, id) {
  run.idleCharId = id;
  const r = run.rogue;
  const c = ownedOf(r, id);
  const box = frame.querySelector('#idleDetail');
  if (!box || !c) return;
  const need = expNeed(c.level);
  const cost = levelUpCost(c.level);
  const needStar = starUpNeed(c.star);
  const onTeam = prog.teamIds.includes(id);
  box.innerHTML = `
    <div class="idle-detail-card">
      <div class="idle-detail-name">${escHtml(c.name)} · ${c.star}★ · Lv.${c.level}</div>
      <div class="idle-detail-meta">攻 ${c.fightAtk} · 血 ${c.fightHp} · 碎片 ${c.copies} · 经验 ${c.exp}/${need}</div>
      <div class="idle-detail-ops">
        <button type="button" class="btn tiny" id="idleTeamBtn">${onTeam ? '撤下' : '上阵'}</button>
        <button type="button" class="btn tiny primary" id="idleLvBtn" ${prog.gold < cost || c.level >= 60 ? 'disabled' : ''}>升级 (${cost}🪙)</button>
        <button type="button" class="btn tiny" id="idleStarBtn" ${c.star >= 5 || c.copies < needStar ? 'disabled' : ''}>升星 (${needStar}碎片)</button>
      </div>
    </div>`;
  box.querySelector('#idleTeamBtn').addEventListener('click', () => {
    if (run.ctx.onIdleToggleTeam) run.ctx.onIdleToggleTeam(id);
  });
  box.querySelector('#idleLvBtn').addEventListener('click', () => {
    if (run.ctx.onIdleLevelUp) run.ctx.onIdleLevelUp(id);
  });
  box.querySelector('#idleStarBtn').addEventListener('click', () => {
    if (run.ctx.onIdleStarUp) run.ctx.onIdleStarUp(id);
  });
}

function paintGacha(frame, run, prog) {
  const r = run.rogue;
  const cost1 = gachaCost(r, 1);
  const cost10 = gachaCost(r, 10);
  frame.classList.add('idle-shell');
  frame.innerHTML = `
    <div class="idle-top">
      <div class="idle-brand">召唤</div>
      <div class="idle-gold">🪙 ${prog.gold}</div>
      <button type="button" class="btn tiny ghost" id="idleExit">退出</button>
    </div>
    <div class="idle-stage-banner">
      <div class="idle-stage-title">女神卡池</div>
      <div class="idle-stage-sub">从作品角色表抽取。重复角色变碎片，可升星。</div>
    </div>
    <div class="gacha-pool" id="gachaPool"></div>
    <div class="gacha-result" id="gachaResult"></div>
    <div class="idle-cta gacha-ops">
      <button type="button" class="btn primary" id="gacha1" ${prog.gold < cost1 || !(r.roster || []).length ? 'disabled' : ''}>抽1次 (${cost1}🪙)</button>
      <button type="button" class="btn" id="gacha10" ${prog.gold < cost10 || !(r.roster || []).length ? 'disabled' : ''}>抽10次 (${cost10}🪙)</button>
    </div>
    ${tabsHtml('gacha')}`;
  const pool = frame.querySelector('#gachaPool');
  (r.roster || []).slice(0, 8).forEach((c) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = portraitHtml(c, 'goddess-card pool');
    if (wrap.firstChild) pool.appendChild(wrap.firstChild);
  });
  if (!(r.roster || []).length) {
    pool.innerHTML = '<div class="idle-empty">工作室里先加角色，卡池才有东西可抽。</div>';
  }
  bindChrome(frame, run);
  const g1 = frame.querySelector('#gacha1');
  const g10 = frame.querySelector('#gacha10');
  if (g1 && !g1.disabled) g1.addEventListener('click', () => run.ctx.onIdleGacha && run.ctx.onIdleGacha(1));
  if (g10 && !g10.disabled) g10.addEventListener('click', () => run.ctx.onIdleGacha && run.ctx.onIdleGacha(10));
  if (run.gachaLast && run.gachaLast.length) renderGachaResult(frame, r, run.gachaLast);
}

export function renderGachaResult(frame, r, results) {
  const box = frame.querySelector('#gachaResult');
  if (!box) return;
  box.innerHTML = results.map((x) => {
    const c = (r.roster || []).find((u) => u.id === x.id) || { name: '?', star: 1 };
    const tag = x.dup ? '碎片+1' : 'NEW';
    return `<div class="gacha-chip star${x.star}">${escHtml(c.name)} ${x.star}★ <span>${tag}</span></div>`;
  }).join('');
}

function paintStages(frame, run, prog) {
  const stages = run.rogue.stages || [];
  frame.classList.add('idle-shell');
  const rows = stages.map((st, i) => {
    let mark = '🔒';
    if (i < prog.stageIdx) mark = '✓';
    else if (i === prog.stageIdx) mark = '▶';
    return `<div class="idle-stage-row${i === prog.stageIdx ? ' cur' : ''}${i < prog.stageIdx ? ' done' : ''}">
      <span class="mk">${mark}</span><span class="tt">${escHtml(st.title)}</span></div>`;
  }).join('') || '<div class="idle-empty">工作室里加关卡后这里会列出推关路线。</div>';
  frame.innerHTML = `
    <div class="idle-top">
      <div class="idle-brand">关卡</div>
      <div class="idle-gold">进度 ${Math.min(prog.stageIdx, stages.length)}/${stages.length} · 🪙 ${prog.gold}</div>
      <button type="button" class="btn tiny ghost" id="idleExit">退出</button>
    </div>
    <div class="idle-stage-list">${rows}</div>
    ${tabsHtml('stages')}`;
  bindChrome(frame, run);
}

function bindChrome(frame, run) {
  const ex = frame.querySelector('#idleExit');
  if (ex) ex.addEventListener('click', () => run.ctx.onExit && run.ctx.onExit());
  frame.querySelectorAll('.idle-tab').forEach((btn) => {
    btn.addEventListener('click', () => run.ctx.onIdleTab && run.ctx.onIdleTab(btn.dataset.tab));
  });
}

export function gachaCost(r, n) {
  const base = Number((r.gacha && r.gacha.cost) || 80);
  if (n >= 10) return base * 9;
  return base * Math.max(1, n);
}

export function pullGacha(r, n) {
  const prog = normalizeIdleProgress(r, (r.stages || []).length);
  const cost = gachaCost(r, n);
  if (prog.gold < cost) return { ok: false, error: '金币不够' };
  const pool = (r.roster || []).filter((c) => c && c.id);
  if (!pool.length) return { ok: false, error: '卡池是空的' };
  const results = [];
  for (let i = 0; i < n; i++) {
    const c = weightedPick(pool);
    const star = starOf(c.star);
    const had = !!prog.chars[c.id];
    if (!had) {
      prog.chars[c.id] = { level: 1, exp: 0, star, copies: 0 };
      results.push({ id: c.id, star, dup: false });
    } else {
      prog.chars[c.id].copies += 1;
      results.push({ id: c.id, star: prog.chars[c.id].star, dup: true });
    }
  }
  prog.gold -= cost;
  Object.keys(prog.chars).forEach((id) => {
    if (prog.teamIds.length < (r.teamSize || 4) && !prog.teamIds.includes(id)) {
      prog.teamIds.push(id);
    }
  });
  r.progress = prog;
  return { ok: true, results, gold: prog.gold };
}

function weightedPick(pool) {
  const weights = pool.map((c) => Math.max(1, 9 - starOf(c.star) * 1.5));
  const sum = weights.reduce((a, b) => a + b, 0);
  let t = Math.random() * sum;
  for (let i = 0; i < pool.length; i++) {
    t -= weights[i];
    if (t <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export function levelUpChar(r, id) {
  const prog = normalizeIdleProgress(r, (r.stages || []).length);
  const o = prog.chars[id];
  if (!o) return { ok: false, error: '还没有这个角色' };
  if (o.level >= 60) return { ok: false, error: '已满级' };
  const cost = levelUpCost(o.level);
  if (prog.gold < cost) return { ok: false, error: '金币不够' };
  prog.gold -= cost;
  o.level += 1;
  o.exp = 0;
  r.progress = prog;
  return { ok: true, level: o.level, gold: prog.gold };
}

export function starUpChar(r, id) {
  const prog = normalizeIdleProgress(r, (r.stages || []).length);
  const o = prog.chars[id];
  if (!o) return { ok: false, error: '还没有这个角色' };
  if (o.star >= 5) return { ok: false, error: '已满星' };
  const need = starUpNeed(o.star);
  if (o.copies < need) return { ok: false, error: '碎片不够' };
  o.copies -= need;
  o.star += 1;
  r.progress = prog;
  return { ok: true, star: o.star, copies: o.copies };
}

/** 通关奖励：金币 + 上阵角色经验；返回 { gold, exp } */
export function rewardIdleStage(r, stageIdx) {
  const prog = normalizeIdleProgress(r, (r.stages || []).length);
  const gold = 40 + stageIdx * 15;
  const exp = 25 + stageIdx * 10;
  prog.gold += gold;
  prog.stageIdx = Math.max(prog.stageIdx, stageIdx + 1);
  (prog.teamIds || []).forEach((id) => {
    const o = prog.chars[id];
    if (!o || o.level >= 60) return;
    o.exp += exp;
    while (o.level < 60 && o.exp >= expNeed(o.level)) {
      o.exp -= expNeed(o.level);
      o.level += 1;
    }
  });
  r.progress = prog;
  return { gold, exp };
}

