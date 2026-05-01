## 2024-04-16 - GitHub API Asset Fetching Bottleneck
**Learning:** The CMS architecture re-fetches inline assets (CSS, images) via the GitHub API (or bouncer) for every page load. Because it operates entirely client-side without a persistent backend, repeatedly loading files like `style.css` or common logos drastically increases page render latency and wastes API rate limits.
**Action:** Implemented a session-level memory cache (`resourceCache`) to store fetched text/blobs for CSS and images. Next time similar client-side resource injection is used, always include an in-memory cache map for repeated paths.
## 2024-04-17 - Base64 Encoding/Decoding Bottleneck for Full Document Saves
**Learning:** The CMS architecture serializes and base64-encodes the *entire* HTML document to push it to the GitHub API on save. Previously, `utf8ToBase64` and `base64ToUtf8` processed strings using character-by-character iterations (`String.fromCharCode` loop and `Uint8Array.from`), which caused massive main-thread blocking (~3s encoding, ~1s decoding for 5MB payloads).
**Action:** Replaced character-by-character loops with chunked processing (`String.fromCharCode.apply` with chunk sizes) and pre-allocated typed arrays in `utils.js`. Always optimize large string manipulations in environments where whole-document serialization is the core operating mechanism.
## 2024-04-18 - Path Resolution Iteration Bottleneck
**Learning:** The CMS uses `resolvePath` extensively to resolve relative paths for images and CSS assets whenever it fetches them from GitHub. This utility function was using `Array.prototype.forEach` to process the path components. For operations executed repeatedly and synchronously during the core rendering loop, creating closures within array iteration methods is an unnecessary overhead compared to traditional loops.
**Action:** Replaced `Array.prototype.forEach` with a standard `for` loop in `resolvePath` in `dev/js/utils.js` and `prod/js/utils.js`. Prioritize traditional `for` loops in utility functions that are repeatedly invoked during document rendering.
## 2024-05-19 - [Avoid DOM Serialization on Keystrokes]
**Learning:** Serializing the entire editor content to an HTML string (`innerHTML`) and re-parsing it into a temporary DOM element on every single keystroke (`text-change` event) causes significant performance degradation and unnecessary memory allocation, especially for larger documents.
**Action:** When analyzing editor content, query the Quill instance's live DOM root (`q.root.querySelectorAll`) directly instead of creating temporary elements and assigning `innerHTML`.
## 2024-05-20 - Keystroke Event Handlers Blocking Main Thread
**Learning:** Functions bound to high-frequency events like `text-change` (keystrokes) that perform synchronous DOM queries or string parsing (like `Igor.scan` or redundant UI updates in `setUnsaved`) can cause severe main-thread blocking, making the editor feel sluggish during rapid typing.
**Action:** Always debounce expensive operations (like full-document scanning or UI rebuilding) bound to keystroke events, and add early returns to state-change functions (like `setUnsaved`) to prevent redundant DOM manipulations once the state has already been reached.
## 2024-05-21 - Caching Promises vs Results for Network Requests
**Learning:** The CMS architecture re-fetches inline assets (CSS, images) via the GitHub API. Storing the resolved result in a cache (`resourceCache`) still allows duplicate concurrent network requests to be sent if multiple identical assets are requested simultaneously before the first one completes. Also, throwing errors on failure can break control flow when the existing logic silently aborted.
**Action:** Always store the Promise immediately in the cache rather than waiting for the resolved result, and handle failed requests gracefully (e.g., returning null) rather than throwing errors.
## 2024-05-22 - Regex split in text scanning functions
**Learning:** Using regex-based string splitting (`cleanText.split(/\s+/)`) for calculating word counts creates an O(N) space array allocation which triggers heavy garbage collection during frequent text scans.
**Action:** Use an O(1) space `charCodeAt` loop for finding word boundaries instead of string manipulation functions whenever parsing large text documents on frequent intervals.

## 2026-05-01 - querySelectorAll vs getElementsByTagName for High-Frequency DOM Scans
**Learning:** Using `querySelectorAll` combined with `.forEach()` for high-frequency DOM operations (like scanning editor content on keystrokes) creates significant overhead due to static NodeList allocation and closure creation. This causes main-thread blocking and garbage collection pauses during rapid typing.
**Action:** Replace `querySelectorAll` with `getElementsByTagName` and standard `for` loops for high-frequency queries to leverage live, low-overhead HTMLCollections and avoid unnecessary memory allocations.
