const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const vm = require("vm");

test("ui.js state and navigation tests", async (t) => {
  const code = fs.readFileSync("dev/js/ui.js", "utf8");

  function createSandbox() {
    const elements = {};

    const createElementMock = (id) => {
      if (!elements[id]) {
        elements[id] = {
          id: id,
          innerText: "",
          value: "",
          style: {},
          classList: {
            classes: new Set(),
            add: function (cls) {
              this.classes.add(cls);
            },
            remove: function (cls) {
              this.classes.delete(cls);
            },
            contains: function (cls) {
              return this.classes.has(cls);
            },
          },
        };
      }
      return elements[id];
    };

    const sandbox = {
      document: {
        getElementById: (id) => {
          if (id === "non-existent") return null;
          return createElementMock(id);
        },
        addEventListener: () => {},
        visibilityState: "visible",
      },
      localStorage: {
        getItem: () => null,
        setItem: () => {},
      },
      fetchFileList: () => {
        sandbox.fetchFileListCalled = true;
      },
      fetchFileListCalled: false,
      console: console,
    };

    const modCode = code.replace("let isDirty = false;", "var isDirty = false;");

    vm.createContext(sandbox);
    vm.runInContext(modCode, sandbox);
    return sandbox;
  }

  await t.test("setUnsaved() updates isDirty and save-status element", () => {
    const sandbox = createSandbox();
    sandbox.setUnsaved();
    assert.strictEqual(sandbox.isDirty, true);
    const el = sandbox.document.getElementById("save-status");
    assert.strictEqual(el.innerText, "● Unsaved changes");
    assert.strictEqual(el.style.color, "#f39c12");
  });

  await t.test("setSaved() updates isDirty and save-status element", () => {
    const sandbox = createSandbox();
    sandbox.setUnsaved();
    sandbox.setSaved();
    assert.strictEqual(sandbox.isDirty, false);
    const el = sandbox.document.getElementById("save-status");
    assert.ok(el.innerText.startsWith("✓ Saved"));
    assert.strictEqual(el.style.color, "#2ecc71");
  });

  await t.test("setUnsaved() handles missing element gracefully", () => {
    const sandbox = createSandbox();
    sandbox.document.getElementById = (id) => null;
    assert.doesNotThrow(() => {
      sandbox.setUnsaved();
    });
    assert.strictEqual(sandbox.isDirty, true);
  });

  await t.test(
    "showDashboard() toggles active classes and calls fetchFileList",
    () => {
      const sandbox = createSandbox();
      const loginScreen = sandbox.document.getElementById("login-screen");
      const dashboardScreen = sandbox.document.getElementById(
        "dashboard-screen",
      );
      loginScreen.classList.add("active");
      sandbox.showDashboard();
      assert.strictEqual(loginScreen.classList.contains("active"), false);
      assert.strictEqual(dashboardScreen.classList.contains("active"), true);
      assert.strictEqual(sandbox.fetchFileListCalled, true);
    },
  );
});
