// Start-up code that used to be inline in index.html (inline scripts would need
// 'unsafe-inline' in the Content-Security-Policy).

let autosaveTimer = null;
const AUTOSAVE_INTERVAL = 30000;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
}
