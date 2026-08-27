function authHeaders() {
  const t = localStorage.getItem("hyool_token");
  return t ? { Authorization: "Bearer " + t } : {};
}

function getFromPath() {
  try {
    const from = new URLSearchParams(location.search).get("from");
    if (from && from.charAt(0) === "/" && from.charAt(1) !== "/") return from;
  } catch {}
  return "/studio-world.html";
}

function backLabel(from) {
  if (from.startsWith("/@")) return "个人主页";
  if (from.startsWith("/studio-world")) return "创造世界";
  return "上一页";
}

function applyBackLink() {
  const from = getFromPath();
  const back = document.getElementById("lwBack");
  if (back) {
    back.href = from;
    back.textContent = "← " + backLabel(from);
  }
  return from;
}

function showError(msg) {
  const from = getFromPath();
  const main = document.getElementById("lwMain");
  if (main) {
    main.innerHTML = `<div class="lw-error">${msg}<br><a href="${from}">返回${backLabel(from)}</a></div>`;
  }
}

async function boot() {
  const from = applyBackLink();
  if (!localStorage.getItem("hyool_token")) {
    location.replace("/yonder.html?next=" + encodeURIComponent("/create-life-world.html" + location.search));
    return;
  }
  try {
    if (!window.ProfileHubUI) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "/profile-hub-ui.js?v=20260828d";
        s.onload = resolve;
        s.onerror = () => reject(new Error("向导脚本加载失败"));
        document.body.appendChild(s);
      });
    }
    const res = await fetch("/api/hub", { credentials: "include", headers: authHeaders() });
    const data = await res.json();
    const chars = data.characters || [];
    window.ProfileHubUI.init({
      getChars: () => chars,
      getWorlds: () => [],
      onCharsChanged: () => {},
      onWorldsChanged: () => {},
      onWorldCreated: (w) => {
        if (w && w.id && w.type === "life") {
          location.href = "/world?world=" + encodeURIComponent(w.id) + "&from=" + encodeURIComponent(from);
        }
      },
    });
    window.ProfileHubUI.openWizardLife();
    const shell = document.getElementById("wizardModal");
    const loading = document.getElementById("lwLoading");
    if (loading) loading.remove();
    if (shell) {
      shell.style.display = "";
      shell.classList.add("show");
      document.getElementById("lwMain")?.appendChild(shell);
    }
  } catch (e) {
    console.error("create-life-world:", e);
    showError(e.message || "加载失败，请刷新重试。");
  }
}

boot();
