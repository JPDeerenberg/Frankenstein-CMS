// Configuration and encryption management using Web Crypto API
let config = { token: "", owner: "", repo: "" };
const KEY_NAME = "frankenstein-key";
const DB_NAME = "FrankensteinDB";

function openKeyDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore("keys");
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB is blocked"));
  });
}

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// The AES key lives in IndexedDB as a non-extractable CryptoKey.
// NOTE: key generation must happen OUTSIDE any IndexedDB transaction —
// awaiting non-IndexedDB work inside one lets the transaction auto-commit,
// and the following put() then throws TransactionInactiveError (which used
// to leave the very first login hanging forever).
async function getCryptoKey() {
  const db = await openKeyDb();
  try {
    const existing = await idbRequest(
      db.transaction("keys", "readonly").objectStore("keys").get(KEY_NAME),
    );
    if (existing) return existing;

    const fresh = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    const tx = db.transaction("keys", "readwrite");
    const store = tx.objectStore("keys");
    // another tab may have created a key in the meantime: keep that one
    const raced = await idbRequest(store.get(KEY_NAME));
    if (raced) return raced;
    store.put(fresh, KEY_NAME);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return fresh;
  } finally {
    db.close();
  }
}

/** Forget the stored session (encrypted token + its key). */
function clearStoredConfig() {
  localStorage.removeItem("frankenstein_encrypted_cfg");
  try {
    indexedDB.deleteDatabase(DB_NAME);
  } catch (e) {
    // ignore: nothing else can be done
  }
}

async function encryptConfig(conf) {
  try {
    const key = await getCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(conf));

    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      encoded,
    );

    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    const b64 = btoa(String.fromCharCode(...combined));
    localStorage.setItem("frankenstein_encrypted_cfg", b64);
    return true;
  } catch (e) {
    console.error("Encryption failed", e);
    return false;
  }
}

async function decryptConfig() {
  try {
    const b64 = localStorage.getItem("frankenstein_encrypted_cfg");
    if (!b64) return null;

    const key = await getCryptoKey();
    const combined = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      ciphertext,
    );

    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch (e) {
    console.error("Decryption failed", e);
    return null;
  }
}
