// Block library + the document operations behind "Insert block".
//
// A block is a ready-made piece of HTML (hero, columns, quote …). Its text
// parts carry data-editable, so after inserting it you edit them like any
// other text. The block's root element is marked with data-cms-block so the
// CMS can show move/remove controls on it later. Blocks use small inline
// styles and inherit colours, so they work on any site; restyle them in your
// own CSS if you like.
//
// Everything here is pure (strings and DOM in, DOM out) and unit-tested.

const FLOW_PARENTS = new Set([
  "BODY",
  "MAIN",
  "ARTICLE",
  "SECTION",
  "DIV",
  "HEADER",
  "FOOTER",
  "ASIDE",
  "NAV",
  "FORM",
]);
const NON_VISUAL = /^(SCRIPT|NOSCRIPT|TEMPLATE|STYLE|LINK|META)$/;

const BLOCK_PLACEHOLDER_IMG =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">' +
      '<rect width="100%" height="100%" fill="#e2e8f0"/>' +
      '<text x="50%" y="50%" fill="#64748b" font-family="sans-serif" font-size="28" text-anchor="middle">Your image</text></svg>',
  );

const BTN_STYLE =
  "display:inline-block;padding:.75rem 1.5rem;border-radius:.5rem;background:#2563eb;color:#fff;text-decoration:none";

/** Field types: url / email / image are sanitised, text is just escaped. */
const BLOCKS = [
  {
    id: "hero",
    icon: "🦸",
    name: "Hero",
    desc: "Big headline, short text and a button.",
    fields: [
      { key: "url", type: "url", label: "Button links to", value: "#contact" },
    ],
    html: (v) =>
      `<section data-cms-block="hero" style="padding:3.5rem 1.5rem;text-align:center">
<h1 data-editable style="margin:0 0 .75rem">Your headline here</h1>
<p data-editable style="font-size:1.15rem;margin:0 auto 1.5rem;max-width:40rem">One or two sentences about what you do.</p>
<a data-editable href="${v.url}" style="${BTN_STYLE}">Get in touch</a>
</section>`,
  },
  {
    id: "text",
    icon: "📝",
    name: "Text section",
    desc: "A heading with two paragraphs.",
    fields: [],
    html: () =>
      `<section data-cms-block="text" style="padding:2rem 1rem;max-width:44rem;margin:0 auto">
<h2 data-editable style="margin-top:0">Section heading</h2>
<p data-editable>Write your first paragraph here.</p>
<p data-editable>And a second one here.</p>
</section>`,
  },
  {
    id: "image-left",
    icon: "🖼️",
    name: "Image left, text right",
    desc: "A picture next to a heading and text.",
    fields: [
      {
        key: "image",
        type: "image",
        label: "Image (e.g. img/photo.jpg, or leave empty)",
        value: "",
      },
      { key: "alt", type: "text", label: "Describe the image", value: "" },
    ],
    html: (v) => imageTextHtml("image-left", "row", v),
  },
  {
    id: "image-right",
    icon: "🖼️",
    name: "Text left, image right",
    desc: "Heading and text next to a picture.",
    fields: [
      {
        key: "image",
        type: "image",
        label: "Image (e.g. img/photo.jpg, or leave empty)",
        value: "",
      },
      { key: "alt", type: "text", label: "Describe the image", value: "" },
    ],
    html: (v) => imageTextHtml("image-right", "row-reverse", v),
  },
  {
    id: "columns-2",
    icon: "◫",
    name: "Two columns",
    desc: "Two side-by-side text columns (stack on phones).",
    fields: [],
    html: () => columnsHtml("columns-2", 2, "16rem"),
  },
  {
    id: "columns-3",
    icon: "▥",
    name: "Three columns",
    desc: "Three features or services in a row.",
    fields: [],
    html: () => columnsHtml("columns-3", 3, "12rem"),
  },
  {
    id: "quote",
    icon: "❝",
    name: "Quote",
    desc: "A highlighted quote with the author.",
    fields: [],
    html: () =>
      `<blockquote data-cms-block="quote" style="margin:2rem auto;max-width:40rem;padding:0 1.25rem;border-left:4px solid #94a3b8">
<p data-editable style="font-size:1.2rem;font-style:italic;margin:0 0 .5rem">“A short quote from a happy customer.”</p>
<cite data-editable style="display:block;opacity:.75">— Name, Company</cite>
</blockquote>`,
  },
  {
    id: "cta",
    icon: "📣",
    name: "Call to action",
    desc: "A banner that sends visitors to a link.",
    fields: [
      { key: "url", type: "url", label: "Button links to", value: "#contact" },
    ],
    html: (v) =>
      `<section data-cms-block="cta" style="padding:2.5rem 1.5rem;text-align:center;background:#f1f5f9;border-radius:.75rem;margin:2rem 0">
<h2 data-editable style="margin:0 0 .5rem;color:#0f172a">Ready to get started?</h2>
<p data-editable style="margin:0 0 1.25rem;color:#334155">A sentence that makes it easy to say yes.</p>
<a data-editable href="${v.url}" style="${BTN_STYLE}">Contact us</a>
</section>`,
  },
  {
    id: "contact",
    icon: "✉️",
    name: "Contact",
    desc: "A heading and an email link.",
    fields: [
      { key: "email", type: "email", label: "Email address", value: "" },
    ],
    html: (v) =>
      `<section data-cms-block="contact" style="padding:2rem 1rem;text-align:center">
<h2 data-editable style="margin-top:0">Contact</h2>
<p data-editable>Questions? Email us at <a href="mailto:${v.email}">${v.email}</a>.</p>
</section>`,
  },
  {
    id: "divider",
    icon: "➖",
    name: "Divider",
    desc: "A thin line between sections.",
    fields: [],
    html: () =>
      `<div data-cms-block="divider" style="padding:1.5rem 0"><hr style="border:0;border-top:1px solid #cbd5e1;margin:0"></div>`,
  },
];

function imageTextHtml(id, direction, v) {
  return `<section data-cms-block="${id}" style="display:flex;flex-direction:${direction};flex-wrap:wrap;align-items:center;gap:1.5rem;padding:2rem 1rem">
<img src="${v.image}" alt="${v.alt}" style="flex:1 1 16rem;max-width:100%;height:auto;border-radius:.5rem">
<div style="flex:1 1 16rem"><h2 data-editable style="margin-top:0">Heading</h2>
<p data-editable>Tell the story behind the picture.</p></div>
</section>`;
}

function columnsHtml(id, count, basis) {
  let cols = "";
  for (let i = 1; i <= count; i++) {
    cols += `<div style="flex:1 1 ${basis}"><h3 data-editable style="margin-top:0">Column ${i}</h3><p data-editable>Short text for column ${i}.</p></div>\n`;
  }
  return `<section data-cms-block="${id}" style="display:flex;flex-wrap:wrap;gap:1.5rem;padding:2rem 1rem">\n${cols}</section>`;
}

function sanitizeBlockUrl(url) {
  const u = String(url || "").trim();
  if (!u) return "#";
  if (/^\s*(javascript|vbscript|data):/i.test(u)) return "#";
  return u;
}

/** An image path typed by the user -> a src that works from the page's folder. */
function resolveBlockImage(value, pageDir) {
  const v = String(value || "").trim();
  if (!v || /^(javascript|vbscript|data):/i.test(v))
    return BLOCK_PLACEHOLDER_IMG;
  if (/^(https?:|\/\/|\/|\.\.?\/|#)/i.test(v)) return v;
  // a repo-root path such as img/photo.jpg (as shown after an upload)
  return relativePath(pageDir || "", v);
}

const Blocks = {
  list: BLOCKS,

  get: function (id) {
    return BLOCKS.find(function (b) {
      return b.id === id;
    });
  },

  /** The block's HTML with the user's field values sanitised and escaped. */
  render: function (id, rawValues, ctx) {
    const def = this.get(id);
    if (!def) throw new Error("Unknown block: " + id);
    const values = {};
    def.fields.forEach(function (f) {
      let raw =
        rawValues && rawValues[f.key] != null ? rawValues[f.key] : f.value;
      raw = String(raw == null ? "" : raw).trim();
      if (f.type === "url") raw = sanitizeBlockUrl(raw);
      else if (f.type === "image")
        raw = resolveBlockImage(raw, ctx && ctx.pageDir);
      else if (f.type === "email")
        raw = raw.replace(/^mailto:/i, "") || "you@example.com";
      values[f.key] = escapeHtml(raw);
    });
    return def.html(values).trim();
  },

  /** All block elements of a document, in page order. */
  listBlocks: function (root) {
    return Array.from(root.querySelectorAll("[data-cms-block]"));
  },

  /**
   * Insert block HTML into a parsed document.
   * opts.afterRegion = index of a data-editable region: insert after it (climbing
   * out of li/span/… so the result stays valid HTML). Otherwise at the end of the page.
   * @returns {number} the block's position among all blocks, or -1
   */
  insert: function (doc, html, opts) {
    opts = opts || {};
    const holder = doc.createElement("div");
    holder.innerHTML = html;
    const node = holder.firstElementChild;
    if (!node) return -1;
    const nl = function () {
      return doc.createTextNode("\n");
    };

    const regions = listEditableRegions(doc.body);
    if (typeof opts.afterRegion === "number" && regions[opts.afterRegion]) {
      let ref = regions[opts.afterRegion];
      while (
        ref.parentElement &&
        !FLOW_PARENTS.has(ref.parentElement.tagName)
      ) {
        ref = ref.parentElement;
      }
      const parent = ref.parentNode;
      const next = ref.nextSibling;
      parent.insertBefore(nl(), next);
      parent.insertBefore(node, next);
      parent.insertBefore(nl(), next);
    } else {
      const main = doc.body.querySelector("main");
      if (main) {
        main.appendChild(nl());
        main.appendChild(node);
        main.appendChild(nl());
      } else {
        let last = doc.body.lastElementChild;
        while (last && NON_VISUAL.test(last.tagName))
          last = last.previousElementSibling;
        if (last && last.tagName === "FOOTER") {
          doc.body.insertBefore(node, last);
          doc.body.insertBefore(nl(), last);
        } else if (last) {
          last.after(nl(), node);
        } else {
          doc.body.appendChild(node);
        }
      }
    }
    return this.listBlocks(doc.body).indexOf(node);
  },

  /** Move block `index` up (-1) or down (+1) past its neighbouring element. @returns {number|null} new index */
  move: function (doc, index, delta) {
    const blocks = this.listBlocks(doc.body);
    const el = blocks[index];
    if (!el) return null;
    let sib = delta < 0 ? el.previousElementSibling : el.nextElementSibling;
    while (sib && NON_VISUAL.test(sib.tagName)) {
      sib = delta < 0 ? sib.previousElementSibling : sib.nextElementSibling;
    }
    if (!sib) return null;
    if (delta < 0) el.parentNode.insertBefore(el, sib);
    else sib.after(el);
    return this.listBlocks(doc.body).indexOf(el);
  },

  remove: function (doc, index) {
    const el = this.listBlocks(doc.body)[index];
    if (!el) return false;
    el.remove();
    return true;
  },
};

/* ========== "Insert block" dialog ========== */

let pendingBlock = null;

function openBlocksModal() {
  if (typeof activeDoc === "undefined" || !activeDoc) {
    alert("Open a page first.");
    return;
  }
  const grid = document.getElementById("blocks-grid");
  grid.innerHTML = "";
  BLOCKS.forEach(function (b) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "block-card";
    const icon = document.createElement("span");
    icon.className = "bc-icon";
    icon.textContent = b.icon;
    const name = document.createElement("strong");
    name.textContent = b.name;
    const desc = document.createElement("small");
    desc.textContent = b.desc;
    card.append(icon, name, desc);
    card.onclick = function () {
      pickBlock(b.id);
    };
    grid.appendChild(card);
  });
  const select = document.getElementById("blocks-position");
  const hasSelection =
    typeof activeRegion !== "undefined" &&
    activeRegion &&
    activeDoc.regions.indexOf(activeRegion) !== -1;
  select.value = hasSelection ? "after" : "end";
  showBlockList();
  document.getElementById("blocks-modal").classList.add("open");
}

function closeBlocksModal() {
  document.getElementById("blocks-modal").classList.remove("open");
  pendingBlock = null;
}

function showBlockList() {
  pendingBlock = null;
  document.getElementById("blocks-list-view").style.display = "";
  document.getElementById("blocks-form-view").style.display = "none";
}

function pickBlock(id) {
  const def = Blocks.get(id);
  if (!def.fields.length) {
    finishBlockInsert(id, {});
    return;
  }
  pendingBlock = def;
  document.getElementById("blocks-form-title").textContent =
    def.icon + " " + def.name;
  const box = document.getElementById("blocks-fields");
  box.innerHTML = "";
  def.fields.forEach(function (f) {
    const label = document.createElement("label");
    label.textContent = f.label;
    const input = document.createElement("input");
    input.type = "text";
    input.value = f.value || "";
    input.dataset.key = f.key;
    label.appendChild(input);
    box.appendChild(label);
  });
  document.getElementById("blocks-list-view").style.display = "none";
  document.getElementById("blocks-form-view").style.display = "";
}

function confirmBlockForm() {
  if (!pendingBlock) return;
  const values = {};
  document.querySelectorAll("#blocks-fields input").forEach(function (i) {
    values[i.dataset.key] = i.value;
  });
  finishBlockInsert(pendingBlock.id, values);
}

function finishBlockInsert(id, values) {
  const position = document.getElementById("blocks-position").value;
  closeBlocksModal();
  insertBlock(id, values, position);
}
