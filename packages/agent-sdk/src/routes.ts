// The route table: every v1 route with its scope. The server mounts from this table and the client calls by id,
// so the server, the clients and the docs cannot drift.
import type { Scope } from "./api.ts";

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

export interface RouteSpec {
  readonly method: Method;
  readonly path: string;
  /** "open" needs no token. */
  readonly scope: Scope | "open";
  readonly summary: string;
}

export const ROUTES = {
  healthz: {
    method: "GET",
    path: "/healthz",
    scope: "open",
    summary: "Liveness: ok, version, device, uptime",
  },
  info: {
    method: "GET",
    path: "/v1/info",
    scope: "read",
    summary: "Device, mode, model, versions and the main conversation",
  },
  stream: {
    method: "GET",
    path: "/v1/stream",
    scope: "read",
    summary: "One SSE stream: hello, agent snapshot and batches, sweeps",
  },
  "workflow.stubSweep": {
    method: "POST",
    path: "/v1/workflows/stub-sweep",
    scope: "workflow",
    summary: "Start one sweep of the example agent (cron calls this)",
  },
  "sweeps.list": {
    method: "GET",
    path: "/v1/sweeps",
    scope: "read",
    summary: "Past sweeps, newest first",
  },
  "sweeps.get": {
    method: "GET",
    path: "/v1/sweeps/:id",
    scope: "read",
    summary: "One sweep with its tool calls",
  },
} as const satisfies Record<string, RouteSpec>;

export type RouteId = keyof typeof ROUTES;

export interface RoutePathOptions {
  params?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | undefined>;
}

/** Fill a route's path params and query string. Throws on a missing param. */
export function routePath(id: RouteId, options: RoutePathOptions = {}): string {
  const path = ROUTES[id].path.replace(/:(\w+)/g, (_, name: string) => {
    const value = options.params?.[name];
    if (value === undefined) throw new Error(`Route ${id} needs param ${name}`);
    return encodeURIComponent(String(value));
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {}))
    if (value !== undefined) search.set(key, String(value));
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}
