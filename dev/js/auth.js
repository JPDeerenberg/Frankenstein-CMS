// Authentication and login management

async function saveConfigAndLogin() {
  const token = document.getElementById("cfg-token").value.trim();
  const owner = document.getElementById("cfg-owner").value.trim();
  const repo = document.getElementById("cfg-repo").value.trim();
  if (!token || !owner || !repo) return alert("Please fill in all fields.");

  const loginMsg = document.getElementById("login-msg");
  try {
    loginMsg.innerText = "Connecting...";
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Authorization: `token ${token}` },
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail =
          body && body.message
            ? `: ${body.message}`
            : ` (status ${res.status})`;
      } catch (_) {
        detail = ` (status ${res.status})`;
      }
      loginMsg.innerText = `Connection failed${detail}`;
      console.error("GitHub connect error", res.status, detail);
      return;
    }
    config = { token, owner, repo };
    await encryptConfig(config);
    loginMsg.innerText = "Connected.";
    showDashboard();
  } catch (e) {
    loginMsg.innerText = `Network error: ${e.message}`;
    console.error(e);
  }
}

function logout() {
  if (confirm("Logout?")) {
    localStorage.removeItem("frankenstein_encrypted_cfg");
    location.reload();
  }
}

function applyExternalConfig(cfg) {
  if (!cfg) return;
  if (cfg.owner) document.getElementById("cfg-owner").value = cfg.owner;
  if (cfg.repo) document.getElementById("cfg-repo").value = cfg.repo;
  if (cfg.owner || cfg.repo) document.getElementById("cfg-token").focus();
}

window.addEventListener("message", (event) => {
  if (event.data && event.data.type === "frankenstein-config") {
    applyExternalConfig(event.data.config);
  }
});

window.onload = async () => {
  const hasData = localStorage.getItem("frankenstein_encrypted_cfg");
  if (hasData) {
    const decrypted = await decryptConfig();
    if (decrypted) {
      config = decrypted;
      showDashboard();
      return;
    }
  }

  // 1. Try URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const urlOwner = urlParams.get("owner");
  const urlRepo = urlParams.get("repo");
  if (urlOwner || urlRepo) {
    applyExternalConfig({ owner: urlOwner, repo: urlRepo });
  }

  // 2. Attempt to load local dev config (only if URL params weren't complete)
  if (!urlOwner || !urlRepo) {
    try {
      const res = await fetch("frankenstein.config.json");
      if (res.ok) {
        const devConfig = await res.json();
        applyExternalConfig(devConfig);
      }
    } catch (e) {
      // Ignore error if file doesn't exist or fetch fails
    }
  }
};

function startDemo() {
  config = {
    token: "demo-token",
    owner: "demo-user",
    repo: "demo-repo",
    isDemo: true,
  };

  document.getElementById("login-msg").innerText = "Entering simulation...";
  setTimeout(() => {
    showDashboard();
    if (window.setSaved) window.setSaved();
  }, 500);
}
