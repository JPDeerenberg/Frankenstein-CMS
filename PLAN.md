# Next steps (not done yet, in priority order)

1. **Iframe preview instead of Shadow DOM.** Real `<html>/<body>` would let the
   site's CSS run unmodified (no scoping regex) and make `@media`/Mobile Preview
   accurate. Deferred after a Chrome experiment: Quill 1.3.7 initialised
   parent-side on an element inside `sandbox="allow-same-origin"` accepts typing,
   but `getSelection()` returns `null` because Quill reads the parent document's
   selection; the formatting toolbar therefore cannot work. Loading Quill inside
   the iframe requires `allow-scripts`, which conflicts with the no-script
   sandbox. Revisit with Quill 2 or a parent-selection adapter.
2. **Source-preserving saves.** `buildSavedDocument` re-serialises the whole file
   through the HTML parser (whitespace/attribute-quoting normalisation shows up
   as noisy diffs). Splicing edited regions into the original text by offset
   would give minimal diffs.
3. **Quill 2.** The bundled editor is 1.3.7, which has a disputed unpatched
   advisory and selection quirks on mobile. Moving to Quill 2 is a rewrite of the
   editor integration, not a drop-in upgrade.
4. **Try the phone layout on a real phone** (Chrome/Android and iOS Safari): the
   drawer, the bottom formatting bar, Gboard autocorrect inside the editor and
   the install flow. These could not be verified without a device.
5. **Native wrapper** (optional): wrap the installed web app as an APK with
   Bubblewrap/PWABuilder (TWA) if you want it in a store.
6. **Optional save mode through a branch/PR** instead of committing straight to
   the default branch, plus hashed passwords for a KV/Supabase-style setup.
7. **Hard rate limiting without Cloudflare's WAF:** a Durable Object counter in
   the Worker.
8. **Authenticated audit trail.** Commits now end with
   `Edited-by: <display name>`, but that name comes from the site configuration
   and Git still records the shared token as author. A real per-client identity
   (signed author metadata or per-client tokens) is still open.
9. **More blocks / your own blocks.** Blocks live in `shared/js/blocks.js` as
   small functions returning HTML; add yours there and run `npm run sync`.
10. **Optional "keep me signed in" switch** in dev so the encrypted token is not
    stored unless asked.
