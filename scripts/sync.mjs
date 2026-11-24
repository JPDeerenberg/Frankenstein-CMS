#!/usr/bin/env node
/**
 * One source of truth for the code that dev/ and prod/ share.
 *
 *   npm run sync          copy shared/js/*.js and shared/vendor/* into both folders
 *   npm run sync --check  write nothing; exit 1 and list files that are out of date
 *
 * The generated copies are committed on purpose: GitHub Pages / Cloudflare Pages
 * serve dev/ and prod/ as-is, so deploying needs no build step.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JS_HEADER = "// GENERATED from shared/js/";
const SW_HEADER =
  "// GENERATED from shared/sw.template.js. Edit that file, then run: npm run sync\n";
const ENVS = ["dev", "prod"];
const check = process.argv.includes("--check");
const unknown = process.argv.slice(2).filter((a) => a !== "--check");
if (unknown.length) {
  console.error(`Unknown option: ${unknown[0]}`);
  process.exit(2);
}

const read = (p) => fs.readFileSync(path.join(ROOT, p));
const text = (p) => read(p).toString("utf8");

/** Every file below `abs`, as sorted paths relative to it. */
function walkFiles(abs) {
  if (!fs.existsSync(abs)) return [];
  const out = [];
  const visit = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(child, name);
      else if (entry.isFile()) out.push(name);
    }
  };
  visit(abs, "");
  return out.sort();
}

const sharedJs = fs
  .readdirSync(path.join(ROOT, "shared/js"))
  .filter((name) => name.endsWith(".js"))
  .sort();
const sharedVendor = walkFiles(path.join(ROOT, "shared/vendor"));

const jsContent = (name) =>
  `${JS_HEADER}${name}. Edit that file, then run: npm run sync\n` +
  text(`shared/js/${name}`);

/** The app shell a service worker must cache for `env`, including planned files. */
function listAssets(env) {
  const dir = path.join(ROOT, env);
  const assets = ["./"];
  const add = (name) => {
    if (fs.existsSync(path.join(dir, name))) assets.push(`./${name}`);
  };
  add("index.html");
  for (const name of walkFiles(path.join(dir, "css"))) {
    assets.push(`./css/${name}`);
  }

  const js = new Set(sharedJs);
  for (const name of walkFiles(path.join(dir, "js"))) {
    if (name.endsWith(".js")) js.add(name);
  }
  for (const name of [...js].sort()) assets.push(`./js/${name}`);

  const vendor = new Set(sharedVendor);
  for (const name of walkFiles(path.join(dir, "vendor"))) vendor.add(name);
  for (const name of [...vendor].sort()) assets.push(`./vendor/${name}`);

  for (const name of walkFiles(path.join(dir, "icons"))) {
    assets.push(`./icons/${name}`);
  }
  add("manifest.webmanifest");
  add("demo_page.html");
  return assets;
}

function assetBytes(env, asset, overrides) {
  const name = asset.slice(2);
  return overrides && overrides.has(name)
    ? overrides.get(name)
    : read(`${env}/${name}`);
}

function cacheHash(env, assets, overrides) {
  const hash = crypto.createHash("sha256");
  for (const asset of assets) {
    if (asset === "./") continue; // alias for index.html, already hashed
    hash.update(asset.slice(2));
    hash.update("\0");
    hash.update(assetBytes(env, asset, overrides));
  }
  return hash.digest("hex").slice(0, 8);
}

function buildSw(env, overrides) {
  const assets = listAssets(env);
  const lines = assets.map((a) => `  ${JSON.stringify(a)},`).join("\n");
  return (
    SW_HEADER +
    text("shared/sw.template.js")
      .replace("  /* __ASSETS__ */", lines)
      .replace("__CACHE_HASH__", cacheHash(env, assets, overrides))
  );
}

/** All files that should exist, as { path, content }. */
function outputs() {
  const out = [];
  const overridesByEnv = new Map();

  for (const env of ENVS) {
    const overrides = new Map();
    for (const name of sharedJs) {
      const content = Buffer.from(jsContent(name));
      overrides.set(`js/${name}`, content);
      out.push({ path: `${env}/js/${name}`, content });
    }
    for (const name of sharedVendor) {
      const content = read(`shared/vendor/${name}`);
      overrides.set(`vendor/${name}`, content);
      out.push({ path: `${env}/vendor/${name}`, content });
    }
    overridesByEnv.set(env, overrides);
  }

  for (const env of ENVS) {
    out.push({
      path: `${env}/sw.js`,
      content: buildSw(env, overridesByEnv.get(env)),
    });
  }
  return out;
}

const files = outputs();
const stale = [];

for (const file of files) {
  const abs = path.join(ROOT, file.path);
  const current = fs.existsSync(abs) ? fs.readFileSync(abs) : null;
  const wanted = Buffer.isBuffer(file.content)
    ? file.content
    : Buffer.from(file.content);
  if (!current || !current.equals(wanted)) {
    stale.push(file.path);
    if (!check) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, wanted);
    }
  }
}

// A source file deleted from shared/js must not leave a generated copy behind.
for (const env of ENVS) {
  for (const name of fs.readdirSync(path.join(ROOT, env, "js"))) {
    if (!name.endsWith(".js")) continue;
    const p = `${env}/js/${name}`;
    if (
      text(p).startsWith(JS_HEADER) &&
      !sharedJs.includes(name) &&
      !stale.includes(p)
    ) {
      stale.push(p);
    }
  }
}

if (check) {
  if (stale.length) {
    console.error("Out of date (run: npm run sync):");
    for (const p of stale) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log("OK: dev/ and prod/ match shared/.");
} else if (stale.length) {
  console.log(`Synced ${stale.length} file(s).`);
} else {
  console.log("Already up to date.");
}
