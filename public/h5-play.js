const TOKEN_KEY = 'hyool_token';
const qs = new URLSearchParams(location.search);
const storyId = qs.get('story') || '';
const from = qs.get('from') || '/fantasy.html';

function authHeaders() {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t ? { Authorization: 'Bearer ' + t } : {};
  } catch (e) { return {}; }
}

function normalizePlayUrl(raw) {
  const u = String(raw || '').trim();
  if (!u) return '';
  if (u.startsWith('/img/') || u.startsWith('/api/')) return u;
  try {
    const parsed = new URL(u, location.origin);
    if (parsed.protocol === 'https:') return parsed.href;
    if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
      return parsed.href;
    }
  } catch (e) { /* ignore */ }
  return '';
}

function showError(msg) {
  const stage = document.getElementById('playStage');
  if (!stage) return;
  stage.innerHTML = '<div class="play-empty">' + msg + '<br><a href="' + from.replace(/"/g, '&quot;') + '">返回</a></div>';
}

async function loadStory() {
  if (!storyId) {
    showError('缺少作品 ID');
    return;
  }
  document.getElementById('playBack').href = from;
  try {
    const res = await fetch('/api/stories/' + encodeURIComponent(storyId), {
      credentials: 'include',
      headers: authHeaders(),
    });
    const d = await res.json();
    if (!d.success) {
      showError(d.error || '无法加载游戏（可能未发布）');
      return;
    }
    const story = d.story;
    if (story.kind !== 'h5_game') {
      showError('这不是 H5 网页游戏作品');
      return;
    }
    const playUrl = normalizePlayUrl(story.h5 && story.h5.playUrl);
    if (!playUrl) {
      showError('作者尚未配置游戏地址');
      return;
    }
    document.getElementById('playTitle').textContent = story.title || 'H5 游戏';
    mountGame(playUrl, story.orientation === 'portrait' ? 'portrait' : 'landscape', story.id);
  } catch (e) {
    showError('加载失败（网络异常）');
  }
}

function mountGame(playUrl, orientation, id) {
  const stage = document.getElementById('playStage');
  stage.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'play-frame-wrap ' + orientation;
  const iframe = document.createElement('iframe');
  iframe.className = 'game-frame';
  iframe.title = 'H5 游戏';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms allow-pointer-lock');
  iframe.allow = 'fullscreen; autoplay; gamepad';
  iframe.src = playUrl;
  wrap.appendChild(iframe);
  stage.appendChild(wrap);

  let gameOrigin = '';
  try { gameOrigin = new URL(playUrl, location.origin).origin; } catch (e) { /* */ }

  iframe.addEventListener('load', () => {
    try {
      iframe.contentWindow.postMessage({
        type: 'hyool:init',
        storyId: id,
        orientation,
      }, gameOrigin || '*');
    } catch (e) { /* cross-origin */ }
  });

  window.addEventListener('message', (e) => {
    if (gameOrigin && e.origin !== gameOrigin) return;
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hyool:ready') {
      document.getElementById('playLoading')?.remove();
    }
    if (msg.type === 'hyool:exit') {
      location.href = from;
    }
  });

  document.getElementById('playFsBtn')?.addEventListener('click', () => {
    const el = wrap;
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  });
}

loadStory();
