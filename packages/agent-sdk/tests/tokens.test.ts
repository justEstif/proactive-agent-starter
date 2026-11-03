import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ensureTokens } from "../src/node/tokens.ts";

test("ensureTokens writes missing tokens once, keeps other lines, and fixes short or equal ones", () => {
  const dir = mkdtempSync(join(tmpdir(), "pas-tok-"));
  const file = join(dir, ".env");
  try {
    writeFileSync(file, "OPENROUTER_API_KEY=abc\nPAS_CLIENT_TOKEN=\n");
    assert.deepEqual(ensureTokens(file), ["PAS_CLIENT_TOKEN", "PAS_CRON_TOKEN"]);
    const text = readFileSync(file, "utf8");
    assert.match(text, /^OPENROUTER_API_KEY=abc$/m);
    assert.match(text, /^PAS_CLIENT_TOKEN=pas_[\w-]{43}$/m);
    assert.match(text, /^PAS_CRON_TOKEN=pas_[\w-]{43}$/m);
    assert.deepEqual(ensureTokens(file), []);
    assert.equal(readFileSync(file, "utf8"), text);
    const same = "pas_" + "y".repeat(40);
    writeFileSync(file, `PAS_CLIENT_TOKEN=${same}\nPAS_CRON_TOKEN=${same}\n`);
    assert.deepEqual(ensureTokens(file), ["PAS_CRON_TOKEN"]);
    assert.deepEqual(ensureTokens(file, { rotate: true }), ["PAS_CLIENT_TOKEN", "PAS_CRON_TOKEN"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
