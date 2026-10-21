// End-to-end: real files.js / api.js / doc.js / editor.js / ui.js / seo.js, real Quill,
// a real shadow DOM (jsdom) and an in-memory fake of the GitHub API.
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("./helpers/dom-env");
const { setup } = require("./helpers/fake-github");

const maybe = JSDOM ? test : test.skip;

const INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Home</title>
<meta name="description" content="Old description">
<link rel="stylesheet" href="css/site.css">
<style>body { margin: 0; background: #eee } .card > h2 { color: blue }</style>
</head>
<body class="home">
<h1 data-editable>Welcome</h1>
<p data-editable class="lead">One<br>Two <span class="x">fancy</span></p>
<div data-editable><p>Para with <a href="about.html">a link</a></p></div>
<p data-editable>Photo: <img src="img/photo.png" alt="A photo"></p>
<style>#cms-page-content, body { max-width: 40rem }</style>
<script>console.log("site script")</script>
</body>
</html>
`;

const ABOUT =
  "<!DOCTYPE html><html><head><title>About</title></head><body><h1 data-editable>About us</h1></body></html>\n";

const doc = (env) => env.get("activeDoc");

maybe("file list: one tree request, sorted, skips vendor folders", async () => {
  const env = setup({
    "b.html": "x",
    "a/z.html": "x",
    "node_modules/pkg/index.html": "x",
    "readme.md": "x",
  });
  await env.w.fetchFileList();
  const names = Array.from(
    env.w.document.querySelectorAll("#file-list li"),
  ).map((l) => l.textContent);
  assert.deepStrictEqual(names, ["a/z.html", "b.html"]);
  assert.strictEqual(env.calls.length, 1);
  assert.match(env.calls[0].url, /git\/trees\/HEAD\?recursive=1/);
});

maybe(
  "load → edit one region → save: only that region changes, nothing leaks into the file",
  async () => {
    const env = setup({
      "index.html": INDEX,
      "css/site.css": "body { background: #fff } h1 { color: red }",
      "img/photo.png": Buffer.from([1, 2, 3]),
    });
    await env.w.loadFile("index.html");
    const d = doc(env);
    assert.ok(d, "document should be loaded");
    assert.strictEqual(d.regions.length, 4);
    assert.strictEqual(env.get("isDirty"), false);

    // the preview works on its own copy: body/html selectors are scoped, scripts removed
    const shadow = env.w.document.getElementById("editor-host").shadowRoot;
    assert.ok(shadow.querySelector("#cms-page-content"));
    assert.ok(!shadow.querySelector("script"));

    d.regions[0].quill.insertText(0, "Hello and ", "user");
    assert.strictEqual(env.get("isDirty"), true);

    await env.w.slaOp();
    assert.strictEqual(env.state.puts, 1);
    const out = env.state.lastPut.text;

    assert.match(
      out,
      /<h1 data-editable="">Hello and Welcome<\/h1>/,
      "h1 stays an h1, no <p> inside",
    );
    assert.match(
      out,
      /<p data-editable="" class="lead">One<br>Two <span class="x">fancy<\/span><\/p>/,
      "untouched region is byte-for-byte intact",
    );
    assert.match(
      out,
      /<div data-editable=""><p>Para with <a href="about\.html">a link<\/a><\/p><\/div>/,
      "link has no target=_blank",
    );
    assert.match(
      out,
      /<style>body \{ margin: 0; background: #eee \} \.card > h2 \{ color: blue \}<\/style>/,
    );
    assert.match(
      out,
      /<style>#cms-page-content, body \{ max-width: 40rem \}<\/style>/,
      "page <style> must not be rewritten",
    );
    assert.match(out, /<script>console\.log\("site script"\)<\/script>/);
    assert.match(
      out,
      /<img src="img\/photo\.png" alt="A photo">/,
      "image path restored, not a blob:/data: URL",
    );
    assert.ok(!/blob:|data:image/.test(out));
    assert.strictEqual(env.state.lastPut.body.sha, "sha1");
    assert.strictEqual(
      env.state.lastPut.body.message,
      "Update index.html via Frankenstein CMS",
    );
    assert.strictEqual(env.get("isDirty"), false);
    assert.strictEqual(doc(env).sha, env.state.files["index.html"].sha);
  },
);

maybe(
  "editing a region that contains an image keeps the repo path",
  async () => {
    const env = setup({
      "index.html": INDEX,
      "img/photo.png": Buffer.from([1, 2, 3]),
    });
    await env.w.loadFile("index.html");
    const d = doc(env);
    d.regions[3].quill.insertText(0, ">> ", "user");
    await env.w.slaOp();
    const out = env.state.lastPut.text;
    assert.match(out, /<img src="img\/photo\.png" alt="A photo">/);
    assert.ok(!/blob:|data:/.test(out));
  },
);

maybe(
  "saving without changes does nothing; save twice in a row works",
  async () => {
    const env = setup({ "index.html": INDEX });
    await env.w.loadFile("index.html");
    await env.w.slaOp();
    assert.ok(!env.state.puts, "no commit without edits");
    const d = doc(env);
    d.regions[0].quill.insertText(0, "A", "user");
    await env.w.slaOp();
    d.regions[0].quill.insertText(0, "B", "user");
    await env.w.slaOp();
    assert.strictEqual(env.state.puts, 2);
    assert.match(
      env.state.lastPut.text,
      /<h1 data-editable="">BAWelcome<\/h1>/,
    );
  },
);

maybe("two saves at the same moment produce one commit", async () => {
  const env = setup({ "index.html": INDEX });
  await env.w.loadFile("index.html");
  doc(env).regions[0].quill.insertText(0, "X", "user");
  await Promise.all([env.w.slaOp(true), env.w.slaOp(false), env.w.slaOp(true)]);
  assert.strictEqual(env.state.puts, 1);
  // not merely "one succeeded": only ONE request was sent and nobody saw a bogus conflict
  assert.strictEqual(
    env.calls.filter((c) => c.init.method === "PUT").length,
    1,
  );
  assert.strictEqual(env.dialogs.confirms.length, 0);
});

maybe(
  "a slow earlier load can never replace a newer one (no saving into the wrong file)",
  async () => {
    const env = setup({ "index.html": INDEX, "about.html": ABOUT });
    env.state.delays["index.html"] = 60;
    const slow = env.w.loadFile("index.html");
    await new Promise((r) => setTimeout(r, 10));
    await env.w.loadFile("about.html");
    await slow;
    assert.strictEqual(doc(env).path, "about.html");
    assert.strictEqual(env.get("currentPath"), "about.html");
    doc(env).regions[0].quill.insertText(0, "Hi ", "user");
    await env.w.slaOp();
    assert.strictEqual(env.state.lastPut.path, "about.html");
    assert.match(env.state.lastPut.text, /Hi About us/);
  },
);

maybe("switching files with unsaved changes asks first", async () => {
  const env = setup({ "index.html": INDEX, "about.html": ABOUT });
  await env.w.loadFile("index.html");
  doc(env).regions[0].quill.insertText(0, "X", "user");
  env.dialogs.answer = false;
  await env.w.loadFile("about.html");
  assert.strictEqual(doc(env).path, "index.html", "stayed on the edited file");
  assert.strictEqual(env.dialogs.confirms.length, 1);
  env.dialogs.answer = true;
  await env.w.loadFile("about.html");
  assert.strictEqual(doc(env).path, "about.html");
});

maybe(
  "a GitHub conflict (409) is handled: nothing lost, reload offered",
  async () => {
    const env = setup({ "index.html": INDEX });
    await env.w.loadFile("index.html");
    doc(env).regions[0].quill.insertText(0, "Mine ", "user");
    // someone else commits in the meantime
    env.state.files["index.html"].sha = "someone-elses-sha";
    env.dialogs.answer = false; // do not reload
    await env.w.slaOp();
    assert.ok(env.dialogs.confirms.some((c) => /changed on GitHub/.test(c)));
    assert.strictEqual(env.get("isDirty"), true, "edits are still there");
    assert.ok(doc(env));
  },
);

maybe("an autosave failure is shown, not swallowed", async () => {
  const env = setup({ "index.html": INDEX });
  await env.w.loadFile("index.html");
  doc(env).regions[0].quill.insertText(0, "X", "user");
  env.state.putFail = 500;
  await env.w.slaOp(true);
  assert.match(
    env.w.document.getElementById("save-status").innerText,
    /Autosave failed/,
  );
  assert.strictEqual(env.dialogs.alerts.length, 0, "no popup for autosave");
});

maybe(
  "files over 1 MB (no inline content) are read through the blobs API, not opened blank",
  async () => {
    const env = setup({ "index.html": INDEX });
    env.state.bigFiles = ["index.html"];
    await env.w.loadFile("index.html");
    assert.ok(doc(env), "loaded");
    assert.strictEqual(doc(env).regions.length, 4);
    assert.ok(env.calls.some((c) => /git\/blobs\//.test(c.url)));
  },
);

maybe(
  "a file that is not valid UTF-8 is refused instead of being corrupted",
  async () => {
    const env = setup({
      "latin1.html": Buffer.from([
        0x3c, 0x70, 0x3e, 0xe9, 0x3c, 0x2f, 0x70, 0x3e,
      ]),
    });
    await env.w.loadFile("latin1.html");
    assert.strictEqual(doc(env), null);
    await env.w.slaOp();
    assert.ok(!env.state.puts);
    assert.match(
      env.w.document.getElementById("save-status").innerText,
      /not valid UTF-8/,
    );
  },
);

maybe("file names with spaces and # are URL-encoded", async () => {
  const env = setup({ "my pages/a#1.html": ABOUT });
  await env.w.loadFile("my pages/a#1.html");
  assert.ok(doc(env));
  assert.ok(env.calls.some((c) => c.url.includes("my%20pages/a%231.html")));
});

maybe(
  "commit history renders messages as text (no HTML injection)",
  async () => {
    const env = setup({ "index.html": INDEX });
    env.state.commits = [
      {
        sha: "abcdef1234",
        commit: {
          message: "<img src=x onerror=window.__pwned=1> evil",
          author: { date: "2026-01-01T00:00:00Z" },
        },
      },
    ];
    await env.w.loadFile("index.html");
    await env.w.loadCommitHistory();
    const li = env.w.document.querySelector("#history-list li");
    assert.ok(li);
    assert.ok(!li.querySelector("img"));
    assert.match(li.textContent, /<img src=x onerror/);
    assert.strictEqual(env.w.__pwned, undefined);
  },
);

maybe(
  "restoring an old version writes it on top of the latest commit",
  async () => {
    const env = setup({ "index.html": INDEX });
    await env.w.loadFile("index.html");
    const headSha = doc(env).sha;
    // a newer version lands on GitHub
    env.state.files["index.html"] = {
      data: Buffer.from(INDEX.replace("Welcome", "Newer")),
      sha: "newer",
    };
    env.state.files["index.html"].sha = headSha; // keep the sha we hold valid
    await env.w.revertToCommit("oldsha");
    assert.ok(doc(env).forceWrite);
    assert.strictEqual(env.get("isDirty"), true);
    await env.w.slaOp();
    assert.strictEqual(env.state.puts, 1);
    assert.strictEqual(env.state.lastPut.body.sha, headSha);
  },
);

maybe(
  "SEO changes are written, untouched SEO leaves the document alone",
  async () => {
    const env = setup({ "index.html": INDEX });
    await env.w.loadFile("index.html");
    const titleInput = env.w.document.getElementById("seo-title");
    assert.strictEqual(titleInput.value, "Home");
    doc(env).regions[0].quill.insertText(0, "X", "user");
    await env.w.slaOp();
    assert.match(env.state.lastPut.text, /<title>Home<\/title>/);
    assert.match(env.state.lastPut.text, /content="Old description"/);

    titleInput.value = "A better title";
    env.w.SEO.saveAndClose();
    assert.strictEqual(env.get("isDirty"), true);
    await env.w.slaOp();
    assert.match(env.state.lastPut.text, /<title>A better title<\/title>/);
  },
);

maybe(
  "GET requests bypass the browser cache so a stale sha can never be used",
  async () => {
    const env = setup({ "index.html": INDEX });
    await env.w.loadFile("index.html");
    const get = env.calls.find((c) => /contents\/index\.html/.test(c.url));
    assert.strictEqual(get.init.cache, "no-cache");
  },
);
