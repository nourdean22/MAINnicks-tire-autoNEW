import { describe, expect, it, vi } from "vitest";
import { resolveMentionsWithTimeout } from "@/features/chat-v2/lib/mention-resolution";

describe("resolveMentionsWithTimeout", () => {
  it("returns raw text without invoking resolvers when there is no mention", async () => {
    const resolveAsync = vi.fn();
    const resolveSync = vi.fn();
    const result = await resolveMentionsWithTimeout({ text: "plain message", resolveAsync, resolveSync });
    expect(result).toEqual({ text: "plain message", source: "raw", timedOut: false });
    expect(resolveAsync).not.toHaveBeenCalled();
    expect(resolveSync).not.toHaveBeenCalled();
  });

  it("uses the server-backed expansion when it resolves in time", async () => {
    const result = await resolveMentionsWithTimeout({
      text: "show @revenue",
      resolveAsync: async () => "show [revenue: today $5,000]",
      resolveSync: () => "sync",
      timeoutMs: 50,
    });
    expect(result).toEqual({ text: "show [revenue: today $5,000]", source: "async", timedOut: false });
  });

  it("falls back to local context when the server resolver times out", async () => {
    vi.useFakeTimers();
    const pending = resolveMentionsWithTimeout({
      text: "show @revenue",
      resolveAsync: () => new Promise(() => {}),
      resolveSync: () => "show [revenue: local snapshot]",
      timeoutMs: 25,
    });
    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toEqual({
      text: "show [revenue: local snapshot]",
      source: "sync",
      timedOut: true,
    });
    vi.useRealTimers();
  });

  it("never loses the operator message when both resolvers fail", async () => {
    const result = await resolveMentionsWithTimeout({
      text: "show @week",
      resolveAsync: async () => { throw new Error("down"); },
      resolveSync: () => { throw new Error("down"); },
    });
    expect(result).toEqual({ text: "show @week", source: "raw", timedOut: false });
  });
});
