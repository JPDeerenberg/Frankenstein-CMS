const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../shared/js/dialog.js"),
  "utf8",
);

function makeWindow() {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://cms.example.com/",
    runScripts: "outside-only",
  });
  const win = dom.window;
  const proto = win.HTMLDialogElement.prototype;
  // jsdom 26 has <dialog> but not the modal methods. The production module
  // uses the native ones; this shim is only for the test DOM.
  if (!proto.showModal) {
    proto.showModal = function () {
      this.setAttribute("open", "");
    };
    proto.close = function (value) {
      this.removeAttribute("open");
      this.returnValue = value || "";
      this.dispatchEvent(new win.Event("close"));
    };
  }
  win.eval(SOURCE);
  return win;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("Dialog.alert resolves on OK and renders the message as text, never HTML", async () => {
  const win = makeWindow();
  const message = '<img src=x onerror="window.pwned=1"> & "quoted"';
  const done = win.Dialog.alert(message);
  const dialog = win.document.querySelector("dialog.cms-dialog");
  assert.ok(dialog.open);
  assert.strictEqual(
    dialog.querySelector(".cms-dialog-message").textContent,
    message,
  );
  assert.strictEqual(dialog.querySelectorAll("img").length, 0);
  assert.strictEqual(win.pwned, undefined);
  dialog.querySelector(".cms-dialog-ok").click();
  assert.strictEqual(await done, undefined);
  assert.strictEqual(dialog.open, false);
});

test("Dialog.confirm returns false for Cancel and Escape, true for OK", async () => {
  const win = makeWindow();
  let done = win.Dialog.confirm("Discard?");
  let dialog = win.document.querySelector("dialog.cms-dialog");
  dialog.querySelector(".cms-dialog-cancel").click();
  assert.strictEqual(await done, false);

  done = win.Dialog.confirm("Discard?");
  dialog = win.document.querySelector("dialog.cms-dialog");
  dialog.dispatchEvent(new win.Event("cancel", { cancelable: true }));
  assert.strictEqual(await done, false);

  done = win.Dialog.confirm("Discard?");
  dialog = win.document.querySelector("dialog.cms-dialog");
  dialog.querySelector(".cms-dialog-ok").click();
  assert.strictEqual(await done, true);
});

test("Dialog.prompt returns the input, an empty string, or null on cancel", async () => {
  const win = makeWindow();
  let done = win.Dialog.prompt("Alt text", "a cat");
  let dialog = win.document.querySelector("dialog.cms-dialog");
  const input = dialog.querySelector(".cms-dialog-input");
  assert.strictEqual(input.value, "a cat");
  input.value = "a dog";
  dialog.querySelector(".cms-dialog-ok").click();
  assert.strictEqual(await done, "a dog");

  done = win.Dialog.prompt("Alt text", "x");
  dialog = win.document.querySelector("dialog.cms-dialog");
  dialog.querySelector(".cms-dialog-input").value = "";
  dialog.querySelector(".cms-dialog-ok").click();
  assert.strictEqual(await done, "");

  done = win.Dialog.prompt("Alt text", "x");
  dialog = win.document.querySelector("dialog.cms-dialog");
  dialog.querySelector(".cms-dialog-cancel").click();
  assert.strictEqual(await done, null);
});

test("pressing Enter (form submit) confirms a prompt", async () => {
  const win = makeWindow();
  const done = win.Dialog.prompt("Link", "https://");
  const dialog = win.document.querySelector("dialog.cms-dialog");
  dialog.querySelector(".cms-dialog-input").value = "https://example.com";
  dialog
    .querySelector("form")
    .dispatchEvent(new win.Event("submit", { cancelable: true }));
  assert.strictEqual(await done, "https://example.com");
});

test("dialogs are queued instead of stacked", async () => {
  const win = makeWindow();
  const first = win.Dialog.confirm("First?");
  const second = win.Dialog.confirm("Second?");
  let dialog = win.document.querySelector("dialog.cms-dialog");
  assert.strictEqual(
    dialog.querySelector(".cms-dialog-message").textContent,
    "First?",
  );
  dialog.querySelector(".cms-dialog-ok").click();
  assert.strictEqual(await first, true);
  await tick();
  dialog = win.document.querySelector("dialog.cms-dialog");
  assert.strictEqual(
    dialog.querySelector(".cms-dialog-message").textContent,
    "Second?",
  );
  dialog.querySelector(".cms-dialog-cancel").click();
  assert.strictEqual(await second, false);
});
