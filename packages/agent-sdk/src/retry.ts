// Retry with full jitter. Used for every outbound call the app makes itself
// (sources, Firecrawl, the API client, cron). Model calls retry inside pi-durable.

export class HttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  readonly body?: string;
  constructor(
    status: number,
    message: string,
    opts: { retryAfterMs?: number; body?: string } = {},
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.retryAfterMs = opts.retryAfterMs;
    this.body = opts.body;
  }
}

export interface RetryInfo {
  attempt: number;
  delayMs: number;
  error: unknown;
}

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  retryOn?: (error: unknown, attempt: number) => boolean;
  onRetry?: (info: RetryInfo) => void;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 529]);
const RETRY_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) return RETRY_STATUSES.has(error.status);
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError") return true;
  const code =
    (error as { code?: string }).code ?? (error.cause as { code?: string } | undefined)?.code;
  if (code && RETRY_CODES.has(code)) return true;
  return error instanceof TypeError && /fetch failed|network/i.test(error.message);
}

export function retryAfterMs(
  header: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function backoffMs(
  attempt: number,
  opts: { baseMs: number; maxMs: number; random: () => number },
  hintMs?: number,
): number {
  const ceiling = Math.min(opts.maxMs, opts.baseMs * 2 ** (attempt - 1));
  const jittered = Math.round(opts.random() * ceiling);
  return Math.min(opts.maxMs, Math.max(jittered, hintMs ?? 0));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 1000;
  const maxMs = opts.maxMs ?? 15_000;
  const retryOn = opts.retryOn ?? isRetryable;
  const wait = opts.sleep ?? sleep;
  const random = opts.random ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    opts.signal?.throwIfAborted();
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= attempts || !retryOn(error, attempt)) throw error;
      const hint = error instanceof HttpError ? error.retryAfterMs : undefined;
      const delayMs = backoffMs(attempt, { baseMs, maxMs, random }, hint);
      opts.onRetry?.({ attempt, delayMs, error });
      await wait(delayMs, opts.signal);
    }
  }
}
