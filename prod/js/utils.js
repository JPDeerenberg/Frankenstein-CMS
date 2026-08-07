// Utility functions for encoding, decoding, and general helpers

function base64ToUtf8(b64) {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
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
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + chunkSize),
      );
    }
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
  const parts = rel.split("/");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p == "..") {
      if (stack.length) stack.pop();
    } else if (p != "." && p != "") stack.push(p);
  }
  return stack.join("/");
}

/**
 * Scope CSS so body/html selectors target the CMS content wrapper
 * instead of the real document body. Handles body.class, body:hover,
 * html, and comma-separated selector lists.
 */
function scopeCssToCms(css, scopeSelector) {
  if (!css || typeof css !== "string") return css;
  const scope = scopeSelector || "#cms-page-content";

  return css.replace(
    /(^|[\s,}])((?:body|html)(?:\.[^\s,{.:#[>+~]*)?(?::[^\s,{]*)?)(?=[\s,{.:#[>+~]|$)/gi,
    function (match, prefix, selector) {
      if (selector.indexOf(scope) !== -1) return match;
      return prefix + scope;
    },
  );
}

/**
 * Fetch with automatic retry on GitHub rate limits (429) and
 * secondary rate-limit style 403s. Uses Retry-After when present.
 */
async function fetchWithRetry(input, init, maxRetries) {
  maxRetries = typeof maxRetries === "number" ? maxRetries : 3;
  let lastRes = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    lastRes = await fetch(input, init);

    const isRateLimited =
      lastRes.status === 429 ||
      (lastRes.status === 403 &&
        lastRes.headers.get("X-RateLimit-Remaining") === "0");

    if (!isRateLimited) return lastRes;
    if (attempt === maxRetries) return lastRes;

    const retryAfter = lastRes.headers.get("Retry-After");
    let waitMs;
    if (retryAfter) {
      const asNum = parseInt(retryAfter, 10);
      waitMs = isNaN(asNum)
        ? Math.max(0, new Date(retryAfter).getTime() - Date.now())
        : asNum * 1000;
      if (!waitMs || waitMs < 0) waitMs = 2000;
    } else {
      waitMs = Math.min(1000 * Math.pow(2, attempt), 16000);
    }
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return lastRes;
}

/** Simple insertion-order LRU for the resource cache */
const RESOURCE_CACHE_MAX = 80;

function cacheSet(map, key, value) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > RESOURCE_CACHE_MAX) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

function cacheClear(map) {
  map.clear();
}

/**
 * Recursively list HTML files under a repo path.
 * @param {function} fetchFn - async (apiPath) => Response
 * @param {string} path
 * @param {number} depth
 * @param {number} maxDepth
 */
async function listHtmlFilesRecursive(fetchFn, path, depth, maxDepth) {
  depth = depth || 0;
  maxDepth = typeof maxDepth === "number" ? maxDepth : 4;

  const skipDirs = new Set([
    ".git",
    "node_modules",
    ".github",
    "dist",
    "build",
    ".next",
    "vendor",
    "prod",
    "dev",
  ]);

  const apiPath = path
    ? `/repos/${config.owner}/${config.repo}/contents/${path}`
    : `/repos/${config.owner}/${config.repo}/contents/`;

  const res = await fetchFn(apiPath);
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Failed to list files at "${path || "/"}" (${res.status})`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) return [];

  const files = [];
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (item.type === "file" && /\.html?$/i.test(item.name)) {
      files.push({ name: item.path, path: item.path });
    } else if (item.type === "dir" && depth < maxDepth) {
      if (skipDirs.has(item.name)) continue;
      const nested = await listHtmlFilesRecursive(
        fetchFn,
        item.path,
        depth + 1,
        maxDepth,
      );
      for (let j = 0; j < nested.length; j++) files.push(nested[j]);
    }
  }
  return files;
}

/**
 * Shared stylesheet loader used by both dev and prod.
 * - Relative paths: fetched via fetchRaw (GitHub API / bouncer)
 * - Absolute http(s) URLs: fetched directly (CORS); skipped on failure
 *
 * @param {object} opts
 * @param {Document} opts.doc
 * @param {ShadowRoot} opts.shadow
 * @param {string} opts.currentDir
 * @param {Map} opts.resourceCache
 * @param {function} opts.fetchRaw - async (resolvedPath) => string|null
 * @returns {Promise[]} array of load promises
 */
function collectStylesheetPromises(opts) {
  const doc = opts.doc;
  const shadow = opts.shadow;
  const currentDir = opts.currentDir;
  const resourceCache = opts.resourceCache;
  const fetchRaw = opts.fetchRaw;
  const promises = [];

  const links = doc.querySelectorAll('link[rel="stylesheet"]');
  links.forEach(function (l) {
    const href = l.getAttribute("href");
    if (!href) return;

    const isExternal = /^https?:\/\//i.test(href);

    const p = (async function () {
      try {
        let css = null;

        if (isExternal) {
          // Policy: try direct fetch (many CDNs allow CORS). Fail soft.
          try {
            const r = await fetchWithRetry(href, { mode: "cors" });
            if (r.ok) css = await r.text();
          } catch (e) {
            console.warn("External stylesheet blocked or failed:", href, e);
            return;
          }
        } else {
          const resolvedHref = resolvePath(currentDir, href);
          if (resourceCache.has(resolvedHref)) {
            css = await resourceCache.get(resolvedHref);
          } else {
            const fetchPromise = (async function () {
              try {
                return await fetchRaw(resolvedHref);
              } catch (e) {
                resourceCache.delete(resolvedHref);
                return null;
              }
            })();
            cacheSet(resourceCache, resolvedHref, fetchPromise);
            css = await fetchPromise;
            if (css === null) resourceCache.delete(resolvedHref);
          }
        }

        if (!css) return;
        css = scopeCssToCms(css);
        const s = document.createElement("style");
        s.textContent = css;
        shadow.appendChild(s);
      } catch (e) {
        console.error("Could not load CSS:", href, e);
      }
    })();
    promises.push(p);
  });

  return promises;
}

/**
 * Shared image reanimation loader used by both dev and prod.
 * Relative images are fetched as raw binaries and turned into data URLs.
 *
 * @returns {Promise[]}
 */
function collectImagePromises(opts) {
  const pageWrapper = opts.pageWrapper;
  const currentDir = opts.currentDir;
  const resourceCache = opts.resourceCache;
  const fetchRawBinary = opts.fetchRawBinary; // async (path) => dataUrl|null
  const promises = [];

  const imgs = pageWrapper.querySelectorAll("img");
  imgs.forEach(function (img) {
    const src = img.getAttribute("src");
    if (!src || /^https?:\/\//i.test(src)) return;
    img.setAttribute("data-original-src", src);

    const resolvedSrc = resolvePath(currentDir, src);
    const p = (async function () {
      try {
        if (resourceCache.has(resolvedSrc)) {
          const cachedSrc = await resourceCache.get(resolvedSrc);
          if (cachedSrc) img.src = cachedSrc;
          return;
        }
        const fetchPromise = (async function () {
          try {
            return await fetchRawBinary(resolvedSrc);
          } catch (e) {
            resourceCache.delete(resolvedSrc);
            return null;
          }
        })();
        cacheSet(resourceCache, resolvedSrc, fetchPromise);
        const newSrc = await fetchPromise;
        if (newSrc === null) {
          resourceCache.delete(resolvedSrc);
          return;
        }
        img.src = newSrc;
      } catch (e) {
        console.error("Image load failed", src, e);
      }
    })();
    promises.push(p);
  });

  return promises;
}

/**
 * Inject scoped <style> tags from a source document into the shadow root.
 */
function injectScopedInlineStyles(doc, shadow, pageWrapper) {
  doc.head.querySelectorAll("style").forEach(function (s) {
    const newStyle = document.createElement("style");
    newStyle.textContent = scopeCssToCms(s.textContent);
    shadow.appendChild(newStyle);
  });
  if (pageWrapper) {
    pageWrapper.querySelectorAll("style").forEach(function (s) {
      s.textContent = scopeCssToCms(s.textContent);
    });
  }
}
