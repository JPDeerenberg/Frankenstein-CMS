const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");

function loadUtils() {
  const code = fs.readFileSync(
    path.join(__dirname, "../dev/js/utils.js"),
    "utf8",
  );
  const sandbox = {
    atob: (b64) => Buffer.from(b64, "base64").toString("binary"),
    btoa: (str) => Buffer.from(str, "binary").toString("base64"),
    TextEncoder,
    TextDecoder,
    Uint8Array,
    String,
    setTimeout,
    clearTimeout,
    console,
    document: {
      createElement: (tag) => {
        const el = {
          tagName: tag.toUpperCase(),
          textContent: "",
          setAttribute() {},
          appendChild() {},
        };
        return el;
      },
    },
    config: { owner: "owner", repo: "repo" },
    fetch: async () => ({ ok: true, status: 200, text: async () => "body{}" }),
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

test("scopeCssToCms rewrites body and html selectors", () => {
  const u = loadUtils();
  const css =
    "body { color: red; } body.main:hover { color: blue; } html, body { margin: 0; }";
  const out = u.scopeCssToCms(css);
  assert.ok(out.includes("#cms-page-content"));
  assert.ok(
    !/(^|[\s,{])body[\s,{.:#[>+~]/.test(
      out.replace(/#cms-page-content/g, "SCOPE"),
    ),
  );
});

test("scopeCssToCms is a no-op for empty input", () => {
  const u = loadUtils();
  assert.strictEqual(u.scopeCssToCms(""), "");
  assert.strictEqual(u.scopeCssToCms(null), null);
});

test("cacheSet enforces LRU max size", () => {
  const u = loadUtils();
  const map = new Map();
  for (let i = 0; i < 100; i++) {
    u.cacheSet(map, "k" + i, i);
  }
  assert.ok(map.size <= 80);
  assert.ok(!map.has("k0")); // oldest evicted
  assert.ok(map.has("k99"));
});

test("cacheClear empties the map", () => {
  const u = loadUtils();
  const map = new Map([["a", 1]]);
  u.cacheClear(map);
  assert.strictEqual(map.size, 0);
});

test("listHtmlFilesRecursive collects nested html and skips node_modules", async () => {
  const u = loadUtils();
  const tree = {
    "": [
      { type: "file", name: "index.html", path: "index.html" },
      { type: "dir", name: "pages", path: "pages" },
      { type: "dir", name: "node_modules", path: "node_modules" },
    ],
    pages: [
      { type: "file", name: "about.html", path: "pages/about.html" },
      { type: "file", name: "readme.md", path: "pages/readme.md" },
    ],
    node_modules: [
      { type: "file", name: "x.html", path: "node_modules/x.html" },
    ],
  };

  async function fetchFn(apiPath) {
    const m = apiPath.match(/\/contents\/?(.*)$/);
    const p = m ? m[1] : "";
    return {
      ok: true,
      status: 200,
      json: async () => tree[p] || [],
    };
  }

  const files = await u.listHtmlFilesRecursive(fetchFn, "", 0, 4);
  const paths = files.map((f) => f.path).sort();
  assert.ok(paths.includes("index.html"));
  assert.ok(paths.includes("pages/about.html"));
  assert.strictEqual(paths.length, 2);
});

test("fetchWithRetry retries on 429 then succeeds", async () => {
  const u = loadUtils();
  let calls = 0;
  const originalFetch = globalThis.fetch;
  // Inject into sandbox by reloading with custom fetch
  const code = fs.readFileSync(
    path.join(__dirname, "../dev/js/utils.js"),
    "utf8",
  );
  const sandbox = {
    atob: (b64) => Buffer.from(b64, "base64").toString("binary"),
    btoa: (str) => Buffer.from(str, "binary").toString("base64"),
    TextEncoder,
    TextDecoder,
    Uint8Array,
    String,
    setTimeout: (fn, ms) => setTimeout(fn, 0), // speed up backoff
    clearTimeout,
    console,
    config: { owner: "o", repo: "r" },
    fetch: async () => {
      calls++;
      if (calls < 3) {
        return {
          status: 429,
          headers: { get: (h) => (h === "Retry-After" ? "0" : null) },
        };
      }
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
      };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const res = await sandbox.fetchWithRetry("https://example.com", {}, 3);
  assert.strictEqual(res.status, 200);
  assert.ok(calls >= 3);
});

test("shared modules stay in parity (dev vs prod)", () => {
  const shared = ["utils.js", "editor.js", "ui.js", "seo.js", "igor.js"];
  for (const file of shared) {
    const a = fs.readFileSync(path.join(__dirname, "../dev/js", file), "utf8");
    const b = fs.readFileSync(path.join(__dirname, "../prod/js", file), "utf8");
    assert.strictEqual(a, b, `${file} drifted between dev and prod`);
  }
});
