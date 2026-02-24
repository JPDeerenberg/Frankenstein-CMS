#!/usr/bin/env node
/**
 * Frankenstein CMS - Backup Bouncer (Node.js)
 *
 * This script provides a fallback for the Cloudflare Worker bouncer.
 * It can be run locally or on any server with Node.js.
 *
 * Usage:
 * export GITHUB_TOKEN=ghp_YOUR_TOKEN
 * export CLIENT_EMAIL=admin@yoursite.com
 * export CLIENT_PASSWORD=your-secure-password
 * node bouncer-backup.js
 *
 * Multi-tenant usage:
 * Create a 'clients.json' file:
 * {
 *   "user1@example.com": { "password": "pass1", "github_token": "ghp_1" },
 *   "user2@example.com": { "password": "pass2", "github_token": "ghp_2" }
 * }
 * export CONFIG_FILE=clients.json
 * node bouncer-backup.js
 */

const http = require("http");
const https = require("https");
const url = require("url");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const SINGLE_TENANT = {
  email: process.env.CLIENT_EMAIL,
  password: process.env.CLIENT_PASSWORD,
  token: process.env.GITHUB_TOKEN,
};

let clients = {};
if (process.env.CONFIG_FILE) {
  const configPath = path.resolve(process.env.CONFIG_FILE);
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

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, HEAD, POST, OPTIONS, PUT, DELETE, PATCH",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Site-Email, Site-Password, Accept",
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const githubPath =
    parsedUrl.query.path || parsedUrl.pathname.replace(/^\/proxy/, "");

  if (!githubPath || githubPath === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bouncer active. Use ?path=/repos/owner/repo to proxy.");
    return;
  }

  const clientEmail = req.headers["site-email"];
  const clientPassword = req.headers["site-password"];

  let allowedEmail = SINGLE_TENANT.email;
  let allowedPassword = SINGLE_TENANT.password;
  let token = SINGLE_TENANT.token;

  // Check multi-tenant config
  if (clients[clientEmail]) {
    allowedEmail = clientEmail;
    allowedPassword = clients[clientEmail].password;
    token = clients[clientEmail].github_token;
  }

  if (!allowedEmail || !allowedPassword || !token) {
    res.writeHead(500);
    res.end("Bouncer misconfigured: Missing credentials for this user.");
    return;
  }

  if (clientEmail !== allowedEmail || clientPassword !== allowedPassword) {
    console.warn(`Unauthorized access attempt for ${clientEmail}`);
    setTimeout(() => {
      res.writeHead(401);
      res.end("Unauthorized: Incorrect Email or Password");
    }, 2000); // Artificial delay
    return;
  }

  // Proxy to GitHub
  const safePath = githubPath.startsWith("/") ? githubPath : `/${githubPath}`;
  const options = {
    hostname: "api.github.com",
    path: safePath,
    method: req.method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Frankenstein-CMS-Backup-Bouncer",
    },
  };

  // Remove headers that might cause issues with GitHub
  const forbiddenHeaders = [
    "site-email",
    "site-password",
    "host",
    "origin",
    "referer",
  ];
  Object.keys(req.headers).forEach((h) => {
    if (!forbiddenHeaders.includes(h.toLowerCase())) {
      // Forward other headers if needed, but usually not necessary for GitHub API
    }
  });

  const proxyReq = https.request(options, (proxyRes) => {
    // Forward status and headers (excluding some)
    const resHeaders = { ...proxyRes.headers };
    delete resHeaders["access-control-allow-origin"]; // We already set this to *

    res.writeHead(proxyRes.statusCode, resHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (e) => {
    console.error("Proxy error:", e.message);
    res.writeHead(500);
    res.end(`Bouncer error: ${e.message}`);
  });

  // Forward the request body
  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(
    `\n🚀 Frankenstein Backup Bouncer running on http://localhost:${PORT}`,
  );
  console.log(
    `Fallback mode active. Ensure your CMS config.json points to this URL.`,
  );
});
