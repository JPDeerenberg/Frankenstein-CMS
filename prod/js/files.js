// File and GitHub API operations

const resourceCache = new Map();

async function githubFetch(apiPath, options) {
  options = options || {};
  const url = `${config.bouncerUrl}?path=${encodeURIComponent(apiPath)}`;
  const headers = Object.assign({}, options.headers || {});
  headers["Site-Email"] = config.email;

  // Prefer short-lived session token over password when available
  if (config.sessionToken) {
    headers["Site-Session"] = config.sessionToken;
  } else {
    headers["Site-Password"] = config.password;
  }

  const fetchOptions = Object.assign({}, options);
  fetchOptions.headers = headers;

  const res = await fetchWithRetry(url, fetchOptions);

  // Capture session token issued by the bouncer (if any)
  const issued = res.headers.get("X-Session-Token");
  if (issued) {
    config.sessionToken = issued;
  }
  return res;
}

async function fetchFileList() {
  const listEl = document.getElementById("file-list");

  if (config.isDemo) {
    listEl.innerHTML = "";
    const demoFiles = [{ name: "demo_page.html", path: "demo_page.html" }];
    demoFiles.forEach(function (file) {
      const li = document.createElement("li");
      li.innerText = file.name;
      li.onclick = function () {
        loadFile(file.path, li);
      };
      listEl.appendChild(li);
    });
    return;
  }

  try {
    listEl.innerHTML =
      "<li style='color:#666;pointer-events:none'>Loading files…</li>";
    const files = await listHtmlFilesRecursive(githubFetch, "", 0, 4);
    listEl.innerHTML = "";
    if (files.length === 0) {
      listEl.innerHTML =
        "<li style='color:#666;pointer-events:none'>No HTML files found</li>";
      return;
    }
    files.forEach(function (file) {
      const li = document.createElement("li");
      li.innerText = file.name;
      li.title = file.path;
      li.onclick = function () {
        loadFile(file.path, li);
      };
      listEl.appendChild(li);
    });
  } catch (e) {
    console.error("fetchFileList failed", e);
    listEl.innerHTML =
      "<li style='color:#c0392b;pointer-events:none'>Error loading files</li>";
  }
}

async function loadFile(path, menuElement) {
  if (menuElement) {
    document.querySelectorAll("#file-list li").forEach(function (l) {
      l.classList.remove("active");
    });
    menuElement.classList.add("active");
  }
  currentPath = path;
  const currentDir = path.includes("/")
    ? path.substring(0, path.lastIndexOf("/"))
    : "";

  document.getElementById("active-filename").innerText = path;

  cacheClear(resourceCache);

  const host = document.getElementById("editor-host");
  if (!host.shadowRoot) shadow = host.attachShadow({ mode: "open" });
  else shadow = host.shadowRoot;

  shadow.innerHTML = `<div style="padding:20px; color:#666;">Loading...</div>`;
  document.getElementById("saveBtn").style.display = "none";
  menu.style.display = "none";

  try {
    let data;
    if (config.isDemo) {
      try {
        const response = await fetch("demo_page.html");
        if (!response.ok) {
          throw new Error(
            `Could not find demo_page.html (Status: ${response.status}). Did you create the file?`,
          );
        }
        const textContent = await response.text();
        data = {
          sha: "demo-sha-local-file",
          content: utf8ToBase64(textContent),
        };
      } catch (err) {
        console.error("Demo fetch error:", err);
        data = {
          sha: "error",
          content: utf8ToBase64(
            "<h1>404 Demo Not Found</h1><p>Create a file named <code>demo_page.html</code> next to index.html!</p>",
          ),
        };
      }
    } else {
      const res = await githubFetch(
        `/repos/${config.owner}/${config.repo}/contents/${path}`,
      );
      if (!res.ok) {
        throw new Error(`Failed to load file (${res.status})`);
      }
      data = await res.json();
    }
    currentSha = data.sha;
    originalRawHTML =
      base64ToUtf8(data.content) ||
      decodeURIComponent(escape(window.atob(data.content)));

    const parser = new DOMParser();
    const doc = parser.parseFromString(originalRawHTML, "text/html");
    if (window.SEO) SEO.initInputs(doc);

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
      [data-editable]:hover { border-style: solid; }

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
        text-align: inherit !important;
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
      console.warn("Could not copy body styles", e);
    }

    pageWrapper.innerHTML = doc.body.innerHTML;
    shadow.appendChild(pageWrapper);

    // Shared asset loaders (deduped into utils.js)
    injectScopedInlineStyles(doc, shadow, pageWrapper);

    const assetPromises = collectStylesheetPromises({
      doc: doc,
      shadow: shadow,
      currentDir: currentDir,
      resourceCache: resourceCache,
      fetchRaw: async function (resolvedHref) {
        const r = await githubFetch(
          `/repos/${config.owner}/${config.repo}/contents/${resolvedHref}`,
          { headers: { Accept: "application/vnd.github.v3.raw" } },
        );
        if (!r.ok) return null;
        return await r.text();
      },
    }).concat(
      collectImagePromises({
        pageWrapper: pageWrapper,
        currentDir: currentDir,
        resourceCache: resourceCache,
        fetchRawBinary: async function (resolvedSrc) {
          const r = await githubFetch(
            `/repos/${config.owner}/${config.repo}/contents/${resolvedSrc}`,
            { headers: { Accept: "application/vnd.github.v3.raw" } },
          );
          if (!r.ok) return null;
          const contentType =
            r.headers.get("Content-Type") || "application/octet-stream";
          const ab = await r.arrayBuffer();
          const b64 = arrayBufferToBase64(ab);
          return `data:${contentType};base64,${b64}`;
        },
      }),
    );

    await Promise.allSettled(assetPromises);

    pageWrapper.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
      });
    });

    const editables = pageWrapper.querySelectorAll("[data-editable]");
    editables.forEach(function (el) {
      if (!el.parentNode) return;

      // Prod: preserve original heading/paragraph tags via data-original-tag
      if (["P", "H1", "H2", "H3", "H4", "H5", "H6"].includes(el.tagName)) {
        const div = document.createElement("div");
        const s = window.getComputedStyle(el);

        div.style.textAlign = s.textAlign;
        div.style.fontSize = s.fontSize;
        div.style.lineHeight = s.lineHeight;
        div.style.color = s.color;
        div.style.fontWeight = s.fontWeight;
        div.style.maxWidth = s.maxWidth;
        div.style.marginTop = s.marginTop;
        div.style.marginBottom = s.marginBottom;

        if (s.marginLeft === s.marginRight && parseFloat(s.marginLeft) > 0) {
          div.style.marginLeft = "auto";
          div.style.marginRight = "auto";
        } else {
          div.style.marginLeft = s.marginLeft;
          div.style.marginRight = s.marginRight;
        }

        div.setAttribute("data-original-tag", el.tagName);
        const originalStyleAttr = el.getAttribute("style");
        if (originalStyleAttr) {
          div.setAttribute("data-original-style", originalStyleAttr);
        }

        Array.from(el.attributes).forEach(function (attr) {
          if (attr.name !== "style") {
            div.setAttribute(attr.name, attr.value);
          }
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
          "align",
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

      const handleSelection = function () {
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
      wrapperEl.addEventListener("scroll", function () {
        menu.style.display = "none";
      });

    if (autosaveTimer) clearInterval(autosaveTimer);
    const autosaveToggle = document.getElementById("autosave-toggle");
    if (autosaveToggle) {
      autosaveToggle.checked = false;
      autosaveToggle.onchange = function () {
        if (autosaveToggle.checked) {
          autosaveTimer = setInterval(function () {
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
    if (config.isDemo) {
      await new Promise(function (r) {
        setTimeout(r, 600);
      });
      setSaved();
      if (!isAuto) alert("✅ Saved to the void! (This is just a demo)");
      if (!isAuto) {
        btn.innerText = "💾 Save & Push";
        btn.disabled = false;
      }
      return;
    }

    const fresh = await githubFetch(
      `/repos/${config.owner}/${config.repo}/contents/${currentPath}`,
    );
    if (!fresh.ok)
      throw new Error("Failed to fetch current file for conflict check");
    const freshData = await fresh.json();
    if (freshData.sha !== currentSha) {
      if (!isAuto) {
        const reload = confirm(
          "This file was modified on GitHub (by someone else or in another tab).\n\n" +
            "Reload the latest version?\n(Your unsaved changes will be lost.)",
        );
        if (reload) {
          loadFile(currentPath);
        }
      }
      if (!isAuto) {
        btn.innerText = "💾 Save & Push";
        btn.disabled = false;
      }
      return;
    }

    const wrapper = shadow.getElementById("cms-page-content");
    const clone = wrapper.cloneNode(true);

    clone.querySelectorAll(".ql-editor").forEach(function (ed) {
      const cleanHTML = ed.innerHTML;
      const originalContainer = ed.closest("[data-editable]");
      if (originalContainer) {
        originalContainer.innerHTML = cleanHTML;
        originalContainer.removeAttribute("contenteditable");
        originalContainer.classList.remove(
          "ql-container",
          "ql-snow",
          "ql-disabled",
        );
      }
    });

    // Restore original tags (prod-specific)
    clone.querySelectorAll("[data-original-tag]").forEach(function (div) {
      const tagName = div.getAttribute("data-original-tag");
      const originalEl = document.createElement(tagName);

      Array.from(div.attributes).forEach(function (attr) {
        if (
          !["data-original-tag", "data-original-style", "style"].includes(
            attr.name,
          )
        ) {
          originalEl.setAttribute(attr.name, attr.value);
        }
      });

      const originalStyle = div.getAttribute("data-original-style");
      if (originalStyle) {
        originalEl.setAttribute("style", originalStyle);
      }

      if (div.children.length === 1 && div.children[0].tagName === "P") {
        originalEl.innerHTML = div.children[0].innerHTML;
      } else {
        originalEl.innerHTML = div.innerHTML;
      }

      div.parentNode.replaceChild(originalEl, div);
    });

    clone.querySelectorAll("img[data-original-src]").forEach(function (i) {
      i.src = i.getAttribute("data-original-src");
      i.removeAttribute("data-original-src");
    });

    const newHTML = serializeDocument(
      originalRawHTML,
      clone.innerHTML,
      true,
    );
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

    const putRes = await githubFetch(
      `/repos/${config.owner}/${config.repo}/contents/${currentPath}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message,
          content: encoded,
          sha: currentSha,
        }),
      },
    );

    if (!putRes.ok) {
      if (putRes.status === 409) {
        if (!isAuto) {
          const reload = confirm(
            "Conflict: the file changed on GitHub while you were editing.\n\n" +
              "Reload the latest version?\n(Your unsaved changes will be lost.)",
          );
          if (reload) loadFile(currentPath);
        }
        if (!isAuto) {
          btn.innerText = "💾 Save & Push";
          btn.disabled = false;
        }
        return;
      }
      let detail = "";
      try {
        const errBody = await putRes.json();
        detail = errBody && errBody.message ? ": " + errBody.message : "";
      } catch (_) {}
      throw new Error("Save failed (" + putRes.status + ")" + detail);
    }

    // Reuse SHA from PUT response
    const putData = await putRes.json();
    if (putData && putData.content && putData.content.sha) {
      currentSha = putData.content.sha;
    } else if (putData && putData.sha) {
      currentSha = putData.sha;
    }
    originalRawHTML = newHTML;
    rememberCommitMessage(message);
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


/* ========== Feature helpers (history, upload, serialize) ========== */

const LAST_COMMIT_KEY = "frankenstein_last_commit_msg";

function rememberCommitMessage(message) {
  try {
    if (message && !message.startsWith("[Autosave]")) {
      localStorage.setItem(LAST_COMMIT_KEY, message);
    }
  } catch (e) {}
}

/**
 * Reconstruct full HTML preserving doctype and <html> attributes
 * from the original document when possible.
 */
function serializeDocument(originalRaw, bodyInnerHTML, applySeo) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(originalRaw, "text/html");
  doc.body.innerHTML = bodyInnerHTML;
  if (applySeo && window.SEO) SEO.applyToDoc(doc);

  // Prefer original doctype if present
  let doctype = "<!DOCTYPE html>";
  try {
    const m = originalRaw.match(/<!DOCTYPE[^>]*>/i);
    if (m) doctype = m[0];
  } catch (e) {}

  // Rebuild <html> opening tag with original attributes
  let htmlOpen = "<html";
  try {
    const htmlEl = doc.documentElement;
    if (htmlEl && htmlEl.attributes) {
      for (let i = 0; i < htmlEl.attributes.length; i++) {
        const a = htmlEl.attributes[i];
        htmlOpen += " " + a.name + '="' + a.value.replace(/"/g, "&quot;") + '"';
      }
    }
  } catch (e) {}
  htmlOpen += ">";

  const head = doc.head ? doc.head.outerHTML : "<head></head>";
  const body = doc.body ? doc.body.outerHTML : "<body></body>";
  return doctype + "\n" + htmlOpen + "\n" + head + "\n" + body + "\n</html>";
}

async function loadCommitHistory() {
  const listEl = document.getElementById("history-list");
  if (!listEl) return;
  if (!currentPath || (config && config.isDemo)) {
    listEl.innerHTML = "<li>History is not available in demo mode.</li>";
    return;
  }
  listEl.innerHTML = "<li>Loading history…</li>";
  try {
    const fetchFn = typeof apiFetch === "function" ? apiFetch : githubFetch;
    const res = await fetchFn(
      `/repos/${config.owner}/${config.repo}/commits?path=${encodeURIComponent(currentPath)}&per_page=20`,
    );
    if (!res.ok) throw new Error("Failed to load commits (" + res.status + ")");
    const commits = await res.json();
    listEl.innerHTML = "";
    if (!Array.isArray(commits) || commits.length === 0) {
      listEl.innerHTML = "<li>No commits found for this file.</li>";
      return;
    }
    commits.forEach(function (c) {
      const li = document.createElement("li");
      li.style.cursor = "pointer";
      li.style.padding = "8px 4px";
      li.style.borderBottom = "1px solid #334155";
      const msg = (c.commit && c.commit.message ? c.commit.message : c.sha).split("\n")[0];
      const date = c.commit && c.commit.author ? c.commit.author.date : "";
      const short = c.sha ? c.sha.slice(0, 7) : "";
      li.innerHTML =
        "<strong>" +
        short +
        "</strong> — " +
        msg.replace(/</g, "&lt;") +
        (date
          ? '<br><span style="opacity:0.7;font-size:0.85em">' +
            new Date(date).toLocaleString() +
            "</span>"
          : "");
      li.onclick = function () {
        if (
          confirm(
            "Load this version into the editor?\nUnsaved changes will be lost.\n\n" +
              msg,
          )
        ) {
          revertToCommit(c.sha);
        }
      };
      listEl.appendChild(li);
    });
  } catch (e) {
    listEl.innerHTML = "<li style='color:#f87171'>Error: " + e.message + "</li>";
  }
}

async function revertToCommit(sha) {
  try {
    const fetchFn = typeof apiFetch === "function" ? apiFetch : githubFetch;
    const res = await fetchFn(
      `/repos/${config.owner}/${config.repo}/contents/${currentPath}?ref=${encodeURIComponent(sha)}`,
    );
    if (!res.ok) throw new Error("Could not load version (" + res.status + ")");
    const data = await res.json();
    // Load content into editor without changing currentSha (user must Save to write back)
    const content =
      base64ToUtf8(data.content) ||
      decodeURIComponent(escape(window.atob(data.content)));
    originalRawHTML = content;
    // Re-render by calling loadFile path but keep sha of HEAD for conflict checks
    // Soft-load: parse and rebuild editor view
    closeHistoryModal();
    // Force reload from the blob we have by temporarily using a demo-like path
    const parser = new DOMParser();
    // Easiest reliable approach: write content into a temp path via loadFile after swapping
    // Use loadFile which fetches again — instead patch current display:
    await loadFileFromContent(content, currentPath);
    setUnsaved();
    alert(
      "Historical version loaded into the editor. Click Save & Push to restore it on GitHub.",
    );
  } catch (e) {
    alert("Revert failed: " + e.message);
  }
}

/** Render editor from raw HTML string without refetching (for history). */
async function loadFileFromContent(html, path) {
  // Reuse loadFile by stashing — simplest: set demo-like local data path
  // Direct approach: invoke core of loadFile
  currentPath = path;
  document.getElementById("active-filename").innerText = path + " (historical)";
  const host = document.getElementById("editor-host");
  if (!host.shadowRoot) shadow = host.attachShadow({ mode: "open" });
  else shadow = host.shadowRoot;
  // Trigger full loadFile after setting a one-shot override is complex;
  // For reliability, call loadFile on current path then overwrite — user already confirmed.
  // Instead: save content to a session flag and call internal rebuild.
  originalRawHTML = html;
  // Full reload of current file would overwrite — so rebuild using existing loadFile structure
  // by temporarily using isDemo-style injection:
  const wasDemo = config.isDemo;
  const prevFetch = window.__frankensteinHistoryContent;
  window.__frankensteinHistoryContent = html;
  try {
    // Monkey-patch: loadFile checks isDemo first. Use a lightweight rebuild:
    shadow.innerHTML = "";
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    if (window.SEO) SEO.initInputs(doc);
    const styleFix = document.createElement("style");
    styleFix.textContent =
      "[data-editable]{border:2px dashed #e74c3c;padding:6px;cursor:text;}";
    shadow.appendChild(styleFix);
    const pageWrapper = document.createElement("div");
    pageWrapper.id = "cms-page-content";
    pageWrapper.innerHTML = doc.body.innerHTML;
    shadow.appendChild(pageWrapper);
    injectScopedInlineStyles(doc, shadow, pageWrapper);
    const currentDir = path.includes("/")
      ? path.substring(0, path.lastIndexOf("/"))
      : "";
    const fetchFn = typeof apiFetch === "function" ? apiFetch : githubFetch;
    const assetPromises = collectStylesheetPromises({
      doc: doc,
      shadow: shadow,
      currentDir: currentDir,
      resourceCache: resourceCache,
      fetchRaw: async function (resolvedHref) {
        try {
          const r = await fetchFn(
            `/repos/${config.owner}/${config.repo}/contents/${resolvedHref}`,
            { headers: { Accept: "application/vnd.github.v3.raw" } },
          );
          if (!r.ok) return null;
          return await r.text();
        } catch (e) {
          return null;
        }
      },
    }).concat(
      collectImagePromises({
        pageWrapper: pageWrapper,
        currentDir: currentDir,
        resourceCache: resourceCache,
        fetchRawBinary: async function (resolvedSrc) {
          try {
            const r = await fetchFn(
              `/repos/${config.owner}/${config.repo}/contents/${resolvedSrc}`,
              { headers: { Accept: "application/vnd.github.v3.raw" } },
            );
            if (!r.ok) return null;
            const contentType =
              r.headers.get("Content-Type") || "application/octet-stream";
            const ab = await r.arrayBuffer();
            return (
              "data:" + contentType + ";base64," + arrayBufferToBase64(ab)
            );
          } catch (e) {
            return null;
          }
        },
      }),
    );
    await Promise.allSettled(assetPromises);
    // Re-init editables minimally
    pageWrapper.querySelectorAll("[data-editable]").forEach(function (el) {
      if (!el.parentNode) return;
      const initialHtml = el.innerHTML;
      el.innerHTML = "";
      const quillHost = document.createElement("div");
      quillHost.className = "quill-host";
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
          "align",
        ],
        modules: { toolbar: false },
      });
      if (window.Igor) window.Igor.init(q);
      q.clipboard.dangerouslyPasteHTML(0, initialHtml);
      el.__quill = q;
      q.on("text-change", function () {
        setUnsaved();
      });
    });
    document.getElementById("saveBtn").style.display = "inline-block";
  } finally {
    window.__frankensteinHistoryContent = prevFetch;
  }
}

async function handleImageUpload(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  if (config.isDemo) {
    alert("Image upload is disabled in demo mode.");
    return;
  }
  if (!currentPath) {
    alert("Open a page before uploading images.");
    return;
  }
  if (!/^image\//i.test(file.type)) {
    alert("Please choose an image file.");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    alert("Image too large (max 5MB).");
    return;
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const destPath = "img/" + Date.now() + "-" + safeName;

  try {
    const buffer = await file.arrayBuffer();
    const b64 = arrayBufferToBase64(buffer);
    const fetchFn = typeof apiFetch === "function" ? apiFetch : githubFetch;
    const putRes = await fetchFn(
      `/repos/${config.owner}/${config.repo}/contents/${destPath}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Upload image " + safeName + " via Frankenstein CMS",
          content: b64,
        }),
      },
    );
    if (!putRes.ok) {
      let detail = "";
      try {
        const body = await putRes.json();
        detail = body.message ? ": " + body.message : "";
      } catch (_) {}
      throw new Error("Upload failed (" + putRes.status + ")" + detail);
    }
    // Insert relative path into active Quill if available
    const relPath = destPath;
    if (typeof activeQuill !== "undefined" && activeQuill) {
      const range = activeQuill.getSelection(true);
      activeQuill.insertEmbed(range ? range.index : 0, "image", relPath);
      setUnsaved();
    }
    alert("✅ Image uploaded to " + destPath + (activeQuill ? " and inserted." : ". Path copied — insert manually if needed."));
    try {
      await navigator.clipboard.writeText(relPath);
    } catch (e) {}
  } catch (e) {
    alert("Upload error: " + e.message);
  }
}
