const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { JSDOM, createEnv } = require("./helpers/dom-env");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

/** width/height from a PNG header */
function pngSize(file) {
  const b = fs.readFileSync(path.join(ROOT, file));
  assert.strictEqual(
    b.subarray(1, 4).toString(),
    "PNG",
    file + " is not a PNG",
  );
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

for (const env of ["dev", "prod"]) {
  test(`${env}: page is mobile-ready (viewport, manifest, icons, theme colour)`, () => {
    const html = read(`${env}/index.html`);
    assert.match(
      html,
      /<meta\s+name="viewport"\s+content="[^"]*width=device-width[^"]*initial-scale=1/,
    );
    assert.match(html, /<link rel="manifest" href="manifest\.webmanifest"/);
    assert.match(html, /<meta name="theme-color"/);
    assert.match(
      html,
      /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png"/,
    );
    assert.match(html, /<script src="js\/pwa\.js" defer>/);
    for (const m of html.matchAll(
      /(?:href|src)="((?:icons\/|manifest|js\/)[^"]+)"/g,
    )) {
      assert.ok(
        exists(`${env}/${m[1]}`),
        `${env}/index.html references missing ${m[1]}`,
      );
    }
    // phone chrome that the CSS and pwa.js rely on
    for (const needle of [
      'class="mobile-bar"',
      'class="sidebar-backdrop"',
      'id="btn-install"',
      'data-action="toggleSidebar"',
      'data-action="closeSidebar"',
      'data-action="installApp"',
    ]) {
      assert.ok(
        html.includes(needle),
        `${env}/index.html is missing ${needle}`,
      );
    }
  });

  test(`${env}: manifest is valid and its icons exist with the declared sizes`, () => {
    const m = JSON.parse(read(`${env}/manifest.webmanifest`));
    assert.strictEqual(m.display, "standalone");
    assert.ok(m.name && m.short_name && m.start_url && m.scope);
    assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
    const by = (size, purpose) =>
      m.icons.find((i) => i.sizes === size && i.purpose === purpose);
    assert.ok(
      by("192x192", "any") && by("512x512", "any"),
      "installable on Android needs 192 and 512",
    );
    assert.ok(by("512x512", "maskable"), "adaptive icon");
    for (const icon of m.icons) {
      const [w, h] = pngSize(`${env}/${icon.src}`);
      assert.strictEqual(`${w}x${h}`, icon.sizes, icon.src);
    }
    assert.deepStrictEqual(
      pngSize(`${env}/icons/apple-touch-icon.png`),
      [180, 180],
    );
  });

  test(`${env}: every file the service worker caches exists`, () => {
    const sw = read(`${env}/sw.js`);
    const list = sw.slice(
      sw.indexOf("const ASSETS = ["),
      sw.indexOf("];", sw.indexOf("const ASSETS = [")),
    );
    const paths = [...list.matchAll(/"\.\/([^"]*)"/g)]
      .map((m) => m[1])
      .filter(Boolean);
    assert.ok(
      paths.includes("manifest.webmanifest") &&
        paths.includes("js/pwa.js") &&
        paths.includes("js/blocks.js"),
    );
    for (const p of paths)
      assert.ok(exists(`${env}/${p}`), `sw.js caches missing ${p}`);
  });

  test(`${env}: stylesheet has the phone layout and the touch toolbar`, () => {
    const css = read(`${env}/css/style.css`);
    const phone = css.slice(css.indexOf("@media (max-width: 820px)"));
    assert.ok(phone.length > 100, "phone media query missing");
    assert.match(
      phone,
      /\.sidebar\s*\{[^}]*position:\s*fixed[^}]*transform:\s*translateX/s,
    );
    assert.match(
      phone,
      /body\.sidebar-open \.sidebar\s*\{[^}]*transform:\s*none/s,
    );
    assert.match(phone, /#dashboard-screen\s*\{[^}]*flex-direction:\s*column/s);
    assert.match(phone, /font-size:\s*16px/, "16px inputs stop iOS zoom");
    assert.match(css, /@media \(pointer: coarse\)\s*\{[^}]*#telepathic-menu/s);
    // balanced braces: a typo would silently drop every rule after it
    assert.strictEqual(
      (css.match(/\{/g) || []).length,
      (css.match(/\}/g) || []).length,
    );
  });
}

test("dev and prod ship the same manifest and icons", () => {
  assert.strictEqual(
    read("dev/manifest.webmanifest"),
    read("prod/manifest.webmanifest"),
  );
  for (const f of [
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-512.png",
    "apple-touch-icon.png",
  ]) {
    assert.ok(
      fs
        .readFileSync(path.join(ROOT, "dev/icons", f))
        .equals(fs.readFileSync(path.join(ROOT, "prod/icons", f))),
      f,
    );
  }
});

const maybe = JSDOM ? test : test.skip;
const HTML = `<div class="sidebar"><ul id="file-list"><li id="f1">a.html</li></ul><button class="action" id="act">Act</button><button id="plain">Refresh</button>
  <button id="btn-install" style="display:none">Install</button></div>`;

function phone() {
  return createEnv(["dev/js/pwa.js"], { html: HTML });
}

maybe(
  "the drawer opens, closes, and closes again when a file or action is tapped",
  () => {
    const w = phone();
    const open = () => w.document.body.classList.contains("sidebar-open");
    w.toggleSidebar();
    assert.strictEqual(open(), true);
    w.document.getElementById("f1").click();
    assert.strictEqual(open(), false, "choosing a file closes the drawer");
    w.toggleSidebar();
    w.document.getElementById("act").click();
    assert.strictEqual(open(), false, "a sidebar action closes the drawer");
    w.toggleSidebar();
    w.document.getElementById("plain").click();
    assert.strictEqual(open(), true, "other buttons leave it open");
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
    assert.strictEqual(open(), false);
    w.toggleSidebar();
    w.closeSidebar();
    assert.strictEqual(open(), false);
  },
);

maybe(
  "the install button appears when the browser offers installation and works once",
  async () => {
    const w = phone();
    const btn = w.document.getElementById("btn-install");
    assert.strictEqual(btn.style.display, "none");

    let prompted = 0;
    const ev = new w.Event("beforeinstallprompt", { cancelable: true });
    ev.prompt = () => prompted++;
    ev.userChoice = Promise.resolve({ outcome: "accepted" });
    w.dispatchEvent(ev);
    assert.strictEqual(
      ev.defaultPrevented,
      true,
      "the browser's own mini-banner is replaced by our button",
    );
    assert.strictEqual(btn.style.display, "");

    await w.installApp();
    assert.strictEqual(prompted, 1);
    assert.strictEqual(btn.style.display, "none");
    await w.installApp(); // nothing left to prompt
    assert.strictEqual(prompted, 1);
  },
);

maybe(
  "installing hides the button; without an offer, installApp does nothing",
  async () => {
    const w = phone();
    await w.installApp();
    const ev = new w.Event("beforeinstallprompt", { cancelable: true });
    ev.prompt = () => {};
    ev.userChoice = Promise.resolve({});
    w.dispatchEvent(ev);
    w.dispatchEvent(new w.Event("appinstalled"));
    assert.strictEqual(
      w.document.getElementById("btn-install").style.display,
      "none",
    );
  },
);
