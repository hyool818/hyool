// game-studio.js — 作品编辑器 · 小游戏模板工坊（原游戏工坊）
// 引擎：PixiJS v8 CDN 懒加载；失败回退 Canvas 2D。
// 存档：浏览器 localStorage；若带 ?story= 则同时写回该作品的 miniGame 字段（云端 stories）。
import { $, toast } from './ui.js';

const PIXI_CDN = 'https://cdn.jsdelivr.net/npm/pixi.js@8.6.6/dist/pixi.min.mjs';
const SAVE_KEY = 'hyool_games_v1';
const W = 640;
const H = 420;
const qs = new URLSearchParams(location.search);
const storyId = qs.get('story') || '';
const fromEditor = qs.get('from') === 'editor' || !!storyId;
const autoPlay = qs.get('play') === '1';
const TOKEN_KEY = 'hyool_token';

const TEMPLATES = {
  catch: { name: '接水果', icon: '🧺', hero: '🧺', items: ['🍎', '🍊', '🍋', '🍇', '🍓'], desc: '移动篮子接住掉落的果子' },
  dodge: { name: '躲避', icon: '🏃', hero: '🐱', items: ['⚡', '🧱', '🌵', '❄️'], desc: '左右躲开坠落障碍撑到最后' },
  whack: { name: '打地鼠', icon: '🔨', hero: '🔨', items: ['🐭', '🦔', '🦊'], desc: '点击冒头的小怪赚分' },
};

let pixiPromise = null;
const loadPixi = () => (pixiPromise ||= import(PIXI_CDN));
// ---------- 配置 / 存档 ----------
const cfg = {
  name: '我的小游戏', template: 'catch', hero: '🧺', item: '', bg: '#1b2340',
  difficulty: 2, sound: true, time: 30,
};
const sessionBest = {};
let savedGames = loadList();
let currentGame = null;
let engineMode = 'idle';

function authHeaders() {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t ? { Authorization: 'Bearer ' + t } : {};
  } catch (e) { return {}; }
}
async function loadStoryMiniGame() {
  if (!storyId) return null;
  try {
    const res = await fetch('/api/stories/' + encodeURIComponent(storyId), {
      credentials: 'include', headers: authHeaders(),
    });
    const d = await res.json();
    if (!d.success || !d.story) return null;
    const data = d.story.data && typeof d.story.data === 'object' ? d.story.data : d.story;
    return data && data.miniGame ? data.miniGame : null;
  } catch (e) { return null; }
}
async function saveStoryMiniGame() {
  if (!storyId) return false;
  try {
    const res = await fetch('/api/stories/' + encodeURIComponent(storyId), {
      credentials: 'include', headers: authHeaders(),
    });
    const d = await res.json();
    if (!d.success || !d.story) return false;
    const full = { ...d.story };
    const data = (full.data && typeof full.data === 'object') ? { ...full.data } : { ...full };
    data.kind = 'mini_game';
    data.miniGame = {
      template: cfg.template,
      name: cfg.name,
      hero: cfg.hero,
      item: cfg.item,
      bg: cfg.bg,
      difficulty: cfg.difficulty,
      sound: cfg.sound,
      time: cfg.time,
    };
    const up = await fetch('/api/stories/' + encodeURIComponent(storyId), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ data }),
    });
    const ud = await up.json();
    return !!ud.success;
  } catch (e) { return false; }
}
function applyMiniFromStory(mg) {
  if (!mg) return;
  if (TEMPLATES[mg.template]) cfg.template = mg.template;
  if (mg.name) cfg.name = String(mg.name).slice(0, 40);
  if (mg.hero) cfg.hero = String(mg.hero).slice(0, 8);
  if (mg.item != null) cfg.item = String(mg.item).slice(0, 8);
  if (mg.bg) cfg.bg = String(mg.bg).slice(0, 20);
  if (mg.difficulty) cfg.difficulty = Math.max(1, Math.min(3, Number(mg.difficulty) || 2));
  cfg.sound = mg.sound !== false;
  if (mg.time) cfg.time = Math.max(10, Math.min(120, Number(mg.time) || 30));
}
function loadList() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}
function persistList() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(savedGames)); } catch (e) { /* ignore */ }
}
// ---------- 音效（Web Audio 合成） ----------
let actx = null;
function ensureAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) actx = new AC();
  }
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
}
function tone(freq, dur, type = 'sine', vol = 0.12, when = 0) {
  if (!cfg.sound) return;
  try {
    ensureAudio();
    if (!actx) return;
    const t0 = actx.currentTime + when;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  } catch (e) { /* ignore */ }
}
function sfx(name) {
  if (name === 'score') tone(720, 0.09, 'triangle', 0.12);
  else if (name === 'miss') tone(170, 0.16, 'sawtooth', 0.06);
  else if (name === 'hit') { tone(300, 0.14, 'square', 0.08); tone(180, 0.18, 'square', 0.07, 0.05); }
  else if (name === 'pop') tone(980, 0.05, 'sine', 0.08);
  else if (name === 'win') tone(523, 0.18, 'triangle', 0.12);
  else if (name === 'over') tone(196, 0.22, 'triangle', 0.12);
}
// ---------- 渲染器抽象：PixiJS / Canvas2D 双后端 ----------
class Canvas2DRenderer {
  constructor(host, w, h, bg) {
    this.w = w; this.h = h; this.bg = bg;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    host.appendChild(this.canvas);
  }
  clear() {
    const c = this.ctx;
    c.fillStyle = this.bg;
    c.fillRect(0, 0, this.w, this.h);
  }
  rect(x, y, w, h, color, radius = 0) {
    const c = this.ctx;
    c.fillStyle = color;
    c.beginPath();
    if (radius > 0) c.roundRect(x, y, w, h, radius);
    else c.rect(x, y, w, h);
    c.fill();
  }
  text(str, x, y, size, color = '#ffffff', align = 'center') {
    const c = this.ctx;
    c.font = `${size}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",-apple-system,"PingFang SC","Microsoft YaHei",sans-serif`;
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.fillText(String(str), x, y);
  }
  destroy() { this.canvas.remove(); }
}
class PixiRenderer {
  constructor(app, PIXI) {
    this.app = app;
    this.PIXI = PIXI;
    this.root = new PIXI.Container();
    app.stage.addChild(this.root);
    this.w = app.screen.width;
    this.h = app.screen.height;
  }
  clear() {
    this.root.removeChildren().forEach((o) => o.destroy({ children: true }));
  }
  rect(x, y, w, h, color, radius = 0) {
    const g = new this.PIXI.Graphics();
    if (radius > 0) g.roundRect(x, y, w, h, radius).fill(color);
    else g.rect(x, y, w, h).fill(color);
    this.root.addChild(g);
  }
  text(str, x, y, size, color = '#ffffff', align = 'center') {
    const t = new this.PIXI.Text({
      text: String(str),
      style: {
        fontFamily: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",-apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
        fontSize: size,
        fill: color,
        fontWeight: '400',
      },
    });
    if (align === 'center') t.anchor.set(0.5, 0.5);
    else t.anchor.set(0, 0.5);
    t.position.set(x, y);
    this.root.addChild(t);
  }
  destroy() {
    this.app.destroy(true, { children: true, texture: true });
  }
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------- 输入（pointer + 键盘） ----------
function bindCanvas(canvas) {
  const onMove = (e) => {
    const g = currentGame;
    if (!g) return;
    const r = canvas.getBoundingClientRect();
    g.pointerX = (e.clientX - r.left) * (W / r.width);
    g.pointerY = (e.clientY - r.top) * (H / r.height);
  };
  const onDown = (e) => {
    const g = currentGame;
    if (!g || g.over) return;
    const r = canvas.getBoundingClientRect();
    g.pointerX = (e.clientX - r.left) * (W / r.width);
    g.pointerY = (e.clientY - r.top) * (H / r.height);
    g.pointerDown = true;
    onTap(g);
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

function onTap(g) {
  if (g.cfg.template === 'whack') {
    const cell = g.cells.find((c) => g.pointerX >= c.x && g.pointerX <= c.x + c.w && g.pointerY >= c.y && g.pointerY <= c.y + c.h);
    if (cell && cell.target) {
      cell.target = null;
      g.score++;
      g.hits++;
      sfx('score');
    } else {
      sfx('pop');
    }
  }
}
async function createRenderer(host, bg) {
  try {
    const PIXI = await loadPixi();
    const app = new PIXI.Application();
    await app.init({
      width: W,
      height: H,
      background: bg,
      antialias: true,
      preference: 'webgl',
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
    });
    host.appendChild(app.canvas);
    bindCanvas(app.canvas);
    engineMode = 'pixi';
    return new PixiRenderer(app, PIXI);
  } catch (e) {
    console.warn('[game-studio] PixiJS 初始化失败，回退 Canvas2D：', e);
    const r = new Canvas2DRenderer(host, W, H, bg);
    bindCanvas(r.canvas);
    engineMode = 'canvas';
    return r;
  }
}

class Game {
  constructor(cfgSnapshot, renderer) {
    this.cfg = cfgSnapshot;
    this.renderer = renderer;
    this.W = W;
    this.H = H;
    this.score = 0;
    this.misses = 0;
    this.hits = 0;
    this.timeLeft = cfgSnapshot.time;
    this.elapsed = 0;
    this.over = false;
    this.win = false;
    this.forceEnd = false;
    this.pointerX = W / 2;
    this.pointerY = H / 2;
    this.pointerDown = false;
    this.keys = new Set();
    this.savedId = null;
    this.best = 0;
    this._raf = 0;
    this._last = 0;
  }
}
// ---------- 三个游戏模板 ----------
const RUNNERS = {
  catch: {
    init(g) {
      g.player = { x: g.W / 2, y: g.H - 44, w: 62, h: 54 };
      g.items = [];
      g.spawnT = 0.5;
    },
    update(g, dt) {
      const d = g.cfg.difficulty;
      const interval = [1.0, 0.72, 0.52][d - 1];
      const vy = [135, 180, 235][d - 1];
      g.spawnT -= dt;
      if (g.spawnT <= 0) {
        g.spawnT = interval * (0.75 + Math.random() * 0.5);
        g.items.push({
          x: 30 + Math.random() * (g.W - 60), y: -26, vy,
          emoji: g.cfg.item || pick(TEMPLATES.catch.items), size: 30 + Math.random() * 8,
        });
      }
      g.player.x += (g.pointerX - g.player.x) * Math.min(1, dt * 12);
      g.player.x = clamp(g.player.x, 26, g.W - 26);
      for (const it of g.items) {
        if (it.dead) continue;
        it.y += it.vy * dt;
        if (it.y + it.size / 2 >= g.player.y && it.y - it.size / 2 <= g.player.y + g.player.h &&
            Math.abs(it.x - g.player.x) < it.size / 2 + g.player.w / 2 - 6) {
          it.dead = true;
          g.score++;
          sfx('score');
        } else if (it.y > g.H + 30) {
          it.dead = true;
          g.misses++;
          if (g.misses % 3 === 0) sfx('miss');
        }
      }
      g.items = g.items.filter((i) => !i.dead);
    },
    render(g) {
      const r = g.renderer;
      r.clear();
      r.rect(0, g.H - 10, g.W, 10, '#ffffff16');
      for (const it of g.items) r.text(it.emoji, it.x, it.y, it.size);
      r.text(g.cfg.hero, g.player.x, g.player.y, 46);
    },
  },

  dodge: {
    init(g) {
      g.player = { x: g.W / 2, y: g.H - 46, w: 44, h: 44 };
      g.obstacles = [];
      g.spawnT = 0.6;
      g.lives = 3;
      g.invuln = 0;
    },
    update(g, dt) {
      const d = g.cfg.difficulty;
      const interval = [1.15, 0.85, 0.62][d - 1];
      const vy = [150, 195, 245][d - 1];
      g.spawnT -= dt;
      if (g.spawnT <= 0) {
        g.spawnT = interval * (0.7 + Math.random() * 0.6);
        g.obstacles.push({
          x: 24 + Math.random() * (g.W - 48), y: -26, vy,
          emoji: g.cfg.item || pick(TEMPLATES.dodge.items), size: 30 + Math.random() * 6,
          sway: 30 + Math.random() * 40,
        });
      }
      if (g.keys.has('ArrowLeft') || g.keys.has('KeyA')) g.player.x -= 310 * dt;
      if (g.keys.has('ArrowRight') || g.keys.has('KeyD')) g.player.x += 310 * dt;
      g.player.x += (g.pointerX - g.player.x) * Math.min(1, dt * 10);
      g.player.x = clamp(g.player.x, 26, g.W - 26);
      g.invuln = Math.max(0, g.invuln - dt);
      for (const o of g.obstacles) {
        if (o.dead) continue;
        o.y += o.vy * dt;
        o.x += Math.sin(g.elapsed * 2 + o.sway) * 30 * dt;
        o.x = clamp(o.x, 22, g.W - 22);
        if (g.invuln <= 0 && o.y + o.size / 2 >= g.player.y - 6 && o.y - o.size / 2 <= g.player.y + g.player.h - 6 &&
            Math.abs(o.x - g.player.x) < o.size / 2 + g.player.w / 2 - 4) {
          o.dead = true;
          g.lives--;
          g.invuln = 0.9;
          sfx('hit');
          if (g.lives <= 0) {
            g.forceEnd = true;
            g.hits = 3;
          }
        } else if (o.y > g.H + 30) {
          o.dead = true;
          g.score += 5;
        }
      }
      g.obstacles = g.obstacles.filter((o) => !o.dead);
      g.score += dt;
    },
    render(g) {
      const r = g.renderer;
      r.clear();
      for (const o of g.obstacles) r.text(o.emoji, o.x, o.y, o.size);
      if (g.invuln > 0 && Math.floor(g.elapsed * 12) % 2 === 0) {
        r.text(g.cfg.hero, g.player.x, g.player.y, 44, '#ffffff88');
      } else {
        r.text(g.cfg.hero, g.player.x, g.player.y, 44);
      }
    },
  },

  whack: {
    init(g) {
      const cols = 3, rows = 3, cw = 118, ch = 92, gap = 14;
      const tw = cols * cw + (cols - 1) * gap;
      const th = rows * ch + (rows - 1) * gap;
      g.cellW = cw;
      g.cellH = ch;
      g.gap = gap;
      g.ox = (g.W - tw) / 2;
      g.oy = 64;
      g.cells = [];
      for (let i = 0; i < rows * cols; i++) {
        const r = Math.floor(i / cols), c = i % cols;
        g.cells.push({ x: g.ox + c * (cw + gap), y: g.oy + r * (ch + gap), w: cw, h: ch, target: null });
      }
      g.spawnT = 0.5;
    },
    update(g, dt) {
      const d = g.cfg.difficulty;
      const stay = [1.2, 0.9, 0.65][d - 1];
      const interval = [1.0, 0.78, 0.58][d - 1];
      g.spawnT -= dt;
      if (g.spawnT <= 0) {
        g.spawnT = interval * (0.7 + Math.random() * 0.6);
        const free = g.cells.filter((c) => !c.target);
        if (free.length) {
          const c = free[Math.floor(Math.random() * free.length)];
          c.target = { emoji: g.cfg.item || pick(TEMPLATES.whack.items), t: stay };
        }
      }
      for (const c of g.cells) {
        if (c.target) {
          c.target.t -= dt;
          if (c.target.t <= 0) c.target = null;
        }
      }
    },
    render(g) {
      const r = g.renderer;
      r.clear();
      r.rect(g.ox - 20, g.oy - 20, 3 * g.cellW + 2 * g.gap + 40, 3 * g.cellH + 2 * g.gap + 40, '#15151f', 20);
      for (const c of g.cells) {
        r.rect(c.x, c.y, c.w, c.h, '#0b0b12', 12);
        r.rect(c.x + 8, c.y + 6, c.w - 16, 12, '#1e1e2c', 6);
        if (c.target) {
          const bob = Math.sin(g.elapsed * 8) * 3;
          r.text(c.target.emoji, c.x + c.w / 2, c.y + c.h / 2 - 10 + bob, 42);
        }
      }
    },
  },
};

function gameStats(g) {
  if (g.cfg.template === 'catch') return { label: '接住', value: `${g.score}`, sub: `${g.misses} 个掉落` };
  if (g.cfg.template === 'dodge') return { label: '存活', value: `${Math.floor(g.score)}s`, sub: `被砸 ${3 - Math.max(0, g.lives)} 次` };
  return { label: '打中', value: `${g.hits}`, sub: `${TEMPLATES.whack.name}` };
}
// ---------- 生命周期 ----------
function tick(now) {
  const g = currentGame;
  if (!g || g.over) return;
  const dt = Math.max(0, Math.min(0.05, (now - g._last) / 1000));
  g._last = now;
  g.elapsed += dt;
  g.timeLeft = Math.max(0, g.timeLeft - dt);
  RUNNERS[g.cfg.template].update(g, dt);
  RUNNERS[g.cfg.template].render(g);
  updateHUD(g);
  if (g.forceEnd || g.timeLeft <= 0) {
    endGame(g, !g.forceEnd);
    return;
  }
  g._raf = requestAnimationFrame(tick);
}

function updateHUD(g) {
  $('#hudScore').textContent = g.cfg.template === 'dodge' ? Math.floor(g.score) : g.score;
  $('#hudTime').textContent = Math.ceil(g.timeLeft);
  const st = gameStats(g);
  $('#hudStat').textContent = st.value;
  if (g.cfg.template === 'dodge') {
    $('#hudLivesWrap').style.display = '';
    $('#hudLives').textContent = '♥'.repeat(Math.max(0, g.lives)) + '♡'.repeat(Math.max(0, 3 - g.lives));
  } else {
    $('#hudLivesWrap').style.display = 'none';
  }
}

function endGame(g, win) {
  g.over = true;
  g.win = win;
  cancelAnimationFrame(g._raf);
  const score = Math.floor(g.score);
  if (g.savedId) {
    const s = savedGames.find((x) => x.id === g.savedId);
    if (s && score > (s.highScore || 0)) {
      s.highScore = score;
      persistList();
      renderSaveList();
    }
  }
  sessionBest[g.cfg.template] = Math.max(sessionBest[g.cfg.template] || 0, score);
  showGameOver(g, win, score);
  sfx(win ? 'win' : 'over');
}

function showGameOver(g, win, score) {
  const st = gameStats(g);
  $('#goTitle').textContent = win ? '时间到 · 完成！' : '哎呀，游戏结束';
  $('#goScore').innerHTML = `${score}<span>分</span>`;
  $('#goStat').textContent = `${st.label} ${st.value}${st.sub ? ' · ' + st.sub : ''}`;
  $('#goBest').textContent = g.best > 0 ? `本存档最佳 ${g.best} 分` : (sessionBest[g.cfg.template] > score ? `本会话最佳 ${sessionBest[g.cfg.template]} 分` : '新纪录！');
  $('#gameOverOverlay').classList.remove('hidden');
  $('#idleOverlay').classList.add('hidden');
}
function setEngineBadge() {
  const map = { idle: '待启动', pixi: 'PixiJS WebGL', canvas: 'Canvas 2D 兜底' };
  $('#engineBadge').innerHTML = `引擎 <b>${map[engineMode] || engineMode}</b>`;
}

function setControls(mode) {
  const startBtn = $('#startBtn');
  const stopBtn = $('#stopBtn');
  if (mode === 'idle') {
    startBtn.disabled = false;
    startBtn.textContent = '▶ 开始试玩';
    stopBtn.disabled = true;
    $('#ctrlHint').textContent = '选择模板并配置参数后开始';
  } else if (mode === 'loading') {
    startBtn.disabled = true;
    startBtn.textContent = '⏳ 加载引擎…';
    stopBtn.disabled = true;
    $('#ctrlHint').textContent = '首次会从 CDN 拉取 PixiJS';
  } else {
    startBtn.disabled = false;
    startBtn.textContent = '↻ 重新试玩';
    stopBtn.disabled = false;
    $('#ctrlHint').textContent = '移动鼠标 / 手指操控（也可用 ← → 或 A / D）';
  }
}

async function startGame(opts = {}) {
  stopGame();
  $('#idleOverlay').classList.add('hidden');
  $('#gameOverOverlay').classList.add('hidden');
  $('#loadingOverlay').classList.remove('hidden');
  $('#gameHud').classList.remove('hidden');
  setControls('loading');
  try {
    const renderer = await createRenderer($('#gameCanvasHost'), cfg.bg);
    const g = new Game({ ...cfg }, renderer);
    g.savedId = opts.savedId || null;
    g.best = opts.best || 0;
    RUNNERS[cfg.template].init(g);
    currentGame = g;
    $('#loadingOverlay').classList.add('hidden');
    setControls('playing');
    setEngineBadge();
    g._last = performance.now();
    g._raf = requestAnimationFrame(tick);
  } catch (e) {
    console.error(e);
    $('#loadingOverlay').classList.add('hidden');
    $('#gameHud').classList.add('hidden');
    $('#idleOverlay').classList.remove('hidden');
    setControls('idle');
    toast('游戏引擎启动失败：' + (e.message || e), true, 3600);
  }
}

function stopGame() {
  if (currentGame) {
    cancelAnimationFrame(currentGame._raf);
    currentGame.over = true;
    if (currentGame.renderer) currentGame.renderer.destroy();
    currentGame = null;
  }
  $('#gameCanvasHost').innerHTML = '';
  $('#gameHud').classList.add('hidden');
  $('#gameOverOverlay').classList.add('hidden');
  $('#loadingOverlay').classList.add('hidden');
  $('#idleOverlay').classList.remove('hidden');
  setEngineBadge();
  setControls('idle');
}
// ---------- 模板选择 / 表单 ----------
function renderTemplatePicker() {
  const host = $('#tplPicker');
  host.innerHTML = '';
  for (const [id, t] of Object.entries(TEMPLATES)) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tpl-card' + (id === cfg.template ? ' active' : '');
    card.dataset.tpl = id;
    card.innerHTML = `<span class="tpl-icon">${t.icon}</span><span class="tpl-info"><b>${t.name}</b><p>${t.desc}</p></span>`;
    card.addEventListener('click', () => selectTemplate(id));
    host.appendChild(card);
  }
}

function selectTemplate(id) {
  if (!TEMPLATES[id]) return;
  cfg.template = id;
  if (!$('#cfgHero').dataset.custom) cfg.hero = TEMPLATES[id].hero;
  $('#cfgHero').value = cfg.hero;
  $('#cfgItem').value = cfg.item;
  $('#cfgItem').placeholder = TEMPLATES[id].items[0] ? `留空随机（如 ${TEMPLATES[id].items[0]}）` : '留空随机';
  $('#idleHint').textContent = TEMPLATES[id].desc + '，试试看吧！';
  renderTemplatePicker();
}

function readForm() {
  cfg.name = ($('#cfgName').value || '我的小游戏').trim() || '我的小游戏';
  cfg.hero = ($('#cfgHero').value || TEMPLATES[cfg.template].hero).trim();
  cfg.item = ($('#cfgItem').value || '').trim();
  cfg.bg = $('#cfgBg').value;
  cfg.difficulty = parseInt($('#cfgDiff').value, 10) || 2;
  cfg.time = parseInt($('#cfgTime').value, 10) || 30;
  cfg.sound = $('#cfgSound').checked;
  $('#cfgBgVal').textContent = cfg.bg;
  $('#cfgDiffVal').textContent = ['简单', '普通', '困难'][cfg.difficulty - 1] || '普通';
}

function applyCfgToForm(c) {
  cfg.name = c.name || '我的小游戏';
  cfg.template = TEMPLATES[c.template] ? c.template : 'catch';
  cfg.hero = c.hero || TEMPLATES[cfg.template].hero;
  cfg.item = c.item || '';
  cfg.bg = c.bg || '#1b2340';
  cfg.difficulty = [1, 2, 3].includes(c.difficulty) ? c.difficulty : 2;
  cfg.time = [20, 30, 45, 60].includes(c.time) ? c.time : 30;
  cfg.sound = c.sound !== false;
  $('#cfgName').value = cfg.name;
  $('#cfgHero').value = cfg.hero;
  $('#cfgHero').dataset.custom = '';
  $('#cfgItem').value = cfg.item;
  $('#cfgBg').value = cfg.bg;
  $('#cfgDiff').value = cfg.difficulty;
  $('#cfgTime').value = cfg.time;
  $('#cfgSound').checked = cfg.sound;
  $('#cfgBgVal').textContent = cfg.bg;
  $('#cfgDiffVal').textContent = ['简单', '普通', '困难'][cfg.difficulty - 1] || '普通';
  $('#cfgItem').placeholder = TEMPLATES[cfg.template].items[0] ? `留空随机（如 ${TEMPLATES[cfg.template].items[0]}）` : '留空随机';
  $('#idleHint').textContent = TEMPLATES[cfg.template].desc + '，试试看吧！';
  renderTemplatePicker();
}
// ---------- 存档 ----------
function saveCurrent() {
  readForm();
  const entry = {
    id: 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: cfg.name,
    template: cfg.template,
    cfg: { ...cfg },
    highScore: sessionBest[cfg.template] || 0,
    createdAt: Date.now(),
  };
  const idx = savedGames.findIndex((s) => s.name === cfg.name && s.template === cfg.template);
  if (idx >= 0) {
    const old = savedGames[idx];
    savedGames[idx] = { ...entry, id: old.id, createdAt: old.createdAt, highScore: Math.max(old.highScore || 0, entry.highScore) };
    toast(`已更新《${cfg.name}》的配置`);
  } else {
    savedGames.unshift(entry);
    toast(`已保存《${cfg.name}》`);
  }
  persistList();
  renderSaveList();
  if (storyId) {
    saveStoryMiniGame().then((ok) => {
      if (ok) toast('已同步到作品');
      else toast('本地已存；云端同步失败（需登录）', true);
    });
  }
}

function launchSaved(s, autoPlay) {
  applyCfgToForm(s.cfg);
  if (autoPlay) {
    readForm();
    startGame({ savedId: s.id, best: s.highScore || 0 });
  } else {
    toast(`已载入《${s.name}》，可修改后重新试玩`);
  }
}

function deleteSaved(id) {
  savedGames = savedGames.filter((s) => s.id !== id);
  persistList();
  renderSaveList();
  toast('已删除该存档');
}

function renderSaveList() {
  const host = $('#saveList');
  host.innerHTML = '';
  if (!savedGames.length) {
    host.innerHTML = '<div class="hint" style="margin:0">还没有存档。完成一局后点击「保存到我的游戏」。</div>';
    return;
  }
  for (const s of savedGames) {
    const t = TEMPLATES[s.template];
    const row = document.createElement('div');
    row.className = 'save-item';
    row.innerHTML = `
      <div class="save-icon">${t ? t.icon : '🎮'}</div>
      <div class="save-info">
        <div class="save-name"></div>
        <div class="save-sub">${t ? t.name : s.template} · 最佳 <b>${s.highScore || 0}</b> 分</div>
      </div>
      <div class="save-ops">
        <button class="btn tiny" data-act="play">试玩</button>
        <button class="btn tiny" data-act="load">载入</button>
        <button class="btn tiny danger" data-act="del">删</button>
      </div>`;
    row.querySelector('.save-name').textContent = s.name;
    row.querySelector('[data-act="play"]').addEventListener('click', () => launchSaved(s, true));
    row.querySelector('[data-act="load"]').addEventListener('click', () => launchSaved(s, false));
    row.querySelector('[data-act="del"]').addEventListener('click', () => deleteSaved(s.id));
    host.appendChild(row);
  }
}
// ---------- 初始化 / 事件 ----------
function init() {
  if (fromEditor) {
    const back = document.getElementById('studioBack');
    if (back) {
      back.href = storyId
        ? '/story-editor.html?story=' + encodeURIComponent(storyId)
        : '/story-editor.html';
      back.textContent = '← 作品编辑器';
    }
  }
  renderTemplatePicker();
  applyCfgToForm(cfg);
  renderSaveList();
  setEngineBadge();
  setControls('idle');

  $('#idleStartBtn').addEventListener('click', () => { readForm(); startGame(); });
  $('#startBtn').addEventListener('click', () => { readForm(); startGame(); });
  $('#stopBtn').addEventListener('click', stopGame);
  $('#goAgainBtn').addEventListener('click', () => { $('#gameOverOverlay').classList.add('hidden'); readForm(); startGame(); });
  $('#goSaveBtn').addEventListener('click', () => { saveCurrent(); $('#gameOverOverlay').classList.add('hidden'); });
  $('#goCloseBtn').addEventListener('click', stopGame);
  $('#saveBtn').addEventListener('click', saveCurrent);

  $('#cfgName').addEventListener('input', () => { cfg.name = $('#cfgName').value; });
  $('#cfgHero').addEventListener('input', () => { cfg.hero = $('#cfgHero').value; $('#cfgHero').dataset.custom = '1'; });
  $('#cfgItem').addEventListener('input', () => { cfg.item = $('#cfgItem').value; });
  $('#cfgBg').addEventListener('input', () => { cfg.bg = $('#cfgBg').value; $('#cfgBgVal').textContent = cfg.bg; });
  $('#cfgDiff').addEventListener('input', () => {
    cfg.difficulty = parseInt($('#cfgDiff').value, 10) || 2;
    $('#cfgDiffVal').textContent = ['简单', '普通', '困难'][cfg.difficulty - 1] || '普通';
  });
  $('#cfgTime').addEventListener('change', () => { cfg.time = parseInt($('#cfgTime').value, 10) || 30; });
  $('#cfgSound').addEventListener('change', () => { cfg.sound = $('#cfgSound').checked; });

  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(e.code)) {
      if (currentGame && !currentGame.over) currentGame.keys.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (currentGame) currentGame.keys.delete(e.code);
  });

  if (storyId) {
    loadStoryMiniGame().then((mg) => {
      if (mg) {
        applyMiniFromStory(mg);
        applyCfgToForm(cfg);
        renderTemplatePicker();
      }
      if (autoPlay) { readForm(); startGame(); }
    });
  } else if (autoPlay) {
    readForm();
    startGame();
  }
}
// ---------- 对外测试 API ----------
window.GameStudio = {
  ready: true,
  get cfg() { return { ...cfg }; },
  templates: () => Object.keys(TEMPLATES),
  selectTemplate: (id) => selectTemplate(id),
  start: () => startGame(),
  startSaved: (id) => {
    const s = savedGames.find((x) => x.id === id);
    if (s) launchSaved(s, true);
    return !!s;
  },
  stop: stopGame,
  save: saveCurrent,
  deleteSaved,
  list: () => savedGames.map((s) => ({ ...s, cfg: { ...s.cfg } })),
  state: () => {
    const g = currentGame;
    if (!g) return null;
    return {
      template: g.cfg.template,
      over: g.over,
      win: g.win,
      score: Math.floor(g.score),
      misses: g.misses,
      hits: g.hits,
      timeLeft: Math.ceil(g.timeLeft),
      engine: engineMode,
      whackCells: g.cfg.template === 'whack'
        ? g.cells.map((c, i) => ({ i, row: Math.floor(i / 3), col: i % 3, hasTarget: !!c.target }))
        : null,
    };
  },
  tapCell: (row, col) => {
    const g = currentGame;
    if (!g || g.cfg.template !== 'whack' || g.over) return { hit: false };
    const c = g.cells[row * 3 + col];
    if (!c || !c.target) return { hit: false };
    c.target = null;
    g.score++;
    g.hits++;
    return { hit: true, score: g.score };
  },
  engine: () => engineMode,
  canvasCount: () => $('#gameCanvasHost').querySelectorAll('canvas').length,
  localStorage: () => { try { return localStorage.getItem(SAVE_KEY); } catch (e) { return null; } },
};

init();
