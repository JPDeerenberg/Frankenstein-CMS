// File and GitHub API operations

const resourceCache = new Map();

/** Direct GitHub API fetch with rate-limit retries (dev version) */
async function apiFetch(apiPath, options) {
  options = options || {};
  const url = apiPath.startsWith("http")
    ? apiPath
    : `https://api.github.com${apiPath.startsWith("/") ? apiPath : "/" + apiPath}`;
  const headers = Object.assign(
    { Authorization: `token ${config.token}` },
    options.headers || {},
  );
  const init = Object.assign({}, options, { headers: headers });
  return fetchWithRetry(url, init);
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
    listEl.innerHTML = "<li style='color:#666;pointer-events:none'>Loading files…</li>";
    const files = await listHtmlFilesRecursive(apiFetch, "", 0, 4);
    listEl.innerHTML = "";
    if (files.length === 0) {
      listEl.innerHTML = "<li style='color:#666;pointer-events:none'>No HTML files found</li>";
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
    listEl.innerHTML = "<li style='color:#c0392b;pointer-events:none'>Error loading files</li>";
  }
}

async function loadFile(path, menuElement) {
  if (menuElement) {
    document
      .querySelectorAll("#file-list li")
      .forEach(function (l) {
        l.classList.remove("active");
      });
    menuElement.classList.add("active");
  }
  currentPath = path;
  const currentDir = path.includes("/")
    ? path.substring(0, path.lastIndexOf("/"))
    : "";

  document.getElementById("active-filename").innerText = path;

  // Clear resource cache when switching files to bound memory
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
      const res = await apiFetch(
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

    // Inject <style> blocks from the page <head>, scoped to CMS wrapper
    doc.head.querySelectorAll("style").forEach(function (s) {
      const newStyle = document.createElement("style");
      newStyle.textContent = scopeCssToCms(s.textContent);
      shadow.appendChild(newStyle);
    });

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

    // Scope inline <style> blocks that lived in the body
    pageWrapper.querySelectorAll("style").forEach(function (s) {
      s.textContent = scopeCssToCms(s.textContent);
    });

    // ---- Asset loading (CSS + images) with Promise.allSettled ----
    const assetPromises = [];

    const links = doc.querySelectorAll('link[rel="stylesheet"]');
    links.forEach(function (l) {
      const href = l.getAttribute("href");
      if (!href || href.startsWith("http")) return; // external still skipped (CORS)

      const resolvedHref = resolvePath(currentDir, href);
      const p = (async function () {
        try {
          let css;
          if (resourceCache.has(resolvedHref)) {
            css = await resourceCache.get(resolvedHref);
          } else {
            const fetchPromise = (async function () {
              try {
                const r = await apiFetch(
                  `/repos/${config.owner}/${config.repo}/contents/${resolvedHref}`,
                  { headers: { Accept: "application/vnd.github.v3.raw" } },
                );
                if (!r.ok) return null;
                return await r.text();
              } catch (e) {
                resourceCache.delete(resolvedHref);
                return null;
              }
            })();
            cacheSet(resourceCache, resolvedHref, fetchPromise);
            css = await fetchPromise;
            if (css === null) {
              resourceCache.delete(resolvedHref);
              return;
            }
          }
          if (!css) return;
          css = scopeCssToCms(css);
          const s = document.createElement("style");
          s.textContent = css;
          shadow.appendChild(s);
        } catch (e) {
          console.error("Could not load CSS:", resolvedHref, e);
        }
      })();
      assetPromises.push(p);
    });

    const imgs = pageWrapper.querySelectorAll("img");
    imgs.forEach(function (img) {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("http")) return;
      img.setAttribute("data-original-src", src);

      const resolvedSrc = resolvePath(currentDir, src);
      const p = (async function () {
        try {
          if (resourceCache.has(resolvedSrc)) {
            const cachedSrc = await resourceCache.get(resolvedSrc);
            if (cachedSrc) img.src = cachedSrc;
            return;
          }
          const fetchPromise = (async function () {
            try {
              const r = await apiFetch(
                `/repos/${config.owner}/${config.repo}/contents/${resolvedSrc}`,
                { headers: { Accept: "application/vnd.github.v3.raw" } },
              );
              if (!r.ok) return null;
              const contentType =
                r.headers.get("Content-Type") || "application/octet-stream";
              const ab = await r.arrayBuffer();
              const b64 = arrayBufferToBase64(ab);
              return `data:${contentType};base64,${b64}`;
            } catch (e) {
              resourceCache.delete(resolvedSrc);
              return null;
            }
          })();
          cacheSet(resourceCache, resolvedSrc, fetchPromise);
          const newSrc = await fetchPromise;
          if (newSrc === null) {
            resourceCache.delete(resolvedSrc);
            return;
          }
          img.src = newSrc;
        } catch (e) {
          console.error("Image load failed", src, e);
        }
      })();
      assetPromises.push(p);
    });

    // Wait for all assets (do not block editor interactivity forever)
    await Promise.allSettled(assetPromises);

    pageWrapper
      .querySelectorAll("a")
      .forEach(function (a) {
        a.addEventListener("click", function (e) {
          e.preventDefault();
        });
      });

    const editables = pageWrapper.querySelectorAll("[data-editable]");
    editables.forEach(function (el) {
      if (!el.parentNode) return;

      if (el.tagName === "P") {
        const div = document.createElement("div");
        Array.from(el.attributes).forEach(function (attr) {
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

    // Conflict check
    const fresh = await apiFetch(
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

    clone.querySelectorAll("img[data-original-src]").forEach(function (i) {
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

    const putRes = await apiFetch(
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

    // Reuse SHA from PUT response — no extra GET needed
    const putData = await putRes.json();
    if (putData && putData.content && putData.content.sha) {
      currentSha = putData.content.sha;
    } else if (putData && putData.sha) {
      currentSha = putData.sha;
    }
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
