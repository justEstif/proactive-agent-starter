// Start a sweep: admit the rendered prompt into the main conversation and watch it finish.
// Durability: the run is a durable pi-durable submission; a crash resumes it, and every tool
// effect is exactly-once through the task memo plus the effects table's unique key.
import { loadPrompt } from "@pas/durable-agent";
import type { Context } from "@earendil-works/chord";
import type { Conversation } from "@earendil-works/pi-durable";
import type { LoggerLike } from "@pas/durable-agent";
import type { Bus } from "../events.ts";
import type { Store, SweepRow } from "../db/store.ts";

export interface SweepDeps {
  store: Store;
  bus: Bus;
  log: LoggerLike;
  main: Conversation;
  /** Re-read prompts each sweep, so prompt edits apply without a restart. */
  promptsDir: string;
}

export type SweepStart =
  | { status: "accepted"; sweep: SweepRow }
  | { status: "replay"; sweep: SweepRow }
  | { status: "busy"; reason: string };

export function startSweep(
  deps: SweepDeps,
  input: { requestId: string; trigger: "cron" | "manual" | "test" },
  ctx: Context,
): SweepStart {
  const { store, bus, log, main } = deps;
  const existing = store.sweeps.byRequest(input.requestId);
  if (existing) return { status: "replay", sweep: existing };
  const active = store.sweeps.activeIn(main.id as number);
  if (active && active.requestId !== input.requestId)
    return { status: "busy", reason: `Sweep ${active.id} is still running` };
  const { sweep, replay } = store.sweeps.admit(input.requestId, main.id as number, input.trigger);
  if (replay) return { status: "replay", sweep };

  const prompt = loadPrompt(deps.promptsDir, "sweep", "USER_PROMPT_SWEEP.md", {
    request_id: sweep.requestId,
    trigger: sweep.trigger,
    now: new Date().toISOString(),
  });
  main
    .submit({ type: "input", content: prompt }, ctx)
    .then((submission) =>
      submission.wait(ctx).then(() => {
        const done = store.sweeps.byRequest(input.requestId);
        if (done && done.status !== "done") {
          store.sweeps.setStatus(sweep.id, "done");
          bus.publish({ type: "sweep", sweep: { ...done, status: "done" } });
        }
      }),
    )
    .catch((error) => {
      if (/closed/i.test(String(error))) return;
      log.error("sweep.submit_failed", { sweepId: sweep.id, error: String(error) });
      store.sweeps.setStatus(sweep.id, "failed", String(error));
      bus.publish({
        type: "sweep",
        sweep: { ...sweep, status: "failed", error: String(error) },
      });
    });
  store.sweeps.setStatus(sweep.id, "running");
  log.info("sweep.started", { sweepId: sweep.id, requestId: sweep.requestId, trigger: sweep.trigger });
  return { status: "accepted", sweep: { ...sweep, status: "running" } };
}

/** After a restart, re-attach the completion watcher to every sweep the crash left running. */
export function watchRunningSweeps(deps: SweepDeps, ctx: Context): void {
  for (const sweep of deps.store.sweeps.running()) {
    deps.log.info("sweep.resuming_watch", { sweepId: sweep.id, requestId: sweep.requestId });
    void deps.main
      .waitForIdle(ctx)
      .then(() => {
        const done = deps.store.sweeps.byRequest(sweep.requestId);
        if (done && done.status !== "done") {
          deps.store.sweeps.setStatus(sweep.id, "done");
          deps.bus.publish({ type: "sweep", sweep: { ...done, status: "done" } });
        }
      })
      .catch((error) => {
        // A shutdown closes the harness under the watcher: the sweep is not failed, the next
        // restart picks it up again.
        if (/closed/i.test(String(error))) return;
        deps.log.error("sweep.watch_failed", { sweepId: sweep.id, error: String(error) });
        deps.store.sweeps.setStatus(sweep.id, "failed", String(error));
      });
  }
}
