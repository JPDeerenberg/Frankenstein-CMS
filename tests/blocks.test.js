const test = require("node:test");
const assert = require("node:assert");
const { JSDOM, createEnv } = require("./helpers/dom-env");
const { setup } = require("./helpers/fake-github");

const maybe = JSDOM ? test : test.skip;
const PURE = ["dev/js/utils.js", "dev/js/doc.js", "dev/js/blocks.js"];

function pure() {
  const w = createEnv(PURE);
  const parse = (html) => new w.DOMParser().parseFromString(html, "text/html");
  return { w, parse, B: w.eval("Blocks") };
}

const PAGE = `<!DOCTYPE html><html><head><title>T</title></head><body>
<header><h1 data-editable>Title</h1></header>
<main>
<p data-editable>One</p>
<ul><li data-editable>Item</li></ul>
<div class="col"><p>x <span data-editable>inline</span></p></div>
</main>
<footer>Foot</footer>
<script>1</script>
</body></html>`;

maybe(
  "every block renders valid HTML that the text editor can handle without warnings",
  () => {
    const { w, parse, B } = pure();
    assert.ok(B.list.length >= 9);
    B.list.forEach((def) => {
      const values = {};
      def.fields.forEach(
        (f) => (values[f.key] = f.type === "email" ? "me@x.com" : f.value),
      );
      const doc = parse(
        "<body>" + B.render(def.id, values, { pageDir: "" }) + "</body>",
      );
      const root = doc.body.firstElementChild;
      assert.strictEqual(root.getAttribute("data-cms-block"), def.id, def.id);
      if (def.id !== "divider") {
        const regions = w.listEditableRegions(doc.body);
        assert.ok(regions.length >= 1, def.id + " has editable text");
        regions.forEach((r) => {
          const issues = Array.from(
            w.analyzeMarkup(r, w.regionMode(r.tagName)),
          );
          assert.deepStrictEqual(
            issues,
            [],
            `${def.id}: <${r.tagName.toLowerCase()}> would trigger a warning`,
          );
        });
      }
      assert.ok(!/<script|javascript:|onerror/i.test(root.outerHTML), def.id);
    });
  },
);

maybe("user input is escaped and unsafe links are neutralised", () => {
  const { parse, B } = pure();
  const hero = parse(
    "<body>" + B.render("hero", { url: "javascript:alert(1)" }) + "</body>",
  );
  assert.strictEqual(hero.querySelector("a").getAttribute("href"), "#");
  const evil = parse(
    "<body>" +
      B.render("contact", { email: '"><script>alert(1)</script>' }) +
      "</body>",
  );
  assert.ok(!evil.querySelector("script"));
  assert.ok(evil.querySelector("a").getAttribute("href").startsWith("mailto:"));
  const img = parse(
    "<body>" +
      B.render("image-left", { image: 'x" onerror="1', alt: '"><b>' }) +
      "</body>",
  );
  assert.ok(!img.querySelector("b"));
  assert.ok(!img.querySelector("img").hasAttribute("onerror"));
});

maybe(
  "image paths become relative to the page's folder; empty gets a placeholder",
  () => {
    const { parse, B } = pure();
    const src = (value, dir) =>
      parse(
        "<body>" +
          B.render("image-left", { image: value, alt: "a" }, { pageDir: dir }) +
          "</body>",
      )
        .querySelector("img")
        .getAttribute("src");
    assert.strictEqual(src("img/a.jpg", ""), "img/a.jpg");
    assert.strictEqual(src("img/a.jpg", "blog"), "../img/a.jpg");
    assert.strictEqual(
      src("https://x.com/a.jpg", "blog"),
      "https://x.com/a.jpg",
    );
    assert.strictEqual(src("/img/a.jpg", "blog"), "/img/a.jpg");
    assert.match(src("", ""), /^data:image\/svg\+xml,/);
    assert.match(src("javascript:alert(1)", ""), /^data:image\/svg\+xml,/);
  },
);

maybe(
  "insert after a text block; climbs out of <li> and <span> so the HTML stays valid",
  () => {
    const { w, parse, B } = pure();
    const html = B.render("divider", {});
    let doc = parse(PAGE);
    assert.strictEqual(B.insert(doc, html, { afterRegion: 2 }), 0); // region 2 = <li data-editable>
    assert.strictEqual(
      doc.querySelector("ul").nextElementSibling.getAttribute("data-cms-block"),
      "divider",
    );
    assert.strictEqual(
      doc.querySelector("ul").children.length,
      1,
      "nothing was put inside the list",
    );
    doc = parse(PAGE);
    B.insert(doc, html, { afterRegion: 3 }); // region 3 = <span> inside <p>
    assert.strictEqual(
      doc.querySelector(".col").lastElementChild.getAttribute("data-cms-block"),
      "divider",
    );
    doc = parse(PAGE);
    B.insert(doc, html, { afterRegion: 0 }); // the <h1> in <header>
    assert.strictEqual(
      doc.querySelector("h1").nextElementSibling.getAttribute("data-cms-block"),
      "divider",
    );
    void w;
  },
);

maybe(
  "insert at the end of the page: inside <main>, else before <footer>, else before trailing scripts",
  () => {
    const { parse, B } = pure();
    const html = B.render("divider", {});
    let doc = parse(PAGE);
    B.insert(doc, html, {});
    assert.strictEqual(
      doc.querySelector("main").lastElementChild.getAttribute("data-cms-block"),
      "divider",
    );

    doc = parse(PAGE.replace("<main>", "<div>").replace("</main>", "</div>"));
    B.insert(doc, html, {});
    assert.strictEqual(
      doc
        .querySelector("footer")
        .previousElementSibling.getAttribute("data-cms-block"),
      "divider",
    );

    doc = parse(
      "<!DOCTYPE html><html><body><p data-editable>a</p><script>1</script></body></html>",
    );
    B.insert(doc, html, {});
    const kids = Array.from(doc.body.children).map((e) => e.tagName);
    assert.deepStrictEqual(kids, ["P", "DIV", "SCRIPT"]);

    doc = parse("<!DOCTYPE html><html><body></body></html>");
    assert.strictEqual(B.insert(doc, html, {}), 0);
  },
);

maybe("move and remove blocks (skipping scripts and styles)", () => {
  const { parse, B } = pure();
  const doc = parse(
    `<body><div data-cms-block="a">A</div><script>1</script><div data-cms-block="b">B</div><style>x{}</style><p>end</p></body>`,
  );
  const ids = () =>
    B.listBlocks(doc.body)
      .map((e) => e.getAttribute("data-cms-block"))
      .join("");
  assert.strictEqual(B.move(doc, 0, -1), null, "already first");
  assert.strictEqual(B.move(doc, 1, -1), 0);
  assert.strictEqual(ids(), "ba");
  assert.strictEqual(B.move(doc, 0, 1), 1);
  assert.strictEqual(ids(), "ab");
  assert.strictEqual(B.move(doc, 1, 1), 1, "moves past <p>");
  assert.strictEqual(B.move(doc, 1, 1), null, "now last");
  assert.strictEqual(B.remove(doc, 0), true);
  assert.strictEqual(ids(), "b");
  assert.strictEqual(B.remove(doc, 5), false);
});

const INDEX = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Home</title></head>
<body>
<h1 data-editable>Welcome</h1>
<p data-editable>Intro text</p>
<script>console.log("keep")</script>
</body></html>
`;

const text = (env, n) => env.state.lastPut.text;
const doc = (env) => env.get("activeDoc");

maybe(
  "insert → edit its text → save → reload → move → remove (full cycle)",
  async () => {
    const env = setup({ "index.html": INDEX });
    await env.w.loadFile("index.html");

    // a pending text edit must survive the structural change
    doc(env).regions[0].quill.insertText(0, "Hi ", "user");
    doc(env).regions[0].index; // region 0 = h1
    await env.w.insertBlock("hero", { url: "contact.html" }, "end");

    const d = doc(env);
    assert.strictEqual(d.regions.length, 5, "h1, p + hero's h1, p, a");
    assert.strictEqual(d.forceWrite, true);
    assert.strictEqual(env.get("isDirty"), true);
    assert.strictEqual(
      env.state.puts,
      undefined,
      "inserting does not commit by itself",
    );
    const preview = env.w.document.getElementById("editor-host").shadowRoot;
    assert.strictEqual(
      preview.querySelectorAll(".cms-block-controls").length,
      1,
      "▲ ▼ 🗑 shown on the block",
    );

    // edit the block's own text through the normal editor
    d.regions[2].quill.insertText(0, "Big ", "user"); // hero <h1>
    await env.w.slaOp();
    const out = env.state.lastPut.text;
    assert.match(
      out,
      /<h1 data-editable="">Hi Welcome<\/h1>/,
      "the earlier edit is kept",
    );
    assert.match(out, /<section data-cms-block="hero"/);
    assert.match(
      out,
      /<h1 data-editable="" style="margin:0 0 \.75rem">Big Your headline here<\/h1>/,
    );
    assert.match(out, /<a data-editable="" href="contact\.html"/);
    assert.match(out, /<script>console\.log\("keep"\)<\/script>/);
    assert.ok(
      !/cms-block-controls|cms-block-preview/.test(out),
      "preview-only controls never reach the file",
    );
    assert.ok(
      out.indexOf("</section>") < out.indexOf("<script>"),
      "block sits before the trailing script",
    );

    // reopen the saved file: the block is still a block, with controls
    env.dialogs.answer = true;
    await env.w.loadFile("index.html", null, { force: true });
    assert.strictEqual(doc(env).regions.length, 5);
    const shadow = () =>
      env.w.document.getElementById("editor-host").shadowRoot;
    assert.strictEqual(shadow().querySelectorAll("[data-cms-block]").length, 1);

    // add a second block after the intro paragraph, then move it up and remove it
    doc(env).regions[1].quill.insertText(0, "Intro: ", "user");
    env.w.eval("activeRegion = activeDoc.regions[1]");
    await env.w.insertBlock("divider", {}, "after");
    assert.strictEqual(shadow().querySelectorAll("[data-cms-block]").length, 2);
    const order = () =>
      Array.from(shadow().querySelectorAll("[data-cms-block]")).map((e) =>
        e.getAttribute("data-cms-block"),
      );
    assert.deepStrictEqual(
      order(),
      ["divider", "hero"],
      "inserted right after the intro, above the hero",
    );
    await env.w.moveBlockAt(0, 1);
    assert.deepStrictEqual(order(), ["hero", "divider"]);
    await env.w.removeBlockAt(1);
    assert.deepStrictEqual(order(), ["hero"]);
    await env.w.slaOp();
    assert.match(
      env.state.lastPut.text,
      /Intro: Intro text/,
      "text edits made before block changes are kept",
    );
    assert.ok(!/data-cms-block="divider"/.test(env.state.lastPut.text));
    assert.match(env.state.lastPut.text, /data-cms-block="hero"/);
  },
);

maybe("cancelling the remove confirmation changes nothing", async () => {
  const env = setup({ "index.html": INDEX });
  await env.w.loadFile("index.html");
  await env.w.insertBlock("divider", {}, "end");
  env.dialogs.answer = false;
  const before = doc(env);
  await env.w.removeBlockAt(0);
  assert.strictEqual(doc(env), before, "no re-render happened");
});

maybe("structural changes are refused while a save is running", async () => {
  const env = setup({ "index.html": INDEX });
  await env.w.loadFile("index.html");
  doc(env).regions[0].quill.insertText(0, "X", "user");
  const saving = env.w.slaOp();
  const refused = await env.w.insertBlock("divider", {}, "end");
  assert.strictEqual(refused, false);
  assert.ok(env.dialogs.alerts.some((a) => /wait until saving/.test(a)));
  await saving;
});

maybe(
  "the dialog: blocks without fields insert at once, others ask for their fields first",
  async () => {
    const env = setup({ "index.html": INDEX });
    await env.w.loadFile("index.html");
    const w = env.w;
    w.openBlocksModal();
    assert.ok(
      w.document.getElementById("blocks-modal").classList.contains("open"),
    );
    assert.strictEqual(
      w.document.querySelectorAll("#blocks-grid .block-card").length,
      w.eval("Blocks.list.length"),
    );
    assert.strictEqual(
      w.document.getElementById("blocks-position").value,
      "end",
      "no text block selected yet",
    );

    w.pickBlock("cta"); // has a link field -> form
    assert.strictEqual(
      w.document.getElementById("blocks-form-view").style.display,
      "",
    );
    const input = w.document.querySelector("#blocks-fields input");
    input.value = "https://example.com/start";
    w.confirmBlockForm();
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(
      !w.document.getElementById("blocks-modal").classList.contains("open"),
    );
    const shadow = w.document.getElementById("editor-host").shadowRoot;
    assert.strictEqual(
      shadow.querySelector('[data-cms-block="cta"] a').getAttribute("href"),
      "https://example.com/start",
    );

    w.openBlocksModal();
    w.pickBlock("divider"); // no fields -> inserted immediately
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(shadow.querySelectorAll("[data-cms-block]").length, 2);
  },
);

maybe("the dialog needs an open page", () => {
  const env = setup({ "index.html": INDEX });
  env.w.openBlocksModal();
  assert.ok(env.dialogs.alerts.some((a) => /Open a page first/.test(a)));
});
