# AGENTS.md

Frankenstein CMS is a zero-install CMS for static HTML sites on GitHub. The app
is plain classic `<script>` files served from a folder; there is no build step to
deploy. This file is for anyone (human or AI) changing it.

## Repo map

- `dev/` — the CMS talking to GitHub directly; the token is encrypted in the browser.
- `prod/` — the same CMS for client logins. A bouncer holds the GitHub token.
  Bouncers live in `prod/worker/`: `cloudflare-bouncer.mjs` (recommended),
  `bouncer.php`, `supabase-bouncer.ts`, `node-bouncer.js`.
- `shared/js/` — **source of truth** for the 11 modules shared by dev and prod:
  `utils doc blocks pwa actions boot editor ui seo igor files`.
- `shared/sw.template.js` — service-worker template. `npm run sync` generates
  `dev/sw.js` and `prod/sw.js` with the real asset list and a content hash.
- `shared/vendor/` — vendored assets copied into both `vendor/` folders.
- `scripts/` — `sync.mjs`, `new-site.mjs`, `set-bouncer-origin.mjs`.
- `tests/` — `node --test`, jsdom, and `tests/helpers/fake-github.js`.
- `dev/vendor/` and `prod/vendor/` — bundled Quill/water.css. Never edit by hand.

## Commands

```bash
npm install
npm test                              # all tests
npm test -- --test-name-pattern "..." # one test
npm run sync                          # shared/ -> dev/ and prod/
npm run check                         # sync check + Prettier check + tests
npm run format                        # Prettier
```

## Rules

- **Classic `<script>`, not ES modules.** Files in `shared/js/`, `dev/js/` and
  `prod/js/` share top-level globals and load in order with `defer`. No
  `import`/`export` in them.
- **Edit shared code only in `shared/`**, then `npm run sync`. Never edit
  `dev/js/<shared file>` or `prod/js/<shared file>` by hand; `npm run check`
  fails when a generated copy is stale.
- **No new runtime dependencies**, bundlers or frameworks. Dev dependencies
  only when a task needs them.
- **Never edit `dev/vendor/*` or `prod/vendor/*`** by hand. Add sources under
  `shared/vendor/` and run sync.
- **Never loosen security.** Do not widen the CSP, the bouncer allowlists
  (`isAllowedGithubRequest`, `isAllowedWritePath`), the sanitiser in
  `shared/js/doc.js`, or `tests/fixtures/bouncer-vectors.json`. Tightening is
  fine.
- **Every behaviour change needs a test** in `tests/`. Do not weaken or skip a
  test to make a change pass.
- Prettier: double quotes, semicolons, trailing commas, 80 columns. Run
  `npm run format`.
- Commit work on the `cleanup` branch, not `main`.

## How a save works

`buildSavedDocument(originalRaw, edits, hooks)` in `shared/js/doc.js` parses the
original file into an inert document, replaces the `innerHTML` of **only** the
editable regions listed in `edits`, applies the SEO hooks, then serialises the
whole document. Untouched regions keep their markup, but whole-file serialisation
can still normalise whitespace and attribute quoting; source-preserving offset
splicing is still open (PLAN.md item 6). Saves are built from the original
document, never from the preview.

## Where things live

- New block: add a renderer in `shared/js/blocks.js`; test in `tests/blocks.test.js`.
- Sanitiser / URL rules: `shared/js/doc.js`; tests `doc.test.js`,
  `security_frontend.test.js`.
- Dialogs: `shared/js/dialog.js` (`Dialog.alert/confirm/prompt`). Never call
  `window.alert/confirm/prompt` directly.
- Service-worker assets: generated from the files that exist in each folder, or
  from `shared/vendor/`; no manual list to maintain.
- Bouncer changes: keep the PHP, Supabase, Node and Cloudflare allowlists in
  sync; `tests/bouncer.test.js` checks the shared vectors.

## Two performance lessons worth keeping

- Cache the **fetch promise** in `resourceCache`, not the resolved result:
  concurrent requests then share one fetch. Return `null` on failure and evict
  the entry so a later retry can succeed.
- **Debounce work on keystrokes.** Do not serialise or re-parse the editor DOM on
  every `text-change`; query the live Quill root instead.

Security rules are not negotiable.
