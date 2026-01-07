// File and GitHub API operations

async function fetchFileList() {
  const listEl = document.getElementById("file-list");
  try {
    const res = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/contents/`,
      { headers: { Authorization: `token ${config.token}` } }
    );
    const data = await res.json();
    listEl.innerHTML = "";
    data
      .filter((f) => f.name.endsWith(".html"))
      .forEach((file) => {
        const li = document.createElement("li");
        li.innerText = file.name;
        li.onclick = () => loadFile(file.path, li);
        listEl.appendChild(li);
      });
  } catch (e) {
    listEl.innerHTML = "Error";
  }
}

async function loadFile(path, menuElement) {
  if (menuElement) {
    document
      .querySelectorAll("#file-list li")
      .forEach((l) => l.classList.remove("active"));
    menuElement.classList.add("active");
  }
  currentPath = path;
  document.getElementById("active-filename").innerText = path;

  const host = document.getElementById("editor-host");
  if (!host.shadowRoot) shadow = host.attachShadow({ mode: "open" });
  else shadow = host.shadowRoot;

  shadow.innerHTML = `<div style="padding:20px; color:#666;">Loading...</div>`;
  document.getElementById("saveBtn").style.display = "none";
  menu.style.display = "none";

  try {
    const res = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`,
      { headers: { Authorization: `token ${config.token}` } }
    );
    const data = await res.json();
    currentSha = data.sha;
    originalRawHTML =
      base64ToUtf8(data.content) ||
      decodeURIComponent(escape(window.atob(data.content)));

    const parser = new DOMParser();
    const doc = parser.parseFromString(originalRawHTML, "text/html");
    if (window.SEO) SEO.initInputs(doc);

    shadow.innerHTML = "";

    shadow.innerHTML = "";

    const qCss = document.createElement("link");
    qCss.rel = "stylesheet";
    qCss.href = "https://cdn.quilljs.com/1.3.6/quill.core.css";
    shadow.appendChild(qCss);

    const styleFix = document.createElement("style");
    styleFix.textContent = `
    :host {
        color: #1a1a1a; 
      }

      #cms-page-content {
        color: #1a1a1a;
    }

      [data-editable] {
        position: relative !important;
        display: block !important;
        border: 2px dashed #e74c3c;
        cursor: text;
        padding: 6px;

        margin: 0 0 6px 0;
        box-sizing: border-box;
        background: transparent !important;
        z-index: 1 !important;
      }
      [
      data-editable]:hover { border-style: solid; }

      .quill-host, .ql-container {
        position: static !important;
        display: block !important;
        width: 100% !important;
        z-index: 2 !important;
        background: transparent !important;
        pointer-events: auto !important;
      }

      .ql-editor {
        position: relative !important;
        z-index: 3 !important;
        display: block !important;
        width: 100% !important;
        min-height: 40px !important;
        padding: 4px 2px !important;
        margin: 0 !important;
        box-sizing: border-box !important;
        background: transparent !important;
        color: inherit !important;
        pointer-events: auto !important;
      }

      [data-editable] > *:not(.quill-host) {
        position: static !important;
      }
    `;
    shadow.appendChild(styleFix);

    const pageWrapper = document.createElement("div");
    pageWrapper.id = "cms-page-content";

    try {
      pageWrapper.className = doc.body.className;
      const bodyStyle = doc.body.getAttribute("style");
      if (bodyStyle) pageWrapper.setAttribute("style", bodyStyle);
    } catch (e) {
      console.warn("Kon body styles niet kopiëren", e);
    }

    pageWrapper.innerHTML = doc.body.innerHTML;
    shadow.appendChild(pageWrapper);

    const links = doc.querySelectorAll('link[rel="stylesheet"]');
    const currentDir = currentPath.includes("/")
      ? currentPath.substring(0, currentPath.lastIndexOf("/"))
      : "";
    links.forEach(async (l) => {
      try {
        const href = l.getAttribute("href");
        if (!href || href.startsWith("http")) return;
        const r = await fetch(
          `https://api.github.com/repos/${config.owner}/${
            config.repo
          }/contents/${resolvePath(currentDir, href)}`,
          {
            headers: {
              Authorization: `token ${config.token}`,
              Accept: "application/vnd.github.v3.raw",
            },
          }
        );
        if (!r.ok) return;
        const css = await r.text();
        const s = document.createElement("style");
        s.textContent = css;
        shadow.appendChild(s);
      } catch (e) {}
    });

    const imgs = pageWrapper.querySelectorAll("img");
    imgs.forEach(async (img) => {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("http")) return;
      img.setAttribute("data-original-src", src);
      try {
        const r = await fetch(
          `https://api.github.com/repos/${config.owner}/${
            config.repo
          }/contents/${resolvePath(currentDir, src)}`,
          {
            headers: {
              Authorization: `token ${config.token}`,
              Accept: "application/vnd.github.v3.raw",
            },
          }
        );
        if (!r.ok) return;
        const contentType =
          r.headers.get("Content-Type") || "application/octet-stream";
        const ab = await r.arrayBuffer();
        const b64 = arrayBufferToBase64(ab);
        img.src = `data:${contentType};base64,${b64}`;
      } catch (e) {
        console.error("Image load failed", src, e);
      }
    });

    pageWrapper
      .querySelectorAll("a")
      .forEach((a) => a.addEventListener("click", (e) => e.preventDefault()));

    const editables = pageWrapper.querySelectorAll("[data-editable]");
    editables.forEach((el) => {
      if (el.tagName === "P") {
        const div = document.createElement("div");
        Array.from(el.attributes).forEach((attr) => {
          div.setAttribute(attr.name, attr.value);
        });
        div.innerHTML = el.innerHTML;
        el.parentNode.replaceChild(div, el);
        el = div;
      }

      try {
        el.setAttribute("role", "textbox");
        el.setAttribute("aria-multiline", "true");
      } catch (e) {}

      const initialHtml = el.innerHTML;

      el.innerHTML = "";

      const quillHost = document.createElement("div");
      quillHost.className = "quill-host";
      quillHost.style.position = "relative";
      quillHost.style.pointerEvents = "auto";

      el.appendChild(quillHost);

      const q = new Quill(quillHost, {
        formats: [
          "header",
          "bold",
          "italic",
          "underline",
          "link",
          "image",
          "list",
        ],
        modules: { toolbar: false },
      });

      if (window.Igor) window.Igor.init(q);

      q.clipboard.dangerouslyPasteHTML(0, initialHtml);
      el.__quill = q;

      function showMenuAtRect(rect, quillInstance) {
        activeQuill = quillInstance || activeQuill;
        const top = rect.top - 50;
        const left = rect.left + rect.width / 2;
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
        menu.style.display = "block";
      }

      const handleSelection = () => {
        try {
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0 || sel.toString().length === 0) {
            menu.style.display = "none";
            return;
          }

          const r = sel.getRangeAt(0);
          if (
            el.contains(r.startContainer) ||
            el.contains(r.commonAncestorContainer)
          ) {
            activeQuill = q;
            showMenuAtRect(r.getBoundingClientRect(), q);
          } else {
            menu.style.display = "none";
          }
        } catch (e) {
          menu.style.display = "none";
        }
      };

      const debouncedHandle = debounce(handleSelection, 50);

      q.on("selection-change", function (range) {
        if (!range || range.length === 0) {
          menu.style.display = "none";
          return;
        }
        activeQuill = q;
        const bounds = q.getBounds(range.index, range.length);
        const containerRect = q.container.getBoundingClientRect();
        menu.style.top = `${containerRect.top + bounds.top - 50}px`;
        menu.style.left = `${
          containerRect.left + bounds.left + bounds.width / 2
        }px`;
        menu.style.display = "block";
      });

      q.on("text-change", function () {
        setUnsaved();
      });

      const qlEditor = el.querySelector(".ql-editor");
      if (qlEditor) {
        qlEditor.addEventListener("mouseup", debouncedHandle);
        qlEditor.addEventListener("keyup", debouncedHandle);
      }
    });

    const wrapperEl = document.getElementById("editor-wrapper");
    if (wrapperEl)
      wrapperEl.addEventListener("scroll", () => (menu.style.display = "none"));

    if (autosaveTimer) clearInterval(autosaveTimer);
    const autosaveToggle = document.getElementById("autosave-toggle");
    if (autosaveToggle) {
      autosaveToggle.checked = false;
      autosaveToggle.onchange = () => {
        if (autosaveToggle.checked) {
          autosaveTimer = setInterval(() => {
            if (isDirty) slaOp(true);
          }, AUTOSAVE_INTERVAL);
        } else {
          if (autosaveTimer) clearInterval(autosaveTimer);
        }
      };
    }

    document.getElementById("saveBtn").style.display = "inline-block";
    setSaved();
  } catch (e) {
    shadow.innerHTML = `<p style="color:red; padding:20px;">${e.message}</p>`;
  }
}

async function slaOp() {
  const btn = document.getElementById("saveBtn");
  const isAuto = arguments[0] === true;
  if (!isAuto) {
    btn.innerText = "Saving...";
    btn.disabled = true;
  }
  try {
    const fresh = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${currentPath}`,
      { headers: { Authorization: `token ${config.token}` } }
    );
    if (!fresh.ok)
      throw new Error("Failed to fetch current file for conflict check");
    const freshData = await fresh.json();
    if (freshData.sha !== currentSha) {
      if (!isAuto)
        alert("Conflict: file was modified on GitHub. Save aborted.");
      if (!isAuto) btn.disabled = false;
      return;
    }

    const wrapper = shadow.getElementById("cms-page-content");
    const clone = wrapper.cloneNode(true);

    clone.querySelectorAll(".ql-editor").forEach((ed) => {
      const cleanHTML = ed.innerHTML;

      const originalContainer = ed.closest("[data-editable]");

      if (originalContainer) {
        originalContainer.innerHTML = cleanHTML;

        originalContainer.removeAttribute("contenteditable");
        originalContainer.classList.remove(
          "ql-container",
          "ql-snow",
          "ql-disabled"
        );
      }
    });

    clone.querySelectorAll("img[data-original-src]").forEach((i) => {
      i.src = i.getAttribute("data-original-src");
      i.removeAttribute("data-original-src");
    });

    const parser = new DOMParser();
    const doc = parser.parseFromString(originalRawHTML, "text/html");
    doc.body.innerHTML = clone.innerHTML;

    if (window.SEO) SEO.applyToDoc(doc);

    const newHTML = new XMLSerializer().serializeToString(doc);
    const encoded =
      utf8ToBase64(newHTML) ||
      window.btoa(unescape(encodeURIComponent(newHTML)));

    const commitMsgInput = document.getElementById("commit-msg");
    let message = commitMsgInput && commitMsgInput.value.trim();
    if (!message) {
      if (isAuto) {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        const ss = String(now.getSeconds()).padStart(2, "0");
        message = `[Autosave] ${hh}:${mm}:${ss}`;
      } else {
        const p = prompt("Commit message:", "Frankenstein Save");
        message = p === null ? "Frankenstein Save" : p;
      }
    }

    await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${currentPath}`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          content: encoded,
          sha: currentSha,
        }),
      }
    );

    const r = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${currentPath}`,
      { headers: { Authorization: `token ${config.token}` } }
    );
    currentSha = (await r.json()).sha;
    originalRawHTML = newHTML;
    setSaved();
    if (!isAuto) alert("✅ Saved!");
  } catch (e) {
    if (!isAuto) alert("Error: " + e.message);
  }
  if (!isAuto) {
    btn.innerText = "💾 Save & Push";
    btn.disabled = false;
  }
}
