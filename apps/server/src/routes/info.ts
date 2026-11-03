// GET /healthz and GET /v1/info.
import { packageVersion } from "../version.ts";
import type { Handlers, RouteDeps } from "./types.ts";

export function infoRoutes({ app }: RouteDeps): Handlers<"healthz" | "info" | "stream"> {
  const handler: Handlers<"healthz" | "info"> = {
    healthz: (_req, res) =>
      res.json({
        ok: true,
        device: app.config.device,
        startedAt: app.startedAt,
        uptimeSeconds: Math.round((Date.now() - app.startedAt) / 1000),
      }),
    info: async (_req, res) => {
      const agent = await app.main.agent(app.ctx);
      res.json({
        device: app.config.device,
        mode: app.config.mode,
        provider: app.config.provider,
        model: {
          id: agent.model?.modelId ?? app.config.model ?? "unknown",
          window: 1_000_000,
        },
        piDurable: packageVersion("@earendil-works/pi-durable"),
        dataDir: app.config.dataDir,
        mainConversationId: app.main.id as number,
        startedAt: app.startedAt,
      });
    },
  };
  return handler as Handlers<"healthz" | "info" | "stream">;
}
