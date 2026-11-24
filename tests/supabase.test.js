const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

test("the Supabase bouncer imports an exact supabase-js version, not a floating major", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../prod/worker/supabase-bouncer.ts"),
    "utf8",
  );
  assert.match(source, /https:\/\/esm\.sh\/@supabase\/supabase-js@2\.\d+\.\d+/);
  assert.ok(!/@supabase\/supabase-js@2["']/.test(source));
  assert.ok(!/@supabase\/supabase-js@latest/.test(source));
});
