// Page settings: SEO + social sharing fields, live preview, and Igor's review.
//
// Only fields the user actually changed are written to the document; the
// others are left exactly as they were (see applyToDoc).

const SEO_META_SELECTORS = {
  desc: ['meta[name="description"]', "name", "description"],
  ogTitle: ['meta[property="og:title"]', "property", "og:title"],
  ogDesc: ['meta[property="og:description"]', "property", "og:description"],
  ogImage: ['meta[property="og:image"]', "property", "og:image"],
};

window.SEO = {
  original: {},
  _bound: false,

  /** The SEO-relevant values of a parsed document. */
  readFromDoc: function (doc) {
    const meta = function (sel) {
      const el = doc.querySelector(sel);
      return el ? el.getAttribute("content") || "" : "";
    };
    const titleEl = doc.querySelector("title");
    const canonical = doc.querySelector('link[rel="canonical"]');
    const robots = doc.querySelector('meta[name="robots"]');
    return {
      // textContent, not innerText: documents from DOMParser are not rendered
      title: titleEl ? titleEl.textContent.trim() : "",
      desc: meta(SEO_META_SELECTORS.desc[0]).trim(),
      canonical: canonical ? (canonical.getAttribute("href") || "").trim() : "",
      ogTitle: meta(SEO_META_SELECTORS.ogTitle[0]).trim(),
      ogDesc: meta(SEO_META_SELECTORS.ogDesc[0]).trim(),
      ogImage: meta(SEO_META_SELECTORS.ogImage[0]).trim(),
      lang: (doc.documentElement.getAttribute("lang") || "").trim(),
      noindex:
        !!robots &&
        /(^|[\s,])noindex([\s,]|$)/i.test(robots.getAttribute("content") || ""),
    };
  },

  /** The values currently typed into the modal. */
  readInputs: function () {
    const val = function (id) {
      const el = document.getElementById(id);
      return el ? el.value.trim() : "";
    };
    const noindexEl = document.getElementById("seo-noindex");
    return {
      title: val("seo-title"),
      desc: val("seo-desc"),
      canonical: val("seo-canonical"),
      ogTitle: val("seo-og-title"),
      ogDesc: val("seo-og-desc"),
      ogImage: val("seo-og-image"),
      lang: val("seo-lang"),
      noindex: !!(noindexEl && noindexEl.checked),
    };
  },

  initInputs: function (doc) {
    const values = this.readFromDoc(doc);
    this.original = values;

    const set = function (id, v) {
      const el = document.getElementById(id);
      if (el) el.value = v;
    };
    set("seo-title", values.title);
    set("seo-desc", values.desc);
    set("seo-canonical", values.canonical);
    set("seo-og-title", values.ogTitle);
    set("seo-og-desc", values.ogDesc);
    set("seo-og-image", values.ogImage);
    set("seo-lang", values.lang);
    const noindexEl = document.getElementById("seo-noindex");
    if (noindexEl) noindexEl.checked = values.noindex;

    if (!this._bound) {
      this._bound = true;
      const self = this;
      [
        "seo-title",
        "seo-desc",
        "seo-canonical",
        "seo-og-title",
        "seo-og-desc",
        "seo-og-image",
        "seo-lang",
        "seo-noindex",
      ].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener("input", function () {
            self.refresh();
          });
          el.addEventListener("change", function () {
            self.refresh();
          });
        }
      });
    }
    this.refresh();
  },

  /** Live character counters under the title/description (60 / 160 recommended). */
  updateCounters: function () {
    const pairs = [
      ["seo-title", "seo-title-hint", 60],
      ["seo-desc", "seo-desc-hint", 160],
    ];
    pairs.forEach(function (p) {
      const input = document.getElementById(p[0]);
      const hint = document.getElementById(p[1]);
      if (!input || !hint) return;
      const n = input.value.length;
      hint.textContent = n + " / " + p[2] + " characters recommended";
      hint.style.color = n > p[2] ? "#f87171" : "";
    });
  },

  /** A Google-style search result, built from the current inputs. */
  renderPreview: function (v) {
    const clip = function (s, n) {
      return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
    };
    const fill = function (id, text) {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    const page = typeof currentPath === "string" ? currentPath : "";
    fill("seo-prev-title", clip(v.title || "(no title)", 60));
    fill("seo-prev-url", v.canonical || page);
    fill("seo-prev-desc", clip(v.desc || "(no description)", 160));
  },

  /** Facts about the page itself (not the form) that Igor needs: H1s, images without alt. */
  pageFacts: function () {
    const host = document.getElementById("editor-host");
    const root = host && host.shadowRoot;
    const page = root && root.querySelector("#cms-page-content");
    if (!page) return null;
    let missingAlt = 0;
    const imgs = page.getElementsByTagName("img");
    for (let i = 0; i < imgs.length; i++) {
      const alt = imgs[i].getAttribute("alt");
      if (!alt || !alt.trim()) missingAlt++;
    }
    return {
      h1: page.getElementsByTagName("h1").length,
      imgsMissingAlt: missingAlt,
    };
  },

  renderIgor: function (v) {
    const box = document.getElementById("seo-igor");
    if (!box || !window.Igor || !window.Igor.seoReport) return;
    const notes = window.Igor.seoReport(v, this.pageFacts());
    box.innerHTML = "";
    notes.forEach(function (n) {
      const li = document.createElement("li");
      li.className = "igor-note igor-" + n.level;
      li.textContent = n.text;
      box.appendChild(li);
    });
  },

  refresh: function () {
    const v = this.readInputs();
    this.updateCounters();
    this.renderPreview(v);
    this.renderIgor(v);
  },

  applyToDoc: function (doc) {
    const now = this.readInputs();
    const was = this.original;
    const changed = function (k) {
      return now[k] !== was[k];
    };
    if (!Object.keys(now).some(changed)) return; // nothing touched: leave the document alone

    // <meta> helper: set, create, or remove (when the value is empty)
    const setMeta = function (key) {
      const spec = SEO_META_SELECTORS[key];
      let el = doc.querySelector(spec[0]);
      if (!now[key]) {
        if (el) el.remove();
        return;
      }
      if (!el) {
        el = doc.createElement("meta");
        el.setAttribute(spec[1], spec[2]);
        doc.head.appendChild(el);
      }
      el.setAttribute("content", now[key]);
    };

    if (changed("title")) {
      let titleEl = doc.querySelector("title");
      if (!titleEl && now.title) {
        titleEl = doc.createElement("title");
        doc.head.appendChild(titleEl);
      }
      if (titleEl) titleEl.textContent = now.title;
    }

    ["desc", "ogTitle", "ogDesc", "ogImage"].forEach(function (k) {
      if (changed(k)) setMeta(k);
    });

    // A share image only gets a big preview on X/Twitter with a card type
    if (
      changed("ogImage") &&
      now.ogImage &&
      !doc.querySelector('meta[name="twitter:card"]')
    ) {
      const card = doc.createElement("meta");
      card.setAttribute("name", "twitter:card");
      card.setAttribute("content", "summary_large_image");
      doc.head.appendChild(card);
    }

    if (changed("canonical")) {
      let link = doc.querySelector('link[rel="canonical"]');
      if (!now.canonical) {
        if (link) link.remove();
      } else {
        if (!link) {
          link = doc.createElement("link");
          link.setAttribute("rel", "canonical");
          doc.head.appendChild(link);
        }
        link.setAttribute("href", now.canonical);
      }
    }

    if (changed("lang")) {
      if (now.lang) doc.documentElement.setAttribute("lang", now.lang);
      else doc.documentElement.removeAttribute("lang");
    }

    if (changed("noindex")) {
      let robots = doc.querySelector('meta[name="robots"]');
      const tokens = robots
        ? (robots.getAttribute("content") || "")
            .split(",")
            .map(function (t) {
              return t.trim();
            })
            .filter(function (t) {
              return t && t.toLowerCase() !== "noindex";
            })
        : [];
      if (now.noindex) tokens.unshift("noindex");
      if (tokens.length) {
        if (!robots) {
          robots = doc.createElement("meta");
          robots.setAttribute("name", "robots");
          doc.head.appendChild(robots);
        }
        robots.setAttribute("content", tokens.join(", "));
      } else if (robots) {
        robots.remove();
      }
    }
  },

  openModal: function () {
    if (typeof currentPath !== "string" || !/\.html?$/i.test(currentPath)) {
      alert("Open an HTML file first to edit SEO settings.");
      return;
    }
    this.refresh(); // page facts (H1, alt text) may have changed while editing
    document.getElementById("seo-modal").style.display = "flex";
  },

  closeModal: function () {
    document.getElementById("seo-modal").style.display = "none";
  },

  saveAndClose: function () {
    const now = this.readInputs();
    const was = this.original;
    const changed = Object.keys(now).some(function (k) {
      return now[k] !== was[k];
    });
    if (changed && typeof setUnsaved === "function") {
      setUnsaved();
    }
    this.closeModal();
  },
};
