// 作品本地缓存辅助：与 story-editor 共用 hyool_stories_v1，避免删云端后又被同步「复活」
export const STORY_SAVE_KEY = 'hyool_stories_v1';
export const STORY_DELETED_KEY = 'hyool_stories_deleted_v1';

export function isStoryDeleted(id) {
  if (!id) return false;
  try {
    const arr = JSON.parse(localStorage.getItem(STORY_DELETED_KEY) || '[]');
    return Array.isArray(arr) && arr.includes(id);
  } catch (e) { return false; }
}

/** 删除作品时：记 tombstone + 从本地作品缓存移除 */
export function purgeLocalStory(id) {
  if (!id) return;
  try {
    const tomb = JSON.parse(localStorage.getItem(STORY_DELETED_KEY) || '[]');
    const ids = Array.isArray(tomb) ? tomb : [];
    if (!ids.includes(id)) ids.push(id);
    localStorage.setItem(STORY_DELETED_KEY, JSON.stringify(ids.slice(-300)));

    const raw = localStorage.getItem(STORY_SAVE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    const next = arr.filter((x) => x && x.id !== id);
    if (next.length !== arr.length) {
      localStorage.setItem(STORY_SAVE_KEY, JSON.stringify(next));
    }
  } catch (e) { /* ignore */ }
}
