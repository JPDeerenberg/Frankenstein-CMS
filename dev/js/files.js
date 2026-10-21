// File operations, editor rendering and saving.
// Shared by dev/ and prod/ — the only environment-specific part is
// apiFetch() in api.js (direct GitHub vs. the bouncer).

const resourceCache = new Map();
const LAST_COMMIT_KEY = "frankenstein_last_commit_msg";

// State of the page currently open in the editor (null while loading):
// { path, sha, originalRaw, regions[], previewMap, forceWrite }
let activeDoc = null;
let loadToken = 0; // bumped on every load so slow, outdated loads are discarded
let isSaving = false;

function repoUrl(suffix) {
  return `/repos/${config.owner}/${config.repo}${suffix}`;
}

function contentsUrl(path, ref) {
  return (
    repoUrl("/contents/" + encodePath(path)) +
    (ref ? "?ref=" + encodeURIComponent(ref) : "")
  );
}

function dirOf(path) {
  return path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
}

/* ========== File list ========== */

function setListMessage(listEl, text, color) {
  listEl.innerHTML = "";
  const li = document.createElement("li");
  li.textContent = text;
  li.style.pointerEvents = "none";
  li.style.color = color || "#666";
  listEl.appendChild(li);
}

/** All HTML files of the repo: one Git Trees request, directory walk as fallback. */
async function listRepoHtmlFiles() {
  try {
    const res = await apiFetch(repoUrl("/git/trees/HEAD?recursive=1"));
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.tree) && !data.truncated) {
        return data.tree
          .filter(function (n) {
            return (
              n.type === "blob" &&
              /\.html?$/i.test(n.path) &&
              !isSkippedPath(n.path)
            );
          })
          .map(function (n) {
            return { name: n.path, path: n.path };
          })
          .sort(function (a, b) {
            return a.path.localeCompare(b.path);
          });
      }
    }
  } catch (e) {
    console.warn("Tree listing failed, falling back to directory walk", e);
  }
  return listHtmlFilesRecursive(apiFetch, "", 0, 4);
}

async function fetchFileList() {
  const listEl = document.getElementById("file-list");

  const renderItems = function (files) {
    listEl.innerHTML = "";
    files.forEach(function (file) {
      const li = document.createElement("li");
      li.textContent = file.name;
      li.title = file.path;
      li.onclick = function () {
        loadFile(file.path, li);
      };
      if (activeDoc && activeDoc.path === file.path) li.classList.add("active");
      listEl.appendChild(li);
    });
  };

  if (config.isDemo) {
    renderItems([{ name: "demo_page.html", path: "demo_page.html" }]);
    return;
  }

  try {
    setListMessage(listEl, "Loading files…");
    const files = await listRepoHtmlFiles();
    if (files.length === 0) {
      setListMessage(listEl, "No HTML files found");
      return;
    }
    renderItems(files);
  } catch (e) {
    console.error("fetchFileList failed", e);
    setListMessage(listEl, "Error loading files: " + e.message, "#c0392b");
  }
}

/* ========== Loading ========== */

/**
 * Fetch a file's text (optionally at a commit/branch `ref`).
 * Files over 1 MB come back without content from the Contents API, so they
 * are read through the Git Blobs API instead; anything that is not valid
 * UTF-8 is refused rather than silently corrupted on the next save.
 */
async function fetchFileContent(path, ref) {
  const res = await apiFetch(contentsUrl(path, ref));
  if (!res.ok) {
    throw new Error(
      res.status === 401 || res.status === 403
        ? `Access denied (${res.status}). Check your token/password.`
        : `Failed to load ${path} (${res.status})`,
    );
  }
  const data = await res.json();
  if (Array.isArray(data) || data.type !== "file") {
    throw new Error(`${path} is not a file`);
  }
  let b64 = data.content;
  if (!b64 && data.size > 0) {
    const blobRes = await apiFetch(repoUrl("/git/blobs/" + data.sha));
    if (!blobRes.ok) {
      throw new Error(`Failed to load ${path} (${blobRes.status})`);
    }
    b64 = (await blobRes.json()).content;
  }
  const text = base64ToUtf8(b64 || "", true);
  if (text === null) {
    throw new Error(
      `${path} is not valid UTF-8 text, so it was not opened (saving could corrupt it).`,
    );
  }
  return { sha: data.sha, text: text };
}

async function fetchDemoContent() {
  try {
    const response = await fetch("demo_page.html");
    if (!response.ok) {
      throw new Error(
        `Could not find demo_page.html (Status: ${response.status}). Did you create the file?`,
      );
    }
    return { sha: "demo-sha-local-file", text: await response.text() };
  } catch (err) {
    console.error("Demo fetch error:", err);
    return {
      sha: "error",
      text: "<h1>404 Demo Not Found</h1><p>Create a file named <code>demo_page.html</code> next to index.html!</p>",
    };
  }
}

function releaseResourceCache() {
  resourceCache.forEach(function (value) {
    Promise.resolve(value)
      .then(function (url) {
        if (typeof url === "string" && url.indexOf("blob:") === 0) {
          URL.revokeObjectURL(url);
        }
      })
      .catch(function () {});
  });
  cacheClear(resourceCache);
}

function stopAutosave() {
  if (typeof autosaveTimer !== "undefined" && autosaveTimer) {
    clearInterval(autosaveTimer);
    autosaveTimer = null;
  }
}

function startAutosave() {
  stopAutosave();
  autosaveTimer = setInterval(function () {
    if (isDirty && !isSaving) slaOp(true);
  }, AUTOSAVE_INTERVAL);
}

async function loadFile(path, menuElement, opts) {
  opts = opts || {};
  if (
    !opts.force &&
    activeDoc &&
    isDirty &&
    !confirm("You have unsaved changes. Discard them and open another file?")
  ) {
    return;
  }

  const token = ++loadToken;
  activeDoc = null; // saving is impossible until the new page is fully loaded
  hideMenu();
  if (typeof isDirty !== "undefined") isDirty = false;

  document.querySelectorAll("#file-list li").forEach(function (l) {
    l.classList.remove("active");
  });
  if (menuElement) menuElement.classList.add("active");

  document.getElementById("active-filename").innerText = path;
  document.getElementById("saveBtn").style.display = "none";
  stopAutosave();
  releaseResourceCache();

  const host = document.getElementById("editor-host");
  shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<div style="padding:20px; color:#666;">Loading...</div>`;

  try {
    const file = config.isDemo
      ? await fetchDemoContent()
      : await fetchFileContent(path);
    if (token !== loadToken) return;

    const doc = await renderEditor(file.text, path, {
      sha: file.sha,
      token: token,
    });
    if (!doc) return; // superseded by a newer load

    finishRender();
    setSaved();
  } catch (e) {
    if (token !== loadToken) return;
    shadow.innerHTML = "";
    const p = document.createElement("p");
    p.style.cssText = "color:red; padding:20px;";
    p.textContent = e.message;
    shadow.appendChild(p);
    setStatus("⚠ " + e.message, "#f87171");
  }
}

/* ========== Rendering ========== */

const PREVIEW_CSS = `
  .cms-block-preview { position: relative; outline: 1px dashed #38bdf8; outline-offset: 2px; }
  .cms-block-controls {
    position: absolute; top: 4px; right: 4px; z-index: 5;
    display: flex; gap: 4px; opacity: 0.85;
  }
  .cms-block-controls button {
    all: unset; cursor: pointer; text-align: center; min-width: 28px; line-height: 28px;
    background: #0f172a; color: #fff; border-radius: 6px; font: 14px system-ui, sans-serif;
  }
  .cms-block-controls button:hover { background: #2563eb; }

  :host { color: #1a1a1a; }
  #cms-page-content { color: #1a1a1a; }

  /* outline (not border) so editing outlines never shift the layout */
  [data-editable] {
    outline: 2px dashed #e74c3c;
    outline-offset: 2px;
    cursor: text;
  }
  [data-editable]:hover { outline-style: solid; }
  [data-cms-warn]::after {
    content: "⚠ Editing may drop: " attr(data-cms-warn);
    display: block;
    font: 11px/1.4 system-ui, sans-serif;
    color: #92400e;
    background: #fef3c7;
    padding: 2px 6px;
    margin-top: 4px;
    border-radius: 4px;
  }

  .quill-host, .ql-container {
    position: static !important;
    display: block !important;
    width: 100% !important;
    background: transparent !important;
    pointer-events: auto !important;
  }
  .ql-editor {
    position: relative !important;
    display: block !important;
    width: 100% !important;
    min-height: 1.4em !important;
    padding: 0 !important;
    margin: 0 !important;
    box-sizing: border-box !important;
    background: transparent !important;
    color: inherit !important;
    font: inherit !important;
    line-height: inherit !important;
    text-align: inherit !important;
    pointer-events: auto !important;
  }
`;

function buildPreviewStage(doc) {
  const stage = document.createElement("div");
  stage.className = "cms-stage";

  const qCss = document.createElement("link");
  qCss.rel = "stylesheet";
  qCss.href = "vendor/quill.core.css";
  stage.appendChild(qCss);

  const styleFix = document.createElement("style");
  styleFix.textContent = PREVIEW_CSS;
  stage.appendChild(styleFix);

  const pageWrapper = document.createElement("div");
  pageWrapper.id = "cms-page-content";
  pageWrapper.className = doc.body.className;
  const bodyStyle = doc.body.getAttribute("style");
  if (bodyStyle) pageWrapper.setAttribute("style", bodyStyle);
  pageWrapper.innerHTML = doc.body.innerHTML;
  sanitizePreviewTree(pageWrapper);

  // The preview is not a real site: no navigation, no form posts.
  pageWrapper.addEventListener("click", function (e) {
    const a = e.target && e.target.closest ? e.target.closest("a") : null;
    if (a) e.preventDefault();
  });
  pageWrapper.addEventListener("submit", function (e) {
    e.preventDefault();
  });

  stage.appendChild(pageWrapper);
  return { stage: stage, pageWrapper: pageWrapper };
}

async function fetchRepoRaw(resolvedPath) {
  return apiFetch(contentsUrl(resolvedPath), {
    headers: { Accept: "application/vnd.github.v3.raw" },
  });
}

/**
 * Build the editable preview for `html` and register it as the active document.
 * Used for normal loads and for restoring historical versions.
 * Returns the new activeDoc, or null if a newer load made this one obsolete.
 */
async function renderEditor(html, path, opts) {
  opts = opts || {};
  const token = opts.token;
  const stale = function () {
    return token !== undefined && token !== loadToken;
  };

  const currentDir = dirOf(path);
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (window.SEO) SEO.initInputs(doc);

  const built = buildPreviewStage(doc);
  const stage = built.stage;
  const pageWrapper = built.pageWrapper;

  const host = document.getElementById("editor-host");
  shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
  shadow.innerHTML = "";
  // Everything the load adds lives in its own stage, so a superseded load
  // can never inject styles into a newer one.
  shadow.appendChild(stage);

  injectScopedInlineStyles(doc, stage, pageWrapper);

  const assetPromises = collectStylesheetPromises({
    doc: doc,
    shadow: stage,
    currentDir: currentDir,
    resourceCache: resourceCache,
    fetchRaw: async function (resolvedHref) {
      const r = await fetchRepoRaw(resolvedHref);
      return r.ok ? await r.text() : null;
    },
  }).concat(
    collectImagePromises({
      pageWrapper: pageWrapper,
      currentDir: currentDir,
      resourceCache: resourceCache,
      fetchRawBinary: async function (resolvedSrc) {
        const r = await fetchRepoRaw(resolvedSrc);
        if (!r.ok) return null;
        const type = guessMimeType(resolvedSrc, r.headers.get("Content-Type"));
        const blob = new Blob([await r.arrayBuffer()], { type: type });
        return URL.createObjectURL(blob);
      },
    }),
  );
  await Promise.allSettled(assetPromises);
  if (stale()) return null;

  // preview URL (blob:) -> original relative path, used when saving
  const previewMap = new Map();
  pageWrapper
    .querySelectorAll("img[data-original-src]")
    .forEach(function (img) {
      previewMap.set(
        img.getAttribute("src"),
        img.getAttribute("data-original-src"),
      );
    });

  const regions = [];
  listEditableRegions(pageWrapper).forEach(function (el, index) {
    regions.push(setupRegion(el, index));
  });

  pageWrapper.querySelectorAll("[data-cms-block]").forEach(addBlockControls);

  const hostEl = document.getElementById("editor-host");
  if (hostEl && !hostEl.__menuScrollBound) {
    hostEl.__menuScrollBound = true;
    hostEl.addEventListener("scroll", hideMenu, { passive: true });
  }

  // the previous editors are gone: forget them
  activeQuill = null;
  activeRegion = null;
  activeDoc = {
    path: path,
    sha: opts.sha,
    originalRaw: html,
    regions: regions,
    previewMap: previewMap,
    forceWrite: !!(opts.forceWrite || opts.historical),
  };
  currentPath = path;
  currentSha = opts.sha;
  originalRawHTML = html;
  return activeDoc;
}

/** Turn one [data-editable] element into a Quill editor and return its state. */
function setupRegion(el, index) {
  const mode = regionMode(el.tagName);
  const originalHtml = el.innerHTML;
  const issues = analyzeMarkup(el, mode);

  el.innerHTML = "";
  // inline elements (span, a …) cannot hold the block-level editor
  if (window.getComputedStyle(el).display === "inline") {
    el.style.display = "block";
  }
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-multiline", "true");
  if (issues.length) el.setAttribute("data-cms-warn", issues.join(", "));

  const quillHost = document.createElement("div");
  quillHost.className = "quill-host";
  el.appendChild(quillHost);

  const q = new Quill(quillHost, {
    formats: EDITOR_FORMATS,
    modules: { toolbar: false },
  });
  // setContents (not dangerouslyPasteHTML) so no stray empty paragraph is added,
  // and clear the undo stack so Ctrl+Z cannot wipe the freshly loaded content.
  q.setContents(q.clipboard.convert(originalHtml), "silent");
  q.history.clear();
  if (window.Igor) window.Igor.init(q);

  const region = {
    index: index,
    el: el,
    quill: q,
    mode: mode,
    originalHtml: originalHtml,
    issues: issues,
    dirty: false,
    rev: 0,
    locked: false,
    acknowledged: issues.length === 0,
  };
  el.__quill = q;

  q.on("text-change", function (delta, oldDelta, source) {
    if (source !== "user") return;
    region.dirty = true;
    region.rev++;
    setUnsaved();
  });

  q.on("selection-change", function (range) {
    if (!range) {
      hideMenu();
      return;
    }
    activeQuill = q;
    activeRegion = region;
    if (!region.acknowledged) {
      region.acknowledged = true;
      const ok = confirm(
        "This block contains markup the editor can't preserve:\n\n  " +
          region.issues.join(", ") +
          "\n\nEditing it may remove that formatting. Edit anyway?",
      );
      if (!ok) {
        region.locked = true;
        q.blur();
        q.enable(false);
        hideMenu();
        return;
      }
    }
    if (range.length > 0) showMenuForSelection(q, range, region);
    else hideMenu();
  });

  return region;
}

/** UI that every successful render needs (save button, autosave toggle). */
function finishRender() {
  document.getElementById("saveBtn").style.display = "inline-block";
  const toggle = document.getElementById("autosave-toggle");
  if (toggle) {
    toggle.checked = false;
    toggle.onchange = function () {
      if (toggle.checked) startAutosave();
      else stopAutosave();
    };
  }
}

/* ========== Saving ========== */

function rememberCommitMessage(message) {
  try {
    if (message && !message.startsWith("[Autosave]")) {
      localStorage.setItem(LAST_COMMIT_KEY, message);
    }
  } catch (e) {}
}

function resetSaveButton(btn, isAuto) {
  if (isAuto) return;
  btn.innerText = "💾 Save & Push";
  btn.disabled = false;
}

async function handleSaveConflict(doc, isAuto) {
  if (isAuto) {
    stopAutosave();
    const toggle = document.getElementById("autosave-toggle");
    if (toggle) toggle.checked = false;
    setStatus("⚠ File changed on GitHub — autosave paused", "#f87171");
    return;
  }
  const reload = confirm(
    "This file was changed on GitHub (by someone else or in another tab).\n\n" +
      "Reload the latest version?\n(Your unsaved changes will be lost.)",
  );
  if (reload) loadFile(doc.path, null, { force: true });
}

/** Only regions the user actually edited are written back. */
function collectEdits(doc) {
  return doc.regions
    .filter(function (r) {
      return r.dirty && !r.locked;
    })
    .map(function (r) {
      return {
        index: r.index,
        rev: r.rev,
        html: cleanEditorHtml(r.quill.root.innerHTML, {
          mode: r.mode,
          originalHtml: r.originalHtml,
          resolveSrc: function (src) {
            return doc.previewMap.get(src);
          },
        }),
      };
    });
}

/** The document as it would be saved right now: original + edits + SEO changes. */
function buildHtmlFromEdits(doc, edits) {
  return buildSavedDocument(doc.originalRaw, edits, {
    applySeo: window.SEO
      ? function (d) {
          SEO.applyToDoc(d);
        }
      : null,
  });
}

async function slaOp(isAuto) {
  isAuto = isAuto === true;
  const btn = document.getElementById("saveBtn");
  const doc = activeDoc;
  if (isSaving || !doc) return;
  if (!isDirty && !doc.forceWrite) {
    if (!isAuto) setStatus("No changes to save", "#94a3b8");
    return;
  }

  isSaving = true;
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
      return;
    }

    const edits = collectEdits(doc);
    const newHTML = buildHtmlFromEdits(doc, edits);

    const input = document.getElementById("commit-msg");
    const typed = input && input.value.trim();
    const fallback = `Update ${doc.path} via Frankenstein CMS`;
    const message = isAuto
      ? `[Autosave] ${typed || fallback}`
      : typed || fallback;

    const putRes = await apiFetch(contentsUrl(doc.path), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message,
        content: utf8ToBase64(newHTML),
        sha: doc.sha,
      }),
    });

    if (!putRes.ok) {
      if (putRes.status === 409) {
        await handleSaveConflict(doc, isAuto);
        return;
      }
      let detail = "";
      try {
        const errBody = await putRes.json();
        detail = errBody && errBody.message ? ": " + errBody.message : "";
      } catch (_) {}
      throw new Error("Save failed (" + putRes.status + ")" + detail);
    }

    const putData = await putRes.json();
    if (putData && putData.content && putData.content.sha) {
      doc.sha = putData.content.sha;
    } else if (putData && putData.sha) {
      doc.sha = putData.sha;
    }
    doc.originalRaw = newHTML;
    doc.forceWrite = false;
    edits.forEach(function (edit) {
      const r = doc.regions[edit.index];
      r.originalHtml = edit.html;
      if (r.rev === edit.rev) r.dirty = false; // edited again meanwhile? stays dirty
    });
    if (doc === activeDoc) {
      currentSha = doc.sha;
      originalRawHTML = newHTML;
      rememberCommitMessage(isAuto ? "" : message);
      if (
        doc.regions.some(function (r) {
          return r.dirty;
        })
      ) {
        setStatus("● Unsaved changes", "#f39c12");
      } else {
        setSaved();
      }
    }
    if (!isAuto) alert("✅ Saved!");
  } catch (e) {
    console.error("Save failed", e);
    if (isAuto) setStatus("⚠ Autosave failed: " + e.message, "#f87171");
    else alert("Error: " + e.message);
  } finally {
    isSaving = false;
    resetSaveButton(btn, isAuto);
  }
}

/* ========== Blocks: insert / move / remove ========== */

/** Small ▲ ▼ 🗑 toolbar on a block, shown in the preview only. */
function addBlockControls(blockEl, index) {
  blockEl.classList.add("cms-block-preview");
  const bar = document.createElement("div");
  bar.className = "cms-block-controls";
  bar.setAttribute("contenteditable", "false");
  [
    [
      "▲",
      "Move up",
      function () {
        moveBlockAt(index, -1);
      },
    ],
    [
      "▼",
      "Move down",
      function () {
        moveBlockAt(index, 1);
      },
    ],
    [
      "🗑",
      "Remove this block",
      function () {
        removeBlockAt(index);
      },
    ],
  ].forEach(function (spec) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = spec[0];
    btn.title = spec[1];
    btn.setAttribute("aria-label", spec[1]);
    btn.onmousedown = function (e) {
      e.preventDefault();
    };
    btn.onclick = spec[2];
    bar.appendChild(btn);
  });
  blockEl.appendChild(bar);
}

/**
 * Apply a structural change to the page. Pending text edits are first baked
 * into a working copy of the document, `mutate(parsedDoc)` changes that copy
 * (return null for "nothing to do", or { focusBlock }), and the editor is
 * rebuilt from the result. The page stays "unsaved" until the user saves.
 */
async function applyStructureChange(mutate) {
  const doc = activeDoc;
  if (!doc) return false;
  if (isSaving) {
    alert("Please wait until saving has finished.");
    return false;
  }
  const baked = buildHtmlFromEdits(doc, collectEdits(doc));
  const parsed = new DOMParser().parseFromString(baked, "text/html");
  const result = mutate(parsed);
  if (!result) return false;

  const token = ++loadToken;
  const next = await renderEditor(
    serializeHtmlDocument(baked, parsed),
    doc.path,
    {
      sha: doc.sha,
      token: token,
      forceWrite: true,
    },
  );
  if (!next) return false;
  setUnsaved();

  if (typeof result.focusBlock === "number") {
    const el = shadow.querySelectorAll("[data-cms-block]")[result.focusBlock];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "center" });
  }
  return true;
}

/** position: "after" = after the text block last clicked, "end" = end of the page */
async function insertBlock(id, values, position) {
  const doc = activeDoc;
  if (!doc) return false;
  const html = Blocks.render(id, values, { pageDir: dirOf(doc.path) });
  const region =
    position === "after" &&
    activeRegion &&
    doc.regions.indexOf(activeRegion) !== -1
      ? activeRegion
      : null;
  return applyStructureChange(function (parsed) {
    const index = Blocks.insert(parsed, html, {
      afterRegion: region ? region.index : null,
    });
    return index < 0 ? null : { focusBlock: index };
  });
}

function moveBlockAt(index, delta) {
  return applyStructureChange(function (parsed) {
    const moved = Blocks.move(parsed, index, delta);
    return moved === null ? null : { focusBlock: moved };
  });
}

function removeBlockAt(index) {
  if (!confirm("Remove this block from the page?"))
    return Promise.resolve(false);
  return applyStructureChange(function (parsed) {
    return Blocks.remove(parsed, index) ? { focusBlock: null } : null;
  });
}

/* ========== History ========== */

async function loadCommitHistory() {
  const listEl = document.getElementById("history-list");
  if (!listEl) return;
  if (!activeDoc || (config && config.isDemo)) {
    setListMessage(listEl, "History is not available in demo mode.");
    return;
  }
  setListMessage(listEl, "Loading history…");
  try {
    const res = await apiFetch(
      repoUrl(
        `/commits?path=${encodeURIComponent(activeDoc.path)}&per_page=20`,
      ),
    );
    if (!res.ok) throw new Error("Failed to load commits (" + res.status + ")");
    const commits = await res.json();
    listEl.innerHTML = "";
    if (!Array.isArray(commits) || commits.length === 0) {
      setListMessage(listEl, "No commits found for this file.");
      return;
    }
    commits.forEach(function (c) {
      const li = document.createElement("li");
      li.style.cssText =
        "cursor:pointer; padding:8px 4px; border-bottom:1px solid #334155;";
      const msg = (
        c.commit && c.commit.message ? c.commit.message : c.sha
      ).split("\n")[0];
      const date = c.commit && c.commit.author ? c.commit.author.date : "";

      const sha = document.createElement("strong");
      sha.textContent = c.sha ? c.sha.slice(0, 7) : "";
      li.appendChild(sha);
      li.appendChild(document.createTextNode(" — " + msg)); // text node: no HTML injection
      if (date) {
        li.appendChild(document.createElement("br"));
        const when = document.createElement("span");
        when.style.cssText = "opacity:0.7; font-size:0.85em;";
        when.textContent = new Date(date).toLocaleString();
        li.appendChild(when);
      }
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
    setListMessage(listEl, "Error: " + e.message, "#f87171");
  }
}

/** Load an old version into the editor. Nothing is written until the user saves. */
async function revertToCommit(sha) {
  if (!activeDoc) return;
  const path = activeDoc.path;
  const headSha = activeDoc.sha;
  const token = ++loadToken;
  closeHistoryModal();
  try {
    const old = await fetchFileContent(path, sha);
    if (token !== loadToken) return;
    // keep the HEAD sha: saving then restores this version on top of the latest commit
    const doc = await renderEditor(old.text, path, {
      sha: headSha,
      token: token,
      historical: true,
    });
    if (!doc) return;
    document.getElementById("active-filename").innerText =
      path + " (version " + sha.slice(0, 7) + ")";
    finishRender();
    setUnsaved();
    alert(
      "Historical version loaded into the editor. Click Save & Push to restore it on GitHub.",
    );
  } catch (e) {
    alert("Revert failed: " + e.message);
  }
}

/* ========== Image upload ========== */

function readFileAsBase64(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () {
      resolve(String(reader.result).split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleImageUpload(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  if (config.isDemo) {
    alert("Image upload is disabled in demo mode.");
    return;
  }
  if (!activeDoc) {
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

  const doc = activeDoc;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const destPath = "img/" + Date.now() + "-" + safeName;

  try {
    setStatus("Uploading image…", "#94a3b8");
    const putRes = await apiFetch(contentsUrl(destPath), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Upload image " + safeName + " via Frankenstein CMS",
        content: await readFileAsBase64(file),
      }),
    });
    if (!putRes.ok) {
      let detail = "";
      try {
        const body = await putRes.json();
        detail = body.message ? ": " + body.message : "";
      } catch (_) {}
      throw new Error("Upload failed (" + putRes.status + ")" + detail);
    }

    // The saved <img> must be relative to the page, not to the repo root
    const relPath = relativePath(dirOf(doc.path), destPath);
    const target =
      activeQuill &&
      doc === activeDoc &&
      doc.regions.some(function (r) {
        return r.quill === activeQuill && !r.locked;
      })
        ? activeQuill
        : null;

    if (target) {
      const previewUrl = URL.createObjectURL(file);
      doc.previewMap.set(previewUrl, relPath);
      const range = target.getSelection(true) || {
        index: Math.max(0, target.getLength() - 1),
      };
      target.insertEmbed(range.index, "image", previewUrl, "user");
      const alt = prompt(
        "Describe the image for accessibility (alt text, optional):",
        "",
      );
      if (alt && alt.trim()) {
        target.formatText(range.index, 1, "alt", alt.trim(), "user");
      }
      setStatus("✓ Image uploaded and inserted — save to publish", "#2ecc71");
    } else {
      try {
        await navigator.clipboard.writeText(relPath);
      } catch (e) {}
      setStatus("✓ Image uploaded to " + destPath, "#2ecc71");
      alert(
        "Image uploaded to " +
          destPath +
          ".\nClick inside a text block first to insert images automatically. The path was copied: " +
          relPath,
      );
    }
  } catch (e) {
    setStatus("⚠ " + e.message, "#f87171");
    alert("Upload error: " + e.message);
  }
}
