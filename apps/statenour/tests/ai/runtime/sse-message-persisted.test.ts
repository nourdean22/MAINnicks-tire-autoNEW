/**
 * message.persisted (audit 04-F2 / 04-F14, 2026-10-10).
 *
 * The stored reply can differ from the streamed one (pre-persist banners,
 * CoVe, calibration), and the turn's post-persist work kept the stream
 * "live" long after the reply landed. The SSE stream now carries ONE
 * `message.persisted { id, content }` event once the row holds its final
 * text - while the AI SDK body is still held open by onFinish - followed by
 * `message.completed` and a close; the deferred work runs on server-side.
 * A turn with no row (private, empty, duplicate) completes when onFinish
 * resolves, as before.
 *
 * The upstream body here is held open until onFinish resolves, which is
 * how ai@6 behaves (streamText awaits onFinish inside its flush).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { createCockpitSseStream, notifyMessagePersisted } from "@/lib/ai/runtime/sse-stream";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function events(raw: string): Array<{ type: string; data: unknown }> {
  return raw
    .split("\n\n")
    .filter((b) => b.startsWith("event: "))
    .map((b) => {
      const [head, data] = b.split("\n");
      return { type: head!.slice(7), data: JSON.parse(data!.slice(6)) };
    });
}

function build(traceId: string, onFinish: Promise<void>) {
  // Upstream emits one chunk, then stays open until onFinish resolves.
  const upstream = new ReadableStream<Uint8Array>({
    async start(c) {
      c.enqueue(new TextEncoder().encode("hello"));
      await onFinish;
      c.close();
    },
  });
  return createCockpitSseStream({
    aiSdkStream: upstream,
    traceId,
    classification: { intent: "x", mode: "fast", model: "m", provider: "p", targets: [] },
    recalledMemories: [],
    contradictions: [],
    onFinishPromise: onFinish,
  });
}

describe("message.persisted", () => {
  it("is emitted while onFinish is still running, before message.completed", async () => {
    const finish = deferred();
    const sse = build("trace-A", finish.promise);
    const reader = sse.getReader();
    const dec = new TextDecoder();
    let raw = "";
    // Drain the header events + the chunk.
    for (let i = 0; i < 3; i += 1) raw += dec.decode((await reader.read()).value);

    // The row is created mid-onFinish (post-persist work still pending).
    expect(notifyMessagePersisted("trace-A", { id: "msg-1", content: "stored text" })).toBe(true);
    raw += dec.decode((await reader.read()).value);
    expect(events(raw).map((e) => e.type)).toContain("message.persisted");
    expect(events(raw).map((e) => e.type)).not.toContain("message.completed");

    finish.resolve();
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      raw += dec.decode(r.value);
    }
    const types = events(raw).map((e) => e.type);
    expect(types.indexOf("message.persisted")).toBeLessThan(types.indexOf("message.completed"));
    expect(events(raw).find((e) => e.type === "message.persisted")!.data).toEqual({
      id: "msg-1",
      content: "stored text",
    });
  });

  it("closes the turn on message.persisted: the client reads to done while onFinish is still running (04-F14)", async () => {
    // onFinish never resolves here: the deferred phases are still running.
    const never = new Promise<void>(() => {});
    const sse = build("trace-C", never);
    const reader = sse.getReader();
    const dec = new TextDecoder();
    let raw = "";
    for (let i = 0; i < 3; i += 1) raw += dec.decode((await reader.read()).value);

    expect(notifyMessagePersisted("trace-C", { id: "msg-3", content: "final text" })).toBe(true);
    const drained = (async () => {
      for (;;) {
        const r = await reader.read();
        if (r.done) return "done";
        raw += dec.decode(r.value);
      }
    })();
    const outcome = await Promise.race([
      drained,
      new Promise<string>((r) => setTimeout(() => r("still open after 200 ms"), 200)),
    ]);
    expect(outcome).toBe("done");
    const types = events(raw).map((e) => e.type);
    expect(types.slice(-2)).toEqual(["message.persisted", "message.completed"]);
    // One announcement per turn: the stream stopped listening when it closed.
    expect(notifyMessagePersisted("trace-C", { id: "late", content: "z" })).toBe(false);
  });

  it("CONTROL: a notify for another trace reaches no stream, and a closed stream stops listening", async () => {
    const finish = deferred();
    const sse = build("trace-B", finish.promise);
    expect(notifyMessagePersisted("trace-other", { id: "x", content: "y" })).toBe(false);
    finish.resolve();
    const text = await new Response(sse).text();
    expect(events(text).map((e) => e.type)).not.toContain("message.persisted");
    expect(events(text).map((e) => e.type)).toContain("message.completed");
    expect(notifyMessagePersisted("trace-B", { id: "late", content: "z" })).toBe(false);
  });
});

describe("B2 · message.persisted says when the stored text is a draft still being checked", () => {
  async function persistedEvent(trace: string, payload: { id: string; content: string; verifying?: boolean }) {
    const sse = build(trace, new Promise<void>(() => {}));
    const reader = sse.getReader();
    const dec = new TextDecoder();
    let raw = "";
    for (let i = 0; i < 3; i += 1) raw += dec.decode((await reader.read()).value);
    notifyMessagePersisted(trace, payload);
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      raw += dec.decode(r.value);
    }
    return events(raw).find((e) => e.type === "message.persisted")?.data as Record<string, unknown>;
  }

  it("carries verifying: true when the server is still checking", async () => {
    expect(await persistedEvent("trace-V1", { id: "m", content: "draft", verifying: true })).toEqual({ id: "m", content: "draft", verifying: true });
  });

  it("CONTROL: without the flag the key is absent", async () => {
    expect(await persistedEvent("trace-V2", { id: "m", content: "final" })).toEqual({ id: "m", content: "final" });
  });
});
