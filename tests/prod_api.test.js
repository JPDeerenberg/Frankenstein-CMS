const test = require("node:test");
const assert = require("node:assert");
const { JSDOM, createEnv } = require("./helpers/dom-env");

const maybe = JSDOM ? test : test.skip;

function setup(handlerFor) {
  const calls = [];
  const w = createEnv(
    ["prod/js/config.js", "prod/js/utils.js", "prod/js/api.js"],
    {
      beforeScripts(win) {
        win.fetch = async (url, init) => {
          const u = new URL(url);
          calls.push({
            base: u.origin + u.pathname,
            path: u.searchParams.get("path"),
            headers: init.headers,
            init,
            n: calls.length,
          });
          return handlerFor(calls[calls.length - 1], calls);
        };
      },
    },
  );
  w.eval(
    'config = { bouncerUrl: "https://primary.example/bouncer.php", backupBouncerUrl: "https://backup.example/", owner: "o", repo: "r", email: "me@site.com", password: "pw" }',
  );
  return { w, calls };
}

const res = (status, headers) => ({
  ok: status < 300,
  status,
  headers: { get: (k) => (headers && headers[k.toLowerCase()]) || null },
  json: async () => ({}),
});

maybe("sends the password once, then only the session token", async () => {
  const { w, calls } = setup((c) =>
    res(200, c.n === 0 ? { "x-session-token": "tok123" } : {}),
  );
  await w.apiFetch("/repos/o/r/contents/a b.html");
  await w.apiFetch("/repos/o/r/commits?path=a.html&per_page=20");
  assert.strictEqual(calls[0].headers["Site-Password"], "pw");
  assert.strictEqual(calls[1].headers["Site-Session"], "tok123");
  assert.strictEqual(calls[1].headers["Site-Password"], undefined);
  assert.strictEqual(calls[1].headers["Site-Email"], "me@site.com");
  // the GitHub path (including its own query) travels as one encoded parameter
  assert.strictEqual(
    calls[1].path,
    "/repos/o/r/commits?path=a.html&per_page=20",
  );
});

maybe(
  "an expired session falls back to the password instead of failing for good",
  async () => {
    const { w, calls } = setup((c) => {
      if (c.headers["Site-Session"]) return res(401);
      return res(200, { "x-session-token": "fresh" });
    });
    w.eval('config.sessionToken = "expired"');
    const r = await w.apiFetch("/repos/o/r");
    assert.strictEqual(r.status, 200);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[1].headers["Site-Password"], "pw");
    assert.strictEqual(w.eval("config.sessionToken"), "fresh");
  },
);

maybe(
  "falls back to the backup bouncer when the primary is down (503) or unreachable",
  async () => {
    let first = setup((c) =>
      c.base.includes("primary") ? res(503) : res(200),
    );
    const r1 = await first.w.apiFetch("/repos/o/r");
    assert.strictEqual(r1.status, 200);
    assert.ok(first.calls[1].base.includes("backup.example"));
    assert.strictEqual(
      first.calls[1].headers["Site-Password"],
      "pw",
      "backup never sees a primary session token",
    );

    const second = setup((c) => {
      if (c.base.includes("primary")) throw new TypeError("Failed to fetch");
      return res(200);
    });
    const r2 = await second.w.apiFetch("/repos/o/r");
    assert.strictEqual(r2.status, 200);
  },
);

maybe(
  "a normal GitHub error (404, 409) is returned as is, not retried on the backup",
  async () => {
    const { w, calls } = setup(() => res(409));
    const r = await w.apiFetch("/repos/o/r/contents/x", {
      method: "PUT",
      body: "{}",
    });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(calls.length, 1);
  },
);

maybe(
  "an auth error is returned to the caller when there is no session to fall back from",
  async () => {
    const { w } = setup(() => res(401));
    const r = await w.apiFetch("/repos/o/r");
    assert.strictEqual(r.status, 401);
  },
);
