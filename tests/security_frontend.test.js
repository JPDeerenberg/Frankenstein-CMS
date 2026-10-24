// Regression tests for the security review: every test here is an attack that used to work.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM, createEnv } = require("./helpers/dom-env");
const { setup } = require("./helpers/fake-github");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const maybe = JSDOM ? test : test.skip;

/* ---------- URL schemes ---------- */

maybe("isSafeUrl: dangerous schemes are caught even when disguised", () => {
  const w = createEnv(["dev/js/doc.js"]);
  const bad = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "\u0001javascript:alert(1)",
    "  javascript:alert(1)",
    "jav\u200bascript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
  ];
  bad.forEach((u) =>
    assert.strictEqual(w.isSafeUrl(u, "href", "A"), false, JSON.stringify(u)),
  );
  const good = [
    "https://x.com/a",
    "http://x.com",
    "mailto:a@b.c",
    "tel:+31612345678",
    "page.html",
    "#top",
    "//cdn.x.com/a.js",
    "../img/a.png",
    "/abs/path",
    "?q=1",
  ];
  good.forEach((u) => assert.strictEqual(w.isSafeUrl(u, "href", "A"), true, u));
  // data: images only as <img src>; blob: only as src
  assert.strictEqual(
    w.isSafeUrl("data:image/png;base64,AAAA", "src", "IMG"),
    true,
  );
  assert.strictEqual(
    w.isSafeUrl("data:image/svg+xml,%3Csvg%3E", "src", "IMG"),
    true,
  );
  assert.strictEqual(
    w.isSafeUrl("data:image/png;base64,AAAA", "href", "A"),
    false,
  );
  assert.strictEqual(
    w.isSafeUrl("data:image/png;base64,AAAA", "src", "IFRAME"),
    false,
  );
  assert.strictEqual(w.isSafeUrl("blob:https://x/1", "src", "IMG"), true);
  assert.strictEqual(w.isSafeUrl("blob:https://x/1", "href", "A"), false);
});

maybe(
  "sanitizePreviewTree removes every script vector, including tab-obfuscated and SVG ones",
  () => {
    const w = createEnv(["dev/js/doc.js"]);
    const doc = new w.DOMParser().parseFromString(
      `<body>
    <a href="java&#9;script:window.__pwned=1">a</a>
    <img src=x onerror="window.__pwned=1" srcset="javascript:alert(1) 1x">
    <svg onload="window.__pwned=1"><a xlink:href="javascript:alert(1)"><animate attributeName="href" values="javascript:alert(1)"/></a><set attributeName="href" to="javascript:alert(1)"/></svg>
    <iframe srcdoc="<script>parent.__pwned=1</script>" src="javascript:alert(1)"></iframe>
    <form action="javascript:alert(1)"><button formaction="javascript:alert(1)">x</button></form>
    <object data="javascript:alert(1)"></object><embed src="x"><applet code="x"></applet>
    <details open ontoggle="window.__pwned=1"></details>
    <video poster="javascript:alert(1)"></video>
    <base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=javascript:alert(1)">
    <script>window.__pwned=1</script><p onmouseover="x()">ok <a href="ok.html">fine</a></p></body>`,
      "text/html",
    );
    w.sanitizePreviewTree(doc.body);
    const html = doc.body.innerHTML;
    assert.ok(!/\bon[a-z]+\s*=/i.test(html), "event handler left: " + html);
    assert.ok(!/javascript:/i.test(html), "javascript: left: " + html);
    assert.ok(
      !doc.querySelector(
        "script, object, embed, applet, base, animate, set, meta[http-equiv]",
      ),
    );
    const iframe = doc.querySelector("iframe");
    assert.strictEqual(iframe.getAttribute("sandbox"), "");
    assert.ok(!iframe.hasAttribute("srcdoc"));
    // harmless content survives
    assert.strictEqual(
      doc.querySelector("p a").getAttribute("href"),
      "ok.html",
    );
  },
);

/* ---------- sanitising happens BEFORE the live parser sees anything ---------- */

const EVIL_PAGE = `<!DOCTYPE html><html><head><title>T</title></head><body>
<h1 data-editable>Hi</h1>
<img src="x" onerror="window.__pwned=1">
<a href="java&#9;script:window.__pwned=1">x</a>
<svg onload="window.__pwned=1"><a xlink:href="javascript:window.__pwned=1"><animate attributeName="href" values="javascript:window.__pwned=1"/></a></svg>
<iframe srcdoc="<script>parent.__pwned=1</script>"></iframe>
<details open ontoggle="window.__pwned=1"><summary>s</summary></details>
<script>window.__pwned=1</script>
</body></html>`;

maybe(
  "opening a page with hostile markup never hands handlers to the live parser (no XSS in the CMS origin)",
  async () => {
    const env = setup({ "index.html": EVIL_PAGE });
    const w = env.w;
    // record every string assigned to innerHTML anywhere
    const assigned = [];
    for (const proto of [
      w.Element.prototype,
      w.ShadowRoot && w.ShadowRoot.prototype,
    ]) {
      if (!proto) continue;
      const d = Object.getOwnPropertyDescriptor(proto, "innerHTML");
      if (!d || !d.set) continue;
      Object.defineProperty(proto, "innerHTML", {
        configurable: true,
        get: d.get,
        set(v) {
          assigned.push(String(v));
          d.set.call(this, v);
        },
      });
    }
    await w.loadFile("index.html");
    assert.ok(env.get("activeDoc"), "page loaded");
    const bad = assigned.filter((v) => /\bon[a-z]+\s*=|javascript:/i.test(v));
    assert.deepStrictEqual(
      bad,
      [],
      "dangerous markup was passed to the live parser",
    );

    const shadow = w.document.getElementById("editor-host").shadowRoot;
    assert.ok(
      !shadow.querySelector("script, [onerror], [onload], [ontoggle], animate"),
    );
    assert.ok(
      !/javascript:/i.test(shadow.querySelector("#cms-page-content").innerHTML),
    );
    assert.strictEqual(w.__pwned, undefined, "nothing executed");

    // the preview is sanitised, the FILE is not rewritten: the site's own markup is preserved on save
    env.get("activeDoc").regions[0].quill.insertText(0, "X", "user");
    await w.slaOp();
    assert.match(
      env.state.lastPut.text,
      /<img src="x" onerror="window\.__pwned=1">/,
    );
    assert.match(env.state.lastPut.text, /<script>window\.__pwned=1<\/script>/);
  },
);

maybe("block links and images typed by the user cannot smuggle scripts", () => {
  const w = createEnv(["dev/js/utils.js", "dev/js/doc.js", "dev/js/blocks.js"]);
  const B = w.eval("Blocks");
  const parse = (h) =>
    new w.DOMParser().parseFromString("<body>" + h + "</body>", "text/html");
  for (const evil of [
    "javascript:alert(1)",
    "java\tscript:alert(1)",
    " JAVASCRIPT:alert(1)",
    "data:text/html,x",
  ]) {
    assert.strictEqual(
      parse(B.render("hero", { url: evil }))
        .querySelector("a")
        .getAttribute("href"),
      "#",
      JSON.stringify(evil),
    );
  }
  const img = parse(
    B.render("image-left", { image: "java\tscript:alert(1)", alt: "x" }),
  ).querySelector("img");
  assert.match(
    img.getAttribute("src"),
    /^data:image\/svg\+xml,/,
    "falls back to the placeholder",
  );
});

/* ---------- image upload ---------- */

maybe(
  "SVG uploads are refused (they can carry scripts); real images are uploaded",
  async () => {
    const env = setup({
      "index.html":
        "<!DOCTYPE html><html><body><p data-editable>x</p></body></html>",
    });
    await env.w.loadFile("index.html");
    const w = env.w;
    const upload = async (name, type) => {
      const file = new w.File([new Uint8Array([1, 2, 3])], name, { type });
      await w.handleImageUpload({ target: { files: [file], value: "x" } });
    };
    const puts = () => env.calls.filter((c) => c.init.method === "PUT").length;
    await upload("evil.svg", "image/svg+xml");
    await upload("disguised.png", "image/svg+xml");
    await upload("evil.svg", "image/png");
    await upload("script.html", "text/html");
    assert.strictEqual(puts(), 0, "nothing was uploaded");
    assert.ok(env.dialogs.alerts.some((a) => /SVG is not allowed/.test(a)));
    await upload("photo.png", "image/png");
    assert.strictEqual(puts(), 1);
  },
);

/* ---------- login: URL / message injection ---------- */

const DEV_LOGIN = `<input id="cfg-token" /><input id="cfg-owner" /><input id="cfg-repo" /><div id="login-msg"></div>`;
const PROD_LOGIN = `<input id="cfg-email" /><input id="cfg-password" /><input id="cfg-owner" /><input id="cfg-repo" /><input id="cfg-bouncer" /><input id="cfg-bouncer-backup" /><div id="login-msg"></div>`;

function login(scripts, html, fetchImpl) {
  const urls = [];
  const alerts = [];
  const w = createEnv(scripts, {
    html,
    beforeScripts(win) {
      win.fetch = async (url) => {
        urls.push(String(url));
        return fetchImpl
          ? fetchImpl(String(url))
          : {
              ok: false,
              status: 0,
              headers: { get: () => null },
              json: async () => ({}),
            };
      };
      win.alert = (m) => alerts.push(String(m));
      win.showDashboard = () => (win.__dash = true);
    },
  });
  return { w, urls, alerts, el: (id) => w.document.getElementById(id) };
}

/** Pretend this page is framed by `parent` (a stand-in window). */
function frameBy(w, parent) {
  Object.defineProperty(w, "parent", { configurable: true, get: () => parent });
}
function message(w, source, data) {
  const ev = new w.MessageEvent("message", { data });
  Object.defineProperty(ev, "source", { value: source });
  w.dispatchEvent(ev);
}

maybe(
  "dev: owner/repo from messages are validated, and only the embedding parent may send them",
  () => {
    const t = login(
      ["dev/js/config.js", "dev/js/utils.js", "dev/js/auth.js"],
      DEV_LOGIN,
    );
    const cfg = (o, r) => ({
      type: "frankenstein-config",
      config: { owner: o, repo: r },
    });
    message(t.w, t.w, cfg("me", "site")); // not framed: window.parent === window
    assert.strictEqual(
      t.el("cfg-owner").value,
      "",
      "ignored when not embedded",
    );

    const parent = {};
    frameBy(t.w, parent);
    message(t.w, { other: "window" }, cfg("attacker", "repo")); // wrong sender
    assert.strictEqual(t.el("cfg-owner").value, "");
    message(t.w, parent, cfg("../..", "user")); // right sender, hostile values
    assert.strictEqual(t.el("cfg-owner").value, "");
    assert.strictEqual(t.el("cfg-repo").value, "user");
    message(t.w, parent, cfg("me", "my-site")); // right sender, good values
    assert.strictEqual(t.el("cfg-owner").value, "me");
  },
);

maybe("dev: a hostile owner/repo never reaches an API URL", async () => {
  const t = login(
    ["dev/js/config.js", "dev/js/utils.js", "dev/js/auth.js"],
    DEV_LOGIN,
  );
  t.el("cfg-token").value = "ghp_x";
  t.el("cfg-owner").value = "../..";
  t.el("cfg-repo").value = "user/repos?x=";
  await t.w.saveConfigAndLogin();
  assert.strictEqual(t.urls.length, 0, "no request was made with the token");
  assert.ok(t.alerts.some((a) => /letters, digits/.test(a)));
});

maybe(
  "prod: ?bouncer= in the address bar cannot redirect the password to another server",
  async () => {
    const run = async (parent) => {
      const t = login(
        ["prod/js/config.js", "prod/js/utils.js", "prod/js/auth.js"],
        PROD_LOGIN,
      );
      t.w.history.replaceState(
        null,
        "",
        "/?bouncer=https://evil.example/steal&owner=o&repo=r",
      );
      if (parent !== undefined) frameBy(t.w, parent);
      t.el("cfg-email").value = "a@b.c";
      t.el("cfg-password").value = "secret-password";
      await t.w.saveConfigAndLogin();
      return t;
    };
    // 1. opened directly
    let t = await run();
    assert.strictEqual(t.urls.length, 0);
    assert.ok(t.alerts.some((a) => /not configured/.test(a)));
    // 2. framed by ANOTHER site (reading its location throws)
    t = await run(
      new Proxy(
        {},
        {
          get() {
            throw new Error("SecurityError: cross-origin");
          },
        },
      ),
    );
    assert.strictEqual(t.urls.length, 0, "cross-origin framing is not trusted");
    // 3. framed by our own same-origin iframe.html: the documented embedding still works
    t = await run({ location: { origin: "https://cms.example.com" } });
    assert.ok(
      t.urls.some((u) => u.startsWith("https://evil.example/steal")),
      "same-origin embedder may set it (this is the iframe.html case)",
    );
  },
);

maybe(
  "prod: a message can set owner/repo but never the bouncer address",
  () => {
    const t = login(
      ["prod/js/config.js", "prod/js/utils.js", "prod/js/auth.js"],
      PROD_LOGIN,
    );
    const parent = {};
    frameBy(t.w, parent);
    message(t.w, parent, {
      type: "frankenstein-config",
      config: {
        owner: "me",
        repo: "site",
        bouncerUrl: "https://evil.example",
        backupBouncerUrl: "https://evil.example",
        bouncer: "https://evil.example",
      },
    });
    assert.strictEqual(t.el("cfg-owner").value, "me");
    assert.strictEqual(t.el("cfg-bouncer").value, "");
    assert.strictEqual(t.el("cfg-bouncer-backup").value, "");
  },
);

maybe(
  "prod: passwords are never sent over plain http (localhost excepted)",
  async () => {
    const ok = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ owner: "o", repo: "r" }),
    };
    const t = login(
      ["prod/js/config.js", "prod/js/utils.js", "prod/js/auth.js"],
      PROD_LOGIN,
      () => ok,
    );
    t.el("cfg-email").value = "a@b.c";
    t.el("cfg-password").value = "pw";
    t.el("cfg-bouncer").value = "http://bouncer.example.com/b.php";
    await t.w.saveConfigAndLogin();
    assert.strictEqual(t.urls.length, 0);
    assert.match(t.el("login-msg").innerText, /https:\/\//);
    t.el("cfg-bouncer").value = "http://localhost:3000/";
    await t.w.saveConfigAndLogin();
    assert.strictEqual(
      t.urls.length,
      1,
      "localhost is allowed for development",
    );
    const u = t.w.isSafeBouncerUrl;
    assert.strictEqual(
      u("https://user:pw@x.com/"),
      false,
      "no credentials inside the URL",
    );
    assert.strictEqual(u("javascript:alert(1)"), false);
    assert.strictEqual(u("ftp://x.com"), false);
    assert.strictEqual(u("not a url"), false);
  },
);

/* ---------- strict CSP: no inline script of any kind ---------- */

for (const env of ["dev", "prod"]) {
  test(`${env}: the page has no inline handlers or inline scripts, so the CSP can forbid them`, () => {
    const html = read(`${env}/index.html`);
    assert.deepStrictEqual(
      html.match(/\son[a-z]+\s*=\s*["']/gi) || [],
      [],
      "inline event handler attributes",
    );
    assert.deepStrictEqual(
      html.match(/<script(?![^>]*\ssrc=)[^>]*>/gi) || [],
      [],
      "inline <script> blocks",
    );
    assert.ok(!/href\s*=\s*["']\s*javascript:/i.test(html));
    const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
    const directive = (name) =>
      (csp.match(new RegExp(name + " ([^;]+)")) || [])[1];
    assert.strictEqual(
      directive("script-src"),
      "'self'",
      "no 'unsafe-inline' / 'unsafe-eval' / external hosts for scripts",
    );
    assert.strictEqual(directive("object-src"), "'none'");
    assert.strictEqual(directive("base-uri"), "'none'");
    assert.strictEqual(directive("form-action"), "'none'");
    if (env === "dev")
      assert.strictEqual(
        directive("connect-src"),
        "'self' https://api.github.com",
        "the token can only be sent to GitHub",
      );
  });
}

maybe(
  "every data-action in the pages maps to a registered action, and only registered names can run",
  () => {
    const w = createEnv(["dev/js/actions.js"]);
    const names = Array.from(w.eval("Object.keys(ACTIONS)"));
    for (const env of ["dev", "prod"]) {
      const html = read(`${env}/index.html`);
      for (const m of html.matchAll(
        /data-(?:action|mousedown|change)="([^"]+)"/g,
      )) {
        assert.ok(
          names.includes(m[1]),
          `${env}/index.html uses unknown action ${m[1]}`,
        );
      }
    }
  },
);

maybe(
  "the dispatcher passes exactly the declared arguments, ignores unknown names and cannot run arbitrary code",
  () => {
    const html = `<button id="b" data-mousedown="fmt" data-args='["header",2]'>h</button>
    <button id="c" data-action="toggleSidebar">t</button>
    <button id="d" data-action="constructor">x</button>
    <button id="e" data-action="__proto__">x</button>
    <button id="f" data-mousedown="fmt" data-args='{broken'>x</button>
    <input id="g" type="file" data-change="handleImageUpload">`;
    const calls = [];
    const popCall = () => JSON.parse(JSON.stringify(calls.pop())); // arrays come from the jsdom realm
    const w = createEnv(["dev/js/actions.js"], {
      html,
      beforeScripts(win) {
        win.eval(
          "var fmt = function () { window.__calls.push(['fmt'].concat(Array.from(arguments))); }; var toggleSidebar = function () { window.__calls.push(['toggle']); }; var handleImageUpload = function (e) { window.__calls.push(['upload', e && e.type]); };",
        );
        win.__calls = calls;
      },
    });
    const ev = (type) =>
      new w.MouseEvent(type, { bubbles: true, cancelable: true });
    const down = ev("mousedown");
    w.document.getElementById("b").dispatchEvent(down);
    assert.strictEqual(
      down.defaultPrevented,
      true,
      "toolbar keeps the editor focused",
    );
    assert.deepStrictEqual(
      popCall(),
      ["fmt", "header", 2],
      "no stray event argument",
    );
    w.document.getElementById("c").dispatchEvent(ev("click"));
    assert.deepStrictEqual(popCall(), ["toggle"]);
    for (const id of ["d", "e"])
      w.document.getElementById(id).dispatchEvent(ev("click"));
    w.document.getElementById("f").dispatchEvent(ev("mousedown"));
    assert.strictEqual(
      calls.length,
      0,
      "unknown names and broken JSON do nothing",
    );
    w.document
      .getElementById("g")
      .dispatchEvent(new w.Event("change", { bubbles: true }));
    assert.deepStrictEqual(
      popCall(),
      ["upload", "change"],
      "the file picker receives its event",
    );
  },
);

/* ---------- service worker never caches API / bouncer responses ---------- */

for (const env of ["dev", "prod"]) {
  test(`${env}: the service worker caches only the app's own files`, () => {
    const handlers = {};
    const ctx = {
      self: {
        location: {
          href: `https://cms.example.com/${env}/sw.js`,
          origin: "https://cms.example.com",
        },
        addEventListener: (t, f) => (handlers[t] = f),
        skipWaiting() {},
        clients: { claim() {} },
      },
      caches: {
        open: async () => ({ add: async () => {}, put: async () => {} }),
        keys: async () => [],
        match: async () => undefined,
        delete: async () => {},
      },
      fetch: async () => ({ ok: true, clone: () => ({}) }),
      URL,
      Promise,
      Set,
      Map,
      Array,
    };
    vm.createContext(ctx);
    vm.runInContext(read(`${env}/sw.js`), ctx);
    const handled = (url, method) => {
      let responded = false;
      handlers.fetch({
        request: { url, method: method || "GET" },
        respondWith: () => (responded = true),
      });
      return responded;
    };
    const base = `https://cms.example.com/${env}/`;
    assert.strictEqual(handled(base + "index.html"), true);
    assert.strictEqual(handled(base + "js/files.js"), true);
    assert.strictEqual(handled(base + "vendor/quill.min.js"), true);
    // a same-origin bouncer returns repository contents: never cache it
    assert.strictEqual(
      handled(
        "https://cms.example.com/bouncer.php?path=%2Frepos%2Fo%2Fr%2Fcontents%2Findex.html",
      ),
      false,
    );
    assert.strictEqual(
      handled(base + "index.html?path=%2Frepos%2Fo%2Fr"),
      false,
    );
    assert.strictEqual(handled(base + "index.html?action=site"), false);
    assert.strictEqual(
      handled("https://cms.example.com/other/secret.json"),
      false,
    );
    assert.strictEqual(handled("https://api.github.com/repos/o/r"), false);
    assert.strictEqual(handled(base + "index.html", "PUT"), false);
  });
}
