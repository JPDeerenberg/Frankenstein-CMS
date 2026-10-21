// GitHub API transport for the dev build: talks to api.github.com directly
// with the personal access token. (prod/js/api.js goes through the bouncer.)
// files.js only ever calls apiFetch(), so everything else is shared.

async function apiFetch(apiPath, options) {
  options = options || {};
  const path = apiPath.startsWith("/") ? apiPath : "/" + apiPath;
  const init = Object.assign({}, options);
  init.headers = Object.assign(
    { Authorization: `token ${config.token}` },
    options.headers || {},
  );
  // GitHub answers GETs with "Cache-Control: max-age=60"; a stale response
  // would carry an outdated sha and make the next save conflict.
  if (!init.cache && (!init.method || init.method === "GET")) {
    init.cache = "no-cache";
  }
  return fetchWithRetry(`https://api.github.com${path}`, init);
}
