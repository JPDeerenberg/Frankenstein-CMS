# Next steps (not done yet, in priority order)

1. **Isolate the preview in an `<iframe>` instead of a Shadow DOM.** Real `<html>/<body>`, so the site's CSS runs unmodified (no scoping regex), `@media` queries and the Mobile Preview become accurate, and text selection works in Firefox/Safari. Quill has to be loaded inside the iframe document. Biggest remaining quality win; needs browser testing.
2. **Vendor Quill** (and water.css) into the repo instead of loading from CDNs, so the CMS works offline / behind blockers and the service worker can really cache the shell.
3. **Igor should aggregate all regions.** Each `Igor.init(quill)` overwrites the previous one, so the stats panel reflects the last edited block only.
4. **Rewrite relative `url(...)` in repo stylesheets** (fonts, backgrounds) to blob URLs for the preview.
5. **Replace `alert()/confirm()/prompt()`** with in-page dialogs (mobile, iframes).
6. **Source-preserving saves.** `buildSavedDocument` re-serialises the whole file through the HTML parser (whitespace/attribute-quoting normalisation shows up as noisy diffs). Splicing edited regions into the original text by offset would give minimal diffs.
7. Optional: save through a branch/PR instead of committing to the default branch; hashed passwords for the Supabase bouncer.

8. **Try the phone layout on a real phone** (Chrome/Android and iOS Safari): the drawer, the bottom formatting bar, Gboard autocorrect inside the editor (Quill 1.x has known quirks there), and the install flow. These could not be verified without a device.
9. **Native wrapper** (optional): wrap the installed web app as an APK with Bubblewrap/PWABuilder (TWA) if you want it in a store.
10. **More blocks / your own blocks:** blocks live in `dev/js/blocks.js` as small functions returning HTML; add yours there (and copy to `prod/js/`), or move the library into a JSON file per site.
