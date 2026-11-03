// JSONL logger: one object per line in logs/<app>.jsonl, optional pretty stderr.
// Every app logs through this, so `GET /v1/logs` and `dna logs` can read one format.
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./env.ts";

export type Level = "debug" | "info" | "warn" | "error" | "fatal";
export type Fields = Record<string, unknown>;

export interface Logger {
  debug(event: string, fields?: Fields): void;
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
  fatal(event: string, fields?: Fields): void;
  child(bindings: Fields): Logger;
  readonly file: string;
}

export interface LoggerOptions {
  dir?: string;
  level?: Level;
  pretty?: boolean;
  maxBytes?: number;
  keep?: number;
  now?: () => Date;
}

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
const SECRET = /token|key|authorization|secret|cookie|password/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (value instanceof Error)
    return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Fields = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET.test(k) && typeof v === "string" ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export function createLogger(app: string, options: LoggerOptions = {}): Logger {
  const dir = options.dir ?? process.env.PAS_LOG_DIR ?? join(repoRoot(), "logs");
  const level = options.level ?? (process.env.PAS_LOG_LEVEL as Level | undefined) ?? "info";
  const pretty = options.pretty ?? process.env.PAS_LOG_PRETTY === "1";
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
  const keep = options.keep ?? 5;
  const now = options.now ?? (() => new Date());
  const file = join(dir, `${app}.jsonl`);
  mkdirSync(dir, { recursive: true });
  let size = existsSync(file) ? statSync(file).size : 0;

  const rotate = () => {
    rmSync(join(dir, `${app}.${keep}.jsonl`), { force: true });
    for (let i = keep - 1; i >= 1; i--) {
      const from = join(dir, `${app}.${i}.jsonl`);
      if (existsSync(from)) renameSync(from, join(dir, `${app}.${i + 1}.jsonl`));
    }
    if (existsSync(file)) renameSync(file, join(dir, `${app}.1.jsonl`));
    size = 0;
  };

  const write = (lvl: Level, event: string, bindings: Fields, fields: Fields = {}) => {
    if (ORDER[lvl] < ORDER[level]) return;
    const record = redact({
      ts: now().toISOString(),
      level: lvl,
      app,
      event,
      ...bindings,
      ...fields,
    }) as Fields;
    const line = `${JSON.stringify(record)}\n`;
    if (size + line.length > maxBytes) rotate();
    appendFileSync(file, line);
    size += Buffer.byteLength(line);
    if (pretty || lvl === "fatal") {
      const { ts, level: l, app: a, event: e, msg, ...rest } = record;
      const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
      process.stderr.write(
        `${String(ts).slice(11, 23)} ${String(l).padEnd(5)} ${a} ${e}${msg ? ` ${msg}` : ""}${extra}\n`,
      );
    }
  };

  const make = (bindings: Fields): Logger => ({
    debug: (e, f) => write("debug", e, bindings, f),
    info: (e, f) => write("info", e, bindings, f),
    warn: (e, f) => write("warn", e, bindings, f),
    error: (e, f) => write("error", e, bindings, f),
    fatal: (e, f) => write("fatal", e, bindings, f),
    child: (more) => make({ ...bindings, ...more }),
    file,
  });
  return make({});
}

export function installProcessHandlers(log: Logger): void {
  process.on("uncaughtException", (error) => {
    log.fatal("process.uncaught_exception", { error });
    process.exit(1);
  });
  process.on("unhandledRejection", (error) => {
    log.fatal("process.unhandled_rejection", { error });
    process.exit(1);
  });
}
