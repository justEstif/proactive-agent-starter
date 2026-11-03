import assert from "node:assert/strict";
import { test } from "node:test";
import { ago, cleanText, k, ms, usd } from "../src/format.ts";

test("formatters", () => {
  assert.equal(k(100_000), "100k");
  assert.equal(k(1_500_000), "1.5M");
  assert.equal(k(512), "512");
  assert.equal(usd(0), "$0");
  assert.equal(usd(0.00003), "$0.0000");
  assert.equal(usd(0.0123), "$0.01");
  assert.equal(usd(1.5), "$1.50");
  assert.equal(ms(850), "850ms");
  assert.equal(ms(1234), "1.2s");
  assert.equal(ms(125_000), "2m 5s");
  assert.equal(ago(Date.now() - 5 * 60_000), "5m ago");
});

test("cleanText drops dashes and bullet dots", () => {
  assert.equal(cleanText("Agents — now durable"), "Agents, now durable");
  assert.equal(cleanText("one - two"), "one, two");
  assert.equal(cleanText("• first · second"), "first second");
  assert.equal(cleanText("pi-durable 1.1.0"), "pi-durable 1.1.0");
  assert.equal(cleanText("Loading… more to come..."), "Loading more to come");
  assert.equal(cleanText("line one\n- item"), "line one\n- item");
});
