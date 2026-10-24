// Authentication and login management

async function saveConfigAndLogin() {
  const token = document.getElementById("cfg-token").value.trim();
  const owner = document.getElementById("cfg-owner").value.trim();
  const repo = document.getElementById("cfg-repo").value.trim();
  if (!token || !owner || !repo) return alert("Please fill in all fields.");
  if (!isValidRepoName(owner) || !isValidRepoName(repo)) {
    return alert(
      "Owner and repository may only contain letters, digits, '.', '-' and '_'.",
    );
  }

  const loginMsg = document.getElementById("login-msg");
  try {
    loginMsg.innerText = "Connecting...";
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Authorization: `token ${token}` },
    });
    if (res.status === 401) {
      loginMsg.innerText =
        "Connection failed: GitHub rejected this token (expired or mistyped).";
      return;
    }
    if (res.status === 404) {
      loginMsg.innerText =
        "Connection failed: repository not found, or the token has no access to it.";
      return;
    }
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
    clearStoredConfig();
    location.reload();
  }
}

function applyExternalConfig(cfg) {
  if (!cfg) return;
  // owner/repo end up inside API URLs: accept only well-formed names
  if (isValidRepoName(cfg.owner))
    document.getElementById("cfg-owner").value = cfg.owner;
  if (isValidRepoName(cfg.repo))
    document.getElementById("cfg-repo").value = cfg.repo;
  if (cfg.owner || cfg.repo) document.getElementById("cfg-token").focus();
}

// Only the page that embeds this CMS (iframe.html) may pre-fill owner/repo.
// Messages from any other window (a page that opened or framed us) are ignored.
window.addEventListener("message", (event) => {
  if (event.source !== window.parent || window.parent === window) return;
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
    // Stored session cannot be decrypted (cleared site data, new browser profile…)
    localStorage.removeItem("frankenstein_encrypted_cfg");
    document.getElementById("login-msg").innerText =
      "Your saved session could not be restored. Please log in again.";
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
