# Frankenstein CMS

**Because CloudCannon is too expensive and your static site deserves a soul.**

[![DEMO](https://img.shields.io/badge/LIVE-DEMO-brightgreen?style=for-the-badge)](https://jpdeerenberg.github.io/Frankenstein-CMS/)

Frankenstein CMS is a **zero-install, single-folder content management system** specifically built for static HTML sites hosted on GitHub. No database, no Node.js overhead, no monthly subscriptions. Just one folder to dominate your repo via the official GitHub API.

It uploads files directly to GitHub, making it work perfectly with **GitHub Pages, Netlify, and other hosting services**.

![Frankenstein Login Interface](/images/login.png)

---

## 🛠️ How Does the Magic Work?

Frankenstein isn't just a text editor; it’s a technical beast that solves three complex problems that other "lightweight" editors ignore:

### 1. CSS Transfusion

Since the CMS and your website live in the same browser tab, their styles would normally clash. Frankenstein solves this by extracting all `<link rel="stylesheet">` tags and inline `<style>` blocks from the source, fetching repo stylesheets via the API, and injecting scoped copies into the editor's Shadow DOM (`body`/`html` selectors are rewritten for the preview only). External CDN stylesheets are fetched and scoped too, or loaded as a plain `<link>` if the CDN does not allow CORS.

### 2. Private Image Reanimation

Images in a private repository are normally invisible to an external editor. Frankenstein finds all `<img>` tags, fetches the binary data using your credentials, and shows temporary `blob:` previews. Your files never contain those previews: on save, every preview URL is mapped back to the original relative path (`img/photo.jpg`).

### 3. The Git Suture

A saved file is **your original document with only the regions you edited replaced**. Nothing is serialised from the live preview, so scoped CSS, preview URLs, editor wrappers or stripped scripts can never leak into your repo, and untouched regions stay byte-for-byte as you wrote them. The result is Base64 encoded and pushed with the file's current `sha`, so a concurrent change on GitHub is detected (409) instead of overwritten.

![Frankenstein Editor Interface](/images/editor.png)

---

## 🚀 The Two Versions

Frankenstein now comes in two flavors depending on your needs. Choose the folder that best fits your workflow.

### 1. The `dev/` Version (Zero Setup)

Perfect for personal projects or developers who want to manage their own sites. It talks directly to the GitHub API. No servers, no setup, just drop it in your repo.

**Three ways to configure it:**

- **A. Manual Login:** Open `dev/index.html` and log in with your Token, Username, and Repo name.
- **B. Local Config:** Fill in your data on `frankenstein.config.json` and reload the page. The fields will pre-fill on reload.
- **C. Remote/Iframe Config:**
  - **URL Params:** Append `?owner=USER&repo=REPO` to the URL.
  - **Iframe Message:** If hosted in an iframe, send a `postMessage` from the parent. (See `dev/iframe.html` for a working template).

**Setup (`dev/`):**

1. Add `data-editable` attributes to your HTML.
2. Create a **fine-grained** [GitHub token](https://github.com/settings/personal-access-tokens/new): *Only select repositories* → your one repo → *Contents: Read and write*. Avoid the classic `repo`-scope token: it can reach every repository you own. (See [SECURITY.md](SECURITY.md).)
3. Open `dev/index.html` (or your iframe/URL link) and enter your Token. The repo details will pre-fill if you used Method B or C.

### 2. The `prod/` Version (For Agencies & Clients)

Perfect if you build websites for clients. It uses a **Serverless Bouncer** (Supabase or PHP) to completely hide your GitHub Token.

**Now with Multi-tenant support:**

- **One Bouncer, Many Sites:** Use Supabase (Database) or a simple JSON file (PHP) to store configs for multiple clients in a single bouncer.
- **Fail-safe Fallback:** If your primary bouncer goes down, the CMS can automatically switch to a `backupBouncerUrl`.
- **Node.js Backup:** Includes a standalone Node.js script to run your own bouncer as a fallback.

**Setup (`prod/`):**

1. **Deploy the Bouncer** — the easiest is the **Cloudflare Worker** (`prod/worker/cloudflare-bouncer.mjs`): one file, no command line, free plan, never goes to sleep. Paste it into the Cloudflare dashboard, add a KV namespace called `SITES`, and you are done — the setup steps are written at the top of the file. Every site is then **one KV entry** (key = client email, value = `{"name","password","owner","repo"}` plus an optional `"token"` for repos that are not on your account).
   - Alternatives: **Supabase** (`prod/worker/supabase-bouncer.sql` + `.ts`, deploy with `--no-verify-jwt`; note free projects pause after a week of inactivity), **PHP** (`prod/worker/bouncer.php` + `sites.json`), or **Node** (`dev/scripts/bouncer-backup.js`, handy as `backupBouncerUrl`). The CMS switches to a backup bouncer automatically if the primary is down.
2. **Configure the UI once:** copy `prod/frankenstein.config.example.json` to `prod/frankenstein.config.json` and set `bouncerUrl`. That is all: with the Cloudflare Worker the CMS asks the bouncer which repo belongs to the login, so **one CMS URL serves all your clients**. (Older bouncers also need `owner` and `repo` in that file, one deployment per site.)
3. **Client Handoff:** Your client visits your CMS URL and enters their Email and Password. Adding the next client = one new KV entry.

---

## 🏗️ Project Structure

- **`dev/`**
  - **`index.html`**: The direct-to-GitHub CMS interface.
  - **`js/`**: Core logic including AES token encryption.
- **`prod/`**
  - **`index.html`**: The simplified Email/Password UI.
  - **`worker/`**: Bouncers: Cloudflare Worker (recommended), Supabase, PHP.
  - **`js/`**: Core logic modified to route traffic through the Bouncer.
- **`Igor`**: Your loyal assistant (`dev/js/igor.js`) who tracks stats, judges your writing style and reviews your page settings.
- **Shared modules** (identical in `dev/` and `prod/`): `files.js` (load/save/history), `doc.js` (editor → clean HTML), `blocks.js` (block library), `seo.js`, `pwa.js` (phone drawer + install button).

---



---

## 🔐 Security model (prod bouncer)

See **[SECURITY.md](SECURITY.md)** for the full picture: how the CMS protects tokens, what you must configure (fine-grained tokens, rate limiting, where the sites file lives), what was fixed, and the risks that remain.

The **bouncer** holds GitHub tokens server-side. Clients never see the token.

| Mechanism | Purpose |
|-----------|---------|
| Email + site password | Initial authentication |
| `X-Session-Token` (HMAC, 8h) | After login, password is not resent on every API call |
| Artificial delay on bad auth | Slows brute force |
| Request allowlist | The bouncer only forwards what the CMS needs (repo info, `contents`, `commits`, git `trees`/`blobs`; writes only to `contents`) and, when `github_owner`/`github_repo` are set, only for that repo. It is not an open GitHub API proxy |
| Constant-time password check | PHP and Node compare in constant time; PHP also accepts `password_hash()` values in `sites.json` |
| `sites.json` / Supabase `sites` table | Per-client token storage |

### CORS

Default bouncer CORS is permissive (`Access-Control-Allow-Origin: *`) so agency demos work from any host. For production:

1. Prefer hosting the CMS UI and bouncer under related origins.
2. Set your CMS origin: environment variable `FRANKENSTEIN_ALLOWED_ORIGIN` (PHP), function secret `ALLOWED_ORIGIN` (Supabase) or `ALLOWED_ORIGIN` (Node), e.g. `https://cms.example.com`.
3. Keep `Access-Control-Expose-Headers` as shipped (`X-Session-Token`, rate-limit headers) so the browser can read session tokens and back off when GitHub rate-limits.

### Operational tips

- Store `sites.json` **outside** the web root when using PHP, or protect it with server rules.
- Rotate GitHub tokens if a bouncer host is compromised.
- Use fine-grained GitHub PATs limited to the target repos.

## ✨ Page settings, blocks and phones

**⚙️ Page settings (SEO).** Beside title and description you can now set the canonical URL, the page language, a "hide from search engines" switch and the social-sharing title, description and image (a share image also adds a `twitter:card` tag). A live Google-style preview shows the result, and 🧟 Igor reviews the fields (title/description length, missing share image, non-absolute URLs, no or several H1s, images without alt text). Only fields you change are written to the page.

**➕ Insert block.** The sidebar's *Insert block* button adds a ready-made section: hero, text section, image + text (either side), two or three columns, quote, call to action, contact, divider. Choose where it goes (after the text block you last clicked, or the end of the page); blocks that need a link, image or email ask for it first. Every text part of a block is editable like the rest of the page, and each block shows ▲ ▼ 🗑 controls in the preview to move or remove it. Blocks are plain HTML with small inline styles that inherit your colours, marked with a `data-cms-block` attribute so the CMS can find them again. They are inserted *next to* a text block rather than inside it: the text editor cannot hold arbitrary components.

**📱 On your phone.** The dashboard has a phone layout (slide-in file drawer, large touch targets, formatting bar docked to the bottom edge) and installs as an app: in Chrome choose **⋮ → Install app** (or tap *📲 Install app* in the menu when it appears); on iOS use **Share → Add to Home Screen**. It runs full-screen and keeps working as a normal web app, so there is nothing to build or publish.

## 🧪 Development

```bash
npm install          # jsdom and fake-indexeddb are dev-only (tests)
npm test             # unit + end-to-end tests (the real bundled Quill in jsdom, fake GitHub API)
npm run check:parity # dev/ and prod/ share files.js, doc.js, utils.js … and must stay identical
```

`files.js`, `doc.js`, `editor.js`, `ui.js`, `seo.js`, `utils.js` and `sw.js` are shared by `dev/` and `prod/`; only login (`auth.js`, `config.js`) and the transport (`api.js`) differ. After editing a shared file, copy it to the other folder (the parity check tells you when you forgot). Also run `git rm -r --cached node_modules` once if `node_modules/` was committed.

## ⚠️ Known limitations

- **Quill is bundled** in `vendor/` (version 1.3.7, no CDN, works offline). `npm audit` no longer sees it because it is not an npm dependency, but know that Quill 1.x has one disputed, unpatched advisory (CVE-2021-3163: event-handler attributes in HTML fed to an HTML editor). The CMS never gives it raw HTML: the preview is sanitised first, Quill's whitelist drops handlers, and `tests/vendor.test.js` checks that payloads do not survive. Quill 2 is the long-term way out.
- **Editor engine (Quill 1.x) keeps only basic formatting** (bold, italic, underline, links, headings, lists, images with alt/size). A block containing anything else (a `<span class>`, `<code>`, inline styles…) is marked with a yellow warning and asks before editing, because editing it would drop that markup. Regions you do not touch are never altered.
- **Mobile Preview only narrows the editor.** CSS `@media` queries follow the real browser window, not the 375px preview.
- **Phone use is built but only verified in an emulated browser.** The layout, installability files and drawer logic are tested; real-device behaviour (Android keyboards with Quill 1.x autocorrect, the native selection bubble) still needs a try-out on your phone.
- **Not a native app.** The installable web app covers the roadmap's "app for mobile"; a store/APK wrapper (WebView/TWA) is not included.
- **Blocks use inline styles** so they work anywhere; restyle them with your own CSS if you want them to match your design.
- **Relative `url(...)` inside repo stylesheets** (fonts, background images) are not rewritten for the preview.
- **Selection in a Shadow DOM** works in Chromium; Firefox/Safari have not been verified with this build.
- **Autosave commits to your default branch** (every 30 s while there are changes), which also triggers a deploy on GitHub Pages. Leave it off unless you want that.
- Files that are not valid UTF-8 are refused rather than risk corrupting them.

## ⚰️ Todo & Roadmap

**Planning:**

**IMPORTANT:**

- [x] **Git Time Travel (History & Revert):** Load past commits for the current file and restore via Save.
- [x] **Mobile Preview:** Sidebar toggle narrows the editor to 375px (layout only: CSS `@media` rules follow the real window).
- [x] **Giving Igor a brain:** Empty links, missing alt, H1 issues, readability, long paragraphs.
- [x] **More SEO Options:** Canonical, language, noindex, social title/description/image, live search preview, and Igor's review of the fields.

**Later:**

- [x] **Phone Ready Editor:** Phone layout + installable web app (PWA). Tested in an emulated browser; try it on a real phone.
  - [ ] Optional native wrapper (WebView/TWA → APK) for app-store distribution.
- [x] **Block Inserter Section:** A menu to insert ready-made HTML components with move/remove controls (next to a text block rather than inside it, see above).
- [x] **Image Upload:** Upload images to `img/` and insert into the active editor.
