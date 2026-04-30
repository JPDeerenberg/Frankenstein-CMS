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
        
        /* THE NUCLEAR OPTION: FORCE BLACK TEXT */
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

    const debouncedScan = typeof debounce === "function"
      ? debounce(() => this.scan(quillInstance), 300)
      : () => this.scan(quillInstance);

    quillInstance.on("text-change", debouncedScan);

    quillInstance.on("selection-change", (range) => {
      if (range) debouncedScan();
    });
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
        // Match spaces, tabs, and newlines (ASCII <= 32)
        if (code <= 32 && (code === 32 || code === 9 || code === 10 || code === 13) || code === 160) {
          inWord = false;
        } else if (!inWord) {
          inWord = true;
          wordCount++;
        }
      }
    }

    const readTime = Math.ceil(wordCount / 200);

    const links = q.root.querySelectorAll("a");
    let badLinks = 0;
    links.forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || href === "#" || href === "") badLinks++;
    });

    const images = q.root.querySelectorAll("img");
    let missingAlt = 0;
    images.forEach((img) => {
      if (!img.alt || img.alt.trim() === "") missingAlt++;
    });

    let headerIssue = null;
    let h1Count = q.root.querySelectorAll("h1").length;

    if (h1Count > 1) headerIssue = "Too many H1s";
    if (h1Count === 0 && wordCount > 50) headerIssue = "Missing H1";

    this.render({
      words: wordCount,
      time: readTime,
      badLinks,
      missingAlt,
      headerIssue,
    });
  },

  render: function (stats) {
    this.container.innerHTML = "";

    const createItem = (content, title) => {
      const div = document.createElement("div");
      div.className = "igor-item";
      if (title) div.title = title;
      if (typeof content === "string") {
        div.textContent = content;
      } else {
        div.appendChild(content);
      }
      return div;
    };

    const createDivider = () => {
      const div = document.createElement("div");
      div.className = "igor-divider";
      return div;
    };

    const createBadge = (text, type, tip) => {
      const span = document.createElement("span");
      span.className = `igor-badge igor-${type} igor-tooltip`;
      span.setAttribute("data-tip", tip);
      span.textContent = text;
      return span;
    };

    // Words
    const wordsStrong = document.createElement("strong");
    wordsStrong.textContent = stats.words;
    const wordsContent = document.createDocumentFragment();
    wordsContent.appendChild(document.createTextNode("📝 "));
    wordsContent.appendChild(wordsStrong);
    this.container.appendChild(createItem(wordsContent, "Words"));
    this.container.appendChild(createDivider());

    // Time
    const timeStrong = document.createElement("strong");
    timeStrong.textContent = `${stats.time}m`;
    const timeContent = document.createDocumentFragment();
    timeContent.appendChild(document.createTextNode("⏱️ "));
    timeContent.appendChild(timeStrong);
    this.container.appendChild(createItem(timeContent, "Time"));
    this.container.appendChild(createDivider());

    // Issues
    let issues = [];
    if (stats.badLinks > 0) {
      issues.push(createBadge(`🔗 ${stats.badLinks}`, "err", `${stats.badLinks} broken links`));
    }
    if (stats.missingAlt > 0) {
      issues.push(createBadge(`🖼️ ${stats.missingAlt}`, "warn", `${stats.missingAlt} images need alt text`));
    }
    if (stats.headerIssue) {
      issues.push(createBadge(`⚠️ ${stats.headerIssue}`, "warn", `Structure: ${stats.headerIssue}`));
    }

    const issuesItem = document.createElement("div");
    issuesItem.className = "igor-item";
    issuesItem.style.display = "flex";
    issuesItem.style.gap = "5px";

    if (issues.length === 0) {
      const cleanBadge = document.createElement("span");
      cleanBadge.className = "igor-badge igor-ok";
      cleanBadge.textContent = "✨ Clean";
      issuesItem.appendChild(cleanBadge);
    } else {
      issues.forEach(issue => issuesItem.appendChild(issue));
    }
    this.container.appendChild(issuesItem);

    // Comment
    let comment = "Ok.";
    if (stats.words === 0) comment = "Empty.";
    else if (issues.length > 2) comment = "Messy.";
    else if (stats.words > 500) comment = "Long.";

    this.container.appendChild(createDivider());
    const commentItem = document.createElement("div");
    commentItem.className = "igor-item";
    commentItem.style.fontStyle = "italic";
    commentItem.style.opacity = "0.8";
    commentItem.style.fontSize = "0.8em";
    commentItem.style.whiteSpace = "nowrap";
    commentItem.style.overflow = "hidden";
    commentItem.style.textOverflow = "ellipsis";
    commentItem.style.maxWidth = "100px";
    commentItem.title = comment;
    commentItem.textContent = comment;
    this.container.appendChild(commentItem);
  },
};
