/**
 * Scoring-config tests · 2026-06-01.
 *
 * Pins the adaptive task-stat multiplier (the factor applied to
 * SIGNAL_XP.task for a completion's character-sheet stat XP). The
 * constants are the canonical source auto-learn also imports, so these
 * also guard that the centralization didn't change the numbers.
 */
import { describe, it, expect } from "vitest";
import {
  taskStatMultiplier,
  EFFORT_MULTIPLIER,
  GOAL_LINKED_MULTIPLIER,
  streakMultiplier,
  CONFIDENCE,
} from "@/lib/mastery/scoring-config";

describe("taskStatMultiplier · effort × ROI × goal × streak", () => {
  it("baseline M30 / roi 50 / no goal / ONCE → 0.5", () => {
    expect(taskStatMultiplier({ effort: "M30", roiScore: 50, loopKind: "ONCE" })).toBeCloseTo(0.5);
  });

  it("maxed H2PLUS / roi 100 / goal-linked / 7-day DAILY → 4.8", () => {
    const m = taskStatMultiplier({
      effort: "H2PLUS",
      roiScore: 100,
      hasGoalId: true,
      loopKind: "DAILY",
      streakCount: 7,
    });
    expect(m).toBeCloseTo(1.0 * 1.6 * 1.5 * 2.0); // 4.8
  });

  it("clamps roi to [0.3, 1.0] — roi 0 floors at 0.3", () => {
    expect(taskStatMultiplier({ effort: "M5", roiScore: 0, loopKind: "ONCE" })).toBeCloseTo(0.3 * 0.6);
  });

  it("defaults a missing effort to M30 (1.0) and missing roi to 50 (0.5)", () => {
    expect(taskStatMultiplier({})).toBeCloseTo(0.5);
  });

  it("streak bonus only applies to DAILY", () => {
    expect(streakMultiplier(10, "ONCE")).toBe(1.0);
    expect(streakMultiplier(3, "DAILY")).toBe(1.3);
    expect(streakMultiplier(7, "DAILY")).toBe(2.0);
  });

  it("constants kept at their prior values (centralization is value-preserving)", () => {
    expect(EFFORT_MULTIPLIER).toMatchObject({ M5: 0.6, M15: 0.8, M30: 1.0, H1: 1.3, H2PLUS: 1.6 });
    expect(GOAL_LINKED_MULTIPLIER).toBe(1.5);
    expect(CONFIDENCE.silentAttach).toBe(0.6);
  });
});
