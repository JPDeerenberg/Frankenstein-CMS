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

## 🚀 The Two Versions

Frankenstein now comes in two flavors depending on your needs. Choose the folder that best fits your workflow.

### 1. The `dev/` Version (Zero Setup)

Perfect for personal projects or developers who want to manage their own sites. It talks directly to the GitHub API. No servers, no setup, just drop it in your repo.

**Setup (`dev/`):**

1. Add `data-editable` attributes to your HTML.
2. Generate a [GitHub Personal Access Token](https://github.com/settings/tokens/new?scopes=repo&description=Frankenstein%20CMS).
3. Open `dev/index.html` and log in with your Token, Username, and Repo name.

### 2. The `prod/` Version (For Agencies & Clients)

Perfect if you build websites for clients. It uses a **Serverless Bouncer** (Cloudflare Worker) to completely hide your GitHub Token. Your clients log in with a clean, professional Email & Password screen.

**Setup (`prod/`):**

1. **Deploy the Bouncer:** Upload `prod/worker/worker.js` to a free Cloudflare Worker.
2. **Secure the Vault:** In the Cloudflare Dashboard, set two Encrypted Variables: `CLIENT_EMAIL` and `CLIENT_PASSWORD` alongside your `GITHUB_TOKEN`.
3. **Configure the UI:** Edit `prod/frankenstein.config.json` to point to your Bouncer URL, GitHub Owner, and Repo Name.
4. **Client Handoff:** Your client visits `prod/index.html` and simply enters the Email and Password you assigned them. They never see your GitHub account details.

---

## 🏗️ Project Structure

- **`dev/`**
  - **`index.html`**: The direct-to-GitHub CMS interface.
  - **`js/`**: Core logic including AES token encryption.
- **`prod/`**
  - **`index.html`**: The simplified Email/Password UI.
  - **`worker/`**: The Cloudflare proxy script.
  - **`js/`**: Core logic modified to route traffic through the Bouncer.
- **`Igor`**: Your loyal assistant (`dev/js/igor.js`) who tracks stats and judges your writing style.

---

## ⚰️ Todo & Roadmap

**Planning:**

**IMPORTANT:**

- [ ] **Git Time Travel (History & Revert):** The ability to retrieve old versions (commits) via the GitHub API. In case you accidentally demolish the place.
- [ ] **Mobile Preview:** A button to narrow the editor to mobile size (375px), so you can see if the layout breaks on small screens.
- [ ] **Giving Igor a brain:** Making Igor smarter than just counting words (e.g. broken link checker or SEO warnings).
- [ ] **More SEO Options:** adding more options to edit the header and maybe have Igor help.

**Later:**

- [ ] **Phone Ready Editor:** An app for mobile devices to edit texts on the go. Maybe with just webview.
- [ ] **Block Inserter Section:** A menu to inject ready-made HTML components (like Google Sites) directly into the `data-editable` container.
- [ ] **Image Upload:** Support for uploading new images to the repo's `/img/` folder, so that the new sections don't remain naked.
