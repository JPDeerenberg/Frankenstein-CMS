window.SEO = {
  initInputs: function (doc) {
    const pageTitle = doc.querySelector("title")
      ? doc.querySelector("title").innerText
      : "";
    const metaDesc = doc.querySelector('meta[name="description"]')
      ? doc.querySelector('meta[name="description"]').getAttribute("content")
      : "";

    const titleInput = document.getElementById("seo-title");
    const descInput = document.getElementById("seo-desc");

    if (titleInput) titleInput.value = pageTitle;
    if (descInput) descInput.value = metaDesc;
  },

  applyToDoc: function (doc) {
    const titleInput = document.getElementById("seo-title");
    const descInput = document.getElementById("seo-desc");

    if (!titleInput || !descInput) return;

    const newTitle = titleInput.value;
    const newDesc = descInput.value;

    let titleEl = doc.querySelector("title");
    if (!titleEl) {
      titleEl = doc.createElement("title");
      doc.head.appendChild(titleEl);
    }
    titleEl.innerText = newTitle;

    let metaEl = doc.querySelector('meta[name="description"]');
    if (!metaEl) {
      metaEl = doc.createElement("meta");
      metaEl.setAttribute("name", "description");
      doc.head.appendChild(metaEl);
    }
    metaEl.setAttribute("content", newDesc);
  },

  openModal: function () {
    const activeFile = document.getElementById("active-filename");
    if (!activeFile || !activeFile.innerText.endsWith(".html")) {
      alert("Open eerst een HTML pagina.");
      return;
    }
    document.getElementById("seo-modal").style.display = "flex";
  },

  closeModal: function () {
    document.getElementById("seo-modal").style.display = "none";
  },

  saveAndClose: function () {
    if (typeof setUnsaved === "function") {
      setUnsaved();
    }
    this.closeModal();
  },
};
