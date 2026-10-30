// @vitest-environment jsdom
/**
 * W2 queue store (features/chat-v2/lib/message-queue.ts), the parts the composer test cannot see:
 * a failed storage write must not lose a queued message, a deleted chat's messages are purged, and
 * every read-modify-write goes through one cross-tab lock (Codex review on PR 3415).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadQueue, mutateQueue, purgeConversation, saveQueue, getQueueSnapshot } from "@/features/chat-v2/lib/message-queue";

const a = { id: "a", text: "one", conversationId: "c1" };
const b = { id: "b", text: "two", conversationId: "c2" };

beforeEach(() => {
  localStorage.clear();
  saveQueue([]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("message queue store", () => {
  it("a write that fails while reads still work keeps the new queue in memory (Codex P2)", () => {
    saveQueue([a]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    saveQueue([a, b]);
    expect(loadQueue()).toEqual([a, b]);
    expect(getQueueSnapshot()).toEqual([a, b]);
  });

  it("CONTROL: once a write lands again, storage is the source again", () => {
    saveQueue([a]);
    expect(JSON.parse(localStorage.getItem("nick-chat-queue")!)).toEqual([a]);
    expect(loadQueue()).toEqual([a]);
  });

  it("purgeConversation drops only that chat's messages (Codex P2)", async () => {
    saveQueue([a, b]);
    await purgeConversation("c1");
    expect(loadQueue()).toEqual([b]);
  });

  it("every read-modify-write runs under the one cross-tab lock (Codex P2)", async () => {
    const request = vi.fn((_name: string, fn: () => unknown) => Promise.resolve(fn()));
    vi.stubGlobal("navigator", { ...navigator, locks: { request } });
    saveQueue([a]);
    const out = await mutateQueue((q) => ({ next: [...q, b], result: q.length }));
    expect(request).toHaveBeenCalledWith("nick-chat-queue", expect.any(Function));
    expect(out).toBe(1);
    expect(loadQueue()).toEqual([a, b]);
  });

  it("an item without a conversation id is dropped on read (a no-id chat cannot queue)", () => {
    localStorage.setItem("nick-chat-queue", JSON.stringify([a, { id: "x", text: "orphan", conversationId: null }]));
    expect(loadQueue()).toEqual([a]);
  });
});
