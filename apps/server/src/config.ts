// Server configuration from the root .env and flags. Every default works offline with zero keys.
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { repoRoot } from "@pas/agent-sdk/node";

export interface Config {
  device: string;
  mode: string;
  host: string;
  port: number;
  dataDir: string;
  rootDir: string;
  promptsDir: string;
  provider: "openrouter" | "faux";
  model?: string;
  clientToken: string;
  cronToken: string;
}

/** apps/server: its prompts live with it. */
const APP_DIR = resolve(import.meta.dirname, "..");

/** Deterministic dev tokens: zero-config offline runs. Replace in .env for anything exposed. */
const DEV_CLIENT_TOKEN = "pas_dev_client_token_change_me_0000000001";
const DEV_CRON_TOKEN = "pas_dev_cron_token_change_me_000000000000002";

const int = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export function loadConfig(argv = process.argv.slice(2), env = process.env): Config {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      "data-dir": { type: "string" },
      device: { type: "string" },
      prompts: { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });
  const rootDir = repoRoot();
  const provider = env.PAS_PROVIDER === "openrouter" ? "openrouter" : "faux";
  return {
    device: String(values.device ?? env.PAS_DEVICE_NAME ?? "local"),
    mode: env.PAS_MODE ?? (provider === "faux" ? "faux" : "live"),
    host: String(values.host ?? env.PAS_HOST ?? "127.0.0.1"),
    port: int(values.port as string | undefined, int(env.PAS_PORT, 4851)),
    dataDir: resolve(
      String(values["data-dir"] ?? env.PAS_DATA_DIR ?? join(rootDir, "data")),
    ),
    rootDir,
    promptsDir: resolve(
      String(values.prompts ?? env.PAS_PROMPTS_DIR ?? join(APP_DIR, "prompt_engineering")),
    ),
    provider,
    model: env.PAS_MODEL?.trim() || undefined,
    clientToken: env.PAS_CLIENT_TOKEN?.trim() || DEV_CLIENT_TOKEN,
    cronToken: env.PAS_CRON_TOKEN?.trim() || DEV_CRON_TOKEN,
  };
}

export function assertTokens(config: Config): void {
  for (const [name, token] of [
    ["PAS_CLIENT_TOKEN", config.clientToken],
    ["PAS_CRON_TOKEN", config.cronToken],
  ] as const) {
    if (token.length < 32) throw new Error(`${name} must be at least 32 characters.`);
  }
  if (config.clientToken === config.cronToken)
    throw new Error("PAS_CLIENT_TOKEN and PAS_CRON_TOKEN must differ.");
}
