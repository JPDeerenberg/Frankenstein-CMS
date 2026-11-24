const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/set-bouncer-origin.mjs");
const ORIGINAL = fs.readFileSync(path.join(ROOT, "prod/index.html"), "utf8");

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

function cspOf(html) {
  return /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)[1];
}

function directive(csp, name) {
  return (csp.match(new RegExp(name + " ([^;]+)")) || [])[1];
}

function fixture(html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cms-csp-"));
  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, html === undefined ? ORIGINAL : html);
  return { dir, file };
}

test("set-bouncer-origin replaces only connect-src and is idempotent", (t) => {
  const { dir, file } = fixture();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const r = run([
    "--file",
    file,
    "https://bouncer.example.com",
    "https://b2.example:8443",
  ]);
  assert.strictEqual(r.status, 0, r.stderr);
  const html = fs.readFileSync(file, "utf8");
  const csp = cspOf(html);
  assert.strictEqual(
    directive(csp, "connect-src"),
    "'self' https://bouncer.example.com https://b2.example:8443",
  );
  assert.strictEqual(directive(csp, "script-src"), "'self'");
  assert.strictEqual(directive(csp, "object-src"), "'none'");
  assert.ok(!csp.includes("http://localhost:*"));

  const once = html;
  const again = run([
    "--file",
    file,
    "https://bouncer.example.com",
    "https://b2.example:8443",
  ]);
  assert.strictEqual(again.status, 0, again.stderr);
  assert.match(again.stdout, /No change/);
  assert.strictEqual(fs.readFileSync(file, "utf8"), once);
});

test("set-bouncer-origin can target a copy, leaving the repository page alone", (t) => {
  const { dir, file } = fixture();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // --file keeps the test suite from modifying the real prod/index.html.
  const r = run(["--file", file, "https://cms.example.com"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(
    cspOf(fs.readFileSync(file, "utf8")),
    /connect-src 'self' https:\/\/cms\.example\.com;/,
  );
});

test("set-bouncer-origin refuses anything that is not a bare https origin", (t) => {
  for (const bad of [
    "http://bouncer.example.com",
    "https://bouncer.example.com/path",
    "https://user:pass@bouncer.example.com",
    "https://bouncer.example.com?x=1",
    "ftp://bouncer.example.com",
  ]) {
    const { dir, file } = fixture();
    try {
      const r = run(["--file", file, bad]);
      assert.strictEqual(r.status, 1, bad);
      assert.match(r.stderr, /set-bouncer-origin:/);
      assert.strictEqual(fs.readFileSync(file, "utf8"), ORIGINAL);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("set-bouncer-origin fails clearly when the page has no CSP", (t) => {
  const { dir, file } = fixture("<html><body>no policy</body></html>");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = run(["--file", file, "https://bouncer.example.com"]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /no Content-Security-Policy/);
});
