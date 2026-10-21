const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("crypto");

let indexedDBLib = null;
try {
  indexedDBLib = require("fake-indexeddb");
} catch (e) {
  // optional dev dependency: run `npm install`
}
const maybe = indexedDBLib ? test : test.skip;

const code = fs.readFileSync(
  process.env.CONFIG_JS || path.join(__dirname, "../dev/js/config.js"),
  "utf8",
);

/**
 * A fresh "browser profile". generateKey resolves one macrotask later, like
 * real browsers (Node's resolves almost instantly, which hides the bug).
 */
function newBrowser(idb, storage) {
  const subtle = {
    generateKey: (...a) =>
      new Promise((r) => setTimeout(r, 5)).then(() =>
        webcrypto.subtle.generateKey(...a),
      ),
    encrypt: (...a) => webcrypto.subtle.encrypt(...a),
    decrypt: (...a) => webcrypto.subtle.decrypt(...a),
  };
  const ctx = {
    indexedDB: idb,
    crypto: {
      subtle,
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
    },
    TextEncoder,
    TextDecoder,
    Uint8Array,
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => (storage[k] = String(v)),
      removeItem: (k) => delete storage[k],
    },
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (b) => Buffer.from(b, "base64").toString("binary"),
    console: { error() {}, log() {}, warn() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

const withTimeout = (p, ms = 2000) =>
  Promise.race([
    p,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error("timed out (hung)")), ms),
    ),
  ]);

maybe(
  "first login on a fresh browser does not hang and the session survives a reload",
  async () => {
    const { IDBFactory } = indexedDBLib;
    const idb = new IDBFactory();
    const storage = {};

    const page1 = newBrowser(idb, storage);
    const ok = await withTimeout(
      page1.encryptConfig({ token: "ghp_abc", owner: "o", repo: "r" }),
    );
    assert.strictEqual(ok, true);

    // "reload": new page context, same IndexedDB + localStorage
    const page2 = newBrowser(idb, storage);
    const restored = await withTimeout(page2.decryptConfig());
    assert.deepStrictEqual(JSON.parse(JSON.stringify(restored)), {
      token: "ghp_abc",
      owner: "o",
      repo: "r",
    });
  },
);

maybe(
  "two tabs creating the key at the same time end up with one shared key",
  async () => {
    const { IDBFactory } = indexedDBLib;
    const idb = new IDBFactory();
    const storage = {};
    const a = newBrowser(idb, storage);
    const b = newBrowser(idb, storage);
    await withTimeout(
      Promise.all([a.encryptConfig({ n: 1 }), b.encryptConfig({ n: 2 })]),
    );
    // whichever wrote last must still be decryptable by a third page
    const c = newBrowser(idb, storage);
    const restored = await withTimeout(c.decryptConfig());
    assert.ok(restored && (restored.n === 1 || restored.n === 2));
  },
);

maybe("clearStoredConfig removes the encrypted session", async () => {
  const { IDBFactory } = indexedDBLib;
  const idb = new IDBFactory();
  const storage = {};
  const page = newBrowser(idb, storage);
  await withTimeout(page.encryptConfig({ token: "x" }));
  assert.ok(storage.frankenstein_encrypted_cfg);
  page.clearStoredConfig();
  assert.strictEqual(storage.frankenstein_encrypted_cfg, undefined);
});
