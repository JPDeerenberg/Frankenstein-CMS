# Frankenstein CMS

**Because CloudCannon is too expensive and your static site deserves a soul.**

[![DEMO](https://img.shields.io/badge/LIVE-DEMO-brightgreen?style=for-the-badge)](https://jpdeerenberg.github.io/Frankenstein-CMS/)

Frankenstein CMS is a **zero-install, single-folder content management system** specifically built for static HTML sites hosted on GitHub. No database, no Node.js overhead, no monthly subscriptions. Just one folder to dominate your repo via the official GitHub API.

It uploads files directly to GitHub, making it work perfectly with **GitHub Pages, Cloudflare Pages, Netlify and other hosting services**.

![Frankenstein Login Interface](/images/login.png)

---

## 🛠️ How Does the Magic Work?

Frankenstein isn't just a text editor; it’s a technical beast that solves three complex problems that other "lightweight" editors ignore:

### 1. CSS Transfusion

Since the CMS and your website live in the same browser tab, their styles would normally clash. Frankenstein solves this by extracting all `<link rel="stylesheet">` tags from the source, fetching them via the API, and injecting them live into the editor's Shadow DOM.

### 2. Private Image Reanimation

Images in a private repository are normally invisible to an external editor. Frankenstein finds all `<img>` tags, fetches the binary data using your GitHub token, and creates temporary blobs for the preview. Upon saving, it reverts these to their original relative paths (`img/photo.jpg`) to keep your repo clean.

### 3. The Git Suture

When you hit "Save", the editor's DOM is stripped of all `contenteditable` attributes. Frankenstein reconstructs a full HTML document by merging the original `<head>` and `<html>` attributes with the new `<body>`. This entire package is Base64 encoded and pushed directly to GitHub.

![Frankenstein Editor Interface](/images/editor.png)

---

## 🚀 Quick Start

1.  **Prepare your HTML:** Add the `data-editable` attribute to any element you want to be able to edit.
    ```html
    <h2 data-editable>Change me, Doctor!</h2>
    ```
2.  **Generate a Token:** Create a [GitHub Personal Access Token](https://github.com/settings/tokens) with the `repo` scope.
3.  **Host the CMS:** Upload the `Frankenstein-CMS` folder to your repo. If you place it in a `/admin` subdirectory, you can access the CMS nicely at `domain.com/admin`.
4.  **Login:** Enter your Token, Username, and Repo name. Choose a session password to keep your credentials encrypted locally via AES.

---

## 🏗️ Project Structure

- **`index.html`**: The entire CMS interface. A sleek, dark dashboard using a Shadow DOM editor-host.
- **`js/`**: The brain. Handles everything from AES encryption in `config.js` to the Quill integration in `editor.js`.
- **`Igor`**: Your loyal assistant (`igor.js`) who tracks stats and judges your writing style.

---

## ⚰️ Todo & Roadmap

**Planning:**

**IMPORTANT:** 
- [ ] **Better Security:** Add better encryption and maybe an OAuth server option. Seed in local storage is still risky.  
- [ ] **Git Time Travel (History & Revert):** The ability to retrieve old versions (commits) via the GitHub API. In case you accidentally demolish the place.
- [ ] **Mobile Preview:** A button to narrow the editor to mobile size (375px), so you can see if the layout breaks on small screens.
- [ ] **Giving Igor a brain:** Making Igor smarter than just counting words (e.g. broken link checker or SEO warnings).
- [ ] **More SEO Options:** adding more options to edit the header and maybe have Igor help.

**Later:**

- [ ] **Phone Ready Editor:** An app for mobile devices to edit texts on the go. Maybe with just webview. 
- [ ] **Block Inserter Section:** A menu to inject ready-made HTML components (like Google Sites) directly into the `data-editable` container.
- [ ] **Image Upload:** Support for uploading new images to the repo's `/img/` folder, so that the new sections don't remain naked.
