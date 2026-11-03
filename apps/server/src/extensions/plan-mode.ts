// An upstream pi-durable example extension (packages/durable/test/examples/26-plan-mode.ts), copied
// with only its import paths changed, proving the wrapper passes pi-durable's full extension
// surface through (docs, tools, sections, per-conversation agent changes). Not installed by
// default: add it to openDurableHarness's `extensions` to use it.
import { arr, obj, str } from "@earendil-works/pi-schema";
import { defineDoc, defineExtension, defineTool, section } from "@earendil-works/pi-durable";

// The current plan of a conversation. A fork keeps the plan it had at the fork entry.
export const PlanDoc = defineDoc<{ steps: string[] }>({
  checkpointWhen: () => false,
  kind: "app.plan",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ steps: [] }),
});

const submitPlan = defineTool({
  name: "submit_plan",
  description: "Submit the plan as a list of steps.",
  parameters: obj({ steps: arr(str()) }),
  execute: async (args, api, callContext) => {
    await api.commit(async (tx) => {
      (await tx.doc(PlanDoc, api.conversationId)).steps = args.steps;
    }, callContext);
    return { output: [{ type: "text", text: "Plan submitted." }], control: { terminate: true } };
  },
});

export const Plan = defineExtension({
  name: "plan",
  tools: [submitPlan],
  sections: [
    section(
      "plan_mode",
      () => "You are in plan mode. Read the code, then call submit_plan. Change nothing.",
    ),
  ],
});

// Plan mode is a change to the conversation's agent: select the plan extension and offer only
// submitting. Clearing returns the host's default selection and every tool.
export const enterPlanMode = { extensions: { add: [Plan] }, tools: [submitPlan] };
export const leavePlanMode = { extensions: null, tools: null };
