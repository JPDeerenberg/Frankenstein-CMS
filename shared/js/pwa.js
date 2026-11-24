// Phone support: the collapsible sidebar and the "Install app" button.

let deferredInstallPrompt = null;

function toggleSidebar() {
  document.body.classList.toggle("sidebar-open");
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
}

/** Chrome/Android fires beforeinstallprompt once the site is installable. */
async function installApp() {
  if (!deferredInstallPrompt) return;
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  const btn = document.getElementById("btn-install");
  if (btn) btn.style.display = "none";
  promptEvent.prompt();
  try {
    await promptEvent.userChoice;
  } catch (e) {
    // the user dismissed the dialog: nothing to do
  }
}

function initPhoneUi() {
  // Picking a file or a sidebar action closes the drawer so the page is visible again
  document.addEventListener("click", function (e) {
    const hit =
      e.target && e.target.closest
        ? e.target.closest("#file-list li, .sidebar button.action")
        : null;
    if (hit) closeSidebar();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeSidebar();
  });

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); // keep it for our own button
    deferredInstallPrompt = e;
    const btn = document.getElementById("btn-install");
    if (btn) btn.style.display = "";
  });
  window.addEventListener("appinstalled", function () {
    deferredInstallPrompt = null;
    const btn = document.getElementById("btn-install");
    if (btn) btn.style.display = "none";
  });
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  initPhoneUi();
}
