/**
 * UI v3 W3b: page context has always been attached silently (PageContextBridge stores the source
 * page's route and entity anchors; use-chat-stream.ts spreads them into every request). The chip
 * above the composer makes it visible and lets the operator detach it for this turn. The pure
 * decision of what goes on the wire, so the hook's body stays a one-line call.
 */
import { describe, it, expect } from "vitest";
import { PAGE_ANCHOR_KEYS, pageContextForTurn } from "@/features/chat-v2/lib/page-context-anchors";

const ctx = { contextRoute: "/decisions/abc", lastDecisionId: "abc", lastTaskId: "t1", ts: 1 };

describe("pageContextForTurn", () => {
  it("attached: every anchor the bridge stored goes on the wire, and the chip names the route", () => {
    const result = pageContextForTurn(ctx, false);
    expect(result.anchors).toEqual({ contextRoute: "/decisions/abc", lastDecisionId: "abc", lastTaskId: "t1" });
    expect(result.chip).toEqual({ route: "/decisions/abc" });
  });

  it("detached for this turn: nothing goes on the wire and there is no chip", () => {
    const result = pageContextForTurn(ctx, true);
    expect(result.anchors).toEqual({});
    expect(result.chip).toBeNull();
  });

  it("no stored context: nothing on the wire and no chip, whatever the detach flag", () => {
    expect(pageContextForTurn(null, false)).toEqual({ anchors: {}, chip: null });
    expect(pageContextForTurn(null, true)).toEqual({ anchors: {}, chip: null });
  });

  it("only known anchor keys travel; ts and unknown fields never do", () => {
    const result = pageContextForTurn({ ...ctx, extra: "x" } as unknown as typeof ctx, false);
    expect(Object.keys(result.anchors).every((k) => (PAGE_ANCHOR_KEYS as readonly string[]).includes(k))).toBe(true);
    expect(result.anchors).not.toHaveProperty("ts");
  });
});
