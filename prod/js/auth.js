// Authentication and login management

// Helper: read configuration from URL query parameters
function getUrlConfig() {
  const params = new URLSearchParams(window.location.search);
  return {
    owner: params.get("owner") || "",
    repo: params.get("repo") || "",
    bouncer: params.get("bouncer") || "",
    backupBouncer: params.get("backupBouncer") || "",
  };
}

async function saveConfigAndLogin() {
  const email = document.getElementById("cfg-email").value.trim();
  const password = document.getElementById("cfg-password").value.trim();

  // These are now populated by tryAutoFillConfig (hidden fields)
  let owner = document.getElementById("cfg-owner").value.trim();
  let repo = document.getElementById("cfg-repo").value.trim();
  let bouncerUrl = document.getElementById("cfg-bouncer").value.trim();
  const backupBouncerUrl = document
    .getElementById("cfg-bouncer-backup")
    .value.trim();

  if (!email || !password) {
    return alert("Please enter your Client Email and Site Password.");
  }

  if (!owner || !repo || !bouncerUrl) {
    // Try to fill missing values from URL parameters as a fallback
    const urlCfg = getUrlConfig();
    if (!owner && urlCfg.owner) owner = urlCfg.owner;
    if (!repo && urlCfg.repo) repo = urlCfg.repo;
    if (!bouncerUrl && urlCfg.bouncer) bouncerUrl = urlCfg.bouncer;
    if (!owner || !repo || !bouncerUrl) {
      return alert(
        "System Error: The Bouncer is not properly configured. Provide owner, repo, and bouncer URL via hidden fields or URL parameters.",
      );
    }
  }

  const loginMsg = document.getElementById("login-msg");
  loginMsg.innerText = "Authenticating...";

  try {
    // We test the connection by fetching repo details via the proxy
    const testPath = `/repos/${owner}/${repo}`;

    let res;
    try {
      res = await fetch(`${bouncerUrl}?path=${encodeURIComponent(testPath)}`, {
        method: "GET",
        headers: {
          "Site-Password": password,
          "Site-Email": email,
        },
      });
    } catch (e) {
      console.warn("Primary bouncer failed, trying backup...", e);
    }

    // Fallback to backup if primary failed or returned error
    if ((!res || !res.ok) && backupBouncerUrl) {
      console.log("Switching to backup bouncer...");
      loginMsg.innerText = "Primary failed. Trying backup...";
      try {
        res = await fetch(
          `${backupBouncerUrl}?path=${encodeURIComponent(testPath)}`,
          {
            method: "GET",
            headers: {
              "Site-Password": password,
              "Site-Email": email,
            },
          },
        );
        if (res.ok) {
          bouncerUrl = backupBouncerUrl;
          console.log("Fallback successful.");
        }
      } catch (e) {
        console.error("Backup bouncer also failed.", e);
      }
    }

    if (!res || !res.ok) {
      if (res && res.status === 401) {
        loginMsg.innerText = "❌ Incorrect password.";
        return;
      }
      let detail = res
        ? ` (status ${res.status})`
        : " (Network error or CORS issue)";
      if (res) {
        try {
          const body = await res.json();
          detail = body.message ? `: ${body.message}` : detail;
        } catch (_) {}
      }
      loginMsg.innerText = `Connection failed${detail}`;
      return;
    }

    config = { bouncerUrl, owner, repo, email };
    encryptConfig(config, password);
    config.password = password; // Retain in memory for Bouncer auth
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

window.onload = async () => {
  await tryAutoFillConfig();

  // 1. Check URL parameters for configuration
  const urlParams = new URLSearchParams(window.location.search);
  const urlConfig = {
    owner: urlParams.get("owner"),
    repo: urlParams.get("repo"),
    bouncer: urlParams.get("bouncer"),
    backupBouncer: urlParams.get("backupBouncer"),
  };
  if (urlConfig.owner || urlConfig.repo || urlConfig.bouncer) {
    applyExternalConfig(urlConfig);
  }

  const hasData = localStorage.getItem("frankenstein_encrypted_cfg");
  if (hasData) {
    const password = prompt("🔐 Session password:");
    if (!password) return;
    const decrypted = decryptConfig(password);
    if (decrypted) {
      config = decrypted;
      config.password = password; // Retain in memory for Bouncer auth
      showDashboard();
    } else {
      alert("❌ Wrong password.");
    }
  }
};

async function tryAutoFillConfig() {
  // 1. Try to fetch frankenstein.config.json if it exists
  try {
    const res = await fetch("frankenstein.config.json");
    if (res.ok) {
      const data = await res.json();
      if (data.owner) document.getElementById("cfg-owner").value = data.owner;
      if (data.repo) document.getElementById("cfg-repo").value = data.repo;
      if (data.bouncerUrl)
        document.getElementById("cfg-bouncer").value = data.bouncerUrl;
      if (data.backupBouncerUrl)
        document.getElementById("cfg-bouncer-backup").value =
          data.backupBouncerUrl;

      // Hide all configuration fields if bouncer is fully configured
      if (data.owner && data.repo && data.bouncerUrl) {
        hideConfigFields();
      }
    }
  } catch (e) {
    // Silently fail if config.json isn't there
    console.error("No config file found", e);
  }

  // We no longer auto-detect from GitHub Pages URL in Prod mode
  // because the Bouncer URL must be explicitly configured.
}

function applyExternalConfig(cfg) {
  if (!cfg) return;
  if (cfg.owner) document.getElementById("cfg-owner").value = cfg.owner;
  if (cfg.repo) document.getElementById("cfg-repo").value = cfg.repo;
  if (cfg.bouncerUrl || cfg.bouncer)
    document.getElementById("cfg-bouncer").value =
      cfg.bouncerUrl || cfg.bouncer;
  if (cfg.backupBouncerUrl || cfg.backupBouncer)
    document.getElementById("cfg-bouncer-backup").value =
      cfg.backupBouncerUrl || cfg.backupBouncer;

  // Logic to hide fields if required info is present
  const owner = document.getElementById("cfg-owner").value;
  const repo = document.getElementById("cfg-repo").value;
  const bouncer = document.getElementById("cfg-bouncer").value;
  if (owner && repo && bouncer) {
    hideConfigFields();
  }
}

window.addEventListener("message", (event) => {
  if (event.data && event.data.type === "frankenstein-config") {
    applyExternalConfig(event.data.config);
  }
});

function hideConfigFields() {
  // In Prod mode, the technical fields are already hidden HTML elements `<input type="hidden">`
  // We just show a professional login message.
  const loginMsg = document.getElementById("login-msg");
  loginMsg.innerHTML = `<span style="font-size: 0.8rem; color:#4ade80;">System Ready</span>`;
}

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
