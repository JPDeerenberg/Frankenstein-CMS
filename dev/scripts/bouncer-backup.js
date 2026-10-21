#!/usr/bin/env node
/**
 * Frankenstein CMS - Backup Bouncer (Node.js)
 *
 * A fallback for the primary bouncer (PHP / Supabase). Run it locally or on
 * any server with Node.js. The GitHub token stays on this machine.
 *
 * Single tenant:
 *   export GITHUB_TOKEN=ghp_YOUR_TOKEN
 *   export CLIENT_EMAIL=admin@yoursite.com
 *   export CLIENT_PASSWORD=your-secure-password
 *   export GITHUB_OWNER=your-user GITHUB_REPO=your-repo   # recommended
 *   node bouncer-backup.js
 *
 * Multi tenant: create clients.json
 *   {
 *     "user1@example.com": { "password": "pass1", "github_token": "ghp_1",
 *                            "github_owner": "user1", "github_repo": "site1" }
 *   }
 *   export CONFIG_FILE=clients.json
 *   node bouncer-backup.js
 *
 * Optional: ALLOWED_ORIGIN=https://cms.example.com restricts CORS (default *).
 * Only the GitHub endpoints the CMS needs are proxied.
 */

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// BOUNCER-GUARD-START
// Whitelist of GitHub requests the CMS may make through this bouncer.
// Mirrors github_request_allowed() in bouncer.php and the Supabase function
// (tests/bouncer.test.js keeps the implementations in sync).
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
      return readOnly || method === "PUT";
    case "commits":
      return readOnly;
    case "git":
      return readOnly && (segments[4] === "blobs" || segments[4] === "trees");
    default:
      return false;
  }
}
// BOUNCER-GUARD-END

/** Constant-time string comparison. */
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function loadClients(env) {
  let clients = {};
  if (env.CONFIG_FILE) {
    const configPath = path.resolve(env.CONFIG_FILE);
    if (fs.existsSync(configPath)) {
      try {
        clients = JSON.parse(fs.readFileSync(configPath, "utf8"));
        console.log(
          `Loaded ${Object.keys(clients).length} clients from ${configPath}`,
        );
      } catch (e) {
        console.error("Error parsing config file:", e.message);
      }
    } else {
      console.error("Config file not found:", configPath);
    }
  }
  return clients;
}

function createServer(env, clients) {
  const allowedOrigin = env.ALLOWED_ORIGIN || "*";
  const failDelayMs =
    env.AUTH_FAIL_DELAY_MS !== undefined
      ? Number(env.AUTH_FAIL_DELAY_MS)
      : 2000;
  const single = {
    email: env.CLIENT_EMAIL,
    password: env.CLIENT_PASSWORD,
    token: env.GITHUB_TOKEN,
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
  };

  return http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    if (allowedOrigin !== "*") res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, PUT, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Site-Email, Site-Password, Site-Session, Accept",
    );
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-Session-Token, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After",
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsed = new URL(req.url, "http://localhost");
    const githubPath =
      parsed.searchParams.get("path") ||
      parsed.pathname.replace(/^\/proxy/, "");

    if (!githubPath || githubPath === "/") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Bouncer active. Use ?path=/repos/owner/repo to proxy.");
      return;
    }

    const clientEmail = req.headers["site-email"];
    const clientPassword = req.headers["site-password"];

    let tenant = single;
    if (
      clientEmail &&
      Object.prototype.hasOwnProperty.call(clients, clientEmail)
    ) {
      const c = clients[clientEmail];
      tenant = {
        email: clientEmail,
        password: c.password,
        token: c.github_token,
        owner: c.github_owner,
        repo: c.github_repo,
      };
    }

    if (!tenant.email || !tenant.password || !tenant.token) {
      res.writeHead(500);
      res.end("Bouncer misconfigured: Missing credentials for this user.");
      return;
    }

    if (
      !clientEmail ||
      !clientPassword ||
      !safeEqual(clientEmail, tenant.email) ||
      !safeEqual(clientPassword, tenant.password)
    ) {
      console.warn(`Unauthorized access attempt for ${clientEmail}`);
      setTimeout(() => {
        res.writeHead(401);
        res.end("Unauthorized: Incorrect Email or Password");
      }, failDelayMs); // artificial delay slows down password guessing
      return;
    }

    if (
      !isAllowedGithubRequest(req.method, githubPath, tenant.owner, tenant.repo)
    ) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ message: "Bouncer: this request is not allowed." }),
      );
      return;
    }

    const headers = {
      Authorization: `Bearer ${tenant.token}`,
      // forward Accept: raw file requests (CSS, images) need it
      Accept: req.headers["accept"] || "application/vnd.github+json",
      "User-Agent": "Frankenstein-CMS-Backup-Bouncer",
    };
    if (req.headers["content-type"]) {
      headers["Content-Type"] = req.headers["content-type"];
    }

    const proxyReq = https.request(
      {
        hostname: "api.github.com",
        path: githubPath.startsWith("/") ? githubPath : `/${githubPath}`,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        const keep = [
          "content-type",
          "content-length",
          "etag",
          "x-ratelimit-remaining",
          "x-ratelimit-reset",
          "retry-after",
        ];
        const resHeaders = {};
        keep.forEach((h) => {
          if (proxyRes.headers[h]) resHeaders[h] = proxyRes.headers[h];
        });
        res.writeHead(proxyRes.statusCode, resHeaders);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on("error", (e) => {
      console.error("Proxy error:", e.message);
      res.writeHead(502);
      res.end(`Bouncer error: ${e.message}`);
    });

    req.pipe(proxyReq);
  });
}

module.exports = {
  isAllowedGithubRequest,
  safeEqual,
  createServer,
  loadClients,
};

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const server = createServer(process.env, loadClients(process.env));
  server.listen(PORT, () => {
    console.log(
      `\n🚀 Frankenstein Backup Bouncer running on http://localhost:${PORT}`,
    );
    console.log(
      `Fallback mode active. Put this URL in backupBouncerUrl of frankenstein.config.json.`,
    );
  });
}
