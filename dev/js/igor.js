window.Igor = {
  init: function (quillInstance) {
    this.container = document.getElementById("igor-stats");

    if (!document.getElementById("igor-style-override")) {
      const style = document.createElement("style");
      style.id = "igor-style-override";
      style.innerHTML = `
        .igor-badge { padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 0.8em; margin-right: 5px; }
        .igor-ok { background: #dcfce7; color: #166534; }
        .igor-warn { background: #fef9c3; color: #854d0e; }
        .igor-err { background: #fee2e2; color: #991b1b; }
        #igor-stats { color: #000000 !important; }
        #igor-stats * { color: #000000 !important; }
        .igor-tooltip { position: relative; cursor: help; border-bottom: 1px dotted #666; }
        .igor-tooltip:hover::after {
          content: attr(data-tip);
          position: absolute;
          top: 100%;
          right: 0;
          background: #1e293b;
          color: white;
          padding: 8px;
          border-radius: 6px;
          font-size: 12px;
          white-space: nowrap;
          z-index: 10000;
          box-shadow: 0 4px 10px rgba(0,0,0,0.2);
          pointer-events: none;
        }
      `;
      document.head.appendChild(style);
    }

    const debouncedScan =
      typeof debounce === "function"
        ? debounce(() => this.scan(quillInstance), 300)
        : () => this.scan(quillInstance);

    quillInstance.on("text-change", debouncedScan);
    quillInstance.on("selection-change", (range) => {
      if (range) debouncedScan();
    });
  },

  /** Rough readability: average words per sentence (lower is easier). */
  readabilityScore: function (text) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return null;
    let sentences = 0;
    for (let i = 0; i < clean.length; i++) {
      const c = clean[i];
      if (c === "." || c === "!" || c === "?") sentences++;
    }
    if (sentences === 0) sentences = 1;
    let words = 0;
    let inWord = false;
    for (let i = 0; i < clean.length; i++) {
      const code = clean.charCodeAt(i);
      if (code <= 32) {
        inWord = false;
      } else if (!inWord) {
        inWord = true;
        words++;
      }
    }
    const avg = words / sentences;
    // Map to a simple label
    if (avg <= 12) return { label: "Easy", avg: avg };
    if (avg <= 20) return { label: "OK", avg: avg };
    return { label: "Dense", avg: avg };
  },

  scan: function (q) {
    if (!q || !this.container) return;

    const text = q.getText();
    const cleanText = text.trim();

    let wordCount = 0;
    if (cleanText.length > 0) {
      let inWord = false;
      for (let i = 0; i < cleanText.length; i++) {
        const code = cleanText.charCodeAt(i);
        if (
          (code <= 32 &&
            (code === 32 || code === 9 || code === 10 || code === 13)) ||
          code === 160
        ) {
          inWord = false;
        } else if (!inWord) {
          inWord = true;
          wordCount++;
        }
      }
    }

    const readTime = Math.ceil(wordCount / 200) || 0;

    const links = q.root.getElementsByTagName("a");
    let badLinks = 0;
    let externalLinks = 0;
    for (let i = 0; i < links.length; i++) {
      const href = links[i].getAttribute("href");
      if (!href || href === "#" || href === "") badLinks++;
      else if (/^https?:\/\//i.test(href)) externalLinks++;
    }

    const images = q.root.getElementsByTagName("img");
    let missingAlt = 0;
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (!img.alt || img.alt.trim() === "") missingAlt++;
    }

    let headerIssue = null;
    const h1Count = q.root.getElementsByTagName("h1").length;
    if (h1Count > 1) headerIssue = "Too many H1s";
    if (h1Count === 0 && wordCount > 50) headerIssue = "Missing H1";

    const readability = this.readabilityScore(cleanText);

    // Long-paragraph warning
    let longParas = 0;
    const paras = q.root.getElementsByTagName("p");
    for (let i = 0; i < paras.length; i++) {
      const t = (paras[i].textContent || "").trim();
      if (t.split(/\s+/).length > 120) longParas++;
    }

    this.render({
      words: wordCount,
      time: readTime,
      badLinks: badLinks,
      missingAlt: missingAlt,
      headerIssue: headerIssue,
      externalLinks: externalLinks,
      readability: readability,
      longParas: longParas,
    });
  },

  render: function (stats) {
    if (!this.container) return;

    const frag = document.createDocumentFragment();

    function badge(text, cls, tip) {
      const span = document.createElement("span");
      span.className = "igor-badge " + cls + (tip ? " igor-tooltip" : "");
      span.textContent = text;
      if (tip) span.setAttribute("data-tip", tip);
      return span;
    }

    frag.appendChild(
      badge(
        stats.words + " words",
        "igor-ok",
        "~" + stats.time + " min read",
      ),
    );

    if (stats.readability) {
      const cls =
        stats.readability.label === "Dense"
          ? "igor-warn"
          : stats.readability.label === "Easy"
            ? "igor-ok"
            : "igor-ok";
      frag.appendChild(
        badge(
          "Read: " + stats.readability.label,
          cls,
          "Avg " + stats.readability.avg.toFixed(1) + " words/sentence",
        ),
      );
    }

    if (stats.badLinks > 0) {
      frag.appendChild(
        badge(
          stats.badLinks + " empty link(s)",
          "igor-err",
          "Links with empty or # href",
        ),
      );
    }

    if (stats.missingAlt > 0) {
      frag.appendChild(
        badge(
          stats.missingAlt + " img missing alt",
          "igor-warn",
          "Accessibility: add alt text",
        ),
      );
    }

    if (stats.headerIssue) {
      frag.appendChild(
        badge(stats.headerIssue, "igor-warn", "SEO heading structure"),
      );
    }

    if (stats.longParas > 0) {
      frag.appendChild(
        badge(
          stats.longParas + " long para(s)",
          "igor-warn",
          "Paragraphs over ~120 words are hard to scan",
        ),
      );
    }

    if (stats.externalLinks > 0) {
      frag.appendChild(
        badge(
          stats.externalLinks + " external",
          "igor-ok",
          "Outbound https links in this block",
        ),
      );
    }

    this.container.innerHTML = "";
    this.container.appendChild(frag);
  },
};
