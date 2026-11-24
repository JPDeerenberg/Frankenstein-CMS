const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const { JSDOM } = require("jsdom");

function loadIgor() {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="igor-stats"></div></body></html>',
    { runScripts: "outside-only", url: "https://cms.example.com/" },
  );
  dom.window.eval(fs.readFileSync("dev/js/igor.js", "utf8"));
  return dom;
}

function fakeQuill(root, text) {
  return {
    root: root,
    getText: () => (text === undefined ? root.textContent : text),
    on: () => {},
  };
}

test("Igor aggregates stats from every editable region", () => {
  const dom = loadIgor();
  const { document } = dom.window;
  const Igor = dom.window.Igor;

  const one = document.createElement("div");
  one.innerHTML =
    '<h1>Title</h1><p>One two three</p><a href="#">empty</a><img src="x">';
  const two = document.createElement("div");
  two.innerHTML =
    "<p>" +
    "word ".repeat(130) +
    '</p><a href="https://example.com">external</a><img alt="ok">';

  Igor.init(fakeQuill(one, "One two three"));
  Igor.init(fakeQuill(two, "word ".repeat(130)));
  const stats = Igor.scanAll();

  assert.strictEqual(stats.words, 133);
  assert.strictEqual(stats.badLinks, 1);
  assert.strictEqual(stats.externalLinks, 1);
  assert.strictEqual(stats.missingAlt, 1);
  assert.strictEqual(stats.longParas, 1);
  assert.strictEqual(stats.headerIssue, null);

  const text = document.getElementById("igor-stats").textContent;
  assert.match(text, /133 words/);
  assert.match(text, /1 empty link/);
  assert.match(text, /1 img missing alt/);
  assert.match(text, /1 long para/);
  assert.match(text, /1 external/);
});

test("Igor counts each region once and reports page-level H1 problems", () => {
  const dom = loadIgor();
  const { document } = dom.window;
  const Igor = dom.window.Igor;

  const root = document.createElement("div");
  root.innerHTML = "<h1>One</h1><h1>Two</h1><p>short</p>";
  const q = fakeQuill(root, "short");
  Igor.init(q);
  Igor.init(q); // same instance, must not be counted twice
  let stats = Igor.scanAll();
  assert.strictEqual(stats.words, 1);
  assert.strictEqual(stats.headerIssue, "Too many H1s");

  Igor.reset();
  const noHeading = document.createElement("div");
  noHeading.innerHTML = "<p>" + "word ".repeat(60) + "</p>";
  Igor.init(fakeQuill(noHeading, "word ".repeat(60)));
  stats = Igor.scanAll();
  assert.strictEqual(stats.headerIssue, "Missing H1");
});

test("Igor.reset forgets the previous document", () => {
  const dom = loadIgor();
  const { document } = dom.window;
  const Igor = dom.window.Igor;

  const root = document.createElement("div");
  root.innerHTML = "<p>one two</p>";
  Igor.init(fakeQuill(root, "one two"));
  Igor.scanAll();
  assert.match(document.getElementById("igor-stats").textContent, /2 words/);

  Igor.reset();
  assert.strictEqual(
    document.getElementById("igor-stats").textContent,
    "",
    "reset clears the rendered badges",
  );
  const stats = Igor.scanAll();
  assert.strictEqual(stats.words, 0);
});
