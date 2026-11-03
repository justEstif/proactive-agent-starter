// One tick: POST /v1/workflows/stub-sweep with the cron token for the current tick slot, marked scheduled so the API
// starts a sweep only when its schedule says one is due. The requestId is the slot, so two fires in one slot are one
// call. Network errors, 429 and 5xx retry after 2 s, 8 s and 30 s.
import type { WorkflowResult } from "@pas/agent-sdk";
import type { Logger } from "@pas/agent-sdk/node";

export const BACKOFF_MS = [2_000, 8_000, 30_000];

/** cron:<device>:<YYYYMMDDTHHmm> in UTC, floored to the slot. */
export function slotId(device: string, now = new Date(), minutes = 15): string {
  const d = new Date(Math.floor(now.getTime() / (minutes * 60_000)) * minutes * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `cron:${device}:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

export interface TickOptions {
  apiUrl: string;
  token: string;
  device: string;
  log: Logger;
  /** The crontab's tick in minutes: the slot the requestId names. */
  slotMinutes?: number;
  now?: Date;
  backoffMs?: number[];
  timeoutMs?: number;
}

export interface TickResult {
  ok: boolean;
  requestId: string;
  attempts: number;
  status?: number;
  result?: WorkflowResult;
  error?: string;
}

const retryable = (status: number) => status === 429 || status >= 500;

export async function tick(options: TickOptions): Promise<TickResult> {
  const requestId = slotId(options.device, options.now, options.slotMinutes);
  const backoff = options.backoffMs ?? BACKOFF_MS;
  const url = `${options.apiUrl.replace(/\/+$/, "")}/v1/workflows/stub-sweep`;
  let last: TickResult = { ok: false, requestId, attempts: 0 };
  for (let attempt = 1; attempt <= backoff.length + 1; attempt++) {
    const start = performance.now();
    let retry = false;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.token}`,
          "content-type": "application/json",
          "idempotency-key": requestId,
        },
        body: JSON.stringify({ trigger: "cron", requestId }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
      const body = (await res.json().catch(() => undefined)) as
        | (WorkflowResult & { error?: { message: string } })
        | undefined;
      const ms = Math.round(performance.now() - start);
      if (res.ok) {
        options.log.info("cron.attempt", {
          slot: requestId,
          attempt,
          status: res.status,
          outcome: body?.status,
          sweepId: body && "sweep" in body ? body.sweep.id : undefined,
          reason: body && "reason" in body ? body.reason : undefined,
          ms,
        });
        return { ok: true, requestId, attempts: attempt, status: res.status, result: body };
      }
      retry = retryable(res.status);
      last = {
        ok: false,
        requestId,
        attempts: attempt,
        status: res.status,
        error: body?.error?.message ?? res.statusText,
      };
      options.log[retry ? "warn" : "error"]("cron.attempt", {
        slot: requestId,
        attempt,
        status: res.status,
        error: last.error,
        ms,
      });
    } catch (error) {
      retry = true;
      last = {
        ok: false,
        requestId,
        attempts: attempt,
        error:
          error instanceof Error
            ? error.cause instanceof Error
              ? error.cause.message
              : error.message
            : String(error),
      };
      options.log.warn("cron.attempt", {
        slot: requestId,
        attempt,
        error: last.error,
        ms: Math.round(performance.now() - start),
      });
    }
    if (!retry || attempt > backoff.length) break;
    await new Promise((r) => setTimeout(r, backoff[attempt - 1]));
  }
  return last;
}
