/**
 * tests/hooks/use-chat-transport-b6.test.ts · audit 04-F2 / 04-F8 client half (task B6).
 *
 * Drives the REAL fetch wrapper and reconnect builder the hook hands to
 * DefaultChatTransport (same capture technique as use-chat-transport.test.ts).
 *
 *   1. `event: message.persisted` reaches the consumer callback, tagged with
 *      the X-Trace-Id of the response it arrived on. Before this, the only
 *      grep hit for "message.persisted" was the server that writes it.
 *   2. A plain UI-message SSE body (bare `data:` lines, no `event:` name) is
 *      what the resume GET, the image lane and the confirmation lane send.
 *      The cockpit parser only forwarded `event: chunk` frames, so every
 *      bare frame was dropped and a resumed turn rendered nothing.
 *   3. The resume GET names the turn it waits for: ?traceId=<last X-Trace-Id>.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

let capturedOpts: Record<string, unknown> | undefined;

vi.mock("ai", () => ({
  DefaultChatTransport: class {
    constructor(opts: Record<string, unknown>) {
      capturedOpts = opts;
    }
  },
}));

import { useChatTransport } from "@/hooks/chat/use-chat-transport";

type Wrapper = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Reconnect = () => { api: string };

function build(opts: {
  body?: Record<string, unknown>;
  lastTraceId?: string | null;
  onMessagePersisted?: (p: { id: string; content: string; traceId: string | null }) => void;
}) {
  capturedOpts = undefined;
  const bodyRef = { current: opts.body ?? {} };
  const traceRef = { current: opts.lastTraceId ?? null };
  function Probe() {
    useChatTransport({
      apiPath: "/api/ai/chat",
      transportBodyRef: bodyRef as never,
      liveContextBlocksRef: { current: null },
      lastPersonaHeaderRef: { current: null },
      lastTraceIdRef: traceRef,
      setDeeperContext: () => {},
      onMessagePersisted: opts.onMessagePersisted,
    } as never);
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  if (!capturedOpts) throw new Error("transport opts were not captured");
  return {
    fetch: capturedOpts.fetch as Wrapper,
    reconnect: capturedOpts.prepareReconnectToStreamRequest as Reconnect,
    traceRef,
  };
}

function sse(pieces: string[], headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < pieces.length) controller.enqueue(encoder.encode(pieces[i++]));
      else controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", ...headers },
  });
}

async function readAllText(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

beforeEach(() => {
  capturedOpts = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("message.persisted reaches the client (04-F2)", () => {
  it("calls onMessagePersisted with the DB id, the stored text and this response's trace id", async () => {
    const onMessagePersisted = vi.fn();
    const { fetch: wrapper } = build({ onMessagePersisted });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sse(
          [
            `event: chunk\ndata: ${JSON.stringify(Buffer.from("x").toString("base64"))}\n\n`,
            `event: message.persisted\n`,
            `data: ${JSON.stringify({ id: "row_1", content: "Stored text" })}\n\n`,
          ],
          { "X-Trace-Id": "T1" },
        ),
      ),
    );

    await readAllText(await wrapper("/api/ai/chat", {}));
    expect(onMessagePersisted).toHaveBeenCalledTimes(1);
    expect(onMessagePersisted).toHaveBeenCalledWith({ id: "row_1", content: "Stored text", traceId: "T1" });
  });

  it("ignores a malformed payload instead of binding a bubble to garbage", async () => {
    const onMessagePersisted = vi.fn();
    const { fetch: wrapper } = build({ onMessagePersisted });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sse([`event: message.persisted\ndata: ${JSON.stringify({ id: 7 })}\n\n`], { "X-Trace-Id": "T1" }),
      ),
    );

    await readAllText(await wrapper("/api/ai/chat", {}));
    expect(onMessagePersisted).not.toHaveBeenCalled();
  });
});

describe("plain UI-message SSE passes through (resume, image and confirmation lanes)", () => {
  it("forwards bare data: frames so the AI SDK can parse them", async () => {
    const { fetch: wrapper } = build({});
    const start = JSON.stringify({ type: "start", messageId: "resume-conv-1-T1" });
    const delta = JSON.stringify({ type: "text-delta", id: "t1", delta: "Resumed reply" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sse([`data: ${start}\n\n`, `data: ${delta}\n\n`, `data: [DONE]\n\n`])),
    );

    const text = await readAllText(await wrapper("/api/ai/chat/conv-1/stream", { method: "GET" }));
    // P2-B6 fix round 2 · a resume's start chunk is marked resumed (the
    // Regenerate gate reads it); every other frame passes byte for byte.
    const marked = JSON.stringify({ ...JSON.parse(start), messageMetadata: { resumed: true } });
    expect(text).toContain(`data: ${marked}\n\n`);
    expect(text).toContain(`data: ${delta}\n\n`);
    expect(text).toContain("data: [DONE]\n\n");
  });

  it("passes a 204 (nothing to resume) through untouched", async () => {
    const { fetch: wrapper } = build({});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const res = await wrapper("/api/ai/chat/conv-1/stream", { method: "GET" });
    expect(res.status).toBe(204);
  });
});

describe("reconnect names the turn it waits for (04-F8)", () => {
  it("appends ?traceId=<last X-Trace-Id> to the resume URL", () => {
    const { reconnect } = build({ body: { conversationId: "conv 1" }, lastTraceId: "T/1" });
    expect(reconnect().api).toBe("/api/ai/chat/conv%201/stream?traceId=T%2F1");
  });

  it("reads the trace id at reconnect time, not at transport build time", () => {
    const { reconnect, traceRef } = build({ body: { conversationId: "conv-1" } });
    traceRef.current = "T2";
    expect(reconnect().api).toBe("/api/ai/chat/conv-1/stream?traceId=T2");
  });

  it("control: no trace yet (fresh page load) keeps the old URL", () => {
    const { reconnect } = build({ body: { conversationId: "conv-1" } });
    expect(reconnect().api).toBe("/api/ai/chat/conv-1/stream");
  });

  it("control: the 'none' sentinel never carries a trace", () => {
    const { reconnect } = build({ body: { privateMode: true, conversationId: "conv-1" }, lastTraceId: "T1" });
    expect(reconnect().api).toBe("/api/ai/chat/none/stream");
  });
});
