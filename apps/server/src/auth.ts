// Two bearer tokens, two scope sets. The client token reads, chats, gives feedback and changes settings. The cron
// token may only start workflows. Compared as sha256 digests with timingSafeEqual.
import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import type { Scope } from "@pas/agent-sdk";
import type { Logger } from "@pas/agent-sdk/node";
import { ApiFault } from "./errors.ts";

export type Principal = "client" | "cron";

export const SCOPES: Record<Principal, readonly Scope[]> = {
  client: ["read", "chat", "feedback", "settings"],
  cron: ["workflow"],
};

const digest = (token: string) => createHash("sha256").update(token).digest();

/** Identify the caller from Authorization: Bearer. Sets res.locals.principal; never rejects by itself. */
export function identify(tokens: { client: string; cron: string }): RequestHandler {
  const known = [
    ["client", digest(tokens.client)],
    ["cron", digest(tokens.cron)],
  ] as const;
  return (req, res, next) => {
    const header = req.get("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (presented) {
      const actual = digest(presented);
      for (const [principal, expected] of known)
        if (timingSafeEqual(actual, expected)) res.locals.principal = principal;
    }
    next();
  };
}

export function requireScope(scope: Scope | "open", route: string, log: Logger): RequestHandler {
  return (_req, res, next) => {
    if (scope === "open") return next();
    const principal = res.locals.principal as Principal | undefined;
    if (!principal) {
      log.warn("auth.unauthorized", { route, scope });
      res.set("WWW-Authenticate", 'Bearer realm="pas"');
      throw new ApiFault("unauthorized", "Missing or invalid token");
    }
    if (!SCOPES[principal].includes(scope)) {
      log.warn("auth.forbidden", { route, scope, principal });
      throw new ApiFault("forbidden", `This route needs the ${scope} scope`);
    }
    next();
  };
}
