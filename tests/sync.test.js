const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SYNC = path.join(__dirname, "../scripts/sync.mjs");
const TEMPLATE = `const CACHE = "frankenstein-cms-__CACHE_HASH__";
const ASSETS = [
  /* __ASSETS__ */
];
`;

function put(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cms-sync-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.copyFileSync(SYNC, path.join(root, "scripts/sync.mjs"));
  put(root, "shared/sw.template.js", TEMPLATE);
  put(root, "shared/js/a.js", "window.A = 1;\n");
  put(root, "shared/js/b.js", "window.B = 2;\n");

  for (const env of ["dev", "prod"]) {
    put(
      root,
      `${env}/index.html`,
      '<script src="js/auth.js"></script><script src="js/a.js"></script>',
    );
    put(root, `${env}/js/auth.js`, `// ${env} auth\n`);
    put(root, `${env}/css/style.css`, "body { color: black }\n");
    put(root, `${env}/vendor/quill.min.js`, "/* quill */\n");
    put(root, `${env}/icons/icon.png`, `icon-${env}`);
    put(root, `${env}/manifest.webmanifest`, "{}\n");
    put(root, `${env}/demo_page.html`, "<!doctype html><title>demo</title>");
  }
  return root;
}

function sync(root, args) {
  return spawnSync(process.execPath, ["scripts/sync.mjs"].concat(args || []), {
    cwd: root,
    encoding: "utf8",
  });
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");
const assetsOf = (sw) => {
  const body = /const ASSETS = \[([\s\S]*?)\];/.exec(sw)[1];
  return JSON.parse("[" + body.replace(/,\s*$/, "") + "]");
};

test("sync generates both folders and a complete service-worker asset list", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const r = sync(root);
  assert.strictEqual(r.status, 0, r.stderr);
  for (const env of ["dev", "prod"]) {
    assert.match(
      read(root, `${env}/js/a.js`),
      /^\/\/ GENERATED from shared\/js\/a\.js\. Edit that file, then run: npm run sync\n/,
    );
    assert.strictEqual(read(root, `${env}/js/b.js`).includes("window.B"), true);
  }
  for (const env of ["dev", "prod"]) {
    const sw = read(root, `${env}/sw.js`);
    assert.match(sw, /^\/\/ GENERATED from shared\/sw\.template\.js/);
    const assets = assetsOf(sw);
    assert.ok(assets.includes("./"));
    assert.ok(assets.includes("./index.html"));
    assert.ok(assets.includes("./css/style.css"));
    assert.ok(assets.includes("./vendor/quill.min.js"));
    assert.ok(assets.includes("./icons/icon.png"));
    assert.ok(assets.includes("./manifest.webmanifest"));
    assert.ok(assets.includes("./demo_page.html"));
    // every JS file the page loads must be cached
    for (const m of read(root, `${env}/index.html`).matchAll(
      /src="(js\/[^"]+)"/g,
    )) {
      assert.ok(assets.includes("./" + m[1]), m[1]);
    }
    // the cache name is a hash, not the old hand-bumped v2
    assert.match(sw, /frankenstein-cms-[0-9a-f]{8}/);
  }
});

test("--check writes nothing and fails on a hand edit or an edited source", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.strictEqual(sync(root).status, 0);
  const ok = sync(root, ["--check"]);
  assert.strictEqual(ok.status, 0, ok.stderr);

  const before = read(root, "dev/js/a.js");
  fs.appendFileSync(path.join(root, "dev/js/a.js"), "\n// hand edit\n");
  const edited = sync(root, ["--check"]);
  assert.strictEqual(edited.status, 1);
  assert.match(edited.stderr, /dev\/js\/a\.js/);
  // --check must not repair the file
  assert.strictEqual(read(root, "dev/js/a.js"), before + "\n// hand edit\n");

  assert.strictEqual(sync(root).status, 0);
  fs.appendFileSync(path.join(root, "shared/js/a.js"), "\n// source edit\n");
  const source = sync(root, ["--check"]);
  assert.strictEqual(source.status, 1);
  assert.match(source.stderr, /dev\/js\/a\.js/);
  assert.match(source.stderr, /prod\/js\/a\.js/);
});

test("sync is idempotent and the cache name follows the cached contents", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.strictEqual(sync(root).status, 0);
  const snapshot = () =>
    Object.fromEntries(
      [
        "dev/js/a.js",
        "dev/js/b.js",
        "dev/sw.js",
        "prod/js/a.js",
        "prod/sw.js",
      ].map((p) => [p, read(root, p)]),
    );
  const first = snapshot();
  const again = sync(root);
  assert.strictEqual(again.status, 0);
  assert.deepStrictEqual(snapshot(), first);
  assert.match(again.stdout, /Already up to date/);

  const before = /frankenstein-cms-([0-9a-f]{8})/.exec(
    read(root, "dev/sw.js"),
  )[1];
  fs.writeFileSync(
    path.join(root, "dev/css/style.css"),
    "body { color: red }\n",
  );
  assert.strictEqual(sync(root).status, 0);
  const after = /frankenstein-cms-([0-9a-f]{8})/.exec(
    read(root, "dev/sw.js"),
  )[1];
  assert.notStrictEqual(after, before);
});

test("shared/vendor files are copied and cached", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  put(root, "shared/vendor/water.css", "/* water */\n");

  assert.strictEqual(sync(root).status, 0);
  for (const env of ["dev", "prod"]) {
    assert.strictEqual(read(root, `${env}/vendor/water.css`), "/* water */\n");
    assert.ok(
      assetsOf(read(root, `${env}/sw.js`)).includes("./vendor/water.css"),
    );
  }
  assert.strictEqual(sync(root, ["--check"]).status, 0);
});
