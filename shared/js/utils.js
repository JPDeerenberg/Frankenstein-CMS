// Utility functions for encoding, decoding, and general helpers

/**
 * Decode base64 to a UTF-8 string. Returns null on failure.
 * With `fatal` set, invalid UTF-8 also returns null instead of silently
 * inserting U+FFFD (which would corrupt the file on the next save).
 */
function base64ToUtf8(b64, fatal) {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const dec = new TextDecoder("utf-8", { fatal: !!fatal });
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

/** GitHub owner / repo names: letters, digits, dot, dash, underscore; never "." or "..". */
function isValidRepoName(s) {
  return (
    typeof s === "string" &&
    /^[A-Za-z0-9_.-]{1,100}$/.test(s) &&
    s !== "." &&
    s !== ".."
  );
}

/** Credentials may only travel over https (or to localhost while developing). */
function isSafeBouncerUrl(u) {
  try {
    const x = new URL(u);
    if (x.username || x.password) return false;
    if (x.protocol === "https:") return true;
    return (
      x.protocol === "http:" &&
      (x.hostname === "localhost" ||
        x.hostname === "127.0.0.1" ||
        x.hostname === "[::1]")
    );
  } catch (e) {
    return false;
  }
}

/** Escape text for safe use inside HTML. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Percent-encode every segment of a repo path (spaces, #, ?, unicode…). */
function encodePath(path) {
  return String(path || "")
    .split("/")
    .filter(function (seg) {
      return seg.length > 0;
    })
    .map(encodeURIComponent)
    .join("/");
}

function safeDecode(str) {
  try {
    return decodeURIComponent(str);
  } catch (e) {
    return str;
  }
}

function stripQueryHash(url) {
  return String(url).split(/[?#]/)[0];
}

/** Path of `target` relative to the directory `fromDir` (both repo-root based). */
function relativePath(fromDir, target) {
  const from = fromDir ? fromDir.split("/").filter(Boolean) : [];
  const to = String(target).split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const up = [];
  for (let j = i; j < from.length; j++) up.push("..");
  return up.concat(to.slice(i)).join("/");
}

const MIME_BY_EXT = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
};

/** GitHub serves some raw files as text/plain; trust the extension for images. */
function guessMimeType(path, headerType) {
  const m = /\.([a-z0-9]+)$/i.exec(stripQueryHash(path));
  const byExt = m ? MIME_BY_EXT[m[1].toLowerCase()] : null;
  if (byExt) return byExt;
  return headerType || "application/octet-stream";
}

/** Rewrite relative url(...) / @import in fetched CSS so it resolves against the file's real URL. */
function absolutizeCssUrls(css, baseHref) {
  if (!css || !baseHref) return css;
  const fix = function (target) {
    const t = target.trim();
    if (!t || /^(data:|blob:|#|https?:|\/\/)/i.test(t)) return target;
    try {
      return new URL(t, baseHref).href;
    } catch (e) {
      return target;
    }
  };
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (m, q, u) {
      return "url(" + q + fix(u) + q + ")";
    })
    .replace(/@import\s+(['"])([^'"]+)\1/gi, function (m, q, u) {
      return "@import " + q + fix(u) + q;
    });
}

const SKIP_DIRS = new Set([
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

/** True when any directory in the path is one the file list should hide. */
function isSkippedPath(path) {
  const parts = String(path).split("/");
  for (let i = 0; i < parts.length - 1; i++) {
    if (SKIP_DIRS.has(parts[i])) return true;
  }
  return false;
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

  const apiPath = path
    ? `/repos/${config.owner}/${config.repo}/contents/${encodePath(path)}`
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
      if (SKIP_DIRS.has(item.name)) continue;
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
          // Try a direct fetch so body/html rules can be scoped; if the CDN
          // blocks CORS (or CSP), fall back to a plain <link> in the preview.
          try {
            const r = await fetchWithRetry(href, { mode: "cors" });
            if (r.ok) css = absolutizeCssUrls(await r.text(), href);
          } catch (e) {
            css = null;
          }
          if (!css) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = href;
            shadow.appendChild(link);
            return;
          }
        } else {
          const resolvedHref = resolvePath(
            currentDir,
            safeDecode(stripQueryHash(href)),
          );
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
    if (!src || /^(https?:|data:|blob:|\/\/)/i.test(src)) return;
    img.setAttribute("data-original-src", src);

    const resolvedSrc = resolvePath(
      currentDir,
      safeDecode(stripQueryHash(src)),
    );
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
 * Add scoped copies of the page's <style> tags to the preview.
 * The originals are left untouched on purpose: body/html selectors are
 * rewritten only in the copies, so they can never leak into a saved file.
 */
function injectScopedInlineStyles(doc, shadow, pageWrapper) {
  const sources = [];
  doc.head.querySelectorAll("style").forEach(function (s) {
    sources.push(s.textContent);
  });
  if (pageWrapper) {
    pageWrapper.querySelectorAll("style").forEach(function (s) {
      sources.push(s.textContent);
    });
  }
  sources.forEach(function (css) {
    const copy = document.createElement("style");
    copy.textContent = scopeCssToCms(css);
    shadow.appendChild(copy);
  });
}
