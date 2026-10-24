// Authentication and login management

// Is this page framed by a page on the SAME origin (our own iframe.html)?
// A cross-origin parent makes the property access throw, which counts as "no".
function embeddedBySameOrigin() {
  try {
    return (
      window.parent !== window &&
      window.parent.location.origin === window.location.origin
    );
  } catch (e) {
    return false;
  }
}

// Helper: read configuration from URL query parameters.
// owner/repo are always read. The bouncer address (where the password is sent)
// is only read when this page is embedded by a same-origin page such as
// iframe.html: a crafted link (?bouncer=https://evil.example) opened directly,
// or framed from another site, is ignored, so it cannot redirect a client's
// password to an attacker. Normally set bouncerUrl in frankenstein.config.json.
function getUrlConfig() {
  const params = new URLSearchParams(window.location.search);
  const trusted = embeddedBySameOrigin();
  return {
    owner: params.get("owner") || "",
    repo: params.get("repo") || "",
    bouncer: trusted ? params.get("bouncer") || "" : "",
    backupBouncer: trusted ? params.get("backupBouncer") || "" : "",
  };
}

/**
 * Log in against ONE bouncer.
 * 1. Ask it which site this login belongs to (`?action=site`): the Cloudflare
 *    bouncer answers with owner/repo/name, so the CMS needs no per-site config.
 * 2. Older bouncers (PHP/Supabase/Node) do not know that action; if owner and
 *    repo are configured, test the connection with a plain repo request instead.
 * Never throws: network problems come back as { ok: false, status: 0 }.
 */
async function loginToBouncer(base, email, password, owner, repo) {
  if (!isSafeBouncerUrl(base)) {
    return {
      ok: false,
      status: 0,
      res: null,
      message:
        "The bouncer URL must start with https:// (credentials are never sent over plain http).",
    };
  }
  const headers = { "Site-Email": email, "Site-Password": password };
  try {
    const res = await fetch(`${base}?action=site`, { headers });
    if (res.status === 401) return { ok: false, status: 401, res };
    if (res.ok) {
      let site = null;
      try {
        site = await res.json();
      } catch (_) {}
      if (site && site.owner && site.repo) {
        return {
          ok: true,
          status: 200,
          res,
          owner: site.owner,
          repo: site.repo,
          name: site.name || "",
        };
      }
    }
    // not supported by this bouncer: fall back to the classic check
    if (!owner || !repo) {
      return {
        ok: false,
        status: res.status,
        res,
        message:
          "This bouncer does not tell the CMS which repo to use. Set owner and repo in frankenstein.config.json.",
      };
    }
    const testPath = `/repos/${owner}/${repo}`;
    const legacy = await fetch(`${base}?path=${encodeURIComponent(testPath)}`, {
      headers,
    });
    return {
      ok: legacy.ok,
      status: legacy.status,
      res: legacy,
      owner,
      repo,
      name: "",
    };
  } catch (e) {
    console.warn("Bouncer unreachable:", base, e);
    return { ok: false, status: 0, res: null };
  }
}

async function saveConfigAndLogin() {
  const email = document.getElementById("cfg-email").value.trim();
  const password = document.getElementById("cfg-password").value.trim();

  // Populated by tryAutoFillConfig (hidden fields). owner/repo are optional
  // now: bouncers that support ?action=site provide them after login.
  let owner = document.getElementById("cfg-owner").value.trim();
  let repo = document.getElementById("cfg-repo").value.trim();
  let bouncerUrl = document.getElementById("cfg-bouncer").value.trim();
  let backupBouncerUrl = document
    .getElementById("cfg-bouncer-backup")
    .value.trim();

  if (!email || !password) {
    return alert("Please enter your Client Email and Site Password.");
  }

  const urlCfg = getUrlConfig();
  if (!owner && isValidRepoName(urlCfg.owner)) owner = urlCfg.owner;
  if (!repo && isValidRepoName(urlCfg.repo)) repo = urlCfg.repo;
  if (owner && !isValidRepoName(owner)) owner = "";
  if (repo && !isValidRepoName(repo)) repo = "";

  if (!bouncerUrl) bouncerUrl = urlCfg.bouncer;
  if (!backupBouncerUrl) backupBouncerUrl = urlCfg.backupBouncer;
  if (!bouncerUrl) {
    return alert(
      "System Error: The Bouncer is not configured. Set bouncerUrl in frankenstein.config.json.",
    );
  }

  const loginMsg = document.getElementById("login-msg");
  loginMsg.innerText = "Authenticating...";

  try {
    let usedUrl = bouncerUrl;
    let result = await loginToBouncer(bouncerUrl, email, password, owner, repo);

    // Primary unreachable or broken (not a wrong password): try the backup
    if (!result.ok && result.status !== 401 && backupBouncerUrl) {
      loginMsg.innerText = "Primary failed. Trying backup...";
      const backup = await loginToBouncer(
        backupBouncerUrl,
        email,
        password,
        owner,
        repo,
      );
      if (backup.ok || backup.status === 401) {
        result = backup;
        usedUrl = backupBouncerUrl;
      }
    }

    if (!result.ok) {
      if (result.status === 401) {
        loginMsg.innerText = "❌ Incorrect email or password.";
        return;
      }
      if (result.message) {
        loginMsg.innerText = "❌ " + result.message;
        return;
      }
      if (result.status === 403) {
        let why = "";
        try {
          why = (await result.res.json()).message || "";
        } catch (_) {}
        loginMsg.innerText = "❌ Request refused by the Bouncer. " + why;
        return;
      }
      let detail = result.res
        ? ` (status ${result.status})`
        : " (Network error or CORS issue)";
      if (result.res) {
        try {
          const body = await result.res.json();
          detail = body.message ? `: ${body.message}` : detail;
        } catch (_) {}
      }
      loginMsg.innerText = `Connection failed${detail}`;
      return;
    }

    config = {
      bouncerUrl: usedUrl,
      backupBouncerUrl,
      owner: result.owner,
      repo: result.repo,
      siteName: result.name,
      email,
    };
    config.password = password; // kept in memory only, used for Bouncer auth
    const issued = result.res.headers.get("X-Session-Token");
    if (issued) config.sessionToken = issued;
    try {
      localStorage.setItem("frankenstein_email", email); // prefill next time
    } catch (_) {}
    loginMsg.innerText = result.name
      ? `Connected: ${result.name}`
      : "Connected.";
    showDashboard();
  } catch (e) {
    loginMsg.innerText = `Network error: ${e.message}`;
    console.error(e);
  }
}

function logout() {
  if (confirm("Logout?")) {
    localStorage.removeItem("frankenstein_encrypted_cfg"); // legacy
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

  // Sessions are no longer restored through a blocking prompt() (browsers
  // suppress it inside iframes, and it cannot use the password manager).
  // The email is remembered; the password is entered in the normal form.
  localStorage.removeItem("frankenstein_encrypted_cfg"); // legacy
  try {
    const savedEmail = localStorage.getItem("frankenstein_email");
    const emailInput = document.getElementById("cfg-email");
    if (savedEmail && emailInput && !emailInput.value) {
      emailInput.value = savedEmail;
      const pw = document.getElementById("cfg-password");
      if (pw) pw.focus();
    }
  } catch (_) {}
};

async function tryAutoFillConfig() {
  // 1. Try to fetch frankenstein.config.json if it exists
  try {
    const res = await fetch("frankenstein.config.json");
    if (res.ok) {
      const data = await res.json();
      if (isValidRepoName(data.owner))
        document.getElementById("cfg-owner").value = data.owner;
      if (isValidRepoName(data.repo))
        document.getElementById("cfg-repo").value = data.repo;
      if (isSafeBouncerUrl(data.bouncerUrl))
        document.getElementById("cfg-bouncer").value = data.bouncerUrl;
      if (isSafeBouncerUrl(data.backupBouncerUrl))
        document.getElementById("cfg-bouncer-backup").value =
          data.backupBouncerUrl;

      // Hide all configuration fields if bouncer is fully configured
      if (isSafeBouncerUrl(data.bouncerUrl)) {
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

// Messages may only pre-fill owner/repo, and only from the embedding page.
// The bouncer URL (where the password is sent) can come ONLY from
// frankenstein.config.json on this origin, never from another window.
function applyExternalConfig(cfg) {
  if (!cfg) return;
  if (isValidRepoName(cfg.owner))
    document.getElementById("cfg-owner").value = cfg.owner;
  if (isValidRepoName(cfg.repo))
    document.getElementById("cfg-repo").value = cfg.repo;
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || window.parent === window) return;
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
