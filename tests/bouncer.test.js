const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const vectors = require("./fixtures/bouncer-vectors.json");
const nodeBouncer = require(path.join(root, "dev/scripts/bouncer-backup.js"));

function between(text, start, end) {
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  assert.ok(a !== -1 && b > a, `markers ${start}/${end} not found`);
  return text.slice(a + start.length, b);
}

const label = (v) =>
  `${v[0]} ${JSON.stringify(v[1])} owner=${v[2]} repo=${v[3]}`;

test("Node bouncer allowlist matches the shared vectors", () => {
  for (const [method, p, owner, repo, expected] of vectors) {
    assert.strictEqual(
      nodeBouncer.isAllowedGithubRequest(method, p, owner, repo),
      expected,
      label([method, p, owner, repo]),
    );
  }
});

test("Cloudflare Worker allowlist matches the shared vectors", () => {
  const src = fs.readFileSync(
    path.join(root, "prod/worker/cloudflare-bouncer.mjs"),
    "utf8",
  );
  const guard = between(src, "// BOUNCER-GUARD-START", "// BOUNCER-GUARD-END");
  const isAllowed = new Function(guard + "\nreturn isAllowedGithubRequest;")();
  for (const [method, p, owner, repo, expected] of vectors) {
    assert.strictEqual(
      isAllowed(method, p, owner, repo),
      expected,
      label([method, p, owner, repo]),
    );
  }
});

test("Supabase (TypeScript) allowlist matches the shared vectors", (t) => {
  const mod = require("node:module");
  if (typeof mod.stripTypeScriptTypes !== "function") {
    t.skip("this Node version cannot strip TypeScript types");
    return;
  }
  const ts = fs.readFileSync(
    path.join(root, "prod/worker/supabase-bouncer.ts"),
    "utf8",
  );
  const guard = between(ts, "// BOUNCER-GUARD-START", "// BOUNCER-GUARD-END");
  const js = mod.stripTypeScriptTypes(guard);
  const isAllowed = new Function(js + "\nreturn isAllowedGithubRequest;")();
  for (const [method, p, owner, repo, expected] of vectors) {
    assert.strictEqual(
      isAllowed(method, p, owner, repo),
      expected,
      label([method, p, owner, repo]),
    );
  }
});

test("PHP allowlist matches the shared vectors", (t) => {
  try {
    execFileSync("php", ["-v"], { stdio: "ignore" });
  } catch (e) {
    t.skip("php is not installed");
    return;
  }
  const php = fs.readFileSync(
    path.join(root, "prod/worker/bouncer.php"),
    "utf8",
  );
  const guard = between(php, "// BOUNCER-GUARD-START", "// BOUNCER-GUARD-END");
  const tmp = path.join(os.tmpdir(), `guard-${process.pid}.php`);
  fs.writeFileSync(
    tmp,
    `<?php\n${guard}\n$v = json_decode(file_get_contents($argv[1]), true);\n` +
      `$out = [];\nforeach ($v as $c) { $out[] = github_request_allowed($c[0], $c[1], $c[2], $c[3]); }\n` +
      `echo json_encode($out);\n`,
  );
  const out = JSON.parse(
    execFileSync("php", [
      tmp,
      path.join(__dirname, "fixtures/bouncer-vectors.json"),
    ]).toString(),
  );
  vectors.forEach((v, i) => {
    assert.strictEqual(out[i], v[4], label(v));
  });
  fs.unlinkSync(tmp);
});

test("PHP bouncer file has valid syntax", (t) => {
  try {
    execFileSync("php", ["-v"], { stdio: "ignore" });
  } catch (e) {
    t.skip("php is not installed");
    return;
  }
  execFileSync("php", ["-l", path.join(root, "prod/worker/bouncer.php")]);
});

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
    req.end();
  });
}

test("Node bouncer server: auth, CORS and path restriction (no network needed)", async () => {
  const server = nodeBouncer.createServer(
    {
      CLIENT_EMAIL: "me@site.com",
      CLIENT_PASSWORD: "s3cret",
      GITHUB_TOKEN: "ghp_x",
      GITHUB_OWNER: "me",
      GITHUB_REPO: "site",
      AUTH_FAIL_DELAY_MS: "0",
    },
    {},
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const good = { "Site-Email": "me@site.com", "Site-Password": "s3cret" };
  try {
    const pre = await request(port, { method: "OPTIONS", path: "/?path=/x" });
    assert.strictEqual(pre.status, 204);
    assert.match(pre.headers["access-control-allow-headers"], /Site-Session/);
    assert.match(
      pre.headers["access-control-expose-headers"],
      /X-RateLimit-Remaining/,
    );

    const noAuth = await request(port, {
      path: "/?path=" + encodeURIComponent("/repos/me/site/contents/a.html"),
    });
    assert.strictEqual(noAuth.status, 401);

    const wrong = await request(port, {
      path: "/?path=" + encodeURIComponent("/repos/me/site/contents/a.html"),
      headers: { "Site-Email": "me@site.com", "Site-Password": "nope" },
    });
    assert.strictEqual(wrong.status, 401);

    const proto = await request(port, {
      path: "/?path=" + encodeURIComponent("/repos/me/site/contents/a.html"),
      headers: { "Site-Email": "__proto__", "Site-Password": "x" },
    });
    assert.strictEqual(proto.status, 401);

    for (const p of [
      "/user",
      "/repos/other/site/contents/a.html",
      "/repos/me/site/issues",
      "/repos/me/site/contents/../../x",
    ]) {
      const res = await request(port, {
        path: "/?path=" + encodeURIComponent(p),
        headers: good,
      });
      assert.strictEqual(res.status, 403, p);
    }
    const del = await request(port, {
      method: "DELETE",
      path: "/?path=" + encodeURIComponent("/repos/me/site/contents/a.html"),
      headers: good,
    });
    assert.strictEqual(del.status, 403);
  } finally {
    server.close();
  }
});
