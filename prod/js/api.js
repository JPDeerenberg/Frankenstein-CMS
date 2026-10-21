// GitHub API transport for the prod build: every request goes through the
// "Bouncer" (PHP / Supabase / Node), which holds the GitHub token server-side.
// (dev/js/api.js talks to GitHub directly.) files.js only calls apiFetch().

function bouncerBases() {
  const bases = [config.bouncerUrl];
  if (
    config.backupBouncerUrl &&
    config.backupBouncerUrl !== config.bouncerUrl
  ) {
    bases.push(config.backupBouncerUrl);
  }
  return bases;
}

async function bouncerRequest(base, apiPath, options, useSession) {
  const init = Object.assign({}, options);
  const headers = Object.assign({}, options.headers || {});
  headers["Site-Email"] = config.email;
  if (useSession && config.sessionToken) {
    headers["Site-Session"] = config.sessionToken;
  } else {
    headers["Site-Password"] = config.password;
  }
  init.headers = headers;
  if (!init.cache && (!init.method || init.method === "GET")) {
    init.cache = "no-cache"; // never reuse a stale sha
  }
  const res = await fetchWithRetry(
    `${base}?path=${encodeURIComponent(apiPath)}`,
    init,
  );
  const issued = res.headers.get("X-Session-Token");
  if (issued) config.sessionToken = issued;
  return res;
}

async function apiFetch(apiPath, options) {
  options = options || {};
  const path = apiPath.startsWith("/") ? apiPath : "/" + apiPath;
  const bases = bouncerBases();
  let lastError = null;

  for (let i = 0; i < bases.length; i++) {
    const isLast = i === bases.length - 1;
    try {
      let res = await bouncerRequest(bases[i], path, options, true);
      if (res.status === 401 && config.sessionToken) {
        // session expired: fall back to the password once (it is still in memory)
        config.sessionToken = "";
        res = await bouncerRequest(bases[i], path, options, false);
      }
      // Bouncer down (not a GitHub error): try the backup bouncer
      if ([502, 503, 504].indexOf(res.status) !== -1 && !isLast) {
        lastError = new Error("Bouncer unavailable (" + res.status + ")");
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
      if (isLast) throw e;
    }
  }
  throw lastError || new Error("No bouncer configured");
}

// Backwards compatibility with code written against the old name
const githubFetch = apiFetch;
