import type { Request, Response } from "express";
import type { RouteId } from "@pas/agent-sdk";
import { invalid } from "../errors.ts";
import type { App } from "../runtime.ts";
import type { StreamHub } from "../sse.ts";

export type Handler = (req: Request, res: Response) => unknown;
export type Handlers<K extends RouteId = RouteId> = Record<K, Handler>;

export interface RouteDeps {
  app: App;
  hub: StreamHub;
}

type Body = Record<string, unknown>;
export const bodyOf = (req: Request): Body =>
  req.body && typeof req.body === "object" && !Array.isArray(req.body) ? (req.body as Body) : {};

export function str(body: Body, key: string, options: { max?: number; optional?: false }): string;
export function str(
  body: Body,
  key: string,
  options: { max?: number; optional: true },
): string | undefined;
export function str(
  body: Body,
  key: string,
  options: { max?: number; optional?: boolean } = {},
): string | undefined {
  const v = body[key];
  if (v === undefined && options.optional) return undefined;
  if (typeof v !== "string" || !v.trim()) throw invalid(`${key} must be a non empty string`);
  if (options.max && v.length > options.max)
    throw invalid(`${key} must be ${options.max} characters or fewer`);
  return v.trim();
}

export function num(
  body: Body,
  key: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || (options.integer && !Number.isInteger(v)))
    throw invalid(`${key} must be a ${options.integer ? "whole " : ""}number`);
  if (
    (options.min !== undefined && v < options.min) ||
    (options.max !== undefined && v > options.max)
  )
    throw invalid(`${key} must be between ${options.min} and ${options.max}`);
  return v;
}

export function bool(body: Body, key: string): boolean | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw invalid(`${key} must be true or false`);
  return v;
}

export function oneOf<T extends string>(
  value: unknown,
  key: string,
  allowed: readonly T[],
  optional = false,
): T | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw invalid(`${key} must be one of: ${allowed.join(", ")}`);
  return value as T;
}
