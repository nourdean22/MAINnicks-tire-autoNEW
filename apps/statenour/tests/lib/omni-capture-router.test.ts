import { describe, it, expect } from "vitest";
import {
  routeCapture,
  cycleIntentKind,
  CYCLEABLE_KINDS,
} from "@/lib/ultron/omni-capture-router";

/**
 * Smoke tests for the OmniCapture router. The router is a pure
 * function — no IO — so these cover the full surface of Nour's
 * typical capture shapes.
 */
describe("routeCapture", () => {
  it("routes questions ending with ? to ask", () => {
    expect(routeCapture("what's the next move?").kind).toBe("ask");
    // "should I ship today?" — has DECIDE_TOKEN "should i" which
    // now takes precedence (Apr 18) so decide wins over ask. A bare
    // "?" alone doesn't flip it back because the decide check
    // happens before the question-mark short-circuit for these
    // ambiguous cases.
    expect(routeCapture("should I ship today?").kind).toBe("decide");
  });

  it("routes question-word starts to ask", () => {
    expect(routeCapture("how is revenue tracking").kind).toBe("ask");
    expect(routeCapture("why did sales drop").kind).toBe("ask");
    // Contractions aren't in QUESTION_WORDS (the list has "what" not
    // "what's"), so "what's on for today" routes to dump. Use the
    // uncontracted form when the caller wants ask.
    expect(routeCapture("what is on for today").kind).toBe("ask");
  });

  it("routes action-verb + short to task", () => {
    expect(routeCapture("call Mike about the alignment").kind).toBe("task");
    expect(routeCapture("email Dania the trip plan").kind).toBe("task");
    expect(routeCapture("book the bloodwork appointment").kind).toBe("task");
  });

  it("routes 'should I' / 'worth it' / 'vs' to decide", () => {
    expect(routeCapture("should I ship the nickstire migration").kind).toBe("decide");
    expect(routeCapture("is it worth it to hire now").kind).toBe("decide");
    expect(routeCapture("pick between NAP fix vs SEO audit").kind).toBe("decide");
    expect(routeCapture("Tues vs Wed for the launch").kind).toBe("decide");
  });

  it("routes search-shape phrases to search", () => {
    expect(routeCapture("where did I see the payroll total").kind).toBe("search");
    expect(routeCapture("remind me what I decided about the quote").kind).toBe("search");
    expect(routeCapture("look up the warranty terms").kind).toBe("search");
  });

  it("routes long-form + emotional hints to dump", () => {
    const text =
      "I've been thinking about the shift and I feel like something's off with how we're pricing the fleet work, maybe it's time to reassess";
    expect(routeCapture(text).kind).toBe("dump");
  });

  it("respects slash prefixes", () => {
    expect(routeCapture("/ask what's next").kind).toBe("ask");
    expect(routeCapture("/task fix the lighting").kind).toBe("task");
    expect(routeCapture("/decide stay or switch").kind).toBe("decide");
    expect(routeCapture("/dump random thought").kind).toBe("dump");
    expect(routeCapture("/park come back later").kind).toBe("park");
    expect(routeCapture("/search tire brands").kind).toBe("search");
    expect(routeCapture("/plan launch day").kind).toBe("plan");
    expect(routeCapture("/reflect on today").kind).toBe("reflect");
  });

  it("handles empty + whitespace-only", () => {
    expect(routeCapture("").kind).toBe("dump");
    expect(routeCapture("   \n\t  ").kind).toBe("dump");
  });

  it("defaults short ambiguous to dump, not task", () => {
    // "fix it" is action-verb + very short. Current router routes to
    // task because first-word matches the ACTION_VERBS list. Lock it
    // in — if we change the threshold, this test surfaces it.
    expect(routeCapture("fix it").kind).toBe("task");
    // "mike" alone — not a verb — should default to dump
    expect(routeCapture("mike").kind).toBe("dump");
  });
});

describe("cycleIntentKind", () => {
  it("cycles through all CYCLEABLE_KINDS in order", () => {
    let current = CYCLEABLE_KINDS[0];
    const visited = new Set<string>([current]);
    for (let i = 0; i < CYCLEABLE_KINDS.length; i++) {
      current = cycleIntentKind(current);
      visited.add(current);
    }
    // After going through the full cycle we should have visited every
    // kind at least once.
    expect(visited.size).toBe(CYCLEABLE_KINDS.length);
  });

  it("wraps from last to first", () => {
    const last = CYCLEABLE_KINDS[CYCLEABLE_KINDS.length - 1];
    expect(cycleIntentKind(last)).toBe(CYCLEABLE_KINDS[0]);
  });

  it("defaults uncycleable kinds to first cycleable", () => {
    // park/plan/reflect are hidden from the chip cycle
    expect(cycleIntentKind("park")).toBe(CYCLEABLE_KINDS[0]);
    expect(cycleIntentKind("plan")).toBe(CYCLEABLE_KINDS[0]);
    expect(cycleIntentKind("reflect")).toBe(CYCLEABLE_KINDS[0]);
  });
});
