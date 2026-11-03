// The example sweep agent: a gather → gate → present workflow as one extension.
// The prompt lives in prompt_engineering/agents/sweep; this file only wires tools and sections.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineExtension, section } from "@earendil-works/pi-durable";
import { arr, obj, str } from "@earendil-works/pi-schema";
import { defineAppTool, once, toolText } from "@pas/durable-agent";
import type { Bus } from "../events.ts";
import type { Store } from "../db/store.ts";

/** The three fixed items every sweep gathers. A real agent fetches or searches here. */
export interface GatheredItem {
  id: string;
  title: string;
  body: string;
}

export const SAMPLE_ITEMS: readonly GatheredItem[] = [
  { id: "alpha", title: "Alpha: a routine changelog", body: "Boring but true: bug fixes and docs." },
  { id: "beta", title: "Beta: a loud claim", body: "Ten times faster, no benchmarks, no source." },
  { id: "gamma", title: "Gamma: a small signal", body: "A quiet breaking change worth acting on." },
];

export interface SweepDeps {
  store: Store;
  bus: Bus;
}

const systemPrompt = (agentsDir: string): string =>
  readFileSync(join(agentsDir, "sweep", "SYSTEM_PROMPT.md"), "utf8");

export function sweepExtension(deps: SweepDeps, agentsDir: string) {
  const { store, bus } = deps;

  const sweepOf = (conversationId: number) => {
    const sweep = store.sweeps.activeIn(conversationId);
    if (!sweep) throw new Error("No sweep is running in this conversation.");
    return sweep;
  };

  const gatherItems = defineAppTool({
    name: "gather_items",
    description: "Gather the candidate items for this sweep. Call once, first.",
    parameters: obj({}),
    replay: "safe",
    returns: "The candidate items with id, title and body",
    execute: async () =>
      toolText(JSON.stringify({ items: SAMPLE_ITEMS }), { items: SAMPLE_ITEMS.map((i) => i.id) }),
  });

  const gateItem = defineAppTool({
    name: "gate_item",
    description: "Decide whether one gathered item is worth presenting.",
    parameters: obj({ id: str(), verdict: str(), reason: str() }),
    enums: { verdict: ["present", "skip"] },
    example: { id: "alpha", verdict: "present", reason: "Actionable and sourced." },
    replay: "safe",
    returns: "The recorded verdict",
    execute: (args, api, ctx) =>
      once(api, `gate:${args.id}`, ctx, () => {
        const sweep = sweepOf(api.conversationId as number);
        store.effects.record(sweep.id, `gate:${args.id}`, "gate_item", args);
        return Promise.resolve(`gated ${args.id}: ${args.verdict} (${args.reason})`);
      }).then(toolText),
  });

  const presentItem = defineAppTool({
    name: "present_item",
    description:
      "Present one gated item to the reader. The sweep's visible effect; runs exactly once per item.",
    parameters: obj({ id: str(), title: str(), summary: arr(str()) }),
    example: { id: "gamma", title: "Gamma: a small signal", summary: ["One line.", "Another."] },
    replay: "safe",
    returns: "Confirmation that the item was presented",
    execute: (args, api, ctx) =>
      once(api, `present:${args.id}`, ctx, () => {
        const sweep = sweepOf(api.conversationId as number);
        const fresh = store.effects.record(sweep.id, `present:${args.id}`, "present_item", args);
        if (fresh)
          bus.publish({
            type: "sweep",
            sweep: { ...sweep, effects: store.effects.count(sweep.id), status: "running" },
          });
        return Promise.resolve(
          fresh ? `presented ${args.id}` : `presented ${args.id} (already recorded)`,
        );
      }).then(toolText),
  });

  return defineExtension({
    name: "sweep",
    tools: [gatherItems, gateItem, presentItem],
    sections: [section("sweep_system", () => systemPrompt(agentsDir), { tag: false })],
  });
}
