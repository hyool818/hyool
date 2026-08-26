// 作品素材库：只存「引用」（URL + 元数据）到本机；不把二进制当素材库卖点上传。
// 约束见 docs/editor-vision.md：图片隐私 → 引用 URL + 本地缓存；作品里仍用现有 /api/upload URL。
const ASSET_KEY = 'hyool_assets_v1';
const MAX_ASSETS = 200;

function uid() {
  return 'asset_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function loadRaw() {
  try {
    const arr = JSON.parse(localStorage.getItem(ASSET_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveRaw(list) {
  try {
    localStorage.setItem(ASSET_KEY, JSON.stringify(list.slice(0, MAX_ASSETS)));
  } catch (e) { /* quota：忽略，不阻塞创作 */ }
}

function normalize(a) {
  if (!a || !a.url) return null;
  const type = a.type === 'video' || a.type === 'audio' || a.type === 'image' ? a.type : 'image';
  return {
    id: a.id || uid(),
    url: String(a.url).trim().slice(0, 2000),
    type,
    label: String(a.label || '').trim().slice(0, 60),
    source: String(a.source || 'url').slice(0, 32),
    createdAt: Number(a.createdAt) || Date.now(),
  };
}

export function listAssets(filter) {
  let list = loadRaw().map(normalize).filter(Boolean);
  if (filter && filter.type) list = list.filter((a) => a.type === filter.type);
  if (filter && filter.q) {
    const q = String(filter.q).toLowerCase();
    list = list.filter((a) => (a.label || '').toLowerCase().includes(q) || a.url.toLowerCase().includes(q));
  }
  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** 按 URL 去重加入；已存在则更新 label/source 并置顶时间 */
export function addAsset(entry) {
  const item = normalize(entry);
  if (!item || !item.url) return null;
  const list = loadRaw().map(normalize).filter(Boolean);
  const i = list.findIndex((x) => x.url === item.url);
  if (i >= 0) {
    list[i] = {
      ...list[i],
      label: item.label || list[i].label,
      source: item.source || list[i].source,
      type: item.type || list[i].type,
      createdAt: Date.now(),
    };
    saveRaw(list);
    return list[i];
  }
  list.unshift(item);
  saveRaw(list);
  return item;
}

export function removeAsset(id) {
  const list = loadRaw().filter((a) => a && a.id !== id);
  saveRaw(list);
  return true;
}

export function getAsset(id) {
  return listAssets().find((a) => a.id === id) || null;
}

/** 从作品积木扫一遍，把已有 media/audio 收进库（不上传） */
export function harvestFromStory(story) {
  if (!story || !Array.isArray(story.chapters)) return 0;
  let n = 0;
  story.chapters.forEach((ch) => {
    (ch.blocks || []).forEach((b) => {
      if (b.media && b.media.url) {
        addAsset({
          url: b.media.url,
          type: b.media.type === 'video' ? 'video' : 'image',
          label: (b.content || b.speaker || '').slice(0, 40) || '画面',
          source: 'story',
        });
        n++;
      }
      if (b.audio && b.audio.url) {
        addAsset({
          url: b.audio.url,
          type: 'audio',
          label: (b.speaker || '配音').slice(0, 40),
          source: 'story',
        });
        n++;
      }
    });
  });
  return n;
}

export const StoryAssets = { listAssets, addAsset, removeAsset, getAsset, harvestFromStory, ASSET_KEY };
