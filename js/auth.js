// Authentication and login management

async function saveConfigAndLogin() {
  const token = document.getElementById("cfg-token").value.trim();
  const owner = document.getElementById("cfg-owner").value.trim();
  const repo = document.getElementById("cfg-repo").value.trim();
  const password = document.getElementById("cfg-password").value.trim();
  if (!token || !owner || !repo || !password)
    return alert("Please fill in all fields.");

  const loginMsg = document.getElementById("login-msg");
  try {
    loginMsg.innerText = "Connecting...";
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Authorization: `token ${token}` },
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail =
          body && body.message
            ? `: ${body.message}`
            : ` (status ${res.status})`;
      } catch (_) {
        detail = ` (status ${res.status})`;
      }
      loginMsg.innerText = `Connection failed${detail}`;
      console.error("GitHub connect error", res.status, detail);
      return;
    }
    config = { token, owner, repo };
    encryptConfig(config, password);
    loginMsg.innerText = "Connected.";
    showDashboard();
  } catch (e) {
    loginMsg.innerText = `Network error: ${e.message}`;
    console.error(e);
  }
}

function logout() {
  if (confirm("Logout?")) {
    localStorage.removeItem("frankenstein_encrypted_cfg");
    location.reload();
  }
}

window.onload = () => {
  const hasData = localStorage.getItem("frankenstein_encrypted_cfg");
  if (hasData) {
    const password = prompt("🔐 Session password:");
    if (!password) return;
    const decrypted = decryptConfig(password);
    if (decrypted) {
      config = decrypted;
      showDashboard();
    } else {
      alert("❌ Wrong password.");
    }
  }
};
