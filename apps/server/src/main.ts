// @pas/server: load the root .env, open the store and the durable harness, then serve HTTP.
//   tsx src/main.ts [--port 4851] [--host 127.0.0.1] [--data-dir data] [--device local]
import { createLogger, installProcessHandlers, loadRootEnv } from "@pas/agent-sdk/node";
import { createHttpApp } from "./app.ts";
import { assertTokens, loadConfig } from "./config.ts";
import { openApp } from "./runtime.ts";

if (process.env.PAS_ENV_FILE !== "none") loadRootEnv(process.env.PAS_ENV_FILE || undefined);
const config = loadConfig();
const log = createLogger("api").child({ device: config.device });
installProcessHandlers(log);
assertTokens(config);

const app = await openApp(config, { log });
const { http, hub } = createHttpApp(app);
const server = http.listen(config.port, config.host);
await new Promise<void>((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
server.keepAliveTimeout = 65_000;
const model = await app.main.agent(app.ctx);
log.info("api.listening", {
  host: config.host,
  port: config.port,
  piDurable: undefined,
  device: config.device,
  mode: config.mode,
  provider: config.provider,
  model: model.model?.modelId,
  dataDir: config.dataDir,
});
console.log(
  `@pas/server on http://${config.host}:${config.port} (${config.device}, ${config.mode}, model ${model.model?.modelId})`,
);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info("api.stopping", { signal, streams: hub.size });
  hub.closeAll();
  server.closeIdleConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await app.close();
  log.info("api.stopped", { signal });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
