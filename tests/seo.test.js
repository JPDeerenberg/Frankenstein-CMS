const test = require("node:test");
const assert = require("node:assert");
const { JSDOM, createEnv } = require("./helpers/dom-env");

const maybe = JSDOM ? test : test.skip;
const SCRIPTS = ["dev/js/utils.js", "dev/js/seo.js", "dev/js/igor.js"];

const PAGE = `<!DOCTYPE html><html lang="en"><head><title>Home</title>
<meta name="description" content="Old description">
<meta name="robots" content="index, follow">
</head><body><h1>Hi</h1></body></html>`;

function setup(html) {
  const w = createEnv(SCRIPTS);
  const doc = new w.DOMParser().parseFromString(html || PAGE, "text/html");
  w.SEO.initInputs(doc);
  const el = (id) => w.document.getElementById(id);
  return { w, doc, el };
}

function apply(t, fill) {
  fill(t.el);
  const doc = new t.w.DOMParser().parseFromString(PAGE, "text/html");
  t.w.SEO.applyToDoc(doc);
  return doc;
}

maybe("existing values are read into the form", () => {
  const t =
    setup(`<!DOCTYPE html><html lang="nl"><head><title> Mijn pagina </title>
    <meta name="description" content="Beschrijving">
    <link rel="canonical" href="https://x.nl/a.html">
    <meta property="og:title" content="OG T"><meta property="og:description" content="OG D">
    <meta property="og:image" content="https://x.nl/i.jpg">
    <meta name="robots" content="noindex, follow"></head><body></body></html>`);
  assert.strictEqual(t.el("seo-title").value, "Mijn pagina");
  assert.strictEqual(t.el("seo-desc").value, "Beschrijving");
  assert.strictEqual(t.el("seo-canonical").value, "https://x.nl/a.html");
  assert.strictEqual(t.el("seo-og-title").value, "OG T");
  assert.strictEqual(t.el("seo-og-desc").value, "OG D");
  assert.strictEqual(t.el("seo-og-image").value, "https://x.nl/i.jpg");
  assert.strictEqual(t.el("seo-lang").value, "nl");
  assert.strictEqual(t.el("seo-noindex").checked, true);
});

maybe("an untouched form leaves the document byte-for-byte alone", () => {
  const t = setup();
  const doc = new t.w.DOMParser().parseFromString(PAGE, "text/html");
  const before = doc.documentElement.outerHTML;
  t.w.SEO.applyToDoc(doc);
  assert.strictEqual(doc.documentElement.outerHTML, before);
});

maybe("only the changed field is written", () => {
  const t = setup();
  const doc = apply(t, (el) => (el("seo-title").value = "New title"));
  assert.strictEqual(doc.querySelector("title").textContent, "New title");
  assert.strictEqual(
    doc.querySelector('meta[name="description"]').getAttribute("content"),
    "Old description",
  );
  assert.strictEqual(
    doc.querySelector('meta[name="robots"]').getAttribute("content"),
    "index, follow",
  );
  assert.ok(!doc.querySelector('meta[property="og:title"]'));
});

maybe(
  "social fields create the tags, and a share image adds a Twitter card",
  () => {
    const t = setup();
    const doc = apply(t, (el) => {
      el("seo-og-title").value = "Share me";
      el("seo-og-desc").value = "Share text";
      el("seo-og-image").value = "https://x.com/i.jpg";
    });
    const og = (p) =>
      doc.querySelector(`meta[property="${p}"]`).getAttribute("content");
    assert.strictEqual(og("og:title"), "Share me");
    assert.strictEqual(og("og:description"), "Share text");
    assert.strictEqual(og("og:image"), "https://x.com/i.jpg");
    assert.strictEqual(
      doc.querySelector('meta[name="twitter:card"]').getAttribute("content"),
      "summary_large_image",
    );
  },
);

maybe("an existing Twitter card is never overwritten", () => {
  const t = setup();
  const doc = new t.w.DOMParser().parseFromString(
    PAGE.replace(
      "</head>",
      '<meta name="twitter:card" content="summary"></head>',
    ),
    "text/html",
  );
  t.el("seo-og-image").value = "https://x.com/i.jpg";
  t.w.SEO.applyToDoc(doc);
  assert.strictEqual(
    doc.querySelectorAll('meta[name="twitter:card"]').length,
    1,
  );
  assert.strictEqual(
    doc.querySelector('meta[name="twitter:card"]').getAttribute("content"),
    "summary",
  );
});

maybe("emptying a field removes its tag", () => {
  const t = setup();
  const doc = apply(t, (el) => (el("seo-desc").value = ""));
  assert.ok(!doc.querySelector('meta[name="description"]'));
});

maybe("canonical and language are set and removed", () => {
  const t = setup();
  let doc = apply(t, (el) => {
    el("seo-canonical").value = "https://x.com/a.html";
    el("seo-lang").value = "nl";
  });
  assert.strictEqual(
    doc.querySelector('link[rel="canonical"]').getAttribute("href"),
    "https://x.com/a.html",
  );
  assert.strictEqual(doc.documentElement.getAttribute("lang"), "nl");
  doc = apply(t, (el) => (el("seo-lang").value = ""));
  assert.ok(!doc.documentElement.hasAttribute("lang"));
});

maybe(
  "noindex keeps the other robots directives and can be switched off again",
  () => {
    const t = setup();
    let doc = apply(t, (el) => (el("seo-noindex").checked = true));
    assert.strictEqual(
      doc.querySelector('meta[name="robots"]').getAttribute("content"),
      "noindex, index, follow",
    );
    // page that has no robots tag at all
    const bare = setup(
      "<!DOCTYPE html><html><head><title>T</title></head><body></body></html>",
    );
    bare.el("seo-noindex").checked = true;
    const d2 = new bare.w.DOMParser().parseFromString(
      "<!DOCTYPE html><html><head><title>T</title></head><body></body></html>",
      "text/html",
    );
    bare.w.SEO.applyToDoc(d2);
    assert.strictEqual(
      d2.querySelector('meta[name="robots"]').getAttribute("content"),
      "noindex",
    );
    // switch off on a page that only had noindex: tag disappears
    const off = setup(
      '<!DOCTYPE html><html><head><title>T</title><meta name="robots" content="noindex"></head><body></body></html>',
    );
    off.el("seo-noindex").checked = false;
    const d3 = new off.w.DOMParser().parseFromString(
      '<!DOCTYPE html><html><head><title>T</title><meta name="robots" content="noindex"></head><body></body></html>',
      "text/html",
    );
    off.w.SEO.applyToDoc(d3);
    assert.ok(!d3.querySelector('meta[name="robots"]'));
  },
);

maybe(
  "the live search preview follows the inputs and shortens long text",
  () => {
    const t = setup();
    t.el("seo-title").value = "x".repeat(80);
    t.el("seo-title").dispatchEvent(new t.w.Event("input"));
    assert.ok(t.el("seo-prev-title").textContent.length <= 60);
    assert.ok(t.el("seo-prev-title").textContent.endsWith("…"));
    t.el("seo-canonical").value = "https://x.com/p.html";
    t.el("seo-canonical").dispatchEvent(new t.w.Event("input"));
    assert.strictEqual(
      t.el("seo-prev-url").textContent,
      "https://x.com/p.html",
    );
  },
);

maybe("Igor reviews the fields", () => {
  const t = setup();
  const levels = (f, facts) =>
    Array.from(t.w.Igor.seoReport(f, facts)).map((n) => n.level + ":" + n.text);
  const good = {
    title: "A good page title that is the right length",
    desc: "A description with enough words in it to be useful to somebody who is searching, but not too long.",
    canonical: "https://x.com/a",
    ogImage: "https://x.com/i.jpg",
    lang: "en",
    noindex: false,
  };
  assert.match(levels(good, { h1: 1, imgsMissingAlt: 0 })[0], /^ok:/);

  const bad = levels(
    {
      title: "",
      desc: "",
      canonical: "/a",
      ogImage: "img/a.jpg",
      lang: "english!",
      noindex: true,
    },
    { h1: 0, imgsMissingAlt: 2 },
  ).join("\n");
  assert.match(bad, /err:Add a page title/);
  assert.match(bad, /meta description/);
  assert.match(bad, /canonical URL should be a full/);
  assert.match(bad, /share image must be a full/);
  assert.match(bad, /hidden from search engines/);
  assert.match(bad, /language code/);
  assert.match(bad, /no H1/);
  assert.match(bad, /2 image\(s\)/);

  assert.match(
    levels({ ...good, title: "t".repeat(70) }).join("\n"),
    /Title is long \(70\/60\)/,
  );
  assert.match(
    levels({ ...good, desc: good.title, title: good.title }).join("\n"),
    /identical/,
  );
  assert.match(
    levels({ ...good, ogImage: "" }).join("\n"),
    /tip:No share image/,
  );
  assert.match(levels(good, { h1: 3, imgsMissingAlt: 0 }).join("\n"), /3 H1/);
});

maybe("the review appears inside the modal when it opens", () => {
  const t = setup();
  t.w.eval('currentPath = "index.html"');
  t.w.SEO.openModal();
  assert.ok(t.el("seo-igor").children.length > 0);
});
