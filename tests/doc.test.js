const test = require("node:test");
const assert = require("node:assert");
const { JSDOM, createEnv } = require("./helpers/dom-env");

const maybe = JSDOM ? test : test.skip;
const SCRIPTS = ["dev/js/utils.js", "dev/js/doc.js", "dev/js/editor.js"];

function setup() {
  return createEnv(SCRIPTS);
}

/** A real Quill instance loaded exactly like the editor does it. */
function quillFor(w, html) {
  const host = w.document.createElement("div");
  w.document.body.appendChild(host);
  const q = new w.Quill(host, {
    formats: w.eval("EDITOR_FORMATS"),
    modules: { toolbar: false },
  });
  q.setContents(q.clipboard.convert(html), "silent");
  q.history.clear();
  return q;
}

function roundtrip(w, html, mode, extra) {
  const q = quillFor(w, html);
  return w.cleanEditorHtml(
    q.root.innerHTML,
    Object.assign({ mode, originalHtml: html }, extra || {}),
  );
}

maybe("regionMode picks the right editing mode per element", () => {
  const w = setup();
  assert.strictEqual(w.regionMode("H1"), "inline");
  assert.strictEqual(w.regionMode("p"), "inline");
  assert.strictEqual(w.regionMode("LI"), "inline");
  assert.strictEqual(w.regionMode("SPAN"), "inline");
  assert.strictEqual(w.regionMode("DIV"), "block");
  assert.strictEqual(w.regionMode("section"), "block");
  assert.strictEqual(w.regionMode("UL"), "list");
});

maybe("analyzeMarkup only warns about markup the editor would lose", () => {
  const w = setup();
  const el = (html) => {
    const d = w.document.createElement("div");
    d.innerHTML = html;
    return d;
  };
  // (arrays come from the jsdom realm, hence Array.from)
  assert.deepStrictEqual(
    Array.from(
      w.analyzeMarkup(
        el('Hi <strong>x</strong> <em>y</em> <a href="a.html">z</a>'),
        "inline",
      ),
    ),
    [],
  );
  const issues = w.analyzeMarkup(
    el(
      'Hi <span class="x">y</span> <a class="btn" href="a">z</a> <code>c</code>',
    ),
    "inline",
  );
  assert.ok(issues.includes("<span>"));
  assert.ok(issues.includes("class on <a>"));
  assert.ok(issues.includes("<code>"));
  // headings are fine in block containers, not inside an <h1>/<p>
  assert.deepStrictEqual(
    Array.from(w.analyzeMarkup(el("<h2>T</h2><p>x</p>"), "block")),
    [],
  );
  assert.ok(w.analyzeMarkup(el("<h2>T</h2>"), "inline").includes("<h2>"));
  // <br> becomes a paragraph break in block containers
  assert.ok(w.analyzeMarkup(el("a<br>b"), "block").length > 0);
  assert.deepStrictEqual(
    Array.from(w.analyzeMarkup(el("a<br>b"), "inline")),
    [],
  );
});

maybe(
  "inline regions (h1/p/li) keep their tag content flat — no <p> nesting, no stray blank line",
  () => {
    const w = setup();
    assert.strictEqual(
      roundtrip(w, "Welcome to <em>Frankenstein</em>", "inline"),
      "Welcome to <em>Frankenstein</em>",
    );
    assert.strictEqual(
      roundtrip(w, "Line one<br>Line two", "inline"),
      "Line one<br>Line two",
    );
  },
);

maybe(
  "block regions round-trip headings, paragraphs and lists without a trailing blank paragraph",
  () => {
    const w = setup();
    const html = "<p>One</p><h2>Two</h2><ul><li>a</li><li>b</li></ul>";
    assert.strictEqual(roundtrip(w, html, "block"), html);
    assert.strictEqual(
      roundtrip(w, "<h2>Title</h2>", "block"),
      "<h2>Title</h2>",
    );
  },
);

maybe("list regions are saved as <li> items", () => {
  const w = setup();
  assert.strictEqual(
    roundtrip(w, "<li>a</li><li>b <strong>c</strong></li>", "list"),
    "<li>a</li><li>b <strong>c</strong></li>",
  );
});

maybe(
  "links: Quill's target=_blank/rel are dropped unless the page already had them",
  () => {
    const w = setup();
    assert.strictEqual(
      roundtrip(
        w,
        'See <a href="about.html">about</a> and <a href="#top">top</a>',
        "inline",
      ),
      'See <a href="about.html">about</a> and <a href="#top">top</a>',
    );
    const kept = roundtrip(
      w,
      'Go <a href="https://x.dev" target="_blank" rel="noopener">x</a>',
      "inline",
    );
    assert.match(kept, /target="_blank"/);
    assert.match(kept, /rel="noopener"/);
  },
);

maybe("an edit made by the user comes out clean", () => {
  const w = setup();
  const q = quillFor(w, "Welcome");
  q.insertText(0, "Hello and ", "user");
  assert.strictEqual(
    w.cleanEditorHtml(q.root.innerHTML, {
      mode: "inline",
      originalHtml: "Welcome",
    }),
    "Hello and Welcome",
  );
});

maybe(
  "images: preview blob: URLs are mapped back to the repo path, alt text survives",
  () => {
    const w = setup();
    const q = quillFor(
      w,
      '<img src="blob:https://cms.example.com/mock-1" alt="A cat"> after',
    );
    assert.match(
      q.root.innerHTML,
      /blob:https:\/\/cms\.example\.com\/mock-1/,
      "blob: must survive the editor",
    );
    const out = w.cleanEditorHtml(q.root.innerHTML, {
      mode: "inline",
      resolveSrc: (src) =>
        src === "blob:https://cms.example.com/mock-1"
          ? "../img/cat.png"
          : undefined,
    });
    const box = new w.DOMParser().parseFromString(
      "<body>" + out + "</body>",
      "text/html",
    ).body;
    assert.strictEqual(
      box.querySelector("img").getAttribute("src"),
      "../img/cat.png",
    );
    assert.strictEqual(box.querySelector("img").getAttribute("alt"), "A cat");
    assert.ok(!/blob:|data:/.test(out));
  },
);

maybe("javascript: image URLs are neutralised by the editor", () => {
  const w = setup();
  const q = quillFor(w, '<img src="javascript:alert(1)">');
  assert.ok(!/javascript:/.test(q.root.innerHTML));
});

maybe("editor-only classes never reach the saved HTML", () => {
  const w = setup();
  const out = w.cleanEditorHtml('<p class="ql-align-center keep">x</p>', {
    mode: "block",
  });
  assert.strictEqual(out, '<p class="keep">x</p>');
});

maybe("loading content then pressing undo does not wipe the region", () => {
  const w = setup();
  const q = quillFor(w, "Hello world");
  q.history.undo();
  assert.strictEqual(q.getText(), "Hello world\n");
});

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>T</title><style>body { margin: 0 } .a > b { color: red }</style></head>
<body class="home">
<h1 data-editable>Welcome</h1>
<p data-editable class="lead">One<br>Two <span class="x">fancy</span></p>
<div data-editable><p>Para</p></div>
<style>#cms-page-content, body { max-width: 40rem }</style>
<img src="img/photo.png" alt="p">
<script>console.log("keep me")</script>
</body>
</html>`;

maybe(
  "buildSavedDocument replaces only the edited region and leaves everything else alone",
  () => {
    const w = setup();
    const out = w.buildSavedDocument(PAGE, [{ index: 0, html: "Hello" }]);
    assert.match(out, /^<!DOCTYPE html>/);
    assert.match(out, /<h1 data-editable="">Hello<\/h1>/);
    // untouched regions keep their markup, classes and <br>
    assert.match(
      out,
      /<p data-editable="" class="lead">One<br>Two <span class="x">fancy<\/span><\/p>/,
    );
    assert.match(out, /<div data-editable=""><p>Para<\/p><\/div>/);
    // page-level CSS is exactly as in the original
    assert.match(
      out,
      /<style>body \{ margin: 0 \} \.a > b \{ color: red \}<\/style>/,
    );
    assert.match(
      out,
      /<style>#cms-page-content, body \{ max-width: 40rem \}<\/style>/,
    );
    assert.match(out, /<body class="home">/);
    assert.match(out, /<script>console\.log\("keep me"\)<\/script>/);
    assert.match(out, /<img src="img\/photo\.png" alt="p">/);
  },
);

maybe(
  "buildSavedDocument applies SEO hooks and ignores out-of-range edits",
  () => {
    const w = setup();
    const out = w.buildSavedDocument(PAGE, [{ index: 99, html: "x" }], {
      applySeo: (d) => (d.querySelector("title").textContent = "New title"),
    });
    assert.match(out, /<title>New title<\/title>/);
    assert.ok(!out.includes(">x<"));
  },
);

maybe(
  "nested data-editable elements are not treated as separate regions",
  () => {
    const w = setup();
    const root = w.document.createElement("div");
    root.innerHTML =
      "<div data-editable><p data-editable>x</p></div><p data-editable>y</p>";
    assert.strictEqual(w.listEditableRegions(root).length, 2);
  },
);

maybe("sanitizePreviewTree makes the preview inert", () => {
  const w = setup();
  const root = w.document.createElement("div");
  root.innerHTML =
    '<img src="x" onerror="alert(1)"><a href="javascript:alert(1)" onclick="x()">a</a><script>bad()</script><iframe src="https://e.com"></iframe><a href="ok.html">ok</a>';
  w.sanitizePreviewTree(root);
  assert.ok(!root.querySelector("script"));
  assert.ok(!root.querySelector("[onerror]"));
  assert.ok(!root.querySelector("[onclick]"));
  assert.strictEqual(root.querySelector("a").hasAttribute("href"), false);
  assert.strictEqual(root.querySelector("iframe").getAttribute("sandbox"), "");
  assert.strictEqual(
    root.querySelectorAll("a")[1].getAttribute("href"),
    "ok.html",
  );
});

maybe("path helpers: encodePath, relativePath, safe skip list", () => {
  const w = setup();
  assert.strictEqual(
    w.encodePath("my pages/a#b?.html"),
    "my%20pages/a%23b%3F.html",
  );
  assert.strictEqual(w.relativePath("blog", "img/x.png"), "../img/x.png");
  assert.strictEqual(w.relativePath("", "img/x.png"), "img/x.png");
  assert.strictEqual(w.relativePath("a/b", "a/img/x.png"), "../img/x.png");
  assert.strictEqual(w.isSkippedPath("node_modules/x/index.html"), true);
  assert.strictEqual(w.isSkippedPath("docs/index.html"), false);
});
