// Turning editor state back into a clean HTML document.
//
// Design rule: a saved file is the ORIGINAL document with only the regions the
// user actually edited replaced. Nothing is ever serialised from the live
// preview, so preview-only changes (scoped CSS, blob: image URLs, stripped
// scripts, Quill wrappers) can never leak into the repository.
//
// These helpers only use plain DOM APIs (DOMParser), so they are unit-tested
// in jsdom.

/** Quill formats the editor allows (alt/width/height keep image attributes). */
const EDITOR_FORMATS = [
  "header",
  "bold",
  "italic",
  "underline",
  "link",
  "image",
  "alt",
  "width",
  "height",
  "list",
];

/** Elements that may hold several paragraphs/headings/lists. Everything else is "inline". */
const BLOCK_CONTAINERS = new Set([
  "DIV",
  "SECTION",
  "ARTICLE",
  "MAIN",
  "ASIDE",
  "HEADER",
  "FOOTER",
  "BLOCKQUOTE",
  "TD",
  "TH",
  "FIGURE",
  "DETAILS",
]);

/**
 * How a data-editable element is edited and saved:
 *  - "block":  keeps <p>, <h2>, lists …   (div, section, article …)
 *  - "inline": text + inline formatting; paragraphs are joined with <br>
 *              (h1–h6, p, li, span, a …) so the element itself never changes
 *  - "list":   the element is a <ul>/<ol>; saved as <li> items
 */
function regionMode(tagName) {
  const t = String(tagName || "").toUpperCase();
  if (t === "UL" || t === "OL") return "list";
  return BLOCK_CONTAINERS.has(t) ? "block" : "inline";
}

/** Top-level [data-editable] elements, in document order (nested ones are ignored). */
function listEditableRegions(root) {
  return Array.from(root.querySelectorAll("[data-editable]")).filter(
    function (el) {
      return !(el.parentElement && el.parentElement.closest("[data-editable]"));
    },
  );
}

const INLINE_OK = ["STRONG", "B", "EM", "I", "U", "A", "IMG", "BR"];
const ALLOWED_ATTRS = {
  A: ["href", "target", "rel"],
  IMG: ["src", "alt", "width", "height"],
};

/**
 * Names the markup inside a region that the editor cannot round-trip.
 * Used to warn before editing: Quill keeps only its whitelisted formats.
 * @returns {string[]} short human-readable issues (empty = safe to edit)
 */
function analyzeMarkup(root, mode) {
  const issues = new Set();
  const allowedTags = new Set(INLINE_OK);
  if (mode === "block") {
    ["P", "UL", "OL", "LI", "H1", "H2", "H3", "H4", "H5", "H6"].forEach(
      function (t) {
        allowedTags.add(t);
      },
    );
    allowedTags.delete("BR"); // Quill turns <br> into separate paragraphs
  }

  (function walk(node) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const tag = child.tagName;
      const name = tag.toLowerCase();
      if (!allowedTags.has(tag)) {
        issues.add(tag === "BR" ? "line breaks (<br>)" : "<" + name + ">");
      } else {
        const allowed = ALLOWED_ATTRS[tag] || [];
        for (let j = 0; j < child.attributes.length; j++) {
          const attr = child.attributes[j].name;
          if (allowed.indexOf(attr) === -1) {
            issues.add(attr + " on <" + name + ">");
          }
        }
      }
      walk(child);
    }
  })(root);

  return Array.from(issues).slice(0, 6);
}

function parseBody(html) {
  return new DOMParser().parseFromString(
    "<body>" + html + "</body>",
    "text/html",
  ).body;
}

/** href -> {target, rel} for links that already had them in the original markup. */
function collectLinkAttrs(originalHtml) {
  const map = new Map();
  if (!originalHtml) return map;
  parseBody(originalHtml)
    .querySelectorAll("a[href]")
    .forEach(function (a) {
      const target = a.getAttribute("target");
      const rel = a.getAttribute("rel");
      if (target || rel) {
        map.set(a.getAttribute("href"), { target: target, rel: rel });
      }
    });
  return map;
}

function isEmptyBlock(el) {
  return (
    /^(P|H[1-6])$/.test(el.tagName) &&
    el.textContent.trim() === "" &&
    !el.querySelector("img")
  );
}

/**
 * Convert Quill's HTML into what should be written back into the element.
 * @param {string} quillHtml  quill.root.innerHTML
 * @param {object} opts
 * @param {string} opts.mode           "block" | "inline" | "list"
 * @param {string} [opts.originalHtml] the region's markup before editing
 * @param {function} [opts.resolveSrc] preview URL -> original repo path
 */
function cleanEditorHtml(quillHtml, opts) {
  opts = opts || {};
  const mode = opts.mode || "block";
  const box = parseBody(quillHtml);

  // Quill adds target=_blank + rel to every link; keep them only if the page already had them.
  const keep = collectLinkAttrs(opts.originalHtml);
  box.querySelectorAll("a").forEach(function (a) {
    const orig = keep.get(a.getAttribute("href"));
    if (orig && orig.target) a.setAttribute("target", orig.target);
    else a.removeAttribute("target");
    if (orig && orig.rel) a.setAttribute("rel", orig.rel);
    else a.removeAttribute("rel");
  });

  // Previews show blob: URLs for private images; write the original path back.
  if (opts.resolveSrc) {
    box.querySelectorAll("img").forEach(function (img) {
      const original = opts.resolveSrc(img.getAttribute("src"));
      if (original) img.setAttribute("src", original);
    });
  }

  // Never let editor-only classes (ql-align-center …) reach the real site.
  box.querySelectorAll("[class]").forEach(function (el) {
    const kept = (el.getAttribute("class") || "")
      .split(/\s+/)
      .filter(function (c) {
        return c && c.indexOf("ql-") !== 0;
      });
    if (kept.length) el.setAttribute("class", kept.join(" "));
    else el.removeAttribute("class");
  });

  while (box.lastElementChild && isEmptyBlock(box.lastElementChild)) {
    box.removeChild(box.lastElementChild);
  }

  if (mode === "block") return box.innerHTML;

  // inline / list: flatten blocks into lines so the container tag is never nested.
  const lines = [];
  const pushLine = function (el) {
    const html = el.innerHTML;
    lines.push(html === "<br>" ? "" : html);
  };
  Array.from(box.childNodes).forEach(function (node) {
    if (node.nodeType === 3) {
      lines.push(escapeHtml(node.textContent));
    } else if (node.nodeType === 1) {
      if (/^(UL|OL)$/.test(node.tagName)) {
        Array.from(node.children).forEach(pushLine);
      } else if (/^(P|H[1-6]|LI|DIV)$/.test(node.tagName)) {
        pushLine(node);
      } else {
        lines.push(node.outerHTML);
      }
    }
  });
  if (mode === "list") {
    return lines
      .map(function (l) {
        return "<li>" + l + "</li>";
      })
      .join("");
  }
  return lines.join("<br>");
}

/**
 * Build the file to commit: the original document with only the edited
 * regions replaced (matched by position) and optional SEO changes applied.
 * @param {string} originalRaw
 * @param {{index:number, html:string}[]} edits
 * @param {{applySeo?: function(Document)}} [hooks]
 */
function buildSavedDocument(originalRaw, edits, hooks) {
  const doc = new DOMParser().parseFromString(originalRaw, "text/html");
  const regions = listEditableRegions(doc.body);
  (edits || []).forEach(function (edit) {
    if (regions[edit.index]) regions[edit.index].innerHTML = edit.html;
  });
  if (hooks && hooks.applySeo) hooks.applySeo(doc);
  return serializeHtmlDocument(originalRaw, doc);
}

/** A parsed document back to text, keeping the original's doctype. */
function serializeHtmlDocument(originalRaw, doc) {
  const m = /^\s*<!DOCTYPE[^>]*>/i.exec(originalRaw);
  const doctype = m ? m[0].trim() : "<!DOCTYPE html>";
  return doctype + "\n" + doc.documentElement.outerHTML + "\n";
}

/**
 * Make the preview inert. Only the preview is sanitised — saved files are
 * built from the original document and never from this tree.
 */
function sanitizePreviewTree(root) {
  root
    .querySelectorAll("script, object, embed, base, meta[http-equiv]")
    .forEach(function (n) {
      n.remove();
    });
  root.querySelectorAll("iframe").forEach(function (f) {
    f.setAttribute("sandbox", "");
  });
  const urlAttrs = ["href", "src", "action", "formaction", "xlink:href"];
  root.querySelectorAll("*").forEach(function (el) {
    Array.from(el.attributes).forEach(function (a) {
      const name = a.name.toLowerCase();
      if (name.indexOf("on") === 0) {
        el.removeAttribute(a.name);
      } else if (
        urlAttrs.indexOf(name) !== -1 &&
        /^\s*(javascript:|vbscript:|data:text\/html)/i.test(a.value)
      ) {
        el.removeAttribute(a.name);
      }
    });
  });
}
