import assert from "node:assert/strict";
import { test } from "node:test";
import { CAPABILITIES } from "../src/capabilities.ts";
import { ROUTES } from "../src/routes.ts";

test("every capability names only real routes", () => {
  for (const [id, cap] of Object.entries(CAPABILITIES)) {
    assert.ok(cap.summary, `${id} has a summary`);
    for (const route of cap.routes) assert.ok(route in ROUTES, `${id} names route ${route}`);
  }
});

test("every scoped route is reachable through some capability except the workflow route (cron only)", () => {
  const covered = new Set(Object.values(CAPABILITIES).flatMap((c) => c.routes));
  for (const id of Object.keys(ROUTES))
    if (ROUTES[id as keyof typeof ROUTES].scope !== "open" && id !== "workflow.stubSweep")
      assert.ok(covered.has(id as never), `route ${id} is in no capability`);
});
