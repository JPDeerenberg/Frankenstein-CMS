// UI state management

let isDirty = false;

function setUnsaved() {
  if (isDirty) return; // Optimization: skip redundant DOM updates
  isDirty = true;
  const el = document.getElementById("save-status");
  if (el) {
    el.innerText = "● Unsaved changes";
    el.style.color = "#f39c12";
  }
}

function setSaved() {
  if (!isDirty) return; // Optimization: skip redundant DOM updates
  isDirty = false;
  const el = document.getElementById("save-status");
  if (el) {
    el.innerText = "✓ Saved";
    el.style.color = "#2ecc71";
  }
}

function showDashboard() {
  document.getElementById("login-screen").classList.remove("active");
  document.getElementById("dashboard-screen").classList.add("active");
  fetchFileList();
}
