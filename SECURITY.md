# Security

Frankenstein CMS handles credentials that can change your websites, so this page says
what is protected, what you must configure yourself, and what is still a risk.

## How it works, and what an attacker would want

| | dev/ (direct) | prod/ (bouncer) |
|---|---|---|
| Secret | your GitHub token, in the browser | clients only know email + password; the token stays on the bouncer |
| Where it lives | encrypted in `localStorage`, key in IndexedDB (non-extractable) | in the bouncer: Cloudflare KV / Supabase table / `sites.php` |
| Worst case if stolen | write access to the repos the token covers | write access to ONE repo's pages and images |

The browser is the weak spot: any script that runs on the CMS page can use the stored token.
The defences are layered so that one mistake is not enough:

1. **No script can run except the CMS's own files.** The Content-Security-Policy is
   `script-src 'self'`; the page has no inline handlers or scripts (`js/actions.js`
   dispatches clicks), so injected `<script>` / `onerror=` markup does nothing even if it gets in.
2. **Repository content is sanitised before it touches the page.** Pages you open are parsed
   in an inert document, stripped of scripts, event handlers, `javascript:`-style URLs
   (including tab/newline-obfuscated ones), `srcdoc`, SVG animation tricks, and only then moved
   into the preview. Saved files are built from the original, never from the preview.
3. **The token can only be sent to GitHub** (dev: `connect-src 'self' https://api.github.com`).
4. **Passwords are only sent over https** to a bouncer address that comes from
   `frankenstein.config.json` on your own origin, never from the URL or from another window.
5. **The bouncer is not an open proxy.** It forwards only what the CMS needs, only for that
   client's repo, and clients may only write `*.html` pages and `img/` PNG/JPG/GIF/WebP/AVIF/ICO
   images: no `.github/` workflows, scripts, configs or SVG (SVG can contain scripts).

## Do this when you deploy

- **Use a fine-grained GitHub token, one per repo.** GitHub → Settings → Developer settings →
  *Fine-grained tokens* → Generate: *Only select repositories* → pick the one repo →
  *Repository permissions*: **Contents: Read and write** (Metadata read is added automatically).
  Give it an expiry (e.g. 90 days) and a reminder to renew it. Do **not** grant Workflows,
  Actions, Administration, or use a classic token with the `repo` scope: that reaches every
  repository you own. If a token leaks, revoke it and create a new one.
- **Passwords: 12+ random characters per client** (the Cloudflare Worker refuses shorter ones).
  The built-in throttle (10 failures / 15 min per address) is a speed bump, not a wall.
- **Cloudflare Worker:** serve it from **your own domain** (Worker → Settings → Domains &
  Routes → Add custom domain), add a *Rate limiting rule* for that hostname in the Cloudflare
  dashboard (Security → WAF), and **disable the `workers.dev` address** (same page). WAF rules
  protect your domain; the plain `*.workers.dev` address would bypass them. Then use the custom
  domain as `bouncerUrl`.
- **PHP bouncer:** keep the sites file out of the web. Use `sites.php` (copy
  `prod/worker/sites.example.php`) or put `sites.json` one folder above `bouncer.php`; a plain
  `sites.json` next to the script is refused. `prod/worker/.htaccess` already denies those
  files on Apache. nginx: `location ~ /(sites\.(json|php)|clients\.json)$ { deny all; }`.
  Set `FRANKENSTEIN_TRUST_PROXY=1` only if you are behind Cloudflare (so the throttle sees
  real client addresses) and `FRANKENSTEIN_ALLOWED_ORIGIN` to your CMS origin.
- **Supabase:** deploy with `--no-verify-jwt`, keep Row Level Security ON (the SQL does this),
  never put the service-role key anywhere but the function's secrets. Set `ALLOWED_ORIGIN`.
- **prod CSP:** `prod/index.html` allows `connect-src https:` because your bouncer address is
  not known in advance. Replace `https: http://localhost:* http://127.0.0.1:*` in that meta
  tag with your exact bouncer origin(s), e.g. `https://bouncer.example.com`.
- **Host your own copy of the CMS.** `dev/iframe.html` points at the original author's hosted
  copy: whoever hosts the page you log in on can read what you type. Change its `src` to your own.
- **Clickjacking:** a `<meta>` tag cannot forbid framing and GitHub Pages cannot send headers.
  If your host can (Cloudflare Pages / Netlify `_headers`, nginx, Apache), add
  `Content-Security-Policy: frame-ancestors 'self'` (or your embedding site) and
  `X-Frame-Options: SAMEORIGIN`.
- **Shared computers:** log out. In dev, the encrypted token stays on the device until you do.

## What the review found (and fixed)

| Severity | Problem | Fix |
|---|---|---|
| High | prod login took the bouncer URL from `?bouncer=…`: a crafted link could send a client's password to an attacker | honoured only when framed by a same-origin page; https required; never from messages |
| High | CSP had `'unsafe-inline'` and 28 inline handlers, so any HTML injection could run script and read the token | inline handlers/scripts removed, `script-src 'self'` |
| High | repo HTML was loaded into the live page and sanitised afterwards (`<img onerror>` could fire first) | sanitised in an inert document, nodes imported, never re-parsed |
| High | PHP read `sites.json` (passwords + tokens) from the public folder | refused; `sites.php` / parent-folder / env path; `.htaccess` |
| Medium | clients could write any file in their repo (workflows, scripts) and upload SVG | write allowlist in all four bouncers; SVG refused |
| Medium | unknown email answered differently from wrong password (Supabase, Node) | identical response and delay |
| Medium | Supabase returned every GitHub header (token scopes, expiry); Node echoed upstream errors | short header list; generic error |
| Medium | service worker could cache a same-origin bouncer's responses (repo contents) | only the app's own files are cached |
| Medium | `message` events accepted from any window; owner/repo from URL unchecked | parent-only, validated names |
| Medium | only a sleep against password guessing; sleep also ties up PHP workers | per-address throttle (429); shorter sleep |
| Low | `java⇥script:` links slipped past the URL check | scheme read after removing invisible characters; allowlist |
| Low | Quill 1.3.6 from a CDN (tabnabbing flaw) | Quill 1.3.7 bundled, no CDN |
| Low | no request size limit | 8 MB cap |

## Still a risk (read this)

- **The token is usable by any script on the CMS origin.** The CSP makes injection much
  harder; it does not make it impossible. A compromised dependency or hosting account would
  still expose it. Fine-grained single-repo tokens limit the damage.
- **Secrets are stored in plain text** in KV / the Supabase table / `sites.php`: protected by
  your account security, not by encryption. Turn on 2FA for Cloudflare/Supabase/GitHub.
- **The throttle is per address and in memory** (Worker, Supabase): determined attackers with
  many addresses are only stopped by a WAF rate-limit rule and strong passwords.
- **Clients can still publish arbitrary HTML** to their own site (that is what a page editor
  is), including `<script>`. Only give accounts to people you trust with their own site.
- **No audit log and no 2FA** for client logins. Git history shows what was committed, but
  every commit is made with the shared token.
- **Quill 1.x** has one disputed, unpatched advisory (CVE-2021-3163, event-handler attributes
  in HTML fed to an HTML editor). The CMS never gives Quill raw HTML and tests check that
  payloads do not survive; Quill 2 is the long-term answer.
- **Third parties:** the dashboard stylesheet comes from jsDelivr (pinned with an integrity
  hash); the Supabase function imports `@supabase/supabase-js` from esm.sh (pin a full version
  if you deploy it). Sites' own external stylesheets are loaded in the preview.
- `style-src` still allows inline styles and any https stylesheet (needed to show your site).

## Reporting a problem

Please report vulnerabilities privately to the repository owner (GitHub: *Security → Report
a vulnerability*) instead of opening a public issue.
