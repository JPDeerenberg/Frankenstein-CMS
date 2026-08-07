const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const code = fs.readFileSync('prod/js/config.js', 'utf8');

function createSandbox() {
  const storage = {};
  const localStorage = {
    setItem: (key, value) => { storage[key] = value; },
    getItem: (key) => storage[key] !== undefined ? storage[key] : null,
    clear: () => { for (let key in storage) delete storage[key]; }
  };

  const context = {
    localStorage,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    console,
    JSON,
    Error,
    String
  };

  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

test('encryptConfig stores encrypted data', async () => {
  const sandbox = createSandbox();
  const conf = { foo: 'bar' };
  const pass = 'secret';
  const result = await sandbox.encryptConfig(conf, pass);

  assert.strictEqual(result, true);
  const stored = sandbox.localStorage.getItem('frankenstein_encrypted_cfg');
  assert.ok(stored);
});

test('encryptConfig returns false on error', async () => {
  const sandbox = createSandbox();
  sandbox.crypto = {
    ...webcrypto,
    subtle: {
      ...webcrypto.subtle,
      encrypt: () => { throw new Error('Encryption failed'); }
    }
  };

  const result = await sandbox.encryptConfig({ a: 1 }, 'p');
  assert.strictEqual(result, false);
});

test('decryptConfig retrieves and decrypts data', async () => {
  const sandbox = createSandbox();
  const conf = { foo: 'bar' };
  const pass = 'secret';

  await sandbox.encryptConfig(conf, pass);
  const decrypted = await sandbox.decryptConfig(pass);

  assert.deepStrictEqual(decrypted, conf);
});

test('decryptConfig returns null if no data in localStorage', async () => {
  const sandbox = createSandbox();
  const result = await sandbox.decryptConfig('any');
  assert.strictEqual(result, null);
});

test('decryptConfig returns null on wrong password', async () => {
  const sandbox = createSandbox();
  await sandbox.encryptConfig({ a: 1 }, 'right');

  const result = await sandbox.decryptConfig('wrong');
  assert.strictEqual(result, null);
});

test('decryptConfig returns null if data is corrupted', async () => {
    const sandbox = createSandbox();
    sandbox.localStorage.setItem('frankenstein_encrypted_cfg', 'garbage');
    const result = await sandbox.decryptConfig('any');
    assert.strictEqual(result, null);
});
