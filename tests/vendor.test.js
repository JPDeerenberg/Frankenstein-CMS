const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { JSDOM, createEnv } = require("./helpers/dom-env");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("Quill is shipped locally, is 1.3.7, and dev/prod copies are identical", () => {
  for (const f of ["quill.min.js", "quill.core.css"]) {
    assert.ok(
      fs
        .readFileSync(path.join(ROOT, "dev/vendor", f))
        .equals(fs.readFileSync(path.join(ROOT, "prod/vendor", f))),
      f,
    );
  }
  assert.match(
    read("dev/vendor/quill.min.js").slice(0, 120),
    /Quill Editor v1\.3\.7/,
  );
});

for (const env of ["dev", "prod"]) {
  test(`${env}: no page or script loads Quill from a CDN, and the local files are wired in`, () => {
    const html = read(`${env}/index.html`);
    assert.ok(
      !html.includes("cdn.quilljs.com"),
      "CDN reference left in index.html",
    );
    assert.ok(
      !read(`${env}/js/files.js`).includes("cdn.quilljs.com"),
      "CDN reference left in files.js",
    );
    assert.match(html, /<script src="vendor\/quill\.min\.js"><\/script>/);
    assert.match(
      html,
      /<link rel="stylesheet" href="vendor\/quill\.core\.css"/,
    );
    assert.match(
      read(`${env}/js/files.js`),
      /qCss\.href = "vendor\/quill\.core\.css"/,
    );
    // the CSP no longer needs to trust any script host
    const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
    assert.match(csp, /script-src 'self' 'unsafe-inline';/);
    // Quill must be loaded (blocking) before the deferred CMS scripts that use it
    assert.ok(
      html.indexOf("vendor/quill.min.js") < html.indexOf('src="js/editor.js"'),
    );
    const sw = read(`${env}/sw.js`);
    assert.ok(
      sw.includes("./vendor/quill.min.js") &&
        sw.includes("./vendor/quill.core.css"),
    );
  });
}

const maybe = JSDOM ? test : test.skip;

maybe(
  "tabnabbing fix: every link Quill creates opts out of window.opener access",
  () => {
    const w = createEnv([]);
    const host = w.document.createElement("div");
    w.document.body.appendChild(host);
    const q = new w.Quill(host, {
      formats: ["link"],
      modules: { toolbar: false },
    });
    q.setContents(
      q.clipboard.convert('<a href="https://example.com">x</a>'),
      "silent",
    );
    const a = q.root.querySelector("a");
    assert.strictEqual(a.getAttribute("target"), "_blank");
    assert.match(a.getAttribute("rel") || "", /noopener/);
    assert.match(a.getAttribute("rel") || "", /noreferrer/);
  },
);

maybe(
  "disputed XSS advisory (CVE-2021-3163): event-handler payloads do not survive the editor or the save step",
  () => {
    const w = createEnv([
      "dev/js/utils.js",
      "dev/js/doc.js",
      "dev/js/editor.js",
    ]);
    const payloads = [
      '<img src="x" onloadstart="window.__pwned=1" onerror="window.__pwned=1">',
      '<img src=x onerror=window.__pwned=1 alt="a">',
      '<video src="x" onloadstart="window.__pwned=1"></video>',
      '<a href="javascript:window.__pwned=1" onclick="window.__pwned=1">x</a>',
      '<svg onload="window.__pwned=1"><circle/></svg>',
      '<p onmouseover="window.__pwned=1" style="x" class="y">text</p><script>window.__pwned=1</script>',
      '<img src="javascript:window.__pwned=1">',
    ];
    for (const html of payloads) {
      const host = w.document.createElement("div");
      w.document.body.appendChild(host);
      const q = new w.Quill(host, {
        formats: w.eval("EDITOR_FORMATS"),
        modules: { toolbar: false },
      });
      q.setContents(q.clipboard.convert(html), "silent");
      for (const out of [
        q.root.innerHTML,
        w.cleanEditorHtml(q.root.innerHTML, { mode: "block" }),
        w.cleanEditorHtml(q.root.innerHTML, { mode: "inline" }),
      ]) {
        assert.ok(
          !/\bon[a-z]+\s*=/i.test(out),
          "event handler survived: " + out,
        );
        assert.ok(
          !/javascript:/i.test(out),
          "javascript: URL survived: " + out,
        );
        assert.ok(
          !/<script|<svg|<video/i.test(out),
          "active element survived: " + out,
        );
      }
    }
    assert.strictEqual(w.__pwned, undefined, "no payload ran");
  },
);
