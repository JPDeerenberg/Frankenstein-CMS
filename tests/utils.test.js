const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('vm');

test('utils.js base64 encoding/decoding tests', async (t) => {
  const code = fs.readFileSync('dev/js/utils.js', 'utf8');

  // Polyfills for browser APIs used in utils.js
  const sandbox = {
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
    TextEncoder: TextEncoder,
    TextDecoder: TextDecoder,
    Uint8Array: Uint8Array,
    String: String,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  await t.test('utf8ToBase64 correctly encodes standard ascii text', () => {
    const input = 'Hello World';
    const expected = Buffer.from(input, 'utf8').toString('base64');
    const result = sandbox.utf8ToBase64(input);
    assert.strictEqual(result, expected);
  });

  await t.test('utf8ToBase64 correctly encodes utf-8 text (emojis and accents)', () => {
    const input = 'Café ☕ 🔥 👨‍👩‍👧‍👦';
    const expected = Buffer.from(input, 'utf8').toString('base64');
    const result = sandbox.utf8ToBase64(input);
    assert.strictEqual(result, expected);
  });

  await t.test('base64ToUtf8 correctly decodes standard ascii text', () => {
    const input = Buffer.from('Hello World', 'utf8').toString('base64');
    const expected = 'Hello World';
    const result = sandbox.base64ToUtf8(input);
    assert.strictEqual(result, expected);
  });

  await t.test('base64ToUtf8 correctly decodes utf-8 text (emojis and accents)', () => {
    const expected = 'Café ☕ 🔥 👨‍👩‍👧‍👦';
    const input = Buffer.from(expected, 'utf8').toString('base64');
    const result = sandbox.base64ToUtf8(input);
    assert.strictEqual(result, expected);
  });

  await t.test('utf8ToBase64 chunking handles large inputs efficiently', () => {
    const largeStr = "A".repeat(100000);
    const expected = Buffer.from(largeStr, 'utf8').toString('base64');
    const result = sandbox.utf8ToBase64(largeStr);
    assert.strictEqual(result, expected);
  });
});
