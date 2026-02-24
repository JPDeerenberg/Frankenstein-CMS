// Editor state and Quill text formatting

let currentSha = "";
let originalRawHTML = "";
let currentPath = "";
let shadow = null;
let activeQuill = null;
const menu = document.getElementById("telepathic-menu");

window.fmt = function (type, val) {
  if (!activeQuill) return;

  const range = activeQuill.getSelection();
  if (!range || range.length === 0) return;

  activeQuill.focus();
  activeQuill.setSelection(range.index, range.length);

  if (val === undefined) {
    const currentFormat = activeQuill.getFormat(range.index, range.length);
    activeQuill.format(type, !currentFormat[type]);
  } else {
    activeQuill.format(type, val);
  }
};

window.askLink = function () {
  if (!activeQuill) return;

  const range = activeQuill.getSelection();
  if (!range || range.length === 0) return;

  activeQuill.focus();
  activeQuill.setSelection(range.index, range.length);

  const url = prompt("URL:", "https://");
  if (url) {
    activeQuill.format("link", url);
  }
};
