/** Profile hub UI — world wizard, char edit, world detail (yonder-home) */
let bridge = { getChars: () => [], getWorlds: () => [], onCharsChanged: () => {}, onWorldsChanged: () => {} };
function syncChars() { allChars = bridge.getChars() || []; }
function syncWorlds() { allWorlds = bridge.getWorlds() || []; }

const api = (p, o = {}) => {
  const t = localStorage.getItem("hyool_token");
  const h = { "Content-Type": "application/json", ...(o.headers || {}) };
  if (t) h["Authorization"] = "Bearer " + t;
  return fetch(p, { credentials: "include", ...o, headers: h }).then(async r => {
    let d; try { d = await r.json(); } catch { d = { success: false, error: "服务器返回异常。" }; }
    if (!r.ok) throw new Error(d.error || "请求失败。");
    return d;
  });
};

const ph$ = id => document.getElementById(id);
const $ = ph$;
const isSvg = u => u && (u.endsWith(".svg") || u.includes("/portrait"));

let isGuest = true;
let allChars = [];
let allWorlds = [];
let inboxMap = {};   // Companion inbox：character_id → 未读条数
let currentDetailWorld = null;
let editingChar = null;
let deletingChar = null;
let deletingWorld = null;

let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function showModal(id, show) {
  const el = $(id);
  if (!el) return;
  el.classList.toggle("show", !!show);
}

/* 题材与载体选项 */
const GENRES = [
  { id: "fantasy", emoji: "🌌", name: "奇幻", desc: "魔法与传说" },
  { id: "scifi", emoji: "🚀", name: "科幻", desc: "星海与未来" },
  { id: "city", emoji: "🏙️", name: "都市", desc: "灯火与日常" },
  { id: "mystery", emoji: "🔍", name: "悬疑", desc: "迷雾与真相" },
  { id: "wuxia", emoji: "⚔️", name: "武侠", desc: "江湖与侠义" },
  { id: "xianxia", emoji: "⛩️", name: "仙侠", desc: "御剑与修真" },
  { id: "daily", emoji: "☕", name: "日常", desc: "温柔与陪伴" },
  { id: "apocalypse", emoji: "🌋", name: "末日", desc: "废墟与守望" },
  { id: "custom", emoji: "✨", name: "自定义", desc: "完全原创" }
];
const GENRE_PROMPT = {
  fantasy: "epic fantasy world, magic, glowing forests, floating islands, mysterious ruins",
  scifi: "sci-fi world, neon metropolis, space station, stars, futuristic technology",
  city: "modern city skyline at dusk, warm lights, bustling streets",
  mystery: "mysterious noir city, thick fog, dim streetlights, hidden clues",
  wuxia: "chinese wuxia world, misty mountains, ancient pavilions, flying sword",
  xianxia: "xianxia immortal cultivation world, floating mountains, flying swords, ancient chinese temple in clouds, waterfalls, spiritual aura",
  daily: "cozy peaceful everyday scene, warm sunlight, gentle atmosphere",
  apocalypse: "post-apocalyptic wasteland, ruined buildings, dramatic stormy sky",
  custom: "dreamlike original world, surreal landscape, cinematic"
};
const GENRE_LABEL = Object.fromEntries(GENRES.map(g => [g.id, g.name]));
const FORMS = [
  { id: "story", emoji: "📜", name: "故事剧本", desc: "VN / 叙事向" },
  { id: "game", emoji: "🎮", name: "H5 小游戏", desc: "可玩的游戏" },
  { id: "mixed", emoji: "🌍", name: "故事 + 游戏", desc: "两者兼顾" },
  { id: "life", emoji: "🌱", name: "生命世界", desc: "多角色自主共存" }
];
const FORM_LABEL = { story: "故事剧本", game: "H5 小游戏", mixed: "故事 + 游戏", life: "生命世界" };
const LIFE_MODE_LABEL = { watch: "🌱 在线运转", hybrid: "⚡ 混合运转", always: "🌌 24h 后台" };
const LIFE_MODELS = [
  { id: "llama3-70b", label: "llama3.3-70B", advice: "综合对话能力均衡，中英文稳定，现网可用" },
  { id: "dsv4pro", label: "DSV4 Pro", advice: "复杂推理与长篇剧情推演更强" },
  { id: "xverse-ent-25b", label: "XVERSE-Ent-25B", advice: "中文语境更自然，古风/架空表现出色" },
  { id: "qwen3-27b-instruct", label: "Qwen3-27B-Instruct", advice: "多轮指令跟随与多角色调度稳定" }
];

/* ---------- 角色区 ---------- */
function pricingBadgeHtml(c) {
  if (!c) return "";
  if (c.pricing === "paid") return `<span class="badge paid" style="background:rgba(201,168,76,.16);color:#e4c46f;">¥${Math.max(0, Number(c.price) || 0)} 收费</span>`;
  return `<span class="badge free" style="background:rgba(120,220,170,.14);color:#9fdcbb;">免费</span>`;
}

/* Edit modal */
function openEdit(idx) {
  const c = allChars[idx];
  if (!c) return;
  editingChar = c;
  $("editName").value = c.name || "";
  $("editAppearance").value = c.appearance || "";
  $("editPersonality").value = c.personality || "";
  $("editBackground").value = c.background || "";
  $("editSpeech").value = c.speech_style || "";
  $("editWorldName").value = c.world_name || "";
  $("editWorldDesc").value = c.world_description || "";
  $("editHook").value = c.story_hook || "";
  const isPaid = c.pricing === "paid";
  $("editPricing").value = isPaid ? "paid" : "free";
  $("editPrice").value = Number(c.price) || 0;
  $("editPrice").style.display = isPaid ? "" : "none";
  showModal("editModal", true);
}

function closeEdit() {
  showModal("editModal", false);
  editingChar = null;
}

async function saveEdit() {
  if (!editingChar) return;
  const btn = $("editSave");
  btn.disabled = true; btn.textContent = "保存中…";
  try {
    const res = await api("/api/characters/" + editingChar.id + "/update", {
      method: "POST",
      body: JSON.stringify({
        name: $("editName").value.trim(),
        appearance: $("editAppearance").value.trim(),
        personality: $("editPersonality").value.trim(),
        background: $("editBackground").value.trim(),
        speech_style: $("editSpeech").value.trim(),
        world_name: $("editWorldName").value.trim(),
        world_description: $("editWorldDesc").value.trim(),
        story_hook: $("editHook").value.trim(),
        pricing: $("editPricing").value === "paid" ? "paid" : "free",
        price: parseInt($("editPrice").value, 10) || 0
      })
    });
    if (!res.success) throw new Error(res.error || "保存失败。");
    Object.assign(editingChar, res.character);
    bridge.onCharsChanged();
    closeEdit();
    toast("角色已保存。");
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false; btn.textContent = "保存";
  }
}

/* Delete modal */
function openDelete(idx) {
  const c = allChars[idx];
  if (!c) return;
  deletingChar = c;
  deletingWorld = null;
  $("deleteTitle").textContent = "删除角色";
  $("deleteName").textContent = c.name || "未名";
  $("deleteExtra").textContent = "所有对话和记忆将一并删除，此操作不可撤销。";
  showModal("deleteModal", true);
}

function closeDelete() {
  showModal("deleteModal", false);
  deletingChar = null;
  deletingWorld = null;
}

async function confirmDelete() {
  if (deletingWorld) {
    await deleteWorld();
    return;
  }
  if (!deletingChar) return;
  const btn = $("deleteConfirm");
  btn.disabled = true; btn.textContent = "删除中…";
  try {
    const res = await api("/api/characters/" + deletingChar.id + "/delete", { method: "POST" });
    if (!res.success) throw new Error(res.error || "删除失败。");
    allChars = allChars.filter(c => c.id !== deletingChar.id);
    if (bridge.onCharDeleted) bridge.onCharDeleted(deletingChar.id);
    else bridge.onCharsChanged();
    closeDelete();
    toast("角色已删除。");
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false; btn.textContent = "删除";
  }
}

function openWorldDetail(idx) {
  const w = allWorlds[idx];
  if (!w) return;
  currentDetailWorld = w;
  const genreLabel = GENRE_LABEL[w.settings && w.settings.genre] || (w.settings && w.settings.genreLabel) || "世界";
  const formLabel = FORM_LABEL[w.type] || w.type;
  const statusLabel = w.status === "published" ? "已上线" : "草稿";

  $("detailCover").src = w.cover_image || "";
  $("detailName").textContent = w.name;
  $("detailDesc").textContent = w.description || "暂无设定。";
  $("detailBadges").innerHTML =
    `<span class="badge">${escapeHtml(genreLabel)}</span>` +
    `<span class="badge form">${escapeHtml(formLabel)}</span>` +
    (w.type === "life" && w.life_mode ? `<span class="badge">${escapeHtml(LIFE_MODE_LABEL[w.life_mode] || w.life_mode)}</span>` : "") +
    `<span class="badge status">${statusLabel}</span>` +
    pricingBadgeHtml(w);

  // 作品类型：免费 / 收费（支付暂未开通，仅记录与展示）
  const detailIsPaid = w.pricing === "paid";
  $("detailPricing").value = detailIsPaid ? "paid" : "free";
  $("detailPrice").value = Number(w.price) || 0;
  $("detailPrice").style.display = detailIsPaid ? "" : "none";

  const cast = w.cast || [];
  let castHtml = cast.length
    ? cast.map(c => `<span class="dc" onclick="location.href='/buddy/${escapeHtml(c.id)}'">
        <img src="${escapeHtml(c.image_url || '')}" alt="" onerror="this.style.opacity=.2">${escapeHtml(c.name)}</span>`).join("")
    : "";
  if (w.type === "life" && w.world_json && Array.isArray(w.world_json.natives) && w.world_json.natives.length) {
    const natives = w.world_json.natives.map(n => `<span class="dc" title="世界原住民">
        ${n.avatar ? `<img src="${escapeHtml(n.avatar)}" alt="" onerror="this.style.opacity=.2">` : `<img src="" alt="" style="opacity:.15">`}${escapeHtml(n.name)}</span>`).join("");
    castHtml = (castHtml ? castHtml : "") + natives;
  }
  $("detailCast").innerHTML = castHtml || `<span class="hint-line">还没有角色，可稍后在世界后台生成原住民或补充演员。</span>`;

  if (w.type === "life" && w.world_json) {
    const wj = w.world_json;
    $("detailScript").innerHTML =
      `<span class="hint-line">生命世界 · ${wj.natives.length} 位原住民 · ${wj.relations.length} 段关系 · ${wj.scenes.length} 个场景。</span>`;
  } else {
    const rawScript = w.script_json;
    const scenes = Array.isArray(rawScript) ? rawScript : (rawScript && Array.isArray(rawScript.scenes) ? rawScript.scenes : []);
    $("detailScript").innerHTML = scenes.length > 0
      ? `<span class="hint-line">已有 ${scenes.length} 幕剧本${w.source_conversation ? "（沉淀自日常对话）" : ""}。</span>`
      : `<span class="hint-line">剧本尚未生成。在角色对话页「沉淀为剧本」，或稍后在 VN 编辑器中编写。</span>`;
  }

  $("detailDelete").onclick = () => openWorldDelete(idx);
  $("detailPlay").textContent = w.type === "life" ? "进入世界" : "进入工坊";
  $("detailPlay").onclick = () => {
    if (w.type === "game" || w.type === "mixed") {
      location.href = w.play_url || "/game-workshop?world=" + w.id;
    } else if (w.type === "life") {
      location.href = w.play_url || "/world?world=" + w.id;
    } else {
      toast("VN 编辑器即将开放，先试试「沉淀为剧本」吧。");
    }
  };
  showModal("worldDetailModal", true);
}

/* 保存世界作品类型（免费/收费，支付暂未开通） */
async function saveWorldPricing() {
  if (!allWorlds || !currentDetailWorld) return;
  const w = currentDetailWorld;
  const btn = $("detailPricingSave");
  btn.disabled = true; btn.textContent = "保存中…";
  try {
    const res = await api("/api/worlds/" + w.id, {
      method: "PATCH",
      body: JSON.stringify({
        pricing: $("detailPricing").value === "paid" ? "paid" : "free",
        price: parseInt($("detailPrice").value, 10) || 0
      })
    });
    if (!res.success) throw new Error(res.error || "保存失败。");
    Object.assign(w, res.world);
    const idx = allWorlds.findIndex(x => x.id === w.id);
    if (idx >= 0) allWorlds[idx] = w;
    bridge.onWorldsChanged();
    openWorldDetail(allWorlds.findIndex(x => x.id === w.id));
    toast("作品设置已保存。");
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false; btn.textContent = "保存作品设置";
  }
}

/* 发布/下架：status='published' 进入主站生命世界广场，draft 下架移除 */
async function toggleWorldPublish(idx) {
  const w = allWorlds[idx];
  if (!w) return;
  const target = w.status !== "published";
  try {
    const res = await api("/api/worlds/" + w.id, { method: "PATCH", body: JSON.stringify({ status: target ? "published" : "draft" }) });
    if (!res.success) throw new Error(res.error || "操作失败。");
    w.status = target ? "published" : "draft";
    bridge.onWorldsChanged();
    toast(target ? "已发布：进入主站生命世界广场。" : "已下架：从主站生命世界广场移除。");
  } catch (e) {
    toast(e.message || "操作失败。");
  }
}

function openWorldDelete(idx) {
  const w = allWorlds[idx];
  if (!w) return;
  showModal("worldDetailModal", false);
  deletingWorld = w;
  deletingChar = null;
  $("deleteTitle").textContent = "删除世界";
  $("deleteName").textContent = w.name;
  $("deleteExtra").textContent = "除角色库角色将回归角色库外，世界内其他资源（原住民、线程、消息、场景、关系、背景图）将一并删除。此操作不可撤销。";
  showModal("deleteModal", true);
}

async function deleteWorld() {
  if (!deletingWorld) return;
  const btn = $("deleteConfirm");
  btn.disabled = true; btn.textContent = "删除中…";
  try {
    const res = await api("/api/worlds/" + deletingWorld.id + "/delete", { method: "POST" });
    if (!res.success) throw new Error(res.error || "删除失败。");
    allWorlds = allWorlds.filter(w => w.id !== deletingWorld.id);
    if (bridge.onWorldDeleted) bridge.onWorldDeleted(deletingWorld.id);
    else bridge.onWorldsChanged();
    closeDelete();
    toast("世界已删除。");
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false; btn.textContent = "删除";
  }
}

/* ---------- 自定义世界向导 ---------- */
let wizard = { step: 1, genre: null, form: "story", name: "", desc: "", castIds: [], cover: "", seed: 0 };

function renderWizardSteps() {
  $("wizardSteps").innerHTML = Array.from({ length: 5 }, (_, i) => {
    const n = i + 1;
    const cls = n < wizard.step ? "done" : n === wizard.step ? "active" : "";
    return `<span class="wizard-step-dot ${cls}"></span>`;
  }).join("");
}

function wizardGo(step) {
  wizard.step = step;
  renderWizardSteps();
  document.querySelectorAll("#wizardModal .wstep").forEach(el => {
    el.classList.toggle("active", Number(el.dataset.wstep) === step);
  });
  const next = $("wizardNext");
  if (step === 3) {
    const isLife = wizard.form === "life";
    $("lifePanel").style.display = isLife ? "" : "none";
    renderCastPickSummary();
  }
  if (step === 5) {
    next.textContent = "创建世界";
    const castNames = (allChars.filter(c => wizard.castIds.includes(c.id)) || []).map(c => c.name).join("、");
    let extra = "";
    if (wizard.form === "life") {
      extra = `<br>运转：${LIFE_MODE_LABEL[wizard.mode] || wizard.mode || "—"}` +
              `<br>模型：${(LIFE_MODELS.find(m => m.id === wizard.model) || {}).label || wizard.model || "—"}`;
    }
    $("wSummary").innerHTML =
      `题材：${GENRE_LABEL[wizard.genre] || "—"}　载体：${FORM_LABEL[wizard.form] || "—"}<br>` +
      `名称：${escapeHtml(wizard.name)}<br>` +
      (wizard.desc ? `设定：${escapeHtml(wizard.desc)}<br>` : "") +
      `演员：${castNames || "（暂无，稍后补充）"}${extra}`;
  } else {
    next.textContent = "下一步";
  }
  next.className = "btn btn-save";
  $("wizardPrev").style.visibility = step === 1 ? "hidden" : "visible";
}

function wizardInit() {
  wizard = { step: 1, genre: null, form: "story", name: "", desc: "", castIds: [], cover: "", seed: 0, mode: "watch", model: "llama3-70b" };
  $("wName").value = "";
  $("wDesc").value = "";

  $("genreGrid").innerHTML = GENRES.map(g => `
    <div class="option-card" data-genre="${g.id}" onclick="pickGenre('${g.id}')">
      <span class="check">✓</span><span class="emoji">${g.emoji}</span>
      <span class="name">${g.name}</span><span class="desc">${g.desc}</span>
    </div>`).join("");

  $("formGrid").innerHTML = FORMS.map(f => `
    <div class="option-card" data-form="${f.id}" onclick="pickForm('${f.id}')">
      <span class="check">✓</span><span class="emoji">${f.emoji}</span>
      <span class="name">${f.name}</span><span class="desc">${f.desc}</span>
    </div>`).join("");
  pickForm("story");
  renderCastPickGrid();
  renderCastPickSummary();

  $("lifeModeGrid").innerHTML = [
    { id: "watch", emoji: "🌱", name: "在线运转", desc: "你看着它们聊，离开即暂停" },
    { id: "hybrid", emoji: "⚡", name: "混合运转", desc: "在线实时 + 离线补播代表剧情" },
    { id: "always", emoji: "🌌", name: "24h 后台", desc: "后台持续运转，随时翻看历史" }
  ].map(m => `
    <div class="option-card" data-lmode="${m.id}" onclick="pickLifeMode('${m.id}')">
      <span class="check">✓</span><span class="emoji">${m.emoji}</span>
      <span class="name">${m.name}</span><span class="desc">${m.desc}</span>
    </div>`).join("");

  $("lifeModelGrid").innerHTML = LIFE_MODELS.map(m => `
    <div class="option-card" data-lmodel="${m.id}" onclick="pickLifeModel('${m.id}')">
      <span class="check">✓</span><span class="emoji">🧠</span>
      <span class="name">${m.label}</span><span class="desc">${m.advice}</span>
    </div>`).join("");

  pickLifeMode("watch");
  pickLifeModel("llama3-70b");
  wizardGo(1);
}

function pickGenre(id) {
  wizard.genre = id;
  document.querySelectorAll("#genreGrid .option-card").forEach(el => {
    el.classList.toggle("selected", el.dataset.genre === id);
  });
}
function pickForm(id) {
  wizard.form = id;
  document.querySelectorAll("#formGrid .option-card").forEach(el => {
    el.classList.toggle("selected", el.dataset.form === id);
  });
  // 生命世界：去掉向导里的一句话设定（时代/氛围/规则将到世界里设置并锁死）
  $("wDescGroup").style.display = id === "life" ? "none" : "";
  $("wDesc").value = "";
  if (id === "life") {
    $("lifePanel").style.display = "";
  } else {
    $("lifePanel").style.display = "none";
  }
}
function pickLifeMode(id) {
  wizard.mode = id;
  document.querySelectorAll("#lifeModeGrid .option-card").forEach(el => {
    el.classList.toggle("selected", el.dataset.lmode === id);
  });
}
function pickLifeModel(id) {
  wizard.model = id;
  document.querySelectorAll("#lifeModelGrid .option-card").forEach(el => {
    el.classList.toggle("selected", el.dataset.lmodel === id);
  });
  const mi = LIFE_MODELS.find(m => m.id === id);
  $("lifeModelAdvice").textContent = mi ? `建议：${mi.advice}` : "";
}
function toggleCast(id, el) {
  const idx = wizard.castIds.indexOf(id);
  if (idx >= 0) { wizard.castIds.splice(idx, 1); if (el) el.classList.remove("selected"); }
  else { wizard.castIds.push(id); if (el) el.classList.add("selected"); }
  renderCastPickSummary();
}
function renderCastPickGrid() {
  const sel = new Set(wizard.castIds);
  $("wCastGrid").innerHTML = allChars.length
    ? allChars.map(c => `
        <div class="char-select${sel.has(c.id) ? " selected" : ""}" data-cid="${escapeHtml(c.id)}" onclick="toggleCast('${escapeHtml(c.id)}', this)">
          <span class="check">✓</span>
          <img src="${escapeHtml(c.image_url || '')}" alt="" onerror="this.style.opacity=.2">
          <span><span class="cs-name">${escapeHtml(c.name || '未名')}</span><br><span class="cs-world">${escapeHtml(c.world_name || '')}</span></span>
        </div>`).join("")
    : `<span class="hint-line" style="grid-column:1/-1;">还没有角色。可以先跳过，稍后在工坊中补充演员。</span>`;
}
function renderCastPickSummary() {
  const picked = allChars.filter(c => wizard.castIds.includes(c.id));
  $("wCastHint").textContent = picked.length ? `已选择 ${picked.length} 位角色。` : "尚未选择角色。";
  $("wCastPicked").innerHTML = picked.map(c => `
    <span class="chip">${escapeHtml(c.name)} <button type="button" onclick="toggleCast('${escapeHtml(c.id)}', null)">✕</button></span>`).join("");
}
function openCastPick() {
  renderCastPickGrid();
  showModal("castPickModal", true);
}
function confirmCastPick() {
  showModal("castPickModal", false);
  renderCastPickSummary();
  toast(wizard.castIds.length ? "已选择 " + wizard.castIds.length + " 位角色。" : "未选择角色，可稍后在工坊补充。");
}

let _imgProv = null;
async function imgProv() {
  if (!_imgProv) _imgProv = await import("/image-provider.js");
  return _imgProv;
}

function coverPromptText() {
  const g = GENRE_PROMPT[wizard.genre] || GENRE_PROMPT.custom;
  const desc = wizard.desc ? ", " + wizard.desc : "";
  return `${g}, world named ${wizard.name}${desc}, cinematic concept art, wide shot, highly detailed, no text, no watermark`;
}

async function buildCoverUrl() {
  const prompt = coverPromptText();
  wizard.seed = Math.floor(Math.random() * 1000000);
  const mod = await imgProv();
  if (mod.getImageProvider() === "comfy") {
    const r = await mod.generateAndResolveUrl({ prompt, width: 1024, height: 768, seed: wizard.seed });
    return r.url;
  }
  return mod.pollinationsUrl(prompt, { width: 1024, height: 768, seed: wizard.seed }).url;
}

async function wizardRegenCover() {
  const btn = document.querySelector('[onclick="wizardRegenCover()"]');
  const old = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "生成中…"; }
  try {
    wizard.cover = await buildCoverUrl();
    $("coverPreview").src = wizard.cover;
    $("coverPreview2").src = wizard.cover;
  } catch (e) {
    toast(e.message || "封面生成失败。");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old || "🔄 换一张"; }
  }
}

function uploadImageFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const t = localStorage.getItem("hyool_token");
  const h = {};
  if (t) h["Authorization"] = "Bearer " + t;
  return fetch("/api/upload", { method: "POST", credentials: "include", headers: h, body: fd })
    .then(r => r.json())
    .then(d => { if (d.success && d.url) return d.url; throw new Error(d.error || "上传失败。"); });
}
async function wizardUploadCover(file) {
  if (!file) return;
  try {
    const url = await uploadImageFile(file);
    wizard.cover = url;
    $("coverPreview").src = wizard.cover;
    $("coverPreview2").src = wizard.cover;
    toast("封面已上传。");
  } catch (e) { toast(e.message); }
}

async function wizardNext() {
  if (wizard.step === 1 && !wizard.genre) { toast("请先选择世界题材。"); return; }
  if (wizard.step === 2) {
    wizard.name = $("wName").value.trim();
    wizard.desc = $("wDesc").value.trim();
    if (!wizard.name) { toast("请给世界起个名字。"); return; }
  }
  if (wizard.step === 4 && !wizard.cover) await wizardRegenCover();
  if (wizard.step === 5) { wizardCreate(); return; }
  wizardGo(wizard.step + 1);
}
function wizardPrev() {
  if (wizard.step > 1) wizardGo(wizard.step - 1);
}

async function wizardCreate() {
  const btn = $("wizardNext");
  btn.disabled = true; btn.textContent = "创建中…";
  try {
    const payload = {
      name: wizard.name,
      description: wizard.desc,
      type: wizard.form,
      cast_ids: wizard.castIds,
      cover_image: wizard.cover,
      settings: { genre: wizard.genre, genreLabel: GENRE_LABEL[wizard.genre] }
    };
    if (wizard.form === "life") {
      payload.world_json = {
        background: { note: wizard.desc },
        life: { mode: wizard.mode, model: wizard.model }
      };
    }
    const res = await api("/api/worlds", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (!res.success) throw new Error(res.error || "创建失败。");
    showModal("wizardModal", false);
    if (bridge.onWorldCreated) bridge.onWorldCreated(res.world);
    else { allWorlds.unshift(res.world); bridge.onWorldsChanged(); }
    toast("世界已创建。");
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false; btn.textContent = "下一步";
  }
}


function openCharEdit(id) {
  syncChars();
  const idx = allChars.findIndex(c => c.id === id);
  if (idx >= 0) openEdit(idx);
}
function openWorldDetailById(id) {
  syncWorlds();
  const idx = allWorlds.findIndex(w => w.id === id);
  if (idx >= 0) openWorldDetail(idx);
}
function openWizardModal() {
  syncChars();
  wizardInit();
  showModal('wizardModal', true);
}
function openWizardLife() {
  syncChars();
  wizardInit();
  pickForm('life');
  showModal('wizardModal', true);
}
function handleProfileHubQuery() {
  const q = new URLSearchParams(location.search);
  const wid = q.get('world');
  if (wid) openWorldDetailById(wid);
}
window.ProfileHubUI = {
  init(cfg) {
    bridge = { ...bridge, ...cfg };
    syncChars();
    syncWorlds();
    import('/image-provider.js').then(m => {
      const el = document.getElementById('imgGenSettings');
      if (el) m.mountImageGenSettings(el);
    }).catch(() => {});
    window.wizardRegenCover = wizardRegenCover;
    window.pickGenre = pickGenre;
    window.pickForm = pickForm;
    window.pickLifeMode = pickLifeMode;
    window.pickLifeModel = pickLifeModel;
    window.toggleCast = toggleCast;
    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    bind('wizardPrev', wizardPrev);
    bind('wizardNext', wizardNext);
    bind('wCastPick', openCastPick);
    bind('castPickCancel', () => showModal('castPickModal', false));
    bind('castPickConfirm', confirmCastPick);
    bind('wizardUploadCover', () => document.getElementById('wizardCoverFile').click());
    const wcf = document.getElementById('wizardCoverFile');
    if (wcf) wcf.addEventListener('change', e => { wizardUploadCover(e.target.files[0]); e.target.value = ''; });
    bind('editCancel', closeEdit);
    bind('editSave', saveEdit);
    const ep = document.getElementById('editPricing');
    if (ep) ep.addEventListener('change', () => { document.getElementById('editPrice').style.display = ep.value === 'paid' ? '' : 'none'; });
    const dp = document.getElementById('detailPricing');
    if (dp) dp.addEventListener('change', () => { document.getElementById('detailPrice').style.display = dp.value === 'paid' ? '' : 'none'; });
    bind('detailPricingSave', saveWorldPricing);
    bind('deleteCancel', closeDelete);
    bind('deleteConfirm', confirmDelete);
    ['editModal', 'deleteModal', 'wizardModal', 'worldDetailModal', 'castPickModal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', e => { if (e.target.id === id) showModal(id, false); });
    });
    handleProfileHubQuery();
  },
  openWizard: openWizardModal,
  openWizardLife,
  openCharEdit,
  openWorldDetail: openWorldDetailById,
};
