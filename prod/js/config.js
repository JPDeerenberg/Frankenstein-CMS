// Configuration and encryption management
let config = { bouncerUrl: "", owner: "", repo: "" };

// Use native Web Crypto API to avoid heavy CryptoJS dependency
async function getCryptoKey(password) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  // Using a fixed salt for simplicity since it's local storage only, 
  // but ideally a random salt should be generated and stored with the ciphertext.
  const salt = enc.encode("frankenstein-salt");
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptConfig(conf, password) {
  try {
    const key = await getCryptoKey(password);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(conf));

    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      encoded
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

async function decryptConfig(password) {
  try {
    const b64 = localStorage.getItem("frankenstein_encrypted_cfg");
    if (!b64) return null;

    const key = await getCryptoKey(password);
    const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      ciphertext
    );

    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch (e) {
    console.error("Decryption failed", e);
    return null;
  }
}
