// The wrapper passes upstream extensions through untouched: the plan-mode extension from
// pi-durable's own examples installs and configures through openDurableHarness.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  createModelCatalog,
  DEFAULT_POINTS,
  openDurableHarness,
  toPolicy,
} from "@pas/durable-agent";
import { enterPlanMode, leavePlanMode, Plan } from "../src/extensions/plan-mode.ts";
import { sweepExtension } from "../src/agents/sweep-extension.ts";
import { installServerFaux } from "../src/agents/faux.ts";
import { openStore } from "../src/db/store.ts";
import { Bus } from "../src/events.ts";

process.env.PAS_ENV_FILE = "none";
process.env.PAS_PROVIDER = "faux";

const dir = mkdtempSync(join(tmpdir(), "pas-ext-"));
const store = openStore(dir);
const bus = new Bus();
const catalog = createModelCatalog({ provider: "faux", installFaux: installServerFaux });
const harness = await openDurableHarness({
  dbPath: join(dir, "agent.sqlite"),
  catalog,
  extensions: [sweepExtension({ store, bus }, join(import.meta.dirname, "../prompt_engineering/agents")), Plan],
  compaction: () => toPolicy(1_000_000, DEFAULT_POINTS, true),
});

after(async () => {
  await harness.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test("an upstream defineExtension installs and plan mode reconfigures the agent", async () => {
  const { harness: h, ctx } = harness;
  const root = await h.root(ctx, { agent: { model: catalog.defaultModel, thinkingLevel: "low" } });
  const tools = async () => (await root.agent(ctx)).tools.map((t) => t.name);
  const before = await tools();
  assert.ok(before.includes("gather_items"), "sweep tools offered");

  await root.configure(enterPlanMode, ctx);
  const planned = await tools();
  assert.ok(planned.includes("submit_plan"), "plan tool offered in plan mode");
  assert.ok(!planned.includes("gather_items"), "sweep tools hidden in plan mode");

  await root.configure(leavePlanMode, ctx);
  assert.ok((await tools()).includes("gather_items"), "tools restored");
});
