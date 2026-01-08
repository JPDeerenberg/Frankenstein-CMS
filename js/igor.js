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

    quillInstance.on("text-change", () => this.scan(quillInstance));

    quillInstance.on("selection-change", (range) => {
      if (range) this.scan(quillInstance);
    });
  },

  scan: function (q) {
    if (!q || !this.container) return;

    const text = q.getText();
    const html = q.root.innerHTML;
    const cleanText = text.trim();

    const wordCount = cleanText.length > 0 ? cleanText.split(/\s+/).length : 0;
    const readTime = Math.ceil(wordCount / 200);

    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = html;
    const links = tempDiv.querySelectorAll("a");
    let badLinks = 0;
    links.forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || href === "#" || href === "") badLinks++;
    });

    const images = tempDiv.querySelectorAll("img");
    let missingAlt = 0;
    images.forEach((img) => {
      if (!img.alt || img.alt.trim() === "") missingAlt++;
    });

    let headerIssue = null;
    let h1Count = tempDiv.querySelectorAll("h1").length;

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
    let statusHTML = "";

    statusHTML += `<div class="igor-item" title="Words">📝 <strong>${stats.words}</strong></div>`;
    statusHTML += `<div class="igor-divider"></div>`;

    statusHTML += `<div class="igor-item" title="Time">⏱️ <strong>${stats.time}m</strong></div>`;
    statusHTML += `<div class="igor-divider"></div>`;

    let issues = [];

    if (stats.badLinks > 0) {
      issues.push(
        `<span class="igor-badge igor-err igor-tooltip" data-tip="${stats.badLinks} broken links">🔗 ${stats.badLinks}</span>`
      );
    }

    if (stats.missingAlt > 0) {
      issues.push(
        `<span class="igor-badge igor-warn igor-tooltip" data-tip="${stats.missingAlt} images need alt text">🖼️ ${stats.missingAlt}</span>`
      );
    }

    if (stats.headerIssue) {
      issues.push(
        `<span class="igor-badge igor-warn igor-tooltip" data-tip="Structure: ${stats.headerIssue}">⚠️ ${stats.headerIssue}</span>`
      );
    }

    if (issues.length === 0) {
      statusHTML += `<div class="igor-item"><span class="igor-badge igor-ok">✨ Clean</span></div>`;
    } else {
      statusHTML += `<div class="igor-item" style="display:flex; gap:5px;">${issues.join(
        ""
      )}</div>`;
    }

    let comment = "Ok.";
    if (stats.words === 0) comment = "Empty.";
    else if (issues.length > 2) comment = "Messy.";
    else if (stats.words > 500) comment = "Long.";

    statusHTML += `<div class="igor-divider"></div>`;
    statusHTML += `<div class="igor-item" style="font-style:italic; opacity:0.8; font-size:0.8em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100px;" title="${comment}">${comment}</div>`;

    this.container.innerHTML = statusHTML;
  },
};
