// GENERATED from shared/js/dialog.js. Edit that file, then run: npm run sync
// Promise-based dialogs for every alert/confirm/prompt in the CMS.
// Uses a native <dialog>, writes only textContent, and never blocks the page.
(function () {
  let dialog = null;
  let form = null;
  let messageEl = null;
  let inputWrap = null;
  let inputEl = null;
  let okBtn = null;
  let cancelBtn = null;
  let active = null;
  const queue = [];

  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "cms-dialog";
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "cms-dialog-message");

    form = document.createElement("form");
    form.className = "cms-dialog-form";
    form.method = "dialog";

    messageEl = document.createElement("p");
    messageEl.id = "cms-dialog-message";
    messageEl.className = "cms-dialog-message";

    inputWrap = document.createElement("label");
    inputWrap.className = "cms-dialog-field";
    inputWrap.hidden = true;
    const inputLabel = document.createElement("span");
    inputLabel.textContent = "Value";
    inputEl = document.createElement("input");
    inputEl.className = "cms-dialog-input";
    inputEl.type = "text";
    inputEl.autocomplete = "off";
    inputWrap.appendChild(inputLabel);
    inputWrap.appendChild(inputEl);

    const actions = document.createElement("menu");
    actions.className = "cms-dialog-actions";
    cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "cms-dialog-cancel";
    cancelBtn.textContent = "Cancel";
    okBtn = document.createElement("button");
    okBtn.type = "submit";
    okBtn.className = "cms-dialog-ok";
    okBtn.textContent = "OK";
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);

    form.appendChild(messageEl);
    form.appendChild(inputWrap);
    form.appendChild(actions);
    dialog.appendChild(form);
    document.body.appendChild(dialog);

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      finish(true);
    });
    cancelBtn.addEventListener("click", function () {
      finish(false);
    });
    dialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener("close", function () {
      if (!active) return;
      finish(dialog.returnValue === "ok");
    });
  }

  function next() {
    if (active || queue.length === 0) return;
    if (!dialog) build();
    const job = queue.shift();
    active = job;
    messageEl.textContent = job.message;
    const isPrompt = job.kind === "prompt";
    inputWrap.hidden = !isPrompt;
    cancelBtn.hidden = job.kind === "alert";
    inputEl.value = isPrompt ? job.defaultValue : "";
    okBtn.textContent = "OK";
    dialog.returnValue = "";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    if (isPrompt) {
      inputEl.focus();
      inputEl.select();
    } else {
      okBtn.focus();
    }
  }

  function finish(ok) {
    const job = active;
    if (!job) return;
    active = null;
    const value =
      job.kind === "alert"
        ? undefined
        : job.kind === "confirm"
          ? ok
          : ok
            ? inputEl.value
            : null;
    if (dialog.open) {
      try {
        dialog.close(ok ? "ok" : "cancel");
      } catch (e) {}
    }
    job.resolve(value);
    setTimeout(next, 0);
  }

  function open(kind, message, defaultValue) {
    return new Promise(function (resolve) {
      queue.push({
        kind: kind,
        message: String(message == null ? "" : message),
        defaultValue: defaultValue == null ? "" : String(defaultValue),
        resolve: resolve,
      });
      next();
    });
  }

  window.Dialog = {
    alert: function (message) {
      return open("alert", message);
    },
    confirm: function (message) {
      return open("confirm", message);
    },
    prompt: function (message, defaultValue) {
      return open("prompt", message, defaultValue);
    },
  };
})();
