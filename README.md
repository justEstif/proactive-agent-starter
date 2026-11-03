# proactive-agent-starter

A durable, proactive agent template: a pi-durable 1.5 kernel, an Express API that hosts it, a cron tick that drives it, and one trivial sweep-shaped example agent. Runs offline with zero API keys on the scripted faux model.

Four workspaces:

| Package | What it is |
| --- | --- |
| `packages/durable-agent` | The kernel wrapper: `openDurableHarness` (SQLite, PID lock, retries, compaction), a model catalog, prompt loading, exactly-once tool helpers, subagents, a scripted faux model, and a commit→telemetry projector. |
| `packages/jev` | The bare jev classifier (JSON in, decisions out). Optional; not used by the example agent. |
| `packages/agent-sdk` | The generic wire contract: route table, SSE frames, typed client, retry, JSONL logger, bearer-token helpers. |
| `apps/server` | Express API: bearer auth (client + cron scopes), Idempotency-Key replay, one SSE stream route, one workflow route (`stub-sweep`). Hosts the harness and the example agent. |
| `apps/cron` | The tick: POSTs the workflow route with the cron token and a slot-based requestId. |

Nothing is published; every package is `private`.

## Quick start (offline, zero keys)

```sh
mise install        # node 24 (see .mise.toml)
npm run setup       # npm install + writes PAS_CLIENT_TOKEN / PAS_CRON_TOKEN into .env if missing
npm run dev         # API on http://127.0.0.1:4851, faux model
```

In a second terminal:

```sh
npm run tick        # one sweep now
npm run cron        # or a tick every 60s
curl -N -H "authorization: Bearer $PAS_CLIENT_TOKEN" http://127.0.0.1:4851/v1/stream
```

`npm run dev:all` runs the server and the cron loop together under one Ctrl-C.

Tokens: without `.env` the server uses fixed dev tokens (printed in `.env.example`'s place — see `src/config.ts`). Run `npm run setup` once to generate real ones; they must be ≥32 chars and differ from each other.

## What the example agent does

The sweep agent (`apps/server/src/agents/`) is deliberately trivial: gather → gate → present.

1. The cron tick POSTs `/v1/workflows/stub-sweep` with `{requestId: "cron:<device>:<slot>"}`.
2. The server admits the sweep's user prompt (from `apps/server/prompt_engineering/agents/sweep/USER_PROMPT_SWEEP.md`, which carries a `## Definition Of Done` section — the prompts test enforces this) into the root durable conversation.
3. The agent calls `gather_items`, `gate_item` per item, `present_item` per gated-in item.
4. Every gate/present effect is exactly-once: the tool task memo plus a unique `(sweep_id, key)` row in `api.sqlite`.
5. `kill -9` mid-sweep, restart, and the run resumes from its last checkpoint with no effect repeated.

Swap in a real model with `PAS_PROVIDER=openrouter PAS_MODEL=anthropic/claude-haiku-5.5 OPENROUTER_API_KEY=...` and replace the gather tool's fixed items with whatever your domain gathers.

## Adding an extension from upstream pi

The kernel is a pass-through, not a narrowing: anything `defineExtension` can express installs. `apps/server/src/extensions/plan-mode.ts` is upstream's plan-mode example (`packages/durable/test/examples/26-plan-mode.ts` from the pi repo) copied with only its import paths changed; `tests/extensions.test.ts` installs it through `openDurableHarness` and switches a conversation into plan mode. To add one:

1. Copy the example into `apps/server/src/extensions/`.
2. Fix imports to the installed packages.
3. Add it to `extensions: [...]` in `apps/server/src/runtime.ts`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run setup` | install deps, generate `.env` tokens |
| `npm run dev` | API server (faux model by default) |
| `npm run dev:all` | server + cron loop |
| `npm run tick` | one cron tick now |
| `npm run cron` | cron loop (one tick per `PAS_CRON_INTERVAL_MS`, default 60s) |
| `npm test` | every workspace's tests |
| `npm run check` | tsc across every workspace |

## Phase 2 (not built)

- Hub gateway for multiple devices.
- Web UI and TUI clients on the SSE stream.
- Config-file driven setup beyond `.env`.
- Scheduled sweeps decided by the API (the tick currently always fires; the workflow route is idempotent per slot).

## License

MIT.
