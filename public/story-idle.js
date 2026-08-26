// 女神挂机壳：主城 / 女神册（养成）/ 召唤卡池 / 关卡。
// 由 story-rogue.js 在 mode===idle 时调用。

/** 卡牌装饰框库：白→绿→蓝→紫→红→金→七彩，带 CSS 动态光效 */
export const CARD_FRAMES = {
  white: { id: 'white', label: '白框 · 普通', fx: '' },
  green: { id: 'green', label: '绿框 · 优良', fx: 'fx-glow' },
  blue: { id: 'blue', label: '蓝框 · 精良', fx: 'fx-glow' },
  purple: { id: 'purple', label: '紫框 · 史诗', fx: 'fx-pulse' },
  red: { id: 'red', label: '红框 · 传说', fx: 'fx-pulse' },
  gold: { id: 'gold', label: '金框 · 神话', fx: 'fx-shimmer' },
  rainbow: { id: 'rainbow', label: '七彩框 · 至尊', fx: 'fx-rainbow' },
};

const FRAME_IDS = Object.keys(CARD_FRAMES);

export function normalizeCardFrame(frame, star) {
  const f = String(frame || '').trim();
  if (FRAME_IDS.includes(f)) return f;
  const s = Math.max(1, Math.min(5, Math.round(Number(star) || 1)));
  return ({ 1: 'white', 2: 'green', 3: 'blue', 4: 'purple', 5: 'gold' })[s] || 'white';
}

export function frameLabel(frameId) {
  const f = CARD_FRAMES[frameId];
  return f ? f.label : CARD_FRAMES.white.label;
}

export function resolveFrameAssetUrl(c, assets) {
  if (!c || !c.frameAssetId || !Array.isArray(assets)) return '';
  const a = assets.find((x) => x && x.id === c.frameAssetId && x.url);
  return a ? a.url : '';
}

export function frameLabelFor(c, assets) {
  const url = resolveFrameAssetUrl(c, assets);
  if (url) {
    const a = (assets || []).find((x) => x && x.id === c.frameAssetId);
    return a && a.name ? '素材框 · ' + a.name : '素材边框';
  }
  return frameLabel(normalizeCardFrame(c && c.frame, c && c.star));
}

function frameClasses(c, assets) {
  if (resolveFrameAssetUrl(c, assets)) return 'card-frame-asset';
  const id = normalizeCardFrame(c && c.frame, c && c.star);
  const fx = (CARD_FRAMES[id] && CARD_FRAMES[id].fx) || '';
  return `card-frame frame-${id}${fx ? ` ${fx}` : ''}`;
}

export function cardFrameClass(c, assets) {
  return frameClasses(c, assets);
}

export function frameOverlayHtml(c, assets) {
  const url = resolveFrameAssetUrl(c, assets);
  if (!url) return '';
  return `<img class="card-frame-img" src="${escAttr(url)}" alt="" aria-hidden="true"/>`;
}

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

export function portraitKindOf(c) {
  if (c && c.portraitKind === 'video') return 'video';
  if (c && c.portraitKind === 'image') return 'image';
  const url = String((c && c.portrait) || '').toLowerCase();
  if (/\.(mp4|webm)(\?|#|$)/.test(url)) return 'video';
  return 'image';
}

export function portraitMediaInner(c) {
  const url = c && c.portrait;
  if (!url) return '';
  const name = escAttr((c && c.name) || '');
  if (portraitKindOf(c) === 'video') {
    return `<video class="card-portrait-vid" src="${escAttr(url)}" autoplay loop muted playsinline disablePictureInPicture preload="metadata" aria-label="${name}"></video>`;
  }
  return `<img src="${escAttr(url)}" alt="${name}"/>`;
}

export function portraitThumbHtml(c) {
  const url = c && c.portrait;
  if (!url) return '<span class="studio-thumb empty">无</span>';
  if (portraitKindOf(c) === 'video') {
    return `<video class="studio-thumb" src="${escAttr(url)}" autoplay loop muted playsinline disablePictureInPicture preload="metadata"></video>`;
  }
  return `<img class="studio-thumb" src="${escAttr(url)}" alt=""/>`;
}

export function portraitHtml(c, cls, assets) {
  const name = (c && c.name) || '?';
  const ch = name.slice(0, 1);
  const url = c && c.portrait;
  const star = (c && c.star) || 1;
  const idAttr = c && c.id ? ` data-char-id="${escAttr(c.id)}"` : '';
  const frameCls = frameClasses(c, assets);
  const overlay = frameOverlayHtml(c, assets);
  if (url) {
    return `<div class="${cls} has-img ${frameCls}"${idAttr}><div class="card-art">${portraitMediaInner(c)}</div>${overlay}<span class="star">${star}★</span><span class="nm">${escHtml(name)}</span></div>`;
  }
  const tone = (c && c.faction) === 'dark' ? 'dark' : 'light';
  return `<div class="${cls} tone-${tone} ${frameCls}"${idAttr}><span class="ch">${escHtml(ch)}</span>${overlay}<span class="star">${star}★</span><span class="nm">${escHtml(name)}</span></div>`;
}

const SKILL_KIND_ZH = { atk: '攻击', heal: '治疗', buff: '强化' };
const ELEM_ZH = { fire: '火', water: '水', wood: '木', light: '光', dark: '暗' };
const FACTION_ZH = {
  idle: { light: '光明', dark: '暗影' },
  queue: { ren: '人族', dao: '道族', fo: '佛族', yao: '妖族' },
  rogue: { fire: '火', water: '水', wood: '木', light: '光', dark: '暗' },
};

function factionText(mode, id) {
  const map = FACTION_ZH[mode] || FACTION_ZH.rogue;
  return map[id] || ELEM_ZH[id] || id || '—';
}

function charSkillList(r, charId) {
  const c = (r.roster || []).find((x) => x.id === charId);
  if (!c) return [];
  const ids = new Set(c.skillIds || []);
  return (r.skills || []).filter((s) => ids.has(s.id) || s.ownerId === charId);
}

export function buildCharSheet(r, charId, opts) {
  const base = (r.roster || []).find((c) => c.id === charId);
  if (!base) return null;
  const owned = opts && opts.owned;
  const mode = r.mode || 'idle';
  const skills = charSkillList(r, charId);
  const hp = owned ? owned.fightHp : base.hp;
  const atk = owned ? owned.fightAtk : base.atk;
  const star = (owned && owned.star) || base.star || 1;
  const level = owned && owned.level ? ` · Lv.${owned.level}` : '';
  return {
    url: base.portrait || '',
    portraitKind: portraitKindOf(base),
    name: base.name,
    subtitle: `${factionText(mode, base.faction || base.elem)} · ${star}★${level} · ${frameLabel(normalizeCardFrame(base.frame, star))}`,
    stats: `生命 ${hp} · 攻击 ${atk} · 速度 ${base.spd}`,
    desc: base.desc || '',
    skills: skills.length ? skills.map((s) => ({
      name: s.name,
      meta: `${SKILL_KIND_ZH[s.kind] || '攻击'} · ${ELEM_ZH[s.elem] || '—'} · 威力 ${s.power}`,
      desc: s.desc || defaultSkillDesc(s),
    })) : [{ name: '普攻', meta: '攻击', desc: '战斗中自动反复出手。' }],
  };
}

export function buildEnemySheet(unit) {
  if (!unit) return null;
  return {
    url: unit.portrait || '',
    portraitKind: portraitKindOf(unit),
    name: unit.name,
    subtitle: `敌人 · ${ELEM_ZH[unit.elem] || '—'}${unit.isBoss ? ' · 首领' : ''}`,
    stats: `生命 ${unit.maxHp || unit.hp} · 攻击 ${unit.atk} · 速度 ${unit.spd}`,
    desc: unit.desc || '关卡中的对手，击败即可推进。',
    skills: [{ name: '普攻', meta: '攻击', desc: '按速度条自动攻击我方。' }],
  };
}

function defaultSkillDesc(skill) {
  if (skill.kind === 'heal') return '为队友恢复生命。';
  if (skill.kind === 'buff') return '强化自身或队友，提高后续输出。';
  return '对敌人造成伤害。';
}

function skillListHtml(skills) {
  if (!skills || !skills.length) {
    return '<div class="sheet-desc">暂无技能说明</div>';
  }
  return skills.map((s) => `
    <div class="skill-chip">
      <div class="nm">${escHtml(s.name)}</div>
      <div class="meta">${escHtml(s.meta || '')}</div>
      ${s.desc ? `<div class="desc">${escHtml(s.desc)}</div>` : ''}
    </div>`).join('');
}

export function openCharSheet(sheet) {
  if (!sheet || !sheet.name) return;
  const prev = document.getElementById('portraitLightbox');
  if (prev) prev.remove();
  const el = document.createElement('div');
  el.id = 'portraitLightbox';
  el.className = 'portrait-lightbox';
  const imgBlock = sheet.url
    ? (sheet.portraitKind === 'video'
      ? `<video class="sheet-portrait-vid" src="${escAttr(sheet.url)}" autoplay loop muted playsinline disablePictureInPicture preload="metadata"></video>`
      : `<img src="${escAttr(sheet.url)}" alt="${escAttr(sheet.name)}"/>`)
    : `<div class="sheet-placeholder">${escHtml((sheet.name || '?').slice(0, 1))}</div>`;
  el.innerHTML = `<div class="portrait-lightbox-inner sheet">
    <div class="sheet-visual">${imgBlock}</div>
    <div class="sheet-info">
      <div class="cap">${escHtml(sheet.name)}</div>
      ${sheet.subtitle ? `<div class="sheet-sub">${escHtml(sheet.subtitle)}</div>` : ''}
      ${sheet.stats ? `<div class="sheet-stats">${escHtml(sheet.stats)}</div>` : ''}
      ${sheet.desc ? `<div class="sheet-desc">${escHtml(sheet.desc)}</div>` : ''}
      <div class="sheet-skills-title">技能</div>
      <div class="sheet-skills">${skillListHtml(sheet.skills)}</div>
    </div>
  </div>`;
  const close = () => {
    el.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  el.addEventListener('click', close);
  el.querySelector('.portrait-lightbox-inner').addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('keydown', onKey);
  document.body.appendChild(el);
}

export function openPortraitLightbox(url, name) {
  openCharSheet({ url, name, skills: [] });
}

export function makePortraitZoomCtx(run) {
  return {
    resolveSheet(el) {
      if (!run || !run.rogue) return null;
      const charHost = el.closest('[data-char-id]');
      if (charHost && charHost.dataset.charId) {
        const owned = run.rogue.mode === 'idle' ? ownedOf(run.rogue, charHost.dataset.charId) : null;
        return buildCharSheet(run.rogue, charHost.dataset.charId, { owned });
      }
      if (run.battle) {
        const foeHost = el.closest('[data-enemy-id]');
        if (foeHost && foeHost.dataset.enemyId) {
          const foe = run.battle.enemies.find((e) => e.id === foeHost.dataset.enemyId);
          if (foe) return buildEnemySheet(foe);
        }
      }
      return null;
    },
  };
}

export function bindPortraitZoom(root, opts) {
  if (!root) return;
  const openFromEl = (el, media) => {
    const sheet = opts && opts.resolveSheet ? opts.resolveSheet(el) : null;
    if (sheet) {
      if (!sheet.url && media) {
        const src = media.currentSrc || media.src;
        if (src) sheet.url = src;
      }
      if (!sheet.portraitKind && media && media.tagName === 'VIDEO') sheet.portraitKind = 'video';
      openCharSheet(sheet);
      return;
    }
    if (media) {
      const src = media.currentSrc || media.src;
      if (src) {
        openCharSheet({
          url: src,
          name: '',
          portraitKind: media.tagName === 'VIDEO' ? 'video' : 'image',
          skills: [],
        });
        return;
      }
    }
  };
  root.querySelectorAll(
    '.goddess-card.has-img img, .goddess-card .inner.has-img img, .goddess-card .card-art img, .goddess-card .card-art video, .idle-detail-portrait img, .idle-detail-portrait video, .bt-portrait img, .bt-portrait video, img.studio-thumb, video.studio-thumb'
  ).forEach((media) => {
    if (media.classList.contains('empty')) return;
    media.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFromEl(media, media);
    });
  });
  root.querySelectorAll('.goddess-card[data-char-id] .ch').forEach((ch) => {
    ch.style.cursor = 'zoom-in';
    ch.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFromEl(ch, null);
    });
  });
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

function storyAssets(run) {
  if (run && run.story && run.story.assets) return run.story.assets;
  if (run && run.ctx && run.ctx.story && run.ctx.story.assets) return run.ctx.story.assets;
  return [];
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
      ? portraitHtml(c, 'goddess-card slot', storyAssets(run))
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
  bindPortraitZoom(frame, makePortraitZoomCtx(run));
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
    wrap.innerHTML = portraitHtml(c, 'inner', storyAssets(run));
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
  bindPortraitZoom(frame, makePortraitZoomCtx(run));
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
  const sheet = buildCharSheet(r, id, { owned: c });
  const portraitBlock = c.portrait
    ? `<div class="idle-detail-portrait" data-char-id="${escAttr(id)}"><div class="card-art">${portraitMediaInner(c)}</div></div>`
    : '';
  const descBlock = sheet && sheet.desc
    ? `<div class="idle-detail-desc">${escHtml(sheet.desc)}</div>`
    : '';
  const skillsBlock = sheet && sheet.skills && sheet.skills.length
    ? `<div class="idle-detail-skills">${sheet.skills.map((s) => `
        <div class="idle-skill-chip">
          <div class="nm">${escHtml(s.name)}</div>
          <div class="meta">${escHtml(s.meta)}</div>
          ${s.desc ? `<div class="ds">${escHtml(s.desc)}</div>` : ''}
        </div>`).join('')}</div>`
    : '';
  box.innerHTML = `
    <div class="idle-detail-card">
      ${portraitBlock}
      <div class="idle-detail-name">${escHtml(c.name)} · ${c.star}★ · Lv.${c.level}</div>
      <div class="idle-detail-meta">攻 ${c.fightAtk} · 血 ${c.fightHp} · 碎片 ${c.copies} · 经验 ${c.exp}/${need}</div>
      ${descBlock}
      ${skillsBlock}
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
  bindPortraitZoom(box, makePortraitZoomCtx(run));
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
    wrap.innerHTML = portraitHtml(c, 'goddess-card pool', storyAssets(run));
    if (wrap.firstChild) pool.appendChild(wrap.firstChild);
  });
  if (!(r.roster || []).length) {
    pool.innerHTML = '<div class="idle-empty">工作室里先加角色，卡池才有东西可抽。</div>';
  }
  bindChrome(frame, run);
  bindPortraitZoom(frame, makePortraitZoomCtx(run));
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

