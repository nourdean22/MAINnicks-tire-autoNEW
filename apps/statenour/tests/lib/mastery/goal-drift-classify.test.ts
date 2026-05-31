import { describe, it, expect } from "vitest";
import { classifyDrift } from "@/lib/mastery/goal-drift-classify";

// Ambition Engine P2 · pure drift classifier. The cron
// (src/inngest/functions/goal-drift-detector.ts) feeds it real event-window
// counts; here we lock the decision boundaries in isolation.

describe("classifyDrift · Ambition Engine P2", () => {
  it("flags deadline-risk (P1) when a deadline is near, behind, and quiet this week", () => {
    expect(
      classifyDrift({ recentEvents: 0, priorEvents: 0, daysSinceActivity: 10, progress: 50, daysToDeadline: 7 }),
    ).toEqual({ signal: "deadline-risk", priority: "P1" });
  });

  it("flags momentum-decay (P2) when it was active but went quiet this week, not yet stale", () => {
    expect(
      classifyDrift({ recentEvents: 0, priorEvents: 3, daysSinceActivity: 10, progress: 40, daysToDeadline: null }),
    ).toEqual({ signal: "momentum-decay", priority: "P2" });
  });

  it("returns null when the goal is active this week (recent events)", () => {
    expect(
      classifyDrift({ recentEvents: 2, priorEvents: 3, daysSinceActivity: 1, progress: 40, daysToDeadline: null }),
    ).toBeNull();
  });

  it("returns null at >=30d idle — that's goal-pruner's job, not drift", () => {
    expect(
      classifyDrift({ recentEvents: 0, priorEvents: 3, daysSinceActivity: 35, progress: 40, daysToDeadline: null }),
    ).toBeNull();
  });

  it("returns null when a near deadline is on-track (progress >= floor)", () => {
    expect(
      classifyDrift({ recentEvents: 0, priorEvents: 0, daysSinceActivity: 10, progress: 90, daysToDeadline: 5 }),
    ).toBeNull();
  });

  it("returns null when the deadline is far off and there was no prior momentum", () => {
    expect(
      classifyDrift({ recentEvents: 0, priorEvents: 0, daysSinceActivity: 10, progress: 10, daysToDeadline: 60 }),
    ).toBeNull();
  });

  it("does not fire on a past-due deadline (daysToDeadline < 0)", () => {
    // A blown deadline is a different (louder) conversation — not this signal.
    expect(
      classifyDrift({ recentEvents: 0, priorEvents: 0, daysSinceActivity: 10, progress: 50, daysToDeadline: -3 }),
    ).toBeNull();
  });

  it("prioritizes deadline-risk over momentum-decay when both could fire", () => {
    expect(
      classifyDrift({ recentEvents: 0, priorEvents: 5, daysSinceActivity: 10, progress: 30, daysToDeadline: 5 }),
    ).toEqual({ signal: "deadline-risk", priority: "P1" });
  });

  it("requires >=2 prior events for momentum-decay (a single blip is not momentum)", () => {
    expect(
      classifyDrift({ recentEvents: 0, priorEvents: 1, daysSinceActivity: 10, progress: 40, daysToDeadline: null }),
    ).toBeNull();
  });
});
