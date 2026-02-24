// Configuration and encryption management using Web Crypto API
let config = { token: "", owner: "", repo: "" };
const KEY_NAME = "frankenstein-key";
const DB_NAME = "FrankensteinDB";

async function getCryptoKey() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore("keys");
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const transaction = db.transaction("keys", "readwrite");
      const store = transaction.objectStore("keys");
      const getRequest = store.get(KEY_NAME);

      getRequest.onsuccess = async () => {
        if (getRequest.result) {
          resolve(getRequest.result);
        } else {
          const key = await crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"],
          );
          store.put(key, KEY_NAME);
          resolve(key);
        }
      };
    };
    request.onerror = (e) => reject(e);
  });
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
