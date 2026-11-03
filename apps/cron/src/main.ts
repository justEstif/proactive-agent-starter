// @pas/cron: tick | loop
//   tick   one idempotent workflow call for this tick's slot; exit 0 on 2xx
//   loop   tick every interval (PAS_CRON_INTERVAL_MS, default 60s) until stopped
import { createLogger, installProcessHandlers, loadRootEnv } from "@pas/agent-sdk/node";
import { DEFAULT_SCHEDULE, slotMinutes } from "./schedule.ts";
import { tick } from "./tick.ts";

if (process.env.PAS_ENV_FILE !== "none") loadRootEnv(process.env.PAS_ENV_FILE || undefined);
const log = createLogger("cron");
installProcessHandlers(log);
const command = process.argv[2] ?? "tick";
const device = process.env.PAS_DEVICE_NAME ?? "local";

if (command === "tick" || command === "loop") {
  const token = process.env.PAS_CRON_TOKEN?.trim() || "pas_dev_cron_token_change_me_000000000000002";
  const apiUrl = process.env.PAS_API_URL ?? `http://127.0.0.1:${process.env.PAS_PORT ?? 4851}`;
  const backoffMs = process.env.PAS_CRON_BACKOFF_MS?.split(",").map(Number);
  const slot = slotMinutes(process.env.PAS_CRON_SCHEDULE ?? DEFAULT_SCHEDULE);
  const run = async () => {
    const r = await tick({
      apiUrl,
      token,
      device,
      log,
      backoffMs,
      slotMinutes: slot,
    });
    log[r.ok ? "info" : "error"]("cron.tick", {
      slot: r.requestId,
      ok: r.ok,
      attempts: r.attempts,
      status: r.status,
      outcome: r.result?.status,
      sweepId: r.result?.status === "accepted" || r.result?.status === "replay"
        ? r.result.sweep.id
        : undefined,
      reason: r.result?.status === "busy" || r.result?.status === "not_due" ? r.result.reason : undefined,
      error: r.error,
    });
    console.log(
      r.ok
        ? `${r.requestId}: ${r.result?.status ?? r.status}`
        : `${r.requestId}: failed after ${r.attempts} attempts: ${r.error}`,
    );
    return r.ok;
  };
  if (command === "tick") {
    process.exit((await run()) ? 0 : 1);
  }
  const intervalMs = Number(process.env.PAS_CRON_INTERVAL_MS ?? 60_000);
  log.info("cron.loop", { apiUrl, intervalMs, slotMinutes: slot });
  console.log(`cron loop: one tick every ${Math.round(intervalMs / 1000)}s against ${apiUrl}`);
  let stopping = false;
  process.on("SIGINT", () => (stopping = true));
  process.on("SIGTERM", () => (stopping = true));
  await run();
  while (!stopping) {
    await new Promise((r) => setTimeout(r, intervalMs));
    if (!stopping) await run();
  }
} else {
  console.error(`Unknown command ${command}. Use tick or loop.`);
  process.exit(2);
}
