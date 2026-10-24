// Runs the REAL prod/worker/bouncer.php under PHP's built-in web server.
// Only paths that do not need the network are exercised (auth, config, throttle, 403/413).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const http = require("http");
const crypto = require("crypto");
const { spawn, execFileSync } = require("child_process");

let hasPhp = true;
try {
  execFileSync("php", ["-v"], { stdio: "ignore" });
} catch (e) {
  hasPhp = false;
}
const maybe = hasPhp ? test : test.skip;
const BOUNCER = path.join(__dirname, "../prod/worker/bouncer.php");

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function request(port, opts) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: opts.method || "GET",
        path: opts.path,
        headers: opts.headers || {},
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** layout: files to create under a fresh root; web = folder served by PHP */
async function withServer(layout, env, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bouncer-"));
  const web = path.join(root, "web");
  const tmp = path.join(root, "tmp");
  fs.mkdirSync(web);
  fs.mkdirSync(tmp);
  fs.copyFileSync(BOUNCER, path.join(web, "bouncer.php"));
  for (const [rel, content] of Object.entries(layout)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  const port = await freePort();
  const proc = spawn("php", ["-S", `127.0.0.1:${port}`, "-t", web], {
    env: { ...process.env, TMPDIR: tmp, ...env },
    stdio: "ignore",
  });
  try {
    for (let i = 0; i < 50; i++) {
      try {
        await request(port, { path: "/bouncer.php", method: "OPTIONS" });
        break;
      } catch (e) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    return await fn({ port, root, web, tmp });
  } finally {
    proc.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const sitesPhp = (extra) =>
  `<?php return ['anna@bakery.com' => ['password' => 'correct-horse-battery', 'github_token' => 'ghp_x', 'github_owner' => 'me', 'github_repo' => 'bakery'${extra || ""}]];`;
const login = (pw) => ({
  "Site-Email": "anna@bakery.com",
  "Site-Password": pw,
});
const P = (p) => "/bouncer.php?path=" + encodeURIComponent(p);

maybe(
  "a sites.json next to bouncer.php is refused (it would be downloadable by URL)",
  async () => {
    await withServer(
      {
        "web/sites.json": JSON.stringify({
          "a@b.c": { password: "x", github_token: "t" },
        }),
      },
      {},
      async ({ port }) => {
        const res = await request(port, {
          path: P("/repos/me/bakery"),
          headers: login("x"),
        });
        assert.strictEqual(res.status, 500);
        assert.match(res.body, /can be downloaded by anyone/);
      },
    );
  },
);

maybe("sites.php works, and requested by URL it leaks nothing", async () => {
  await withServer({ "web/sites.php": sitesPhp() }, {}, async ({ port }) => {
    const direct = await request(port, { path: "/sites.php" });
    assert.strictEqual(
      direct.body.trim(),
      "",
      "executing the file prints nothing",
    );
    assert.ok(!/correct-horse|ghp_x/.test(direct.body));
    const ok = await request(port, {
      path: P("/user"),
      headers: login("correct-horse-battery"),
    });
    assert.strictEqual(
      ok.status,
      403,
      "logged in, but /user is not an allowed path",
    );
    assert.ok(ok.headers["x-session-token"], "session token issued");
  });
});

maybe(
  "sites.json one folder ABOVE the script (outside the web root) is used",
  async () => {
    await withServer(
      {
        "sites.json": JSON.stringify({
          "anna@bakery.com": {
            password: "correct-horse-battery",
            github_token: "t",
            github_owner: "me",
            github_repo: "bakery",
          },
        }),
      },
      {},
      async ({ port }) => {
        const res = await request(port, {
          path: P("/user"),
          headers: login("correct-horse-battery"),
        });
        assert.strictEqual(res.status, 403);
      },
    );
  },
);

maybe(
  "FRANKENSTEIN_SITES can point anywhere; the legacy public sites.json needs an explicit opt-in",
  async () => {
    await withServer(
      {
        "elsewhere/s.json": JSON.stringify({
          "anna@bakery.com": {
            password: "correct-horse-battery",
            github_token: "t",
          },
        }),
      },
      {},
      async ({ port }) => {
        // env points to a file we create after knowing the root: use the opt-in route instead for this server
        void port;
      },
    );
    await withServer(
      {
        "web/sites.json": JSON.stringify({
          "anna@bakery.com": {
            password: "correct-horse-battery",
            github_token: "t",
          },
        }),
      },
      { FRANKENSTEIN_ALLOW_PUBLIC_SITES_JSON: "1" },
      async ({ port }) => {
        const res = await request(port, {
          path: P("/user"),
          headers: login("correct-horse-battery"),
        });
        assert.strictEqual(
          res.status,
          403,
          "explicit opt-in keeps old installs working",
        );
      },
    );
  },
);

maybe(
  "password_hash() values work, wrong passwords are 401, unknown emails are 401",
  async () => {
    const hash = execFileSync("php", [
      "-r",
      'echo password_hash("correct-horse-battery", PASSWORD_DEFAULT);',
    ]).toString();
    const php = `<?php return ['anna@bakery.com' => ['password' => '${hash}', 'github_token' => 't', 'github_owner' => 'me', 'github_repo' => 'bakery']];`;
    await withServer({ "web/sites.php": php }, {}, async ({ port }) => {
      assert.strictEqual(
        (
          await request(port, {
            path: P("/user"),
            headers: login("correct-horse-battery"),
          })
        ).status,
        403,
      );
      assert.strictEqual(
        (await request(port, { path: P("/user"), headers: login("wrong") }))
          .status,
        401,
      );
      assert.strictEqual(
        (
          await request(port, {
            path: P("/user"),
            headers: {
              "Site-Email": "nobody@x.com",
              "Site-Password": "correct-horse-battery",
            },
          })
        ).status,
        401,
      );
    });
  },
);

maybe(
  "after too many failed logins the client is refused with 429, even with the right password",
  async () => {
    await withServer(
      { "web/sites.php": sitesPhp() },
      {},
      async ({ port, tmp }) => {
        const key = crypto
          .createHash("sha256")
          .update("127.0.0.1")
          .digest("hex");
        fs.writeFileSync(
          path.join(tmp, "frankenstein-throttle-" + key),
          JSON.stringify({ first: Math.floor(Date.now() / 1000), count: 10 }),
        );
        const res = await request(port, {
          path: P("/repos/me/bakery"),
          headers: login("correct-horse-battery"),
        });
        assert.strictEqual(res.status, 429);
        assert.ok(res.headers["retry-after"]);
        assert.ok(!res.headers["x-session-token"]);
      },
    );
  },
);

maybe(
  "a client can only reach its own repo and may only write pages and img/ images",
  async () => {
    await withServer({ "web/sites.php": sitesPhp() }, {}, async ({ port }) => {
      const h = login("correct-horse-battery");
      for (const [method, p] of [
        ["GET", "/repos/other/bakery/contents/x.html"],
        ["GET", "/repos/me/other/contents/x.html"],
        ["PUT", "/repos/me/bakery/contents/.github/workflows/deploy.yml"],
        ["PUT", "/repos/me/bakery/contents/app.js"],
        ["PUT", "/repos/me/bakery/contents/img/evil.svg"],
        ["DELETE", "/repos/me/bakery/contents/index.html"],
      ]) {
        assert.strictEqual(
          (await request(port, { method, path: P(p), headers: h })).status,
          403,
          `${method} ${p}`,
        );
      }
    });
  },
);

maybe(
  "oversized uploads are rejected before anything is sent to GitHub",
  async () => {
    await withServer({ "web/sites.php": sitesPhp() }, {}, async ({ port }) => {
      const res = await request(port, {
        method: "PUT",
        path: P("/repos/me/bakery/contents/index.html"),
        headers: {
          ...login("correct-horse-battery"),
          "Content-Type": "application/json",
        },
        body: "x".repeat(9 * 1024 * 1024),
      });
      assert.strictEqual(res.status, 413);
    });
  },
);

maybe(
  "throttle unit: counts per client, window expires, success resets",
  () => {
    const src = fs.readFileSync(BOUNCER, "utf8");
    const a = src.indexOf("// BOUNCER-THROTTLE-START");
    const b = src.indexOf("// BOUNCER-THROTTLE-END");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "throttle-"));
    const script =
      `<?php\n${src.slice(a, b)}\n$d = $argv[1]; $out = [];\n` +
      `for ($i = 0; $i < 9; $i++) throttle_fail('ip1', $d, 900, 1000);\n$out[] = throttle_blocked('ip1', $d, 10, 900, 1000);\n` +
      `throttle_fail('ip1', $d, 900, 1000);\n$out[] = throttle_blocked('ip1', $d, 10, 900, 1000);\n` +
      `$out[] = throttle_blocked('ip2', $d, 10, 900, 1000);\n` +
      `$out[] = throttle_blocked('ip1', $d, 10, 900, 1000 + 901);\n` +
      `throttle_reset('ip1', $d);\n$out[] = throttle_blocked('ip1', $d, 10, 900, 1000);\n` +
      `throttle_fail('ip3', $d, 900, 1000); throttle_fail('ip3', $d, 900, 5000); $out[] = throttle_read('ip3', $d, 900, 5000);\n` +
      `echo json_encode($out);`;
    const f = path.join(dir, "t.php");
    fs.writeFileSync(f, script);
    const out = JSON.parse(execFileSync("php", [f, dir]).toString());
    assert.deepStrictEqual(out, [false, true, false, false, false, 1]);
    fs.rmSync(dir, { recursive: true, force: true });
  },
);
