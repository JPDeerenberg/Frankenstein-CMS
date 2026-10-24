#!/usr/bin/env node
/**
 * Ensures files that should stay identical between dev/ and prod/ do not drift.
 * Intentional differences (auth.js, api.js, config.js, index.html, style.css) are excluded:
 * dev talks to GitHub directly, prod goes through the bouncer.
 */
const fs = require("fs");
const path = require("path");

const SHARED = [
  "utils.js",
  "doc.js",
  "blocks.js",
  "pwa.js",
  "actions.js",
  "boot.js",
  "editor.js",
  "ui.js",
  "seo.js",
  "igor.js",
  "files.js",
];
const SHARED_ROOT = ["sw.js"];
const root = path.join(__dirname, "..");
let failed = false;

for (const file of SHARED) {
  const a = fs.readFileSync(path.join(root, "dev/js", file), "utf8");
  const b = fs.readFileSync(path.join(root, "prod/js", file), "utf8");
  if (a !== b) {
    console.error(`PARITY FAIL: dev/js/${file} differs from prod/js/${file}`);
    failed = true;
  } else {
    console.log(`OK: ${file}`);
  }
}

for (const file of SHARED_ROOT) {
  const a = fs.readFileSync(path.join(root, "dev", file), "utf8");
  const b = fs.readFileSync(path.join(root, "prod", file), "utf8");
  if (a !== b) {
    console.error(`PARITY FAIL: dev/${file} differs from prod/${file}`);
    failed = true;
  } else {
    console.log(`OK: ${file}`);
  }
}

if (failed) {
  process.exit(1);
}
console.log("All shared modules are in parity.");
