#!/usr/bin/env node
// Generate one KV entry for the Cloudflare bouncer (or the other bouncers).
// It only prints text: it never writes secrets to disk or calls GitHub.

import { randomBytes } from "node:crypto";

const USAGE = `Usage:
  node scripts/new-site.mjs "Site name" email@example.com owner/repo [--own-token]

Prints the KV key (the lowercased email) and the JSON value to paste into the
SITES namespace. --own-token adds the per-site GitHub token placeholder.`;

function fail(message) {
  console.error(`new-site: ${message}`);
  console.error(USAGE);
  process.exit(1);
}

function isValidRepoName(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_.-]{1,100}$/.test(value) &&
    value !== "." &&
    value !== ".."
  );
}

function validEmail(value) {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function makePassword() {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  while (out.length < 24) {
    // 248 is the largest multiple of 62 below 256: no modulo bias.
    for (const byte of randomBytes(24)) {
      if (byte >= 248) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === 24) break;
    }
  }
  return out;
}

const argv = process.argv.slice(2);
const ownToken = argv.includes("--own-token");
const positional = argv.filter((arg) => arg !== "--own-token");
if (positional.some((arg) => arg.startsWith("-"))) {
  fail(`unknown option: ${positional.find((arg) => arg.startsWith("-"))}`);
}
if (positional.length !== 3) {
  fail("expected three arguments: name, email and owner/repo");
}

const name = positional[0].trim();
const email = positional[1].trim().toLowerCase();
const repoParts = positional[2].split("/");

if (!name || name.length > 100) fail("site name must be 1-100 characters");
if (!validEmail(email)) fail(`invalid email: ${positional[1]}`);
if (repoParts.length !== 2 || !repoParts.every(isValidRepoName)) {
  fail(`invalid repository (expected owner/repo): ${positional[2]}`);
}

const value = {
  name,
  password: makePassword(),
  owner: repoParts[0],
  repo: repoParts[1],
};
if (ownToken) value.token = "github_pat_PASTE_FINE_GRAINED_TOKEN_HERE";

console.log(`KV key: ${email}`);
console.log("");
console.log("KV value:");
console.log(JSON.stringify(value, null, 2));
