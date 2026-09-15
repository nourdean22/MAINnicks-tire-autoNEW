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
    const p = computeNextPayload("/stats", "");
    expect(p).not.toBeNull();
    expect(p?.contextRoute).toBe("/stats");
    expect(p?.lastTaskId).toBeUndefined();
    expect(p?.lastDecisionId).toBeUndefined();
  });

  // 2026-09-15 · UI workbench · the universal inspector carries the object in
  // `?inspect=<kind>:<id>` on ANY page, and the live task-row anchor is
  // `task-<id>` (mission-task-row.tsx), not the `task-row-<id>` chat receipts
  // emit. Positive control: both cases below FAILED against the pre-change
  // bridge (lastTaskId undefined) before the fix landed.
  it("reads the inspected object from the query string on any page", () => {
    const p = computeNextPayload("/brain", "", "?tab=memory&inspect=task:t1");
    expect(p?.lastTaskId).toBe("t1");
    expect(p?.contextRoute).toBe("/brain");
    const q = computeNextPayload("/stats", "", "inspect=decision:d7");
    expect(q?.lastDecisionId).toBe("d7");
  });

  it("accepts the row's real `#task-<id>` anchor on /missions", () => {
    const p = computeNextPayload("/missions", "#task-t2", "");
    expect(p?.lastTaskId).toBe("t2");
  });

  it("the inspected object wins over a hash anchor when both are present", () => {
    const p = computeNextPayload("/missions", "#task-row-a", "?inspect=task:b");
    expect(p?.lastTaskId).toBe("b");
  });

  it("an inspected kind the bridge has no field for still stores the route (no field invented)", () => {
    const p = computeNextPayload("/brain", "", "?inspect=memory:m1");
    expect(p?.contextRoute).toBe("/brain");
    expect(Object.keys(p ?? {}).sort()).toEqual(["contextRoute", "ts"]);
  });
});
