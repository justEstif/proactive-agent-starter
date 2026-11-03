import assert from "node:assert/strict";
import { test } from "node:test";
import { backoffMs, HttpError, isRetryable, retryAfterMs, withRetry } from "../src/retry.ts";

const noSleep = async () => {};

test("retries retryable errors up to the attempt limit", async () => {
  let calls = 0;
  const retries: number[] = [];
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new HttpError(503, "down");
      },
      { attempts: 3, sleep: noSleep, onRetry: (i) => retries.push(i.attempt) },
    ),
    /down/,
  );
  assert.equal(calls, 3);
  assert.deepEqual(retries, [1, 2]);
});

test("passes non-retryable errors through at once", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new HttpError(400, "bad request");
      },
      { attempts: 5, sleep: noSleep },
    ),
    /bad request/,
  );
  assert.equal(calls, 1);
});

test("returns the first success", async () => {
  let calls = 0;
  const value = await withRetry(
    async () => {
      calls++;
      if (calls < 2) throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
      return "ok";
    },
    { sleep: noSleep },
  );
  assert.equal(value, "ok");
  assert.equal(calls, 2);
});

test("honors Retry-After and caps at maxMs", async () => {
  assert.equal(retryAfterMs("3"), 3000);
  assert.equal(retryAfterMs(null), undefined);
  const delays: number[] = [];
  await assert.rejects(
    withRetry(
      async () => {
        throw new HttpError(429, "slow down", { retryAfterMs: 4000 });
      },
      {
        attempts: 2,
        baseMs: 100,
        maxMs: 5000,
        random: () => 0,
        sleep: async (ms) => void delays.push(ms),
      },
    ),
  );
  assert.deepEqual(delays, [4000]);
  assert.equal(backoffMs(10, { baseMs: 1000, maxMs: 15000, random: () => 1 }), 15000);
});

test("classifies errors", () => {
  assert.equal(isRetryable(new HttpError(502, "x")), true);
  assert.equal(isRetryable(new HttpError(404, "x")), false);
  assert.equal(isRetryable(new TypeError("fetch failed")), true);
  assert.equal(isRetryable(Object.assign(new Error("t"), { name: "TimeoutError" })), true);
  assert.equal(isRetryable("nope"), false);
});
