/**
 * Frankenstein CMS — Cloudflare Worker bouncer
 * One file, no build step, no command line needed.
 *
 * WHAT IT DOES
 *   Clients log in to the CMS with an email + password. This Worker checks
 *   them, looks up which GitHub repo that email belongs to, and forwards the
 *   CMS's requests to GitHub using the site's token. Clients never see a token.
 *
 * ── SETUP (about 5 minutes, in the Cloudflare dashboard) ─────────────────────
 *  1. Workers & Pages → Create → Create Worker → name it "frankenstein-bouncer"
 *     → Deploy → Edit code → delete the sample, paste THIS WHOLE FILE → Deploy.
 *  2. Storage & Databases → KV → Create a namespace named "frankenstein-sites".
 *  3. Your Worker → Settings → Bindings → Add → KV namespace
 *     → variable name:  SITES   → pick "frankenstein-sites" → Deploy.
 *  4. (Optional) Settings → Variables and Secrets → add a SECRET named
 *     GITHUB_TOKEN: the token used by every site that has no "token" of its own.
 *  5. Put your Worker's URL (https://frankenstein-bouncer.<you>.workers.dev) in
 *     prod/frankenstein.config.json as "bouncerUrl". Open it in a browser: it
 *     should say "Frankenstein bouncer is running."
 *
 * ── ADDING / EDITING A SITE ──────────────────────────────────────────────────
 *  KV namespace → "frankenstein-sites" → Add entry.
 *    Key   = the client's login email, lowercase   e.g.  anna@bakery.com
 *    Value = JSON, copy this and edit it:
 *
 *    {
 *      "name": "Anna's Bakery",
 *      "password": "a-long-password-you-give-the-client",
 *      "owner": "your-github-username",
 *      "repo": "bakery-site"
 *    }
 *
 *  Add  "token": "github_pat_…"  to a site whose repo needs its own token
 *  (a repo that is not on your account). Sites without "token" use the
 *  GITHUB_TOKEN secret from step 4.
 *  Changes apply within about a minute (KV is cached briefly).
 *  Remove a client = delete their KV entry. Change a password = edit "password"
 *  (this also logs that client out everywhere).
 *
 * ── GOOD TO KNOW ─────────────────────────────────────────────────────────────
 *  • Passwords and tokens sit in your Cloudflare account (KV), not in the repo.
 *    Use a fine-grained GitHub token limited to the one repo (Contents: read &
 *    write) for each site.
 *  • Only what the CMS needs is allowed: repo info, files, commit history and
 *    git trees/blobs of THAT site's repo. Everything else on the GitHub API is
 *    refused (403), so a client can't use the Worker to reach anything else.
 *  • Passwords must be at least 12 characters (shorter ones are refused with a
 *    setup message). After 10 wrong attempts an address is refused for 15 minutes
 *    (best effort, per Worker instance). For a hard limit use your own domain +
 *    a Cloudflare rate-limiting rule and disable the workers.dev address: see
 *    SECURITY.md in the repository.
 *  • Clients can only write pages (.html) and PNG/JPG/GIF/WebP/AVIF/ICO images in
 *    img/; never .github/, scripts, configs or SVG.
 *  • Optional variable ALLOWED_ORIGIN = https://cms.your-domain.com restricts
 *    which website may call the Worker (default: any).
 *  • Troubleshooting: Worker → Logs shows errors. A 500 with a message
 *    ("Bouncer setup: …") tells you which setup step is missing.
 */

const SESSION_TTL_SEC = 8 * 60 * 60; // after login the password isn't re-sent for 8 hours

const MAX_BODY_BYTES = 8 * 1024 * 1024; // images are limited to 5 MB (+ base64)
const FAIL_LIMIT = 10;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 12;

// Failed-login throttle. Kept in memory of this Worker instance: a best-effort
// speed bump, NOT a guarantee (Cloudflare runs many instances). For a hard limit
// add a free "Rate limiting rule" in front of the Worker (see SECURITY.md) and
// use long random passwords.
const failures = new Map();

function isBlocked(ip) {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.first > FAIL_WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return f.count >= FAIL_LIMIT;
}

function recordFailure(ip) {
  const now = Date.now();
  const f = failures.get(ip);
  if (!f || now - f.first > FAIL_WINDOW_MS)
    failures.set(ip, { first: now, count: 1 });
  else f.count++;
  if (failures.size > 5000) failures.clear(); // keep memory bounded
}

// BOUNCER-GUARD-START
// Whitelist of GitHub requests the CMS may make through this bouncer.
// Mirrors github_request_allowed() in bouncer.php and the other bouncers
// (tests/bouncer.test.js keeps the implementations in sync).
// Files a client may WRITE: the pages the CMS edits (.html/.htm) and image
// uploads straight into img/. Never dotfiles/dot-folders (.github, .env …), never
// scripts, styles, configs, or SVG (it can carry scripts).
function isAllowedWritePath(parts) {
  if (parts.length === 0) return false;
  if (parts.some((p) => p.startsWith("."))) return false;
  const name = parts[parts.length - 1].toLowerCase();
  if (/\.html?$/.test(name)) return true;
  return (
    parts.length === 2 &&
    parts[0] === "img" &&
    /\.(png|jpe?g|gif|webp|avif|ico)$/.test(name)
  );
}

function isAllowedGithubRequest(method, rawPath, owner, repo) {
  method = String(method).toUpperCase();
  if (/[\x00-\x20\\]/.test(rawPath)) return false;
  const pathPart = rawPath.split("?")[0];
  const pathname = pathPart.startsWith("/") ? pathPart : "/" + pathPart;
  const segments = pathname.split("/").filter((s) => s !== "");
  const decoded = [];
  for (const s of segments) {
    let d = s;
    try {
      d = decodeURIComponent(s);
    } catch {
      d = s;
    }
    if (d === "." || d === ".." || d.includes("/") || d.includes("\\")) {
      return false;
    }
    decoded.push(d);
  }
  if (segments.length < 3 || segments[0] !== "repos") return false;
  if (owner && decoded[1].toLowerCase() !== owner.toLowerCase()) return false;
  if (repo && decoded[2].toLowerCase() !== repo.toLowerCase()) return false;
  const readOnly = method === "GET" || method === "HEAD";
  if (segments.length === 3) return readOnly;
  switch (segments[3]) {
    case "contents":
      return (
        readOnly || (method === "PUT" && isAllowedWritePath(decoded.slice(4)))
      );
    case "commits":
      return readOnly;
    case "git":
      return readOnly && (segments[4] === "blobs" || segments[4] === "trees");
    default:
      return false;
  }
}
// BOUNCER-GUARD-END

/* ---------- small helpers ---------- */

function corsHeaders(env) {
  const h = {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, HEAD, PUT, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Site-Email, Site-Password, Site-Session, Accept",
    "Access-Control-Expose-Headers":
      "X-Session-Token, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After",
  };
  if (env.ALLOWED_ORIGIN) h["Vary"] = "Origin";
  return h;
}

function reply(status, body, headers) {
  const isJson = typeof body !== "string";
  const h = new Headers(headers);
  h.set("Content-Type", isJson ? "application/json" : "text/plain");
  return new Response(isJson ? JSON.stringify(body) : body, {
    status,
    headers: h,
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = new TextEncoder();

function b64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToString(s) {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Constant-time string comparison (compares SHA-256 digests). */
async function safeEqual(a, b) {
  const [x, y] = await Promise.all(
    [a, b].map(
      async (v) =>
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", enc.encode(String(v))),
        ),
    ),
  );
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function hmac(payload, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload))),
  );
}

// Session tokens are signed with the site's password + token, so changing
// either one instantly invalidates every session of that site.
async function makeSessionToken(email, secret) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload = `${b64url(enc.encode(email))}.${b64url(enc.encode(String(exp)))}`;
  return `${payload}.${await hmac(payload, secret)}`;
}

async function verifySessionToken(token, email, secret) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return false;
  try {
    if (b64urlToString(parts[0]) !== email) return false;
    if (
      parseInt(b64urlToString(parts[1]), 10) < Math.floor(Date.now() / 1000)
    ) {
      return false;
    }
    return await safeEqual(
      await hmac(`${parts[0]}.${parts[1]}`, secret),
      parts[2],
    );
  } catch {
    return false;
  }
}

/* ---------- the Worker ---------- */

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      console.error("Bouncer exception:", err);
      return reply(
        500,
        { message: "Bouncer error: " + err.message },
        corsHeaders(env),
      );
    }
  },
};

async function handle(request, env) {
  const cors = corsHeaders(env);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const path = url.searchParams.get("path");

  // Opening the Worker URL in a browser = quick "is it deployed?" check
  if (!action && !path)
    return reply(200, "Frankenstein bouncer is running.", cors);

  const email = (request.headers.get("Site-Email") || "").trim().toLowerCase();
  if (!email) return reply(400, "Missing Site-Email", cors);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (isBlocked(ip)) {
    return reply(429, "Too many failed attempts. Try again in a few minutes.", {
      ...cors,
      "Retry-After": "900",
    });
  }

  if (!env.SITES) {
    return reply(
      500,
      {
        message:
          'Bouncer setup: bind the KV namespace to this Worker with the variable name "SITES".',
      },
      cors,
    );
  }

  let site = null;
  try {
    site = await env.SITES.get(email, { type: "json", cacheTtl: 60 });
  } catch {
    return reply(
      500,
      {
        message:
          "Bouncer setup: the KV entry for this email is not valid JSON.",
      },
      cors,
    );
  }

  const token = site && (site.token || env.GITHUB_TOKEN);
  const secret = site && site.password ? `${site.password}:${token || ""}` : "";

  // --- authenticate (session token first, then password) ---
  const session = request.headers.get("Site-Session");
  const password = request.headers.get("Site-Password");
  let authenticated = false;
  let issueSession = false;
  if (site && site.password) {
    if (session && (await verifySessionToken(session, email, secret))) {
      authenticated = true;
    } else if (password && (await safeEqual(password, site.password))) {
      authenticated = true;
      issueSession = true;
    }
  }
  if (!authenticated) {
    recordFailure(ip);
    // slows down password guessing
    await sleep(
      env.AUTH_FAIL_DELAY_MS !== undefined
        ? Number(env.AUTH_FAIL_DELAY_MS)
        : 1500,
    );
    return reply(401, "Unauthorized: Incorrect credentials", cors);
  }

  failures.delete(ip);

  // --- the login is valid; now check the site entry is complete ---
  if (String(site.password).length < MIN_PASSWORD_LENGTH) {
    return reply(
      500,
      {
        message: `Bouncer setup: this site's password is shorter than ${MIN_PASSWORD_LENGTH} characters. Use a long random one.`,
      },
      cors,
    );
  }
  for (const field of ["owner", "repo"]) {
    if (!site[field]) {
      return reply(
        500,
        { message: `Bouncer setup: this site's KV entry has no "${field}".` },
        cors,
      );
    }
  }
  if (!token) {
    return reply(
      500,
      {
        message:
          'Bouncer setup: no GitHub token for this site. Add "token" to its KV entry or set the GITHUB_TOKEN secret.',
      },
      cors,
    );
  }

  const headers = new Headers(cors);
  if (issueSession)
    headers.set("X-Session-Token", await makeSessionToken(email, secret));

  // The CMS asks "which site am I?" right after login, so it needs no per-site config.
  if (action === "site") {
    return reply(
      200,
      { name: site.name || "", owner: site.owner, repo: site.repo },
      headers,
    );
  }

  if (!path) return reply(400, { message: "Missing path" }, headers);

  if (!isAllowedGithubRequest(request.method, path, site.owner, site.repo)) {
    return reply(
      403,
      { message: "Bouncer: this request is not allowed." },
      headers,
    );
  }

  // --- forward to GitHub (headers built from scratch: no browser headers leak) ---
  const upstream = new Headers({
    Authorization: `Bearer ${token}`,
    // raw file requests (CSS, images) depend on the client's Accept header
    Accept: request.headers.get("Accept") || "application/vnd.github+json",
    "User-Agent": "Frankenstein-CMS-Cloudflare-Bouncer",
  });
  const contentType = request.headers.get("Content-Type");
  if (contentType) upstream.set("Content-Type", contentType);

  const init = { method: request.method, headers: upstream };
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY_BYTES) {
      return reply(413, { message: "Request too large." }, headers);
    }
    init.body = await request.arrayBuffer();
    if (init.body.byteLength > MAX_BODY_BYTES) {
      return reply(413, { message: "Request too large." }, headers);
    }
  }

  const res = await fetch(
    `https://api.github.com${path.startsWith("/") ? path : "/" + path}`,
    init,
  );

  // ETag/Content-Length are deliberately not copied: the same URL serves both
  // JSON and raw files, and the runtime sets the length itself.
  for (const h of [
    "Content-Type",
    "X-RateLimit-Remaining",
    "X-RateLimit-Reset",
    "Retry-After",
  ]) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers });
}
