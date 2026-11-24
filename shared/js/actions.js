// Event dispatcher. index.html contains NO inline event handlers and NO inline
// scripts: they would force 'unsafe-inline' into the Content-Security-Policy,
// which switches off its protection against injected scripts (the thing that
// stands between an XSS bug and your GitHub token).
//
// Elements declare what they do with data attributes:
//   data-action="name"     run on click
//   data-mousedown="name"  run on mousedown (and keep the editor focused)
//   data-change="name"     run on change
//   data-args='["a", 2]'   optional JSON arguments
// Only names listed in ACTIONS can run; nothing is ever evaluated as code.

const ACTIONS = {
  fmt: function (type, val) {
    return fmt(type, val);
  },
  askLink: function () {
    return askLink();
  },
  triggerImageUpload: function () {
    return triggerImageUpload();
  },
  handleImageUpload: function (event) {
    return handleImageUpload(event);
  },
  toggleSidebar: function () {
    return toggleSidebar();
  },
  closeSidebar: function () {
    return closeSidebar();
  },
  toggleMobilePreview: function () {
    return toggleMobilePreview();
  },
  startDemo: function () {
    return startDemo();
  },
  slaOp: function () {
    return slaOp();
  },
  saveConfigAndLogin: function () {
    return saveConfigAndLogin();
  },
  logout: function () {
    return logout();
  },
  installApp: function () {
    return installApp();
  },
  fetchFileList: function () {
    return fetchFileList();
  },
  openHistoryModal: function () {
    return openHistoryModal();
  },
  closeHistoryModal: function () {
    return closeHistoryModal();
  },
  openBlocksModal: function () {
    return openBlocksModal();
  },
  closeBlocksModal: function () {
    return closeBlocksModal();
  },
  showBlockList: function () {
    return showBlockList();
  },
  confirmBlockForm: function () {
    return confirmBlockForm();
  },
  "seo.openModal": function () {
    return SEO.openModal();
  },
  "seo.closeModal": function () {
    return SEO.closeModal();
  },
  "seo.saveAndClose": function () {
    return SEO.saveAndClose();
  },
};

// `withEvent` is only used for change events (the file picker needs the event);
// click/mousedown actions get exactly the arguments declared in data-args.
function runAction(name, argsJson, event, withEvent) {
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, name)) return;
  let args = [];
  if (argsJson) {
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      return;
    }
    if (!Array.isArray(args)) return;
  }
  return ACTIONS[name].apply(null, withEvent ? args.concat([event]) : args);
}

function initActions() {
  const find = function (e, attr) {
    return e.target && e.target.closest
      ? e.target.closest("[" + attr + "]")
      : null;
  };
  document.addEventListener("click", function (e) {
    const el = find(e, "data-action");
    if (el)
      runAction(el.getAttribute("data-action"), el.getAttribute("data-args"));
  });
  document.addEventListener("mousedown", function (e) {
    const el = find(e, "data-mousedown");
    if (!el) return;
    e.preventDefault(); // keep the text selection: the toolbar must not steal focus
    runAction(el.getAttribute("data-mousedown"), el.getAttribute("data-args"));
  });
  document.addEventListener("change", function (e) {
    const el = find(e, "data-change");
    if (el)
      runAction(
        el.getAttribute("data-change"),
        el.getAttribute("data-args"),
        e,
        true,
      );
  });
}

if (typeof document !== "undefined") initActions();
