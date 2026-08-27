function authHeaders() {
  const t = localStorage.getItem("hyool_token");
  return t ? { Authorization: "Bearer " + t } : {};
}

function showError(msg) {
  const main = document.getElementById("lwMain");
  if (main) {
    main.innerHTML = `<div class="lw-error">${msg}<br><a href="/studio-world.html">返回创造世界</a></div>`;
  }
}

async function boot() {
  if (!localStorage.getItem("hyool_token")) {
    location.replace("/yonder.html?next=" + encodeURIComponent("/create-life-world.html"));
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
          location.href = "/world?world=" + encodeURIComponent(w.id) + "&from=/studio-world.html";
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
