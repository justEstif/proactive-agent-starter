// POST /v1/workflows/stub-sweep (cron token only) and the sweep reads.
import { join } from "node:path";
import { startSweep } from "../agents/sweep.ts";
import { int, notFound } from "../errors.ts";
import { bodyOf, oneOf, str, type Handlers, type RouteDeps } from "./types.ts";

export function workflowRoutes({ app }: RouteDeps): Handlers<"workflow.stubSweep" | "sweeps.list" | "sweeps.get"> {
  return {
    "workflow.stubSweep": async (req, res) => {
      const body = bodyOf(req);
      const requestId = str(body, "requestId", { max: 128 });
      const trigger =
        oneOf(body.trigger, "trigger", ["cron", "manual", "test"] as const, true) ?? "cron";
      const result = startSweep(
        {
          store: app.store,
          bus: app.bus,
          log: app.log,
          main: app.main,
          promptsDir: join(app.config.promptsDir, "agents"),
        },
        { trigger, requestId },
        app.ctx,
      );
      if (result.status === "busy") return res.status(200).json(result);
      if (result.status === "replay") res.set("Idempotent-Replay", "true");
      res.status(result.status === "accepted" ? 202 : 200).json(result);
    },
    "sweeps.list": (req, res) =>
      res.json(app.store.sweeps.list(int(req.query.limit, "limit", 50))),
    "sweeps.get": (req, res) => {
      const sweep = app.store.sweeps.get(int(req.params.id, "id"));
      if (!sweep) throw notFound(`No sweep ${req.params.id}`);
      res.json({ ...sweep, effects: app.store.effects.forSweep(sweep.id) });
    },
  };
}

