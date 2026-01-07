# 🧟‍♂️ Frankenstein CMS

Frankenstein CMS is a **zero-install, single-folder content management system** specifically built for static HTML sites hosted on GitHub. No database, no Node.js, no overhead. Just one folder to manage your repo via the official GitHub API.

---

## 🛠️ How Does the Magic Work?

Frankenstein isn't just a text editor; it’s a technical beast that solves three complex problems:

### 1. CSS Transfusion

Since the CMS and your website live in the same browser tab, their styles would normally clash. Frankenstein solves this by:

- Extracting all `<link rel="stylesheet">` tags from the source file.
- Fetching these files via the GitHub API (using your token, so it works for private repos).
- Injecting the CSS live into the CMS `<head>`.

### 2. Private Image Reanimation

Images in a private repository are normally invisible to an external editor.

- Frankenstein finds all `<img>` tags.
- It fetches the binary data via the GitHub API with an `Accept: application/vnd.github.v3.raw` header.
- It creates a temporary `URL.createObjectURL(blob)`.
- **Crucial:** Upon saving, it reverts these temporary URLs back to their original relative paths (`img/photo.jpg`), keeping your repo clean.

### 3. The Git Suture

When you hit "Save", the editor's DOM is stripped of all `contenteditable` attributes. Frankenstein then reconstructs a full HTML document by merging the original `<head>` and `<html>` attributes with the new `<body>`. This entire package is Base64 encoded and pushed to GitHub.

---

## 🚀 Quick Start

1.  **Prepare your HTML:** Add the `data-editable` attribute to any element you want to be able to edit.
    ```html
    <h2 data-editable>Change me!</h2>
    ```
2.  **Generate a Token:** Create a [GitHub Personal Access Token (classic)](https://github.com/settings/tokens) with the `repo` scope.
3.  **Host the CMS:** Upload `index.html` to your repo or just open it locally.
4.  **Login:** Enter your Token, Username, and Repo name.

---

## 🏗️ Project Structure

- **`index.html`**: The entire CMS. Interface (CSS), logic (JS), and structure (HTML) in one single body.
- **Auth**: Uses `localStorage` to remember your session (safe and local, never sent to a third-party server).
- **Editor**: Uses the browser-native `document.execCommand` for a lightweight editing experience.

---

## ⚠️ Security & Limitations

- **Tokens:** Never share your token. If someone steals your `index.html` with saved credentials, they have full access to your repo.
- **Caching:** GitHub API responses can sometimes be cached for 1-2 minutes. If your changes don't appear immediately, stay calm.
- **Backups:** Frankenstein has no 'undo' button on the server. What you push is final (unless you dive into Git history).

---

## ⚰️ Todo & Roadmap

Planning.

- [ ] **Git Time Travel (History & Revert):** The ability to retrieve old versions (commits) via the GitHub API. In case you accidentally demolish the place.
- [ ] **Mobile Preview:** A button to narrow the editor to mobile size (375px), so you can see if the layout breaks on small screens.
- [ ] **Giving Igor a brain:** Making Igor smarter than just counting words (e.g. broken link checker or SEO warnings).

Later:

- [ ] **Block Inserter Section:** A menu to inject ready-made HTML components directly into the data-editable container, maybe grabbing it from a seperate template file.
- [ ] **Image Upload:** Support for uploading new images to the repo's '/img/' folder, so that the new sections don't remain naked.
