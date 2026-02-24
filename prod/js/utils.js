// Utility functions for encoding, decoding, and general helpers

function base64ToUtf8(b64) {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dec = new TextDecoder();
    return dec.decode(bytes);
  } catch (e) {
    return null;
  }
}

function utf8ToBase64(str) {
  try {
    const enc = new TextEncoder();
    const bytes = enc.encode(str);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++)
      binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } catch (e) {
    return null;
  }
}

function debounce(fn, wait) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function resolvePath(base, rel) {
  if (rel.startsWith("/")) return rel.substring(1);
  const stack = base ? base.split("/").filter((p) => p.length) : [];
  rel.split("/").forEach((p) => {
    if (p == "..") {
      if (stack.length) stack.pop();
    } else if (p != "." && p != "") stack.push(p);
  });
  return stack.join("/");
}
