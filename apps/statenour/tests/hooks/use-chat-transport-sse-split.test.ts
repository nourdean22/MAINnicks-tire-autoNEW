/**
 * tests/hooks/use-chat-transport-sse-split.test.ts · SSE frame-split lock.
 *
 * THE BUG (fixed 2026-08-09). An SSE frame is two lines:
 *
 *     event: chunk
 *     data: "<base64>"
 *     <blank line>
 *
 * The transport's reader keeps a `buffer` across reads precisely because a
 * network read can end mid-frame. But `currentEvent` was declared INSIDE the
 * `while (true)` read loop, so it was thrown away at the end of every read.
 * When a read boundary fell between the `event:` line and its `data:` line,
 * the next read started with currentEvent = "" and the data line matched
 * neither `currentEvent === "chunk"` nor the truthy `else if (currentEvent)`.
 * There is no final `else`, so the payload was SILENTLY DROPPED — lost stream
 * bytes, no error, no log, no counter.
 *
 * This test drives the REAL fetch wrapper (same capture technique as its
 * sibling use-chat-transport.test.ts) with a body deliberately chunked so the
 * split lands in the worst place. It fails on the pre-fix code.
 *
 * Frame count and size scale with response length, so this got likelier the
 * longer the reply — part of the operator's 2026-08-09 report that longer
 * chat turns misbehave.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, createRef } from "react";

let capturedFetch:
  | ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>)
  | undefined;

vi.mock("ai", () => ({
  DefaultChatTransport: class {
    opts: Record<string, unknown>;
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      capturedFetch = opts.fetch as typeof capturedFetch;
    }
  },
}));

import { useChatTransport } from "@/hooks/chat/use-chat-transport";

function buildTransport() {
  capturedFetch = undefined;
  function Probe() {
    useChatTransport({
      apiPath: "/api/ai/chat",
      transportBodyRef: createRef() as never,
      liveContextBlocksRef: { current: null },
      lastPersonaHeaderRef: { current: null },
      setDeeperContext: () => {},
      onConversationId: () => {},
    });
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  if (!capturedFetch) throw new Error("transport fetch wrapper was not captured");
  return capturedFetch;
}

/** An SSE response whose body arrives as the given pre-split string pieces. */
function sseResponseFromPieces(pieces: string[]): Response {
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
    headers: { "Content-Type": "text/event-stream" },
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
  capturedFetch = undefined;
  vi.restoreAllMocks();
});

describe("useChatTransport · SSE frames split across reads", () => {
  const payload = "hello-from-the-stream";
  const b64 = Buffer.from(payload, "utf8").toString("base64");

  it("decodes a chunk whose event: and data: lines arrive in SEPARATE reads", async () => {
    const wrapper = buildTransport();
    // The split lands between the event line and its data line — the exact
    // boundary that used to lose currentEvent.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponseFromPieces([`event: chunk\n`, `data: ${JSON.stringify(b64)}\n\n`]),
      ),
    );

    const res = await wrapper("/api/ai/chat", {});
    await expect(readAllText(res)).resolves.toContain(payload);
  });

  it("still decodes when the whole frame arrives in ONE read (control)", async () => {
    const wrapper = buildTransport();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponseFromPieces([`event: chunk\ndata: ${JSON.stringify(b64)}\n\n`]),
      ),
    );

    const res = await wrapper("/api/ai/chat", {});
    await expect(readAllText(res)).resolves.toContain(payload);
  });

  it("does not leak an event name across a completed frame", async () => {
    // After a frame terminates (blank line), a bare data: line belongs to no
    // event and must NOT be decoded as a chunk. This pins the per-frame reset
    // that makes hoisting currentEvent safe.
    const wrapper = buildTransport();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponseFromPieces([
          `event: chunk\ndata: ${JSON.stringify(b64)}\n\n`,
          `data: ${JSON.stringify(Buffer.from("ORPHAN", "utf8").toString("base64"))}\n\n`,
        ]),
      ),
    );

    const res = await wrapper("/api/ai/chat", {});
    const text = await readAllText(res);
    expect(text).toContain(payload);
    expect(text).not.toContain("ORPHAN");
  });
});
