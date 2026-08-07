// UI state management

let isDirty = false;
let lastSavedAt = null;
let mobilePreviewOn = false;

function formatTime(d) {
  if (!d) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return hh + ":" + mm + ":" + ss;
}

function setUnsaved() {
  if (isDirty) return;
  isDirty = true;
  const el = document.getElementById("save-status");
  if (el) {
    el.innerText = "● Unsaved changes";
    el.style.color = "#f39c12";
  }
}

function setSaved() {
  lastSavedAt = new Date();
  const stamp = "✓ Saved at " + formatTime(lastSavedAt);
  if (!isDirty) {
    // Still refresh timestamp when already clean (e.g. after load)
    const elEarly = document.getElementById("save-status");
    if (elEarly) {
      elEarly.innerText = stamp;
      elEarly.style.color = "#2ecc71";
    }
    isDirty = false;
    return;
  }
  isDirty = false;
  const el = document.getElementById("save-status");
  if (el) {
    el.innerText = stamp;
    el.style.color = "#2ecc71";
  }
}

function showDashboard() {
  document.getElementById("login-screen").classList.remove("active");
  document.getElementById("dashboard-screen").classList.add("active");
  fetchFileList();
  initFeatureUi();
}

function initFeatureUi() {
  // Restore last commit message
  const commitInput = document.getElementById("commit-msg");
  if (commitInput) {
    try {
      const last = localStorage.getItem("frankenstein_last_commit_msg");
      if (last && !commitInput.value) commitInput.value = last;
    } catch (e) {}
  }

  // Autosave: pause when tab is hidden
  if (typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", function () {
      const toggle = document.getElementById("autosave-toggle");
      if (!toggle || !toggle.checked) return;
      if (document.visibilityState === "hidden") {
        if (typeof autosaveTimer !== "undefined" && autosaveTimer) {
          clearInterval(autosaveTimer);
          autosaveTimer = null;
        }
      } else if (document.visibilityState === "visible") {
        if (typeof AUTOSAVE_INTERVAL !== "undefined") {
          if (typeof autosaveTimer !== "undefined" && autosaveTimer) {
            clearInterval(autosaveTimer);
          }
          autosaveTimer = setInterval(function () {
            if (isDirty && typeof slaOp === "function") slaOp(true);
          }, AUTOSAVE_INTERVAL);
        }
      }
    });
  }
}

function toggleMobilePreview() {
  mobilePreviewOn = !mobilePreviewOn;
  const host = document.getElementById("editor-host");
  const btn = document.getElementById("btn-mobile-preview");
  if (!host) return;
  if (mobilePreviewOn) {
    host.style.maxWidth = "375px";
    host.style.margin = "0 auto";
    host.style.border = "2px solid #64748b";
    host.style.borderRadius = "12px";
    host.style.overflow = "hidden";
    if (btn) btn.classList.add("active-tool");
  } else {
    host.style.maxWidth = "";
    host.style.margin = "";
    host.style.border = "";
    host.style.borderRadius = "";
    host.style.overflow = "";
    if (btn) btn.classList.remove("active-tool");
  }
}

function openHistoryModal() {
  const modal = document.getElementById("history-modal");
  if (modal) modal.classList.add("open");
  if (typeof loadCommitHistory === "function") loadCommitHistory();
}

function closeHistoryModal() {
  const modal = document.getElementById("history-modal");
  if (modal) modal.classList.remove("open");
}

function triggerImageUpload() {
  const input = document.getElementById("image-upload-input");
  if (input) input.click();
}
