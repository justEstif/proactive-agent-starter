// Typed client for one proactive-agent-starter server. Works in browsers and Node (fetch and streams).
import type { AgentState, ApiErrorBody, Frame, Info, SweepSummary, WorkflowResult } from "./api.ts";
import { ApiError } from "./errors.ts";
import { ROUTES, routePath, type RouteId } from "./routes.ts";
import { readSse } from "./sse.ts";

export interface CallOptions {
  params?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  idempotencyKey?: string;
}

export interface Raw<T> {
  status: number;
  headers: Headers;
  data: T;
}

export const newRequestId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export class AgentClient {
  readonly baseUrl: string;
  constructor(
    baseUrl: string,
    private readonly token?: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private headers(json: boolean, extra: Record<string, string> = {}) {
    return {
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      ...(json ? { "content-type": "application/json" } : {}),
      ...extra,
    };
  }

  /** Call a route by id and keep status and headers. Every POST carries an Idempotency-Key. */
  async raw<T>(id: RouteId, options: CallOptions = {}): Promise<Raw<T>> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const response = await fetch(`${this.baseUrl}${routePath(id, options)}`, {
      method: ROUTES[id].method,
      headers: this.headers(
        options.body !== undefined,
        options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {},
      ),
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal,
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text || response.statusText;
      try {
        message = (JSON.parse(text) as ApiErrorBody).error?.message ?? message;
      } catch {}
      throw new ApiError(response.status === 401 ? "unauthorized" : "internal", message);
    }
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, headers: response.headers, data };
  }

  private async get<T>(id: RouteId, options: CallOptions = {}): Promise<T> {
    return (await this.raw<T>(id, options)).data;
  }

  info(): Promise<Info> {
    return this.get("info");
  }

  sweeps(limit = 50): Promise<SweepSummary[]> {
    return this.get("sweeps.list", { query: { limit } });
  }

  sweep(id: number): Promise<SweepSummary & { toolCalls: unknown[] }> {
    return this.get("sweeps.get", { params: { id } });
  }

  /** Start one sweep. The requestId is the idempotency slot: the same id replays, never runs twice. */
  async sweepNow(
    requestId: string,
    options: { trigger?: "manual" | "test" | "cron"; signal?: AbortSignal } = {},
  ): Promise<WorkflowResult> {
    const result = await this.raw<WorkflowResult>("workflow.stubSweep", {
      body: { requestId, trigger: options.trigger ?? "manual" },
      idempotencyKey: requestId,
      signal: options.signal,
    });
    return result.data;
  }

  /** Open GET /v1/stream and yield frames until it ends. Throws ApiError on failure. */
  async *stream(options: { conversations?: number[]; idleMs?: number; signal?: AbortSignal } = {}) {
    const qs = (() => {
      const search = new URLSearchParams();
      if (options.conversations?.length)
        search.set("conversations", options.conversations.join(","));
      const s = search.toString();
      return s ? `?${s}` : "";
    })();
    const response = await fetch(`${this.baseUrl}${routePath("stream")}${qs}`, {
      headers: { ...this.headers(false), accept: "text/event-stream" },
      signal: options.signal,
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      throw new ApiError("offline", `Stream failed (${response.status}) ${text}`.trim());
    }
    for await (const message of readSse(response.body, options.idleMs))
      if (message.event === "agent.snapshot" || message.event === "agent.batch")
        yield JSON.parse(message.data) as Frame;
      else if (message.event !== "message")
        try {
          yield JSON.parse(message.data) as Frame;
        } catch {}
  }
}

export type { AgentState };
