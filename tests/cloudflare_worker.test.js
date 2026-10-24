const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { pathToFileURL } = require("url");

const WORKER = path.join(__dirname, "../prod/worker/cloudflare-bouncer.mjs");

let worker;
test.before(async () => {
  worker = (await import(pathToFileURL(WORKER).href)).default;
});

const SITES = {
  "anna@bakery.com": {
    name: "Anna's Bakery",
    password: "pw-anna-123456",
    owner: "me",
    repo: "bakery",
    token: "ghp_site_token",
  },
  "bob@shop.com": {
    name: "Bob",
    password: "pw-bob-1234567",
    owner: "bobco",
    repo: "shop",
  },
  "broken@x.com": { password: "pw-long-enough-1", token: "t" }, // no owner/repo
  "notoken@x.com": { password: "pw-long-enough-1", owner: "me", repo: "r" },
};

function makeEnv(extra) {
  return Object.assign(
    {
      SITES: {
        get: async (key) =>
          SITES[key] ? JSON.parse(JSON.stringify(SITES[key])) : null,
      },
      GITHUB_TOKEN: "ghp_default_token",
      AUTH_FAIL_DELAY_MS: "0",
    },
    extra || {},
  );
}

/** Calls the Worker with GitHub faked out. Returns the Response and the upstream requests. */
async function call(env, opts) {
  const upstream = [];
  const realFetch = globalThis.fetch;
  let ipCounter = (call.n = (call.n || 0) + 1);
  globalThis.fetch = async (url, init) => {
    upstream.push({ url: String(url), init });
    return new Response(opts.githubBody || '{"ok":true}', {
      status: opts.githubStatus || 200,
      headers: {
        "Content-Type": "application/json",
        "X-RateLimit-Remaining": "4999",
        ETag: '"abc"',
        "Set-Cookie": "leak=1",
        "X-OAuth-Scopes": "repo, workflow",
        "GitHub-Authentication-Token-Expiration": "2027-01-01",
      },
    });
  };
  try {
    const url = "https://bouncer.example/" + (opts.query || "");
    const req = new Request(url, {
      method: opts.method || "GET",
      headers: {
        "CF-Connecting-IP":
          opts.ip || `203.0.113.${ipCounter % 250}-${ipCounter}`,
        ...(opts.headers || {}),
      },
      body: opts.body,
    });
    const res = await worker.fetch(req, env);
    return { res, upstream };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const login = (email, password) => ({
  "Site-Email": email,
  "Site-Password": password,
});
const q = (p) => "?path=" + encodeURIComponent(p);

test("health check: opening the URL in a browser says it is running", async () => {
  const { res } = await call(makeEnv(), {});
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /is running/);
});

test("CORS preflight allows the headers the CMS sends", async () => {
  const { res } = await call(makeEnv(), { method: "OPTIONS", query: q("/x") });
  assert.strictEqual(res.status, 204);
  assert.match(res.headers.get("Access-Control-Allow-Headers"), /Site-Session/);
  assert.match(
    res.headers.get("Access-Control-Expose-Headers"),
    /X-Session-Token/,
  );
  assert.strictEqual(res.headers.get("Access-Control-Allow-Origin"), "*");
  const restricted = await call(
    makeEnv({ ALLOWED_ORIGIN: "https://cms.me.com" }),
    { method: "OPTIONS", query: q("/x") },
  );
  assert.strictEqual(
    restricted.res.headers.get("Access-Control-Allow-Origin"),
    "https://cms.me.com",
  );
});

test("login: the CMS learns the site's repo from the bouncer (no per-site config)", async () => {
  const { res, upstream } = await call(makeEnv(), {
    query: "?action=site",
    headers: login("anna@bakery.com", "pw-anna-123456"),
  });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), {
    name: "Anna's Bakery",
    owner: "me",
    repo: "bakery",
  });
  assert.ok(res.headers.get("X-Session-Token"), "a session token is issued");
  assert.strictEqual(upstream.length, 0, "login never touches GitHub");
});

test("the email is matched case-insensitively and trimmed", async () => {
  const { res } = await call(makeEnv(), {
    query: "?action=site",
    headers: login("  Anna@Bakery.COM ", "pw-anna-123456"),
  });
  assert.strictEqual(res.status, 200);
});

test("wrong password, unknown email and missing email are refused", async () => {
  const wrong = await call(makeEnv(), {
    query: "?action=site",
    headers: login("anna@bakery.com", "nope"),
  });
  assert.strictEqual(wrong.res.status, 401);
  const unknown = await call(makeEnv(), {
    query: "?action=site",
    headers: login("who@nowhere.com", "pw-anna-123456"),
  });
  assert.strictEqual(unknown.res.status, 401);
  const none = await call(makeEnv(), { query: "?action=site", headers: {} });
  assert.strictEqual(none.res.status, 400);
  const emptyPw = await call(makeEnv(), {
    query: "?action=site",
    headers: login("anna@bakery.com", ""),
  });
  assert.strictEqual(emptyPw.res.status, 401);
});

test("proxy: uses the SITE's token, passes Accept/Content-Type, hides browser headers and GitHub cookies", async () => {
  const { res, upstream } = await call(makeEnv(), {
    query: q("/repos/me/bakery/contents/index.html"),
    headers: {
      ...login("anna@bakery.com", "pw-anna-123456"),
      Accept: "application/vnd.github.v3.raw",
      Cookie: "secret=1",
      Origin: "https://evil.example",
    },
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(upstream.length, 1);
  assert.strictEqual(
    upstream[0].url,
    "https://api.github.com/repos/me/bakery/contents/index.html",
  );
  const h = upstream[0].init.headers;
  assert.strictEqual(h.get("Authorization"), "Bearer ghp_site_token");
  assert.strictEqual(h.get("Accept"), "application/vnd.github.v3.raw");
  assert.strictEqual(h.get("Cookie"), null);
  assert.strictEqual(h.get("Origin"), null);
  assert.strictEqual(h.get("Site-Password"), null);
  assert.strictEqual(res.headers.get("X-RateLimit-Remaining"), "4999");
  assert.strictEqual(res.headers.get("Set-Cookie"), null);
  assert.strictEqual(res.headers.get("ETag"), null);
});

test("sites without their own token use the GITHUB_TOKEN secret; none at all gives a helpful setup error", async () => {
  const withDefault = await call(makeEnv(), {
    query: q("/repos/bobco/shop"),
    headers: login("bob@shop.com", "pw-bob-1234567"),
  });
  assert.strictEqual(withDefault.res.status, 200);
  assert.strictEqual(
    withDefault.upstream[0].init.headers.get("Authorization"),
    "Bearer ghp_default_token",
  );

  const none = await call(makeEnv({ GITHUB_TOKEN: undefined }), {
    query: q("/repos/me/r"),
    headers: login("notoken@x.com", "pw-long-enough-1"),
  });
  assert.strictEqual(none.res.status, 500);
  assert.match((await none.res.json()).message, /no GitHub token/);
});

test("a client can only reach their own repo, and only what the CMS needs", async () => {
  const h = login("anna@bakery.com", "pw-anna-123456");
  for (const [method, p] of [
    ["GET", "/repos/me/other/contents/x"],
    ["GET", "/repos/bobco/shop/contents/x"],
    ["GET", "/user"],
    ["GET", "/user/repos"],
    ["GET", "/repos/me/bakery/issues"],
    ["DELETE", "/repos/me/bakery/contents/index.html"],
    ["PUT", "/repos/me/bakery"],
    ["GET", "/repos/me/bakery/contents/../../other"],
  ]) {
    const { res, upstream } = await call(makeEnv(), {
      method,
      query: q(p),
      headers: h,
    });
    assert.strictEqual(res.status, 403, `${method} ${p}`);
    assert.strictEqual(upstream.length, 0, "nothing was sent to GitHub");
  }
});

test("saving a file: PUT body and content type reach GitHub unchanged", async () => {
  const body = JSON.stringify({
    message: "Update",
    content: "aGk=",
    sha: "abc",
  });
  const { res, upstream } = await call(makeEnv(), {
    method: "PUT",
    query: q("/repos/me/bakery/contents/a%20b.html"),
    headers: {
      ...login("anna@bakery.com", "pw-anna-123456"),
      "Content-Type": "application/json",
    },
    body,
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(upstream[0].init.method, "PUT");
  assert.strictEqual(
    upstream[0].init.headers.get("Content-Type"),
    "application/json",
  );
  assert.strictEqual(Buffer.from(upstream[0].init.body).toString(), body);
});

test("GitHub errors (409, 404) pass through with their status", async () => {
  const { res } = await call(makeEnv(), {
    method: "PUT",
    query: q("/repos/me/bakery/contents/x.html"),
    headers: {
      ...login("anna@bakery.com", "pw-anna-123456"),
      "Content-Type": "application/json",
    },
    body: "{}",
    githubStatus: 409,
    githubBody: '{"message":"sha does not match"}',
  });
  assert.strictEqual(res.status, 409);
  assert.match(await res.text(), /sha does not match/);
});

test("session token: after login the password is no longer needed; tampering, other sites and password changes invalidate it", async () => {
  const env = makeEnv();
  const first = await call(env, {
    query: "?action=site",
    headers: login("anna@bakery.com", "pw-anna-123456"),
  });
  const token = first.res.headers.get("X-Session-Token");

  const ok = await call(env, {
    query: q("/repos/me/bakery"),
    headers: { "Site-Email": "anna@bakery.com", "Site-Session": token },
  });
  assert.strictEqual(ok.res.status, 200);
  assert.strictEqual(
    ok.res.headers.get("X-Session-Token"),
    null,
    "no new token while the session is valid",
  );

  const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
  const bad = await call(env, {
    query: q("/repos/me/bakery"),
    headers: { "Site-Email": "anna@bakery.com", "Site-Session": tampered },
  });
  assert.strictEqual(bad.res.status, 401);

  const otherSite = await call(env, {
    query: q("/repos/bobco/shop"),
    headers: { "Site-Email": "bob@shop.com", "Site-Session": token },
  });
  assert.strictEqual(otherSite.res.status, 401);

  // password changed in KV -> every old session stops working
  SITES["anna@bakery.com"].password = "new-password";
  try {
    const afterChange = await call(env, {
      query: q("/repos/me/bakery"),
      headers: { "Site-Email": "anna@bakery.com", "Site-Session": token },
    });
    assert.strictEqual(afterChange.res.status, 401);
  } finally {
    SITES["anna@bakery.com"].password = "pw-anna-123456";
  }
});

test("setup mistakes produce readable errors instead of a mystery", async () => {
  const noKv = await call(
    { AUTH_FAIL_DELAY_MS: "0" },
    { query: "?action=site", headers: login("a@b.com", "x") },
  );
  assert.strictEqual(noKv.res.status, 500);
  assert.match((await noKv.res.json()).message, /"SITES"/);

  const brokenJson = makeEnv({
    SITES: {
      get: async () => {
        throw new SyntaxError("bad json");
      },
    },
  });
  const bj = await call(brokenJson, {
    query: "?action=site",
    headers: login("a@b.com", "x"),
  });
  assert.strictEqual(bj.res.status, 500);
  assert.match((await bj.res.json()).message, /not valid JSON/);

  const noOwner = await call(makeEnv(), {
    query: "?action=site",
    headers: login("broken@x.com", "pw-long-enough-1"),
  });
  assert.strictEqual(noOwner.res.status, 500);
  assert.match((await noOwner.res.json()).message, /no "owner"/);
});

test("a valid login with an unknown action and no path gets a clear 400", async () => {
  const { res } = await call(makeEnv(), {
    query: "?action=bogus",
    headers: login("anna@bakery.com", "pw-anna-123456"),
  });
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).message, /Missing path/);
});

test("sessions expire after 8 hours", async () => {
  const env = makeEnv();
  const first = await call(env, {
    query: "?action=site",
    headers: login("anna@bakery.com", "pw-anna-123456"),
  });
  const token = first.res.headers.get("X-Session-Token");
  const headers = { "Site-Email": "anna@bakery.com", "Site-Session": token };

  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 7 * 3600 * 1000;
    const stillValid = await call(env, {
      query: q("/repos/me/bakery"),
      headers,
    });
    assert.strictEqual(stillValid.res.status, 200);

    Date.now = () => realNow() + 9 * 3600 * 1000;
    const expired = await call(env, { query: q("/repos/me/bakery"), headers });
    assert.strictEqual(expired.res.status, 401);
  } finally {
    Date.now = realNow;
  }
});

test("GitHub's token metadata headers never reach the browser", async () => {
  const { res } = await call(makeEnv(), {
    query: q("/repos/me/bakery"),
    headers: login("anna@bakery.com", "pw-anna-123456"),
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get("X-OAuth-Scopes"), null);
  assert.strictEqual(
    res.headers.get("GitHub-Authentication-Token-Expiration"),
    null,
  );
});

test("passwords shorter than 12 characters are refused with a clear setup error", async () => {
  SITES["short@x.com"] = {
    password: "short",
    owner: "me",
    repo: "r",
    token: "t",
  };
  try {
    const { res } = await call(makeEnv(), {
      query: "?action=site",
      headers: login("short@x.com", "short"),
    });
    assert.strictEqual(res.status, 500);
    assert.match((await res.json()).message, /shorter than 12/);
  } finally {
    delete SITES["short@x.com"];
  }
});

test("a client can only write pages and img/ images (no workflows, scripts, SVG)", async () => {
  const h = {
    ...login("anna@bakery.com", "pw-anna-123456"),
    "Content-Type": "application/json",
  };
  for (const p of [
    "/repos/me/bakery/contents/.github/workflows/deploy.yml",
    "/repos/me/bakery/contents/app.js",
    "/repos/me/bakery/contents/style.css",
    "/repos/me/bakery/contents/img/evil.svg",
    "/repos/me/bakery/contents/img/deep/a.png",
  ]) {
    const { res, upstream } = await call(makeEnv(), {
      method: "PUT",
      query: q(p),
      headers: h,
      body: "{}",
    });
    assert.strictEqual(res.status, 403, p);
    assert.strictEqual(upstream.length, 0);
  }
  for (const p of [
    "/repos/me/bakery/contents/blog/post.html",
    "/repos/me/bakery/contents/img/photo.png",
  ]) {
    const { res } = await call(makeEnv(), {
      method: "PUT",
      query: q(p),
      headers: h,
      body: "{}",
    });
    assert.strictEqual(res.status, 200, p);
  }
});

test("oversized requests are refused before anything is sent to GitHub", async () => {
  const h = {
    ...login("anna@bakery.com", "pw-anna-123456"),
    "Content-Type": "application/json",
  };
  const big = "x".repeat(9 * 1024 * 1024);
  const { res, upstream } = await call(makeEnv(), {
    method: "PUT",
    query: q("/repos/me/bakery/contents/index.html"),
    headers: h,
    body: big,
  });
  assert.strictEqual(res.status, 413);
  assert.strictEqual(upstream.length, 0);
});

test("brute force: after 10 failures a client address is refused, even with the right password; others are unaffected; success resets", async () => {
  const env = makeEnv();
  const ip = "198.51.100.7";
  for (let i = 0; i < 9; i++) {
    const { res } = await call(env, {
      ip,
      query: "?action=site",
      headers: login("anna@bakery.com", "wrong-" + i),
    });
    assert.strictEqual(res.status, 401);
  }
  // a correct login in between resets the counter
  assert.strictEqual(
    (
      await call(env, {
        ip,
        query: "?action=site",
        headers: login("anna@bakery.com", "pw-anna-123456"),
      })
    ).res.status,
    200,
  );
  for (let i = 0; i < 10; i++) {
    await call(env, {
      ip,
      query: "?action=site",
      headers: login("anna@bakery.com", "wrong"),
    });
  }
  const blocked = await call(env, {
    ip,
    query: "?action=site",
    headers: login("anna@bakery.com", "pw-anna-123456"),
  });
  assert.strictEqual(blocked.res.status, 429);
  assert.ok(blocked.res.headers.get("Retry-After"));
  assert.strictEqual(blocked.res.headers.get("X-Session-Token"), null);
  const other = await call(env, {
    ip: "198.51.100.8",
    query: "?action=site",
    headers: login("anna@bakery.com", "pw-anna-123456"),
  });
  assert.strictEqual(other.res.status, 200);
});
