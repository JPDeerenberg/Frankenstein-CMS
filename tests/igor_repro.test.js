const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const vm = require("vm");

test("igor.js XSS vulnerability fix verification", async (t) => {
  const code = fs.readFileSync("dev/js/igor.js", "utf8");

  class MockElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.style = {};
      this.attributes = {};
      this.className = "";
      this._innerHTML = "";
    }
    appendChild(child) {
      // Flatten document fragments like a real DOM
      if (child && child.tagName === "FRAGMENT" && child.children) {
        for (const c of child.children) this.children.push(c);
      } else {
        this.children.push(child);
      }
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
    set textContent(val) {
      this._textContent = val;
    }
    get textContent() {
      return this._textContent || "";
    }
    set innerHTML(val) {
      this._innerHTML = val;
      // Simulate clearing children when innerHTML is set to empty
      if (val === "") this.children = [];
    }
    get innerHTML() {
      return this._innerHTML;
    }
  }

  const mockedContainer = new MockElement("div");

  const sandbox = {
    window: {},
    document: {
      getElementById: (id) => {
        if (id === "igor-stats") return mockedContainer;
        return null;
      },
      createElement: (tag) => new MockElement(tag),
      createDocumentFragment: () => {
        const frag = new MockElement("fragment");
        frag.appendChild = function (child) {
          this.children.push(child);
        };
        return frag;
      },
      head: { appendChild: () => {} },
    },
    console: console,
  };
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const Igor = sandbox.window.Igor;
  Igor.init({ on: () => {} });

  await t.test("Igor.render treats malicious input as plain text", () => {
    const maliciousInput = "<img src=x onerror=alert(1)>";
    Igor.render({
      words: 100,
      time: 1,
      badLinks: 0,
      missingAlt: 0,
      headerIssue: maliciousInput,
    });

    // After render, badges are children of the container
    const badge = mockedContainer.children.find(
      (c) => c.textContent && c.textContent.includes(maliciousInput),
    );
    assert.ok(badge, "Badge with malicious input should exist");
    assert.strictEqual(
      badge.textContent,
      maliciousInput,
      "Malicious input should be treated as plain text via textContent",
    );
    // Ensure we did not inject HTML via innerHTML of the badge
    assert.strictEqual(badge._innerHTML || "", "");
  });
});
