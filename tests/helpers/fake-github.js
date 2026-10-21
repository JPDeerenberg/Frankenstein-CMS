// An in-memory fake of the GitHub API plus a jsdom page running the real CMS scripts.
const { createEnv, run } = require("./dom-env");

const SCRIPTS = [
  "dev/js/config.js",
  "dev/js/api.js",
  "dev/js/utils.js",
  "dev/js/doc.js",
  "dev/js/blocks.js",
  "dev/js/ui.js",
  "dev/js/editor.js",
  "dev/js/seo.js",
  "dev/js/files.js",
];

function b64(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/(.{60})/g, "$1\n");
}

function setup(initialFiles, opts) {
  opts = opts || {};
  const files = {};
  const calls = [];
  const dialogs = { alerts: [], confirms: [], answer: true };
  let shaCounter = 1;
  Object.entries(initialFiles).forEach(([p, v]) => {
    files[p] = {
      data: Buffer.isBuffer(v) ? v : Buffer.from(v),
      sha: "sha" + shaCounter++,
    };
  });
  const state = { files, calls, putFail: null, delays: {}, commits: [] };

  const respond = (status, body, extra) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (extra && extra[k.toLowerCase()]) || null },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () => new Uint8Array(Buffer.from(String(body))).buffer,
  });

  const handler = async (url, init) => {
    init = init || {};
    const method = init.method || "GET";
    const headers = init.headers || {};
    calls.push({ method, url, headers, init });
    const u = new URL(url);
    const m = u.pathname.match(/^\/repos\/o\/r(\/.*)?$/);
    if (!m) return respond(404, { message: "Not Found" });
    const rest = m[1] || "";

    if (rest === "/git/trees/HEAD") {
      return respond(200, {
        truncated: false,
        tree: Object.keys(files).map((p) => ({ path: p, type: "blob" })),
      });
    }
    if (rest.startsWith("/git/blobs/")) {
      const sha = rest.slice("/git/blobs/".length);
      const f = Object.values(files).find((x) => x.sha === sha);
      return f
        ? respond(200, { content: b64(f.data), encoding: "base64" })
        : respond(404, {});
    }
    if (rest.startsWith("/commits")) {
      return respond(200, state.commits);
    }
    if (rest.startsWith("/contents/")) {
      const p = decodeURIComponent(rest.slice("/contents/".length));
      if (state.delays[p])
        await new Promise((r) => setTimeout(r, state.delays[p]));
      if (method === "PUT") {
        if (state.putFail)
          return respond(state.putFail, { message: "forced failure" });
        const body = JSON.parse(init.body);
        const existing = files[p];
        if (existing && body.sha !== existing.sha)
          return respond(409, { message: "sha does not match" });
        files[p] = {
          data: Buffer.from(body.content, "base64"),
          sha: "sha" + shaCounter++,
        };
        state.lastPut = { path: p, body, text: files[p].data.toString("utf8") };
        state.puts = (state.puts || 0) + 1;
        return respond(200, { content: { sha: files[p].sha } });
      }
      const f = files[p];
      if (!f) return respond(404, { message: "Not Found" });
      if ((headers.Accept || "").includes("raw"))
        return respond(200, f.data.toString("binary"), {
          "content-type": "text/plain",
        });
      const big = state.bigFiles && state.bigFiles.includes(p);
      return respond(200, {
        type: "file",
        sha: f.sha,
        size: f.data.length,
        content: big ? "" : b64(f.data),
        encoding: big ? "none" : "base64",
      });
    }
    return respond(404, { message: "Not Found" });
  };

  const w = createEnv(SCRIPTS.slice(0, 0), {
    beforeScripts(win) {
      win.fetch = handler;
      win.alert = (m) => dialogs.alerts.push(String(m));
      win.confirm = (m) => {
        dialogs.confirms.push(String(m));
        return dialogs.answer;
      };
      win.prompt = () => "";
      run(win, "let autosaveTimer = null; const AUTOSAVE_INTERVAL = 30000;");
    },
  });
  // load the CMS scripts after the stubs exist
  SCRIPTS.forEach((s) =>
    run(
      w,
      require("fs").readFileSync(
        require("path").join(__dirname, "..", "..", s),
        "utf8",
      ),
    ),
  );
  w.eval('config = { token: "t", owner: "o", repo: "r" }');
  const get = (expr) => w.eval(expr);
  return { w, state, dialogs, calls, get };
}

module.exports = { setup, SCRIPTS, b64 };
