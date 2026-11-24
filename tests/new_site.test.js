const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "../scripts/new-site.mjs");

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
  });
}

function valueOf(stdout) {
  const marker = "KV value:\n";
  return JSON.parse(stdout.slice(stdout.indexOf(marker) + marker.length));
}

test("new-site prints a lowercased KV key and a ready-to-paste value", () => {
  const r = run(["Anna's Bakery", "  Anna@Bakery.COM ", "me/bakery"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(/^KV key: (.+)$/m.exec(r.stdout)[1], "anna@bakery.com");
  const value = valueOf(r.stdout);
  assert.strictEqual(value.name, "Anna's Bakery");
  assert.strictEqual(value.owner, "me");
  assert.strictEqual(value.repo, "bakery");
  assert.match(value.password, /^[A-Za-z0-9]{24}$/);
  assert.strictEqual("token" in value, false);
});

test("new-site can add the per-site token placeholder, never a token", () => {
  const r = run(["Bob's Shop", "bob@shop.com", "bobco/shop", "--own-token"]);
  assert.strictEqual(r.status, 0, r.stderr);
  const value = valueOf(r.stdout);
  assert.strictEqual(value.token, "github_pat_PASTE_FINE_GRAINED_TOKEN_HERE");
  assert.ok(!/ghp_[A-Za-z0-9]{20,}/.test(r.stdout));
});

test("two runs produce different 24-character passwords", () => {
  const a = valueOf(run(["A", "a@x.com", "me/r"]).stdout).password;
  const b = valueOf(run(["B", "b@x.com", "me/r"]).stdout).password;
  assert.strictEqual(a.length, 24);
  assert.notStrictEqual(a, b);
});

test("new-site rejects missing, malformed and unsafe input", () => {
  for (const args of [
    [],
    ["Name", "not-an-email", "me/r"],
    ["Name", "a@b.com", "me"],
    ["Name", "a@b.com", "../x"],
    ["Name", "a@b.com", "me/r", "--unknown"],
    ["", "a@b.com", "me/r"],
  ]) {
    const r = run(args);
    assert.strictEqual(r.status, 1, `${JSON.stringify(args)}: ${r.stdout}`);
    assert.match(r.stderr, /new-site:/);
  }
});
