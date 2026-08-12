/**
 * The page-context bridge must not destroy its own payload — 2026-08-12.
 *
 * Pre-fix, any page without an entity anchor CLEARED storage, and /chat
 * has none, so navigating to chat wiped the source page's anchors in the
 * same frame chat needed to send them: the anchor → "OPERATOR CONTEXT
 * (live)" lane was dead for every cross-page navigation, and
 * body.contextRoute (server-consumed since Wave 30) had no text-chat
 * sender at all. These pin the fixed decision function.
 */
import { describe, it, expect } from "vitest";
import { computeNextPayload } from "@/components/chat/page-context-bridge";

describe("computeNextPayload", () => {
  it("returns null on /chat — the source page's stored context must survive", () => {
    expect(computeNextPayload("/chat", "")).toBeNull();
  });

  it("stores anchor + route on an entity page", () => {
    const p = computeNextPayload("/decisions/dec-42", "");
    expect(p).not.toBeNull();
    expect(p?.lastDecisionId).toBe("dec-42");
    expect(p?.contextRoute).toBe("/decisions/dec-42");
    expect(typeof p?.ts).toBe("number");
  });

  it("stores hash-anchored entities (missions task row)", () => {
    const p = computeNextPayload("/missions", "#task-row-t9");
    expect(p?.lastTaskId).toBe("t9");
    expect(p?.contextRoute).toBe("/missions");
  });

  it("stores route-only payload on a plain page instead of clearing", () => {
    const p = computeNextPayload("/business", "");
    expect(p).not.toBeNull();
    expect(p?.contextRoute).toBe("/business");
    expect(p?.lastTaskId).toBeUndefined();
    expect(p?.lastDecisionId).toBeUndefined();
  });
});
