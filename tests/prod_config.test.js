const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

const code = fs.readFileSync('prod/js/config.js', 'utf8');

function createSandbox() {
  const storage = {};
  const localStorage = {
    setItem: (key, value) => { storage[key] = value; },
    getItem: (key) => storage[key] !== undefined ? storage[key] : null,
    clear: () => { for (let key in storage) delete storage[key]; }
  };

  const CryptoJS = {
    AES: {
      encrypt: (data, pass) => {
        return {
          toString: () => JSON.stringify({ ciphertext: data, password: pass })
        };
      },
      decrypt: (ciphertext, pass) => {
        let parsed;
        try {
            parsed = JSON.parse(ciphertext);
        } catch (e) {
            return { toString: () => { throw new Error('Malformed'); } };
        }

        return {
          toString: (enc) => {
            if (pass !== parsed.password) {
                return "bad-data";
            }
            return parsed.ciphertext;
          }
        };
      }
    },
    enc: {
      Utf8: 'utf8'
    }
  };

  const context = {
    localStorage,
    CryptoJS,
    console,
    JSON,
    Error
  };

  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

test('encryptConfig stores encrypted data', () => {
  const sandbox = createSandbox();
  const conf = { foo: 'bar' };
  const pass = 'secret';
  const result = sandbox.encryptConfig(conf, pass);

  assert.strictEqual(result, true);
  const stored = sandbox.localStorage.getItem('frankenstein_encrypted_cfg');
  const parsed = JSON.parse(stored);
  assert.strictEqual(parsed.ciphertext, JSON.stringify(conf));
  assert.strictEqual(parsed.password, pass);
});

test('encryptConfig returns false on error', () => {
  const sandbox = createSandbox();
  sandbox.CryptoJS.AES.encrypt = () => { throw new Error('Encryption failed'); };

  const result = sandbox.encryptConfig({ a: 1 }, 'p');
  assert.strictEqual(result, false);
});

test('decryptConfig retrieves and decrypts data', () => {
  const sandbox = createSandbox();
  const conf = { foo: 'bar' };
  const pass = 'secret';

  sandbox.encryptConfig(conf, pass);
  const decrypted = sandbox.decryptConfig(pass);

  assert.deepStrictEqual(decrypted, conf);
});

test('decryptConfig returns null if no data in localStorage', () => {
  const sandbox = createSandbox();
  const result = sandbox.decryptConfig('any');
  assert.strictEqual(result, null);
});

test('decryptConfig returns null on wrong password', () => {
  const sandbox = createSandbox();
  sandbox.encryptConfig({ a: 1 }, 'right');

  const result = sandbox.decryptConfig('wrong');
  assert.strictEqual(result, null);
});

test('decryptConfig returns null if data is corrupted', () => {
    const sandbox = createSandbox();
    sandbox.localStorage.setItem('frankenstein_encrypted_cfg', 'garbage');
    const result = sandbox.decryptConfig('any');
    assert.strictEqual(result, null);
});
