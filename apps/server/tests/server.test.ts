// End-to-end server test on the faux model: a sweep through HTTP, exactly-once effects, replay, and SSE.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Express } from "express";
import type { Server } from "node:http";
import type { WorkflowResult } from "@pas/agent-sdk";
import { createHttpApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openApp, type App } from "../src/runtime.ts";

process.env.PAS_ENV_FILE = "none";
process.env.PAS_PROVIDER = "faux";

let app: App;
let http: Express;
let server: Server;
let base: string;
const dir = mkdtempSync(join(tmpdir(), "pas-server-"));

before(async () => {
  const config = loadConfig([
    "--port",
    "0",
    "--data-dir",
    dir,
    "--prompts",
    join(import.meta.dirname, "../prompt_engineering"),
  ]);
  app = await openApp(config);
  ({ http } = createHttpApp(app));
  server = http.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(async () => {
  server.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, body: unknown, token: string) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("the workflow route rejects the client token and accepts the cron token", async () => {
  const forbidden = await post("/v1/workflows/stub-sweep", { requestId: "t-x" }, app.config.clientToken);
  assert.equal(forbidden.status, 403);
});

test("a sweep runs to done with exactly-once effects, and a replay returns the same sweep", async () => {
  const start = await post("/v1/workflows/stub-sweep", { requestId: "t-sweep" }, app.config.cronToken);
  const accepted = (await start.json()) as WorkflowResult;
  assert.equal(accepted.status, "accepted");


  // Wait for the run to finish: status flips to done.
  let sweep: { status: string; effects?: unknown[] } | undefined;
  for (let i = 0; i < 200; i++) {
    const r = await fetch(`${base}/v1/sweeps/1`, {
      headers: { authorization: `Bearer ${app.config.clientToken}` },
    });
    sweep = (await r.json()) as { status: string; effects?: unknown[] };
    if (sweep.status === "done") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(sweep!.status, "done");

  const presented = app.store.effects.forSweep(1).filter((e) => e.tool === "present_item");
  assert.deepEqual(
    presented.map((e) => e.key).sort(),
    ["present:alpha", "present:gamma"],
    "only gated-in items presented, each once",
  );

  const replay = await post("/v1/workflows/stub-sweep", { requestId: "t-sweep" }, app.config.cronToken);
  const replayed = (await replay.json()) as WorkflowResult;
  assert.equal(replayed.status, "replay");
  assert.equal(replay.headers.get("idempotent-replay"), "true");
  assert.equal(app.store.effects.forSweep(1).length, 5, "3 gates + 2 presents, nothing repeated");
});

test("the SSE stream sends hello and an agent snapshot", async () => {
  const res = await fetch(`${base}/v1/stream`, { headers: { authorization: `Bearer ${app.config.clientToken}` } });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const want = /event: hello[\s\S]*event: agent.snapshot/;
  for (let i = 0; i < 20 && !want.test(seen); i++) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += decoder.decode(value);
  }
  await reader.cancel();
  assert.match(seen, /event: hello/);
  assert.match(seen, /event: agent.snapshot/);
});
