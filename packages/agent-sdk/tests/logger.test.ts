import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLogger, redact } from "../src/node/logger.ts";

const lines = (file: string) =>
  readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

test("writes one JSON object per line with bindings", () => {
  const dir = mkdtempSync(join(tmpdir(), "pas-log-"));
  try {
    const log = createLogger("api", { dir });
    log.child({ sweepId: 7 }).info("sweep.started", { msg: "go" });
    log.debug("hidden");
    const [record] = lines(log.file);
    assert.equal(record.app, "api");
    assert.equal(record.event, "sweep.started");
    assert.equal(record.sweepId, 7);
    assert.equal(record.level, "info");
    assert.equal(lines(log.file).length, 1, "debug is below the default level");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("redacts secrets and serializes errors", () => {
  const out = redact({
    token: "abc",
    nested: { apiKey: "k", ok: 1 },
    error: new Error("boom"),
  }) as any;
  assert.equal(out.token, "[redacted]");
  assert.equal(out.nested.apiKey, "[redacted]");
  assert.equal(out.nested.ok, 1);
  assert.equal(out.error.message, "boom");
});

test("rotates at maxBytes and keeps N files", () => {
  const dir = mkdtempSync(join(tmpdir(), "pas-log-"));
  try {
    const log = createLogger("cron", { dir, maxBytes: 300, keep: 2 });
    for (let i = 0; i < 20; i++) log.info("tick", { i, pad: "x".repeat(40) });
    assert.ok(existsSync(join(dir, "cron.1.jsonl")));
    assert.ok(existsSync(join(dir, "cron.2.jsonl")));
    assert.ok(!existsSync(join(dir, "cron.3.jsonl")));
    assert.equal(lines(log.file).at(-1).i, 19);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
