// Open everything the server runs: api.sqlite, the durable Harness with the sweep extension,
// and the root conversation. Close it all on shutdown.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { Conversation } from "@earendil-works/pi-durable";
import {
  createModelCatalog,
  DEFAULT_POINTS,
  openDurableHarness,
  toPolicy,
  type CompactionPoints,
  type DurableHarness,
} from "@pas/durable-agent";
import { createLogger, type Logger } from "@pas/agent-sdk/node";
import type { Config } from "./config.ts";
import { openStore, type Store } from "./db/store.ts";
import { Bus } from "./events.ts";
import { sweepExtension } from "./agents/sweep-extension.ts";
import { watchRunningSweeps } from "./agents/sweep.ts";
import { installServerFaux } from "./agents/faux.ts";

export interface App {
  config: Config;
  log: Logger;
  store: Store;
  bus: Bus;
  harness: DurableHarness;
  ctx: Context;
  main: Conversation;
  readonly startedAt: number;
  close(): Promise<void>;
}

export async function openApp(config: Config, options: { log?: Logger } = {}): Promise<App> {
  mkdirSync(config.dataDir, { recursive: true });
  const log = options.log ?? createLogger("api").child({ device: config.device });
  const store = openStore(config.dataDir);
  const bus = new Bus();
  const catalog = createModelCatalog({
    provider: config.provider,
    installFaux: (models) => installServerFaux(models),
    defaultModel: config.provider === "faux" ? undefined : config.model,
  });
  const agentsDir = join(config.promptsDir, "agents");
  const compaction = { points: DEFAULT_POINTS as CompactionPoints, enabled: true };
  const harness = await openDurableHarness({
    dbPath: join(config.dataDir, "agent.sqlite"),
    catalog,
    extensions: [sweepExtension({ store, bus }, agentsDir)],
    compaction: () => toPolicy(catalog.info(catalog.defaultModel.modelId)?.contextWindow ?? 1_000_000, compaction.points, compaction.enabled),
    logger: log,
  });
  const ctx = harness.ctx;
  const main = await harness.harness.root(ctx, {
    agent: { model: catalog.defaultModel, thinkingLevel: "low" },
  });
  harness.harness.resume();
  watchRunningSweeps({ store, bus, log, main, promptsDir: agentsDir }, ctx);

  log.info("app.opened", {
    device: config.device,
    provider: config.provider,
    dataDir: config.dataDir,
    mainConversation: main.id,
  });

  return {
    config,
    log,
    store,
    bus,
    harness,
    ctx,
    main,
    startedAt: Date.now(),
    async close() {
      await harness.close();
      store.close();
      log.info("app.closed", {});
    },
  };
}
