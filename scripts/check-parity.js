#!/usr/bin/env node
/**
 * Ensures files that should stay identical between dev/ and prod/ do not drift.
 * Intentional differences (auth.js, files.js, config.js, index.html) are excluded.
 */
const fs = require("fs");
const path = require("path");

const SHARED = ["utils.js", "editor.js", "ui.js", "seo.js", "igor.js"];
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

if (failed) {
  process.exit(1);
}
console.log("All shared modules are in parity.");
