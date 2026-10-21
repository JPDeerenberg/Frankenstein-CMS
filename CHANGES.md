# What changed in this overhaul

## Fixed: data loss / corrupted files
- Saving rewrote the site's own `<style>` blocks (`body` → `#cms-page-content`) in your repo on every save. The file is now built from the original document + only the edited regions.
- Every editable region was re-serialised through the editor, so untouched content changed too (`<br>` split into paragraphs, classes/spans dropped, `target="_blank"` added to all links, `<p>`/`<h1>` replaced by `<div><p>`…). Only regions you edit are written now, and block/inline containers keep their own tag.
- Images inside editable regions were saved as giant `data:` URLs. Preview URLs are mapped back to the repo path.
- Files over 1 MB opened blank and a save would have overwritten them with an empty page. They are read via the Git Blobs API; non-UTF-8 files are refused.
- Clicking another file quickly could display one file but save into another (no load guard). Outdated loads are now discarded.
- Switching files / closing the tab with unsaved edits silently lost them. Both ask first.
- Two overlapping saves (autosave + button) could clash. A save lock prevents it; a GitHub 409 conflict offers a reload instead of failing silently; autosave failures are shown.
- Ctrl+Z right after opening a page emptied the region.
- Stale `sha`s from the browser HTTP cache (GitHub caches GETs for 60 s) are avoided with `cache: "no-cache"`.

## Fixed: it just didn't work
- dev login could hang forever on a fresh browser (IndexedDB key creation outside a transaction).
- prod: CSP blocked every bouncer that was not on `*.supabase.co`, external CDN stylesheets and web fonts. CSP updated (`frame-ancestors` removed: it is ignored in a `<meta>`).
- prod/Supabase/Node bouncers replaced the `Accept` header, so raw CSS/images came back as JSON in the preview.
- prod: the session token expiring (8 h) broke every request; it now falls back to the password. The backup bouncer is used for all requests, not only at login.
- Relative links/images in pages inside sub-folders, file names with spaces/`#`/`?`, `?v=2` query strings on assets.
- Uploaded images were inserted with a path relative to the repo root; now relative to the page. Alt text prompt added.
- File list: one Git Trees request instead of one request per folder.

## Fixed: security
- Bouncers forwarded any GitHub API path (other repos, user data, DELETE…) for any authenticated client. They now allow only what the CMS needs and, with `github_owner`/`github_repo`, only that repo (PHP, Supabase and Node share test vectors).
- prod commit history rendered commit messages as HTML (XSS). Text nodes now.
- Preview is sanitised (no scripts, inline handlers or `javascript:` URLs run inside the CMS origin).
- Constant-time password checks; optional hashed passwords (PHP); restrictable CORS origin.

## Improved
- Headings toggle (H2 again → paragraph), Paragraph button in dev, toolbar no longer steals the selection, menu stays with the selection.
- Warning before editing blocks with markup the editor cannot preserve.
- Dev and prod now share `files.js`, `doc.js` and friends (parity-checked) instead of drifting apart.
- Service worker is network-first (old versions were served until a second reload).
- SEO: live character counters, `.htm` support, document untouched unless SEO fields changed.
- 76 tests (was 36): end-to-end editor flow with real Quill, bouncer allowlists in PHP/TS/Node, login regression.

## Added: Cloudflare Worker bouncer (multi-site made easy)
- `prod/worker/cloudflare-bouncer.mjs`: single file you paste into the Cloudflare dashboard. Sites live in a KV namespace: one entry per client (email → name, password, owner, repo, optional own token, otherwise the shared `GITHUB_TOKEN` secret).
- The CMS now learns the client's repo from the bouncer after login (`?action=site`), so `prod/` is deployed once for all clients. Older bouncers keep working with `owner`/`repo` in `frankenstein.config.json`.
- Same safety rules as the other bouncers: request allowlist limited to the client's own repo, constant-time password check, signed 8-hour sessions (invalidated when the password/token changes), no browser headers forwarded, readable `Bouncer setup: …` errors.
- 13 Worker tests (fake KV + fake GitHub) and shared allowlist vectors; 6 tests for the new login flow.

## Roadmap items completed (from the README to-do list)
- **More SEO Options:** canonical URL, language, noindex, social title/description/image (adds `twitter:card`), live search-result preview, Igor reviews the fields and the page (H1 count, images without alt). Only changed fields are written. 12 tests.
- **Block Inserter:** 9 blocks (hero, text, image left/right, 2/3 columns, quote, call to action, contact, divider), insert after the selected text block or at the end of the page, move up/down, remove. Text typed before an insert is never lost; every block's text fields open in the editor without warnings. 11 tests incl. the full insert → edit → save → reload → move → remove cycle.
- **Phone Ready Editor:** there was no viewport tag and no responsive CSS at all, so phones showed a shrunken desktop page. Added the viewport tag, a slide-in drawer, 44px touch targets, 16px inputs (no iOS zoom), a formatting bar docked to the bottom on touch screens, a web app manifest with icons and an install button, and the service worker caches the app shell. 12 tests for the files, CSS and drawer/install logic.
