// Editor state and Quill text formatting

let currentSha = "";
let originalRawHTML = "";
let currentPath = "";
let shadow = null;
let activeQuill = null;
let activeRegion = null;
const menu = document.getElementById("telepathic-menu");

// Quill's default image sanitizer rewrites blob: URLs to "//:0", which would
// break previews of private images (and the path mapping used on save).
(function allowPreviewImageUrls() {
  if (typeof Quill === "undefined") return;
  const Img = Quill.import("formats/image");
  Img.sanitize = function (url) {
    const ok =
      /^(https?:|data:|blob:)/i.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url);
    return ok ? url : "//:0";
  };
})();

function hideMenu() {
  if (menu) menu.style.display = "none";
}

function showMenuForSelection(q, range, region) {
  if (!menu) return;
  activeQuill = q;
  activeRegion = region || activeRegion;
  const bounds = q.getBounds(range.index, range.length);
  const box = q.container.getBoundingClientRect();
  const x = box.left + bounds.left + bounds.width / 2;
  const y = box.top + bounds.top - 54;
  menu.dataset.mode = activeRegion ? activeRegion.mode : "block";
  menu.style.left = Math.max(90, Math.min(window.innerWidth - 90, x)) + "px";
  menu.style.top = Math.max(8, y) + "px";
  menu.style.display = "block";
}

/** Toolbar action. Pressing the same heading again turns it back into a paragraph. */
window.fmt = function (type, val) {
  if (!activeQuill) return;

  const range = activeQuill.getSelection();
  if (!range || range.length === 0) return;
  // Headings only make sense inside block containers (not inside an <h1>, <p>, <li> …)
  if (type === "header" && activeRegion && activeRegion.mode !== "block") {
    return;
  }

  activeQuill.focus();
  activeQuill.setSelection(range.index, range.length);

  const current = activeQuill.getFormat(range.index, range.length);
  let next;
  if (val === undefined) next = !current[type];
  else next = current[type] === val ? false : val;
  // "user" so the region is marked as edited and saved
  activeQuill.format(type, next, "user");
};

window.askLink = function () {
  if (!activeQuill) return;

  const range = activeQuill.getSelection();
  if (!range || range.length === 0) return;

  const url = prompt(
    "Link URL (https://… or a page like about.html):",
    "https://",
  );
  if (url && url !== "https://") {
    activeQuill.formatText(
      range.index,
      range.length,
      "link",
      url.trim(),
      "user",
    );
  }
};
