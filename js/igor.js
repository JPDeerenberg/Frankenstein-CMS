window.Igor = {
  init: function (quillInstance) {
    this.quill = quillInstance;
    this.container = document.getElementById("igor-stats");

    this.scan();

    this.quill.on("text-change", () => this.scan());
  },

  scan: function () {
    if (!this.container) return;

    const text = this.quill.getText();
    const cleanText = text.trim();

    if (cleanText.length === 0) {
      this.render(0, 0, 0);
      return;
    }

    const wordCount = cleanText.split(/\s+/).length;
    const charCount = cleanText.length;
    const readTime = Math.ceil(wordCount / 200);

    this.render(wordCount, charCount, readTime);
  },

  render: function (words, chars, time) {
    let mood = "😐";
    let comment = "Kort & Krachtig";

    if (words > 200) {
      mood = "🤔";
      comment = "Goed bezig";
    }
    if (words > 500) {
      mood = "📜";
      comment = "Lekker lang";
    }
    if (words > 1000) {
      mood = "😴";
      comment = "TL;DR";
    }

    this.container.innerHTML = `
      <div class="igor-item" title="Woorden">📝 <strong style="color:black">${words}</strong></div>
      <div class="igor-divider"></div>
      <div class="igor-item" title="Karakters">⌨️ <strong style="color:black">${chars}</strong></div>
      <div class="igor-divider"></div>
      <div class="igor-item" title="Leestijd">⏱️ <strong style="color:black">~${time} min</strong></div>
      <div class="igor-divider"></div>
      <div class="igor-item"><strong style="color: black; font-size: 0.9em;">${mood} ${comment}</strong></div>
    `;
  },
};
