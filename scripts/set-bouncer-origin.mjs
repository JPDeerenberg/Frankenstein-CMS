#!/usr/bin/env node
// Replace the permissive production connect-src with the exact bouncer origins.
// Everything else in the CSP stays untouched. Safe to run more than once.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `Usage:
  node scripts/set-bouncer-origin.mjs https://bouncer.example.com [more origins]

Rewrites connect-src in prod/index.html to 'self' plus those exact https
origins. Use --file <path> to operate on a copy (mainly for tests).`;

function fail(message) {
  console.error(`set-bouncer-origin: ${message}`);
  console.error(USAGE);
  process.exit(1);
}

function normalizeOrigin(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`not a URL: ${raw}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`only https:// origins are allowed: ${raw}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      `origin must not contain credentials, query or hash: ${raw}`,
    );
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error(`origin must not contain a path: ${raw}`);
  }
  return url.origin;
}

const args = process.argv.slice(2);
let file = path.join(ROOT, "prod/index.html");
const rawOrigins = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--file") {
    if (!args[i + 1]) fail("--file needs a path");
    file = path.resolve(args[++i]);
  } else {
    rawOrigins.push(args[i]);
  }
}
if (rawOrigins.length === 0) fail("give at least one https origin");

let origins;
try {
  origins = [...new Set(rawOrigins.map(normalizeOrigin))];
} catch (error) {
  fail(error.message);
}

let html;
try {
  html = fs.readFileSync(file, "utf8");
} catch (error) {
  fail(`cannot read ${file}: ${error.message}`);
}

const meta =
  /(<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*content=")([^"]*)(")/i.exec(
    html,
  );
if (!meta) fail(`no Content-Security-Policy meta tag in ${file}`);

const directives = meta[2]
  .split(";")
  .map((part) => part.trim())
  .filter(Boolean);
const next = `connect-src 'self' ${origins.join(" ")}`;
const index = directives.findIndex(
  (part) => part === "connect-src" || part.startsWith("connect-src "),
);
if (index === -1) directives.push(next);
else directives[index] = next;

const trailing = /;\s*$/.test(meta[2]) ? ";" : "";
const csp = directives.join("; ") + trailing;
const updated =
  html.slice(0, meta.index) +
  meta[1] +
  csp +
  meta[3] +
  html.slice(meta.index + meta[0].length);

if (updated === html) {
  console.log(`No change: ${file}`);
} else {
  fs.writeFileSync(file, updated);
  console.log(`Updated ${file}`);
  console.log(`connect-src 'self' ${origins.join(" ")}`);
}
