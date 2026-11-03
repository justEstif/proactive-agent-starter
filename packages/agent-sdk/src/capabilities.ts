// The capability registry: everything a reader can do, each mapped to its routes.
import type { RouteId } from "./routes.ts";

export interface Capability {
  readonly summary: string;
  readonly routes: readonly RouteId[];
}

export const CAPABILITIES = {
  status: { summary: "Device, model and sweep history", routes: ["info", "sweeps.list"] },
  "sweep.read": { summary: "One sweep with its tool calls", routes: ["sweeps.get"] },
  "chat.watch": { summary: "Watch the agent and its tool calls live", routes: ["stream"] },
  "sweep.run": {
    summary: "Start a sweep now (what cron does on its schedule)",
    routes: ["workflow.stubSweep"],
  },
} as const satisfies Record<string, Capability>;

export type CapabilityId = keyof typeof CAPABILITIES;
