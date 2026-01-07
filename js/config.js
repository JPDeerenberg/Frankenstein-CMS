// Configuration and encryption management
let config = { token: "", owner: "", repo: "" };

function encryptConfig(conf, password) {
  try {
    const ciphertext = CryptoJS.AES.encrypt(
      JSON.stringify(conf),
      password
    ).toString();
    localStorage.setItem("frankenstein_encrypted_cfg", ciphertext);
    return true;
  } catch (e) {
    return false;
  }
}

function decryptConfig(password) {
  try {
    const ciphertext = localStorage.getItem("frankenstein_encrypted_cfg");
    if (!ciphertext) return null;
    const bytes = CryptoJS.AES.decrypt(ciphertext, password);
    return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
  } catch (e) {
    return null;
  }
}
