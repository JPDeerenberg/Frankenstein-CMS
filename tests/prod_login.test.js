const test = require("node:test");
const assert = require("node:assert");
const { JSDOM, createEnv } = require("./helpers/dom-env");

const maybe = JSDOM ? test : test.skip;

const LOGIN_HTML = `
  <input id="cfg-email" /><input id="cfg-password" />
  <input id="cfg-owner" /><input id="cfg-repo" />
  <input id="cfg-bouncer" /><input id="cfg-bouncer-backup" />
  <div id="login-msg"></div>`;

const res = (status, body, headers) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => (headers && headers[k.toLowerCase()]) || null },
  json: async () => {
    if (body === undefined) throw new Error("no body");
    return body;
  },
});

/** handler(url) -> response | throws. Returns the page plus the list of requested URLs. */
function setup(fields, handler) {
  const urls = [];
  const alerts = [];
  const w = createEnv(["prod/js/config.js", "prod/js/auth.js"], {
    html: LOGIN_HTML,
    beforeScripts(win) {
      win.fetch = async (url, init) => {
        urls.push(String(url));
        return handler(String(url), init);
      };
      win.alert = (m) => alerts.push(m);
      win.showDashboard = () => (win.__dashboard = true);
    },
  });
  const set = (id, v) => (w.document.getElementById(id).value = v);
  set("cfg-email", "anna@bakery.com");
  set("cfg-password", "pw");
  Object.entries(fields).forEach(([k, v]) => set(k, v));
  return {
    w,
    urls,
    alerts,
    msg: () => w.document.getElementById("login-msg").innerText,
    cfg: () => JSON.parse(JSON.stringify(w.eval("config"))),
  };
}

maybe(
  "with the Cloudflare bouncer only the bouncer URL is needed: owner/repo come from the login",
  async () => {
    const t = setup({ "cfg-bouncer": "https://b.example" }, (url) =>
      res(
        200,
        { name: "Anna's Bakery", owner: "me", repo: "bakery" },
        { "x-session-token": "tok" },
      ),
    );
    await t.w.saveConfigAndLogin();
    assert.strictEqual(t.w.__dashboard, true);
    const c = t.cfg();
    assert.strictEqual(c.owner, "me");
    assert.strictEqual(c.repo, "bakery");
    assert.strictEqual(c.siteName, "Anna's Bakery");
    assert.strictEqual(c.sessionToken, "tok");
    assert.strictEqual(c.password, "pw");
    assert.strictEqual(c.bouncerUrl, "https://b.example");
    assert.deepStrictEqual(t.urls, ["https://b.example?action=site"]);
    assert.match(t.msg(), /Connected: Anna's Bakery/);
  },
);

maybe(
  "older bouncers (no ?action=site) still work when owner/repo are configured",
  async () => {
    const t = setup(
      {
        "cfg-bouncer": "https://old.example",
        "cfg-owner": "me",
        "cfg-repo": "r",
      },
      (url) =>
        url.includes("action=site")
          ? res(403, { message: "not allowed" })
          : res(200, {}, { "x-session-token": "t" }),
    );
    await t.w.saveConfigAndLogin();
    assert.strictEqual(t.w.__dashboard, true);
    assert.strictEqual(t.cfg().owner, "me");
    assert.strictEqual(t.cfg().sessionToken, "t");
    assert.ok(t.urls[1].includes(encodeURIComponent("/repos/me/r")));
  },
);

maybe(
  "an older bouncer without owner/repo configured gives an actionable message",
  async () => {
    const t = setup({ "cfg-bouncer": "https://old.example" }, () =>
      res(403, { message: "not allowed" }),
    );
    await t.w.saveConfigAndLogin();
    assert.notStrictEqual(t.w.__dashboard, true);
    assert.match(t.msg(), /Set owner and repo/);
  },
);

maybe("a wrong password says so and does not try the backup", async () => {
  const t = setup(
    {
      "cfg-bouncer": "https://b.example",
      "cfg-bouncer-backup": "https://backup.example",
    },
    () => res(401),
  );
  await t.w.saveConfigAndLogin();
  assert.match(t.msg(), /Incorrect email or password/);
  assert.strictEqual(t.urls.length, 1);
});

maybe(
  "primary bouncer down: logs in through the backup and remembers it",
  async () => {
    const t = setup(
      {
        "cfg-bouncer": "https://b.example",
        "cfg-bouncer-backup": "https://backup.example",
        "cfg-owner": "me",
        "cfg-repo": "r",
      },
      (url) => {
        if (url.startsWith("https://b.example"))
          throw new TypeError("Failed to fetch");
        return url.includes("action=site")
          ? res(403, { message: "no" })
          : res(200, {});
      },
    );
    await t.w.saveConfigAndLogin();
    assert.strictEqual(t.w.__dashboard, true);
    assert.strictEqual(t.cfg().bouncerUrl, "https://backup.example");
    assert.strictEqual(t.cfg().backupBouncerUrl, "https://backup.example");
  },
);

maybe("no bouncer URL configured at all is reported", async () => {
  const t = setup({}, () => res(200, {}));
  await t.w.saveConfigAndLogin();
  assert.ok(t.alerts.some((a) => /not configured/.test(a)));
  assert.strictEqual(t.urls.length, 0);
});
