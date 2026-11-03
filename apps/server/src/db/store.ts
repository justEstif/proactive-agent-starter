// api.sqlite: sweeps, effects and idempotent request replay. One API process writes.
import { join } from "node:path";
import type { SweepSummary } from "@pas/agent-sdk";
import { migrate } from "./migrate.ts";
import { type Db, nowIso, openDb } from "./db.ts";

export interface Store {
  readonly db: Db;
  readonly sweeps: Sweeps;
  readonly effects: Effects;
  close(): void;
}

export interface SweepRow extends SweepSummary {
  conversationId: number;
}

export interface EffectRow {
  sweepId: number;
  key: string;
  tool: string;
  args: string;
  createdAt: string;
}

export interface Sweeps {
  /** Insert a sweep for a fresh requestId, or return the existing row (a replay). */
  admit(requestId: string, conversationId: number, trigger: "cron" | "manual" | "test"): { sweep: SweepRow; replay: boolean };
  get(id: number): SweepRow | undefined;
  byRequest(requestId: string): SweepRow | undefined;
  /** The sweep still working in this conversation, if any. */
  activeIn(conversationId: number): SweepRow | undefined;
  running(): SweepRow[];
  setStatus(id: number, status: SweepRow["status"], error?: string): void;
  list(limit: number): SweepRow[];
}

export interface Effects {
  /** Insert one effect; false when the key already ran (a replay). */
  record(sweepId: number, key: string, tool: string, args: unknown): boolean;
  count(sweepId: number): number;
  forSweep(sweepId: number): EffectRow[];
}

const row = (r: Record<string, unknown> | undefined): SweepRow | undefined =>
  r
    ? ({
        id: Number(r.id),
        status: r.status,
        trigger: r.trigger,
        requestId: r.request_id,
        startedAt: String(r.started_at),
        endedAt: r.ended_at ? String(r.ended_at) : undefined,
        error: r.error ? String(r.error) : undefined,
        effects: 0,
        conversationId: Number(r.conversation_id),
      }) as SweepRow
    : undefined;

export function openStore(dataDir: string): Store {
  const db = openDb(join(dataDir, "api.sqlite"));
  migrate(db);
  const withCount = (s: SweepRow | undefined): SweepRow | undefined =>
    s ? { ...s, effects: effects.count(s.id) } : s;

  const sweeps: Sweeps = {
    admit(requestId, conversationId, trigger) {
      const existing = db
        .prepare("SELECT * FROM sweeps WHERE request_id = ?")
        .get(requestId) as Record<string, unknown> | undefined;
      if (existing) return { sweep: withCount(row(existing))!, replay: true };
      const info = db
        .prepare(
          "INSERT INTO sweeps (request_id, conversation_id, trigger, status, started_at) VALUES (?, ?, ?, 'accepted', ?)",
        )
        .run(requestId, conversationId, trigger, nowIso());
      return { sweep: this.get(Number(info.lastInsertRowid))!, replay: false };
    },
    get: (id) => withCount(row(db.prepare("SELECT * FROM sweeps WHERE id = ?").get(id) as never)),
    byRequest: (requestId) =>
      withCount(row(db.prepare("SELECT * FROM sweeps WHERE request_id = ?").get(requestId) as never)),
    activeIn: (conversationId) =>
      withCount(
        row(
          db
            .prepare(
              "SELECT * FROM sweeps WHERE conversation_id = ? AND status IN ('accepted','running') ORDER BY id DESC LIMIT 1",
            )
            .get(conversationId) as never,
        ),
      ),
    running: () =>
      (db
        .prepare("SELECT * FROM sweeps WHERE status IN ('accepted','running') ORDER BY id")
        .all() as Record<string, unknown>[]).map((r) => withCount(row(r))!),
    setStatus(id, status, error) {
      db.prepare("UPDATE sweeps SET status = ?, ended_at = ?, error = ? WHERE id = ?").run(
        status,
        status === "accepted" || status === "running" ? null : nowIso(),
        error ?? null,
        id,
      );
    },
    list: (limit) =>
      (db
        .prepare("SELECT * FROM sweeps ORDER BY id DESC LIMIT ?")
        .all(limit) as Record<string, unknown>[]).map((r) => withCount(row(r))!),
  };

  const effects: Effects = {
    record(sweepId, key, tool, args) {
      const r = db
        .prepare(
          "INSERT OR IGNORE INTO effects (sweep_id, key, tool, args, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(sweepId, key, tool, JSON.stringify(args ?? null), nowIso());
      return Number(r.changes) > 0;
    },
    count: (sweepId) =>
      Number(
        (db.prepare("SELECT COUNT(*) AS n FROM effects WHERE sweep_id = ?").get(sweepId) as { n: number }).n,
      ),
    forSweep: (sweepId) =>
      db
        .prepare("SELECT * FROM effects WHERE sweep_id = ? ORDER BY created_at, key")
        .all(sweepId) as unknown as EffectRow[],
  };

  return {
    db,
    sweeps,
    effects,
    close: () => db.close(),
  };
}
