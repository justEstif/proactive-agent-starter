// GET /v1/stream: one SSE stream per client. hello, then the main conversation's structural view
// (a snapshot now, each committed revision after), then bus frames (sweep). Pings every 15 s and
// ends at 2 MB buffered so a slow viewer reconnects to a fresh snapshot. Streams are viewers only:
// closing one never aborts work.
import type { Request, Response } from "express";
import { API_VERSION, type Frame } from "@pas/agent-sdk";
import type { ConversationId } from "@earendil-works/pi-durable";
import { invalid } from "./errors.ts";
import type { App } from "./runtime.ts";

const MAX_BUFFER = 2_000_000;
const MAX_CONVERSATIONS = 8;

export interface Sse {
  send(frame: Frame): void;
  onClose(fn: () => void): void;
  close(): void;
  readonly closed: boolean;
}

export function openSse(res: Response): Sse {
  res.status(200).set({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.flushHeaders();
  res.socket?.setNoDelay(true);
  let seq = 0;
  let closed = false;
  const cleanups: (() => void)[] = [];
  const ping = setInterval(() => {
    if (!closed) res.write(": ping\n\n");
  }, 15_000);
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    for (const fn of cleanups.splice(0)) {
      try {
        fn();
      } catch {}
    }
  };
  res.on("close", close);
  const send = (frame: Frame) => {
    if (closed) return;
    if (res.writableLength > MAX_BUFFER) {
      res.end();
      close();
      return;
    }
    res.write(`id: ${++seq}\nevent: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`);
  };
  return {
    send,
    onClose(fn) {
      if (closed) fn();
      else cleanups.push(fn);
    },
    close() {
      res.end();
      close();
    },
    get closed() {
      return closed;
    },
  };
}

export function parseConversations(raw: unknown): number[] {
  if (raw === undefined || raw === "") return [];
  if (typeof raw !== "string") throw invalid("conversations must be a comma separated list of ids");
  const ids = [...new Set(raw.split(",").map((s) => Number(s.trim())))];
  if (ids.some((n) => !Number.isInteger(n) || n <= 0))
    throw invalid("conversations must be a comma separated list of ids");
  if (ids.length > MAX_CONVERSATIONS)
    throw invalid(`At most ${MAX_CONVERSATIONS} conversations per stream`);
  return ids;
}

/** Every open stream, so shutdown can end them before the harness closes. */
export class StreamHub {
  private readonly open = new Set<Sse>();
  closing = false;

  async serve(app: App, req: Request, res: Response): Promise<void> {
    const { harness, ctx } = app.harness;
    const extra = parseConversations(req.query.conversations);
    const ids = [app.main.id as number, ...extra.filter((id) => id !== (app.main.id as number))];
    const sse = openSse(res);
    this.open.add(sse);
    sse.onClose(() => this.open.delete(sse));
    const log = app.log.child({ stream: true });
    log.info("stream.open", { conversations: ids });
    sse.onClose(() => log.info("stream.close", { conversations: ids }));
    sse.send({
      type: "hello",
      apiVersion: API_VERSION,
      serverTime: Date.now(),
      device: app.config.device,
      mainConversationId: app.main.id as number,
    });

    for (const id of ids) {
      if (sse.closed) return;
      const conversation = await harness.conversation(id as ConversationId, ctx);
      if (!conversation) continue;
      const watch = await conversation.watch(ctx);
      sse.send({
        type: "agent.snapshot",
        conversationId: id,
        snapshot: { entries: watch.value.entries },
      });
      void watch.start(async (call) => {
        if (sse.closed || call.kind === "failed") return;
        sse.send({
          type: "agent.snapshot",
          conversationId: id,
          snapshot: { entries: call.value.entries },
        });
      });
      sse.onClose(() => void watch.stop());
    }

    sse.onClose(app.bus.subscribe((frame) => sse.send(frame)));
  }

  closeAll(): void {
    this.closing = true;
    for (const sse of [...this.open]) sse.close();
  }

  get size(): number {
    return this.open.size;
  }
}
