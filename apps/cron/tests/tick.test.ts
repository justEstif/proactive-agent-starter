import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { createLogger } from "@pas/agent-sdk/node";
import { slotMinutes } from "../src/schedule.ts";
import { tick, slotId } from "../src/tick.ts";

test("slots floor to the tick in UTC", () => {
  assert.equal(slotId("mini", new Date("2026-10-12T16:14:59Z")), "cron:mini:20261012T1600");
  assert.equal(slotId("mini", new Date("2026-10-12T16:15:00Z")), "cron:mini:20261012T1615");
  assert.equal(slotId("mini", new Date("2026-10-12T16:14:59Z"), 5), "cron:mini:20261012T1610");
  assert.equal(slotMinutes("*/5 * * * *"), 5);
  assert.equal(slotMinutes("* * * * *"), 1);
  assert.equal(slotMinutes("7 * * * *"), 60);
});

test("a tick posts the slot requestId once on 2xx and retries 5xx", async () => {
  const log = createLogger("cron-test", { dir: mkdtempSync(join(tmpdir(), "pas-cron-")) });
  const hits: { auth: string | undefined; body: Record<string, unknown> }[] = [];
  let codes = [500, 202];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({ auth: req.headers.authorization, body: JSON.parse(body || "{}") as Record<string, unknown> });
      const status = codes.shift() ?? 202;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "accepted", sweep: { id: 1, status: "running", trigger: "cron", requestId: "x", startedAt: "now", effects: 0 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const r = await tick({
      apiUrl: base,
      token: "t".repeat(40),
      device: "mini",
      log,
      backoffMs: [10],
      now: new Date("2026-10-12T16:14:59Z"),
    });
    assert.equal(r.ok, true);
    assert.equal(r.attempts, 2, "one retry after the 500");
    assert.equal(hits.length, 2);
    assert.equal(r.requestId, "cron:mini:20261012T1600");
    assert.equal(hits[0].body.requestId, "cron:mini:20261012T1600");
    assert.equal(hits[0].body.trigger, "cron");
    assert.equal(hits[0].auth, `Bearer ${"t".repeat(40)}`);
  } finally {
    server.close();
  }
});
