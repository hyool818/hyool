/** 我的专属库 · 云端素材 API（R2 + file_objects，按 owner 隔离） */
const TOKEN_KEY = 'hyool_token';

export function vaultAuthHeaders() {
  const t = localStorage.getItem(TOKEN_KEY);
  return t ? { Authorization: 'Bearer ' + t } : {};
}

export function vaultLoggedIn() {
  return !!localStorage.getItem(TOKEN_KEY);
}

export async function fetchMyVault(category = 'all') {
  const q = category && category !== 'all' ? '?category=' + encodeURIComponent(category) : '';
  const res = await fetch('/api/my-vault' + q, { credentials: 'include', headers: vaultAuthHeaders() });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || '加载失败');
  return data.items || [];
}

export async function deleteVaultItem(id) {
  const res = await fetch('/api/my-vault/' + encodeURIComponent(id), {
    method: 'DELETE',
    credentials: 'include',
    headers: vaultAuthHeaders(),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || '删除失败');
  return true;
}

export function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(2) + ' MB';
}
