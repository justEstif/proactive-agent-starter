// The Express app: request log, auth, idempotency, then every route in ROUTES with its scope, then errors.
import express from "express";
import { ROUTES, type RouteId } from "@pas/agent-sdk";
import { identify, requireScope } from "./auth.ts";
import { errorMiddleware, notFound } from "./errors.ts";
import { idempotent } from "./idempotency.ts";
import { requestLog } from "./request-log.ts";
import { infoRoutes } from "./routes/info.ts";
import { workflowRoutes } from "./routes/workflows.ts";
import type { Handlers } from "./routes/types.ts";
import type { App } from "./runtime.ts";
import { StreamHub } from "./sse.ts";
import type { Request, Response } from "express";

export function createHttpApp(app: App) {
  const hub = new StreamHub();
  const handlers: Handlers = {
    ...infoRoutes({ app, hub }),
    ...workflowRoutes({ app, hub }),
    stream: (req: Request, res: Response) => void hub.serve(app, req, res),
  };
  const http = express();
  http.disable("x-powered-by");
  http.set("trust proxy", "loopback");
  http.use(requestLog(app.log));
  http.use(express.json({ limit: "256kb" }));
  http.use(identify({ client: app.config.clientToken, cron: app.config.cronToken }));
  http.use(idempotent(app.store.db, { skip: [ROUTES["workflow.stubSweep"].path] }));
  for (const id of Object.keys(ROUTES) as RouteId[]) {
    const route = ROUTES[id];
    const method = route.method.toLowerCase() as "get" | "post" | "patch" | "delete";
    http[method](route.path, requireScope(route.scope, id, app.log), handlers[id]);
  }
  http.use((req) => {
    throw notFound(`No route ${req.method} ${req.path}`);
  });
  http.use(errorMiddleware(app.log));
  return { http, hub };
}
