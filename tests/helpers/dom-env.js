// Builds a jsdom "browser" that runs the real CMS scripts (and real Quill 1.3.6)
// as classic scripts, so top-level declarations are shared exactly like on the page.
const fs = require("fs");
const path = require("path");

let JSDOM = null;
try {
  ({ JSDOM } = require("jsdom"));
} catch (e) {
  // optional dev dependency: run `npm install`
}

const ROOT = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

function quillSource() {
  return fs.readFileSync(path.join(ROOT, "dev/vendor/quill.min.js"), "utf8");
}

function run(win, code) {
  const s = win.document.createElement("script");
  s.textContent = code;
  win.document.body.appendChild(s);
}

const SKELETON = `
  <div id="telepathic-menu"></div>
  <span id="save-status"></span>
  <span id="active-filename"></span>
  <button id="saveBtn"></button>
  <input id="commit-msg" />
  <input type="checkbox" id="autosave-toggle" />
  <ul id="file-list"></ul>
  <ul id="history-list"></ul>
  <div id="editor-host"></div>
  <input id="seo-title" /><textarea id="seo-desc"></textarea>
  <input id="seo-canonical" /><input id="seo-lang" /><input type="checkbox" id="seo-noindex" />
  <input id="seo-og-title" /><textarea id="seo-og-desc"></textarea><input id="seo-og-image" />
  <div id="seo-prev-title"></div><div id="seo-prev-url"></div><div id="seo-prev-desc"></div>
  <ul id="seo-igor"></ul>
  <div id="blocks-modal"><div id="blocks-list-view"><select id="blocks-position"><option value="after">after</option><option value="end">end</option></select><div id="blocks-grid"></div></div>
  <div id="blocks-form-view" style="display:none"><p id="blocks-form-title"></p><div id="blocks-fields"></div></div></div>
  <p id="seo-title-hint"></p><p id="seo-desc-hint"></p>
  <div id="seo-modal"></div>
`;

/**
 * @param {string[]} scripts  CMS files to load, relative to the repo root
 */
function createEnv(scripts, opts) {
  opts = opts || {};
  const dom = new JSDOM(
    `<!doctype html><html><body>${SKELETON}${opts.html || ""}</body></html>`,
    {
      url: "https://cms.example.com/dev/index.html",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    },
  );
  const w = dom.window;
  w.document.execCommand = () => false;
  w.TextEncoder = TextEncoder;
  w.TextDecoder = TextDecoder;
  let n = 0;
  w.URL.createObjectURL = () => `blob:https://cms.example.com/mock-${++n}`;
  w.URL.revokeObjectURL = () => {};
  run(w, quillSource());
  if (opts.beforeScripts) opts.beforeScripts(w);
  scripts.forEach((s) => run(w, read(s)));
  return w;
}

module.exports = { JSDOM, createEnv, run, read, ROOT };
