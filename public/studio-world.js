function authHeaders() {
  const t = localStorage.getItem("hyool_token");
  return t ? { Authorization: "Bearer " + t } : {};
}

let hubMount = null;
let cachedChars = [];
let opening = false;

async function ensureHub() {
  if (window.ProfileHubUI && document.getElementById("wizardModal")) return;
  if (!hubMount) {
    hubMount = (async () => {
      if (!document.getElementById("wizardModal")) {
        const html = await fetch("/profile-hub-modals.html?v=20260828b").then((r) => r.text());
        document.body.insertAdjacentHTML("beforeend", html);
      }
      if (!window.ProfileHubUI) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "/profile-hub-ui.js?v=20260828b";
          s.onload = resolve;
          s.onerror = reject;
          document.body.appendChild(s);
        });
      }
      const res = await fetch("/api/hub", { credentials: "include", headers: authHeaders() });
      const data = await res.json();
      cachedChars = data.characters || [];
      window.ProfileHubUI.init({
        getChars: () => cachedChars,
        getWorlds: () => [],
        onCharsChanged: () => {},
        onWorldsChanged: () => {},
        onWorldCreated: (w) => {
          if (w && w.id && w.type === "life") {
            location.href = "/world?world=" + encodeURIComponent(w.id) + "&from=/studio-world.html";
          }
        },
      });
    })();
  }
  await hubMount;
}

async function openCreateLifeWorld() {
  if (opening) return;
  if (!localStorage.getItem("hyool_token")) {
    location.href = "/yonder.html?next=" + encodeURIComponent("/studio-world.html?create=life");
    return;
  }
  opening = true;
  const link = document.getElementById("createWorldLink");
  link?.classList.add("st-loading");
  try {
    await ensureHub();
    window.ProfileHubUI.openWizardLife();
  } finally {
    opening = false;
    link?.classList.remove("st-loading");
  }
}

document.getElementById("createWorldLink")?.addEventListener("click", (e) => {
  e.preventDefault();
  openCreateLifeWorld();
});

if (new URLSearchParams(location.search).get("create") === "life") {
  openCreateLifeWorld();
}

if (localStorage.getItem("hyool_token")) {
  const preload = () => { ensureHub().catch(() => {}); };
  if (typeof requestIdleCallback === "function") requestIdleCallback(preload, { timeout: 2500 });
  else setTimeout(preload, 400);
}
