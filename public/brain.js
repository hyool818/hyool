// HYOOL 中枢前端：一句话 → plan → 人审蓝图 → run → 写入作品编辑器
const TOKEN_KEY = 'hyool_token';
const $ = (s) => document.querySelector(s);

let meta = { styles: [], voices: [] };
let blueprint = null;
let lastStory = null;

function authHeaders() {
  const t = localStorage.getItem(TOKEN_KEY);
  return t ? { Authorization: 'Bearer ' + t } : {};
}

function toast(msg, bad) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('bad', !!bad);
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3200);
}

function setStep(n) {
  document.querySelectorAll('[data-step]').forEach((el) => {
    el.classList.toggle('hidden', Number(el.dataset.step) !== n);
  });
  document.querySelectorAll('.wiz-step').forEach((el) => {
    const i = Number(el.dataset.wiz);
    el.classList.toggle('on', i === n);
    el.classList.toggle('done', i < n);
  });
}

async function ensureLogin() {
  try {
    const res = await fetch('/api/me', { credentials: 'include', headers: authHeaders() });
    const d = await res.json().catch(() => ({}));
    if (!d.authenticated || !d.user) {
      $('#loginGate').classList.remove('hidden');
      return false;
    }
    $('#loginGate').classList.add('hidden');
    $('#who').textContent = '@' + (d.user.username || '');
    return true;
  } catch (e) {
    $('#loginGate').classList.remove('hidden');
    return false;
  }
}

async function loadMeta() {
  const res = await fetch('/api/hub/meta', { credentials: 'include', headers: authHeaders() });
  const d = await res.json();
  if (!d.success) throw new Error(d.error || '无法加载中枢元数据');
  meta = d;
  const sel = $('#styleSel');
  sel.innerHTML = '';
  (d.styles || []).forEach((s) => {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = s.label || s.id;
    sel.appendChild(o);
  });
}

function renderBlueprint(bp) {
  blueprint = bp;
  $('#bpTitle').value = (bp.meta && bp.meta.title) || '';
  $('#bpConcept').value = (bp.meta && (bp.meta.concept || bp.meta.logline)) || '';
  $('#bpOrient').value = (bp.meta && bp.meta.orientation) === 'portrait' ? 'portrait' : 'landscape';
  if (bp.meta && bp.meta.style) $('#styleSel').value = bp.meta.style;

  const castEl = $('#bpCast');
  castEl.innerHTML = '';
  (bp.cast || []).forEach((c) => {
    const li = document.createElement('li');
    li.textContent = `${c.name || c.id} · ${c.role || ''} · ${c.appearance || ''}`.replace(/\s·\s$/,'');
    castEl.appendChild(li);
  });

  const chEl = $('#bpChapters');
  chEl.innerHTML = '';
  (bp.chapters || []).forEach((ch, i) => {
    const details = document.createElement('details');
    if (i === 0) details.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `${ch.title || ('第' + (i + 1) + '章')} · ${(ch.blocks || []).length} 块`;
    details.appendChild(sum);
    const ul = document.createElement('ul');
    (ch.blocks || []).forEach((b) => {
      const li = document.createElement('li');
      const kind = b.type === 'dialogue' ? '对白' : (b.type === 'choice' ? '选项' : '场景');
      const snip = String(b.content || b.prompt || '').replace(/\s+/g, ' ').slice(0, 48);
      li.textContent = `[${kind}] ${snip}`;
      ul.appendChild(li);
    });
    details.appendChild(ul);
    chEl.appendChild(details);
  });
}

function applyEditsToBlueprint() {
  if (!blueprint) return null;
  blueprint.meta = blueprint.meta || {};
  blueprint.meta.title = ($('#bpTitle').value || '').trim().slice(0, 40) || blueprint.meta.title;
  blueprint.meta.concept = ($('#bpConcept').value || '').trim().slice(0, 200);
  blueprint.meta.orientation = $('#bpOrient').value === 'portrait' ? 'portrait' : 'landscape';
  blueprint.meta.style = $('#styleSel').value || blueprint.meta.style;
  return blueprint;
}

/** 无素材骨架：人审后可直接进编辑器（不跑图/TTS） */
function skeletonFromBlueprint(bp) {
  const castMap = {};
  (bp.cast || []).forEach((c) => {
    if (c.name) castMap[c.name] = { kind: 'tts', voice: c.voiceId || '' };
  });
  const chapters = (bp.chapters || []).map((ch) => ({
    id: ch.id,
    title: ch.title,
    blocks: (ch.blocks || []).map((b) => {
      if (b.type === 'dialogue') {
        const cast = (bp.cast || []).find((c) => c.id === b.speaker);
        return {
          id: b.id,
          type: 'dialogue',
          speaker: cast ? cast.name : '旁白',
          content: b.content || '',
          subtitle: { on: true },
        };
      }
      if (b.type === 'choice') {
        const opts = Array.isArray(b.options) ? b.options : [];
        return {
          id: b.id,
          type: 'choice',
          content: b.prompt || b.content || '请选择：',
          choices: opts.map((o, i) => ({
            id: o.id || `${b.id}_opt_${i}`,
            label: String(o.label || `选项${i + 1}`).slice(0, 40),
            jump: String(o.target || 'next').slice(0, 96),
            require: Array.isArray(o.require) ? o.require : [],
            effect: Array.isArray(o.effect) ? o.effect : [],
          })),
        };
      }
      return {
        id: b.id,
        type: 'scene',
        content: b.content || b.prompt || '',
        subtitle: { on: true },
      };
    }),
  }));
  return {
    title: (bp.meta && bp.meta.title) || '未名作品',
    orientation: (bp.meta && bp.meta.orientation) === 'portrait' ? 'portrait' : 'landscape',
    imgQuality: 'standard',
    kind: 'story',
    cast: castMap,
    logic: {
      state: (bp.logic && bp.logic.state && typeof bp.logic.state === 'object') ? { ...bp.logic.state } : {},
      rules: {},
    },
    chapters,
  };
}

async function saveStoryToCloud(storyData) {
  const res = await fetch('/api/stories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      title: storyData.title,
      orientation: storyData.orientation,
      imgQuality: storyData.imgQuality || 'standard',
      kind: storyData.kind || 'story',
    }),
  });
  const d = await res.json();
  if (!d.success || !d.story) throw new Error(d.error || '创建作品失败');
  const full = { ...storyData, id: d.story.id, kind: 'story' };
  const up = await fetch('/api/stories/' + encodeURIComponent(full.id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ data: full }),
  });
  const ud = await up.json();
  if (!ud.success) throw new Error(ud.error || '保存作品失败');
  // 本地缓存合并，方便素材库 harvest
  try {
    const key = 'hyool_stories_v1';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    const list = Array.isArray(arr) ? arr : [];
    list.unshift(full);
    localStorage.setItem(key, JSON.stringify(list.slice(0, 80)));
  } catch (e) { /* ignore */ }
  // 收进素材库（若有 URL）
  try {
    const { harvestFromStory } = await import('/story-assets.js');
    harvestFromStory(full);
  } catch (e) { /* ignore */ }
  return full;
}

function openEditor(id) {
  location.href = '/story-editor.html?story=' + encodeURIComponent(id);
}

async function onPlan() {
  const request = ($('#reqInput').value || '').trim();
  if (!request) { toast('先写一句你想做的作品', true); return; }
  const btn = $('#planBtn');
  btn.disabled = true;
  btn.textContent = '规划中…';
  try {
    const res = await fetch('/api/hub/plan', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        request,
        options: { style: $('#styleSel').value || undefined },
      }),
    });
    const d = await res.json();
    if (!d.success) throw new Error(d.error || '规划失败');
    renderBlueprint(d.blueprint);
    const imgN = (d.assets && d.assets.images && d.assets.images.length) || 0;
    const vocN = (d.assets && d.assets.voices && d.assets.voices.length) || 0;
    $('#assetHint').textContent = `将生成约 ${imgN} 张图、${vocN} 段配音（可先只导入文字骨架）。`;
    setStep(2);
    toast('企划书已就绪，请确认后生成');
  } catch (e) {
    toast(e.message || '规划失败', true);
  } finally {
    btn.disabled = false;
    btn.textContent = '生成企划书 →';
  }
}

async function onRun(fullAssets) {
  const bp = applyEditsToBlueprint();
  if (!bp) { toast('没有企划书', true); return; }
  setStep(3);
  $('#runStatus').textContent = fullAssets
    ? '正在生成画面与配音，可能需要一两分钟…'
    : '正在导入文字骨架…';
  $('#runBar').style.width = '18%';
  const runBtn = $('#runBtn');
  const skelBtn = $('#skelBtn');
  if (runBtn) runBtn.disabled = true;
  if (skelBtn) skelBtn.disabled = true;
  try {
    let storyData;
    if (fullAssets) {
      $('#runBar').style.width = '40%';
      const res = await fetch('/api/hub/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ blueprint: bp }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '生成失败');
      if (!d.story) throw new Error('流水线未返回作品，可改用「只导入文字」');
      storyData = { ...d.story, kind: 'story', imgQuality: 'standard' };
      $('#runBar').style.width = '75%';
    } else {
      storyData = skeletonFromBlueprint(bp);
      $('#runBar').style.width = '60%';
    }
    const saved = await saveStoryToCloud(storyData);
    lastStory = saved;
    $('#runBar').style.width = '100%';
    $('#runStatus').textContent = '已写入作品库：「' + saved.title + '」';
    $('#openBtn').classList.remove('hidden');
    $('#openBtn').onclick = () => openEditor(saved.id);
    toast('完成，可进编辑器试玩');
  } catch (e) {
    $('#runStatus').textContent = e.message || '失败';
    $('#runBar').style.width = '0%';
    toast(e.message || '失败', true);
    setStep(2);
  } finally {
    if (runBtn) runBtn.disabled = false;
    if (skelBtn) skelBtn.disabled = false;
  }
}

async function boot() {
  setStep(1);
  const ok = await ensureLogin();
  if (!ok) return;
  try {
    await loadMeta();
  } catch (e) {
    toast(e.message || '中枢未就绪', true);
  }
  $('#planBtn').addEventListener('click', onPlan);
  $('#back1').addEventListener('click', () => setStep(1));
  $('#runBtn').addEventListener('click', () => onRun(true));
  $('#skelBtn').addEventListener('click', () => onRun(false));
  $('#againBtn').addEventListener('click', () => {
    $('#openBtn').classList.add('hidden');
    setStep(1);
  });
}

boot();
