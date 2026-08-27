/** 已登录 → /@username；游客 → fallback（默认幻灵广场） */
export function profileAuthHeaders() {
  const t = localStorage.getItem("hyool_token");
  return t ? { Authorization: "Bearer " + t } : {};
}

export async function myProfileUrl(guestFallback = "/plaza") {
  try {
    const r = await fetch("/api/me", {
      credentials: "include",
      cache: "no-store",
      headers: profileAuthHeaders(),
    });
    const d = await r.json();
    if (d.authenticated && d.user?.username) {
      return "/@" + encodeURIComponent(String(d.user.username).trim().toLowerCase());
    }
  } catch { /* ignore */ }
  return guestFallback;
}

export function bindProfileLinks(selector, guestFallback = "/plaza") {
  document.querySelectorAll(selector).forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      myProfileUrl(guestFallback).then((url) => {
        location.href = url;
      });
    });
  });
}
