// PAS_PROVIDER=faux (the default): a scripted stand-in model that walks a whole sweep with real
// tools: gather once, gate every item, present the gated-in ones, then report. Deterministic and
// free, so `npm run dev` works offline with zero keys.
import type { MutableModels } from "@earendil-works/pi-ai/models";
import { installScriptedFaux, say, call, calls, type FauxRule, type FauxTurn } from "@pas/durable-agent";
import { SAMPLE_ITEMS } from "./sweep-extension.ts";

const called = (turn: FauxTurn, name: string) => turn.calls.filter((c) => c.name === name);
const gated = (turn: FauxTurn, id: string) =>
  called(turn, "gate_item").some((c) => c.arguments.id === id && c.arguments.verdict === "present");
const presented = (turn: FauxTurn, id: string) =>
  called(turn, "present_item").some((c) => c.arguments.id === id);

/** The fixed editorial taste the faux model applies: skip the loud claim, present the rest. */
const PRESENT: Record<string, boolean> = { alpha: true, beta: false, gamma: true };

function nextStep(turn: FauxTurn) {
  if (!called(turn, "gather_items").length)
    return call("gather_items", {}, "Gathering the candidates for this sweep.");
  const ungated = SAMPLE_ITEMS.filter((i) => !called(turn, "gate_item").some((c) => c.arguments.id === i.id));
  if (ungated.length)
    return calls(
      ungated.map((i) => ({
        name: "gate_item",
        args: {
          id: i.id,
          verdict: PRESENT[i.id] ? "present" : "skip",
          reason: PRESENT[i.id] ? "Sourced and actionable." : "Loud claim without a source.",
        },
      })),
      "Gating every candidate.",
    );
  const toPresent = SAMPLE_ITEMS.filter((i) => gated(turn, i.id) && !presented(turn, i.id));
  if (toPresent.length)
    return calls(
      toPresent.map((i) => ({
        name: "present_item",
        args: {
          id: i.id,
          title: i.title,
          summary: [i.body, PRESENT[i.id] ? "Why it matters: actionable." : ""].filter(Boolean),
        },
      })),
      "Presenting the gated-in items.",
    );
  return say(
    `Sweep complete: ${SAMPLE_ITEMS.filter((i) => gated(turn, i.id)).length} gated, ${SAMPLE_ITEMS.filter((i) => presented(turn, i.id)).length} presented. Done.`,
  );
}

export function fauxRules(): readonly FauxRule[] {
  return [
    (turn) =>
      /request_id:/.test(turn.lastUser) || turn.calls.length || turn.results.length
        ? nextStep(turn)
        : undefined,
  ];
}

export function installServerFaux(models: MutableModels): void {
  const tokensPerSecond = Number(process.env.PAS_FAUX_TPS);
  installScriptedFaux(models, fauxRules(), {
    ...(Number.isFinite(tokensPerSecond) && tokensPerSecond > 0
      ? { tokensPerSecond }
      : {}),
  });
}
