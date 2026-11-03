// The v1 wire contract shared by the server, the cron and any client. Generic: no domain types.
import type { WireEntry } from "./wire.ts";

export const API_VERSION = 1 as const;

export type Scope = "read" | "chat" | "feedback" | "settings" | "workflow";

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface Page<T> {
  items: T[];
  cursor?: string;
}

export interface Info {
  device: string;
  mode: string;
  provider: string;
  model: { id: string; window: number };
  piDurable: string;
  dataDir: string;
  mainConversationId: number;
  startedAt: number;
}

/** The sweep-shaped workflow every domain reuses: gather, gate, present. */
export interface SweepSummary {
  id: number;
  status: "accepted" | "running" | "done" | "failed";
  trigger: "cron" | "manual" | "test";
  requestId: string;
  startedAt: string;
  endedAt?: string;
  /** How many tool effects the sweep performed (presented items, saved records, ...). */
  effects: number;
  error?: string;
}

export type WorkflowResult =
  | { status: "accepted"; sweep: SweepSummary }
  | { status: "replay"; sweep: SweepSummary }
  | { status: "busy"; reason: string }
  | { status: "not_due"; reason: string };

export interface WorkflowBody {
  requestId: string;
  trigger?: "cron" | "manual" | "test";
}

/** Every frame the SSE stream can send. */
export type Frame =
  | { type: "hello"; apiVersion: number; serverTime: number; device: string; mainConversationId: number }
  | { type: "agent.snapshot"; conversationId: number; snapshot: { entries: readonly WireEntry[] } }
  | { type: "agent.state"; state: { busy: boolean; conversationId: number } }
  | { type: "sweep"; sweep: SweepSummary };

export interface AgentState {
  busy: boolean;
  model?: { provider: string; modelId: string };
  thinkingLevel?: string;
  extensions?: readonly string[];
  tools?: readonly string[];
}
