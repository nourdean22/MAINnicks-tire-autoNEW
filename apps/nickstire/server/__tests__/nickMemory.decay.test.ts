/**
 * Regression tests for the nickMemory decay math (PR review of the self-improving
 * loop). The bug: memories froze at exactly 0.30 and never reached the <0.15 prune
 * floor, so decayMemories never pruned anything. These lock the corrected curve +
 * the preference-protection.
 */
import { describe, it, expect } from "vitest";
import { decayedConfidence, isPrunableMemory, applyReinforcement } from "../services/nickMemory";

const DAY = 24 * 60 * 60 * 1000;
const MONTH = 30 * DAY;

describe("nickMemory decay math", () => {
  describe("decayedConfidence", () => {
    it("does not decay within the first 30 days", () => {
      expect(decayedConfidence(0.85, 0)).toBe(0.85);
      expect(decayedConfidence(0.85, MONTH)).toBe(0.85);
    });

    it("decays 0.05 per 30-day step", () => {
      expect(decayedConfidence(0.85, MONTH + DAY)).toBe(0.8);
      expect(decayedConfidence(0.85, 2 * MONTH + DAY)).toBe(0.75);
    });

    it("REGRESSION: decays PAST 0.30 instead of freezing there (the plateau bug)", () => {
      // 11 steps from 0.85 lands on 0.30 — the old guard froze it here forever.
      expect(decayedConfidence(0.85, 11 * MONTH + DAY)).toBe(0.3);
      // 12+ steps must keep going below 0.30 so the prune floor is reachable.
      expect(decayedConfidence(0.85, 12 * MONTH + DAY)).toBe(0.25);
      expect(decayedConfidence(0.85, 13 * MONTH + DAY)).toBeLessThan(0.3);
    });

    it("floors at 0.10 and never returns a float-drift value", () => {
      expect(decayedConfidence(0.85, 99 * MONTH)).toBe(0.1);
      // 0.85 - 0.55 must be exactly 0.30, not 0.30000000000000004
      expect(decayedConfidence(0.85, 11 * MONTH + DAY)).toBe(0.3);
    });

    it("lower-confidence rows (0.6 lessons also plateaued at 0.30 before) decay past it too", () => {
      expect(decayedConfidence(0.6, 6 * MONTH + DAY)).toBe(0.3);
      expect(decayedConfidence(0.6, 7 * MONTH + DAY)).toBe(0.25);
    });
  });

  describe("isPrunableMemory", () => {
    it("prunes a decayed, stale non-preference memory", () => {
      expect(isPrunableMemory("insight", 0.1, 4 * MONTH)).toBe(true);
    });
    it("never prunes above the 0.15 floor", () => {
      expect(isPrunableMemory("insight", 0.3, 12 * MONTH)).toBe(false);
    });
    it("never prunes before 90 days, even if low", () => {
      expect(isPrunableMemory("lesson", 0.1, 2 * MONTH)).toBe(false);
    });
    it("NEVER prunes an operator preference, however stale", () => {
      expect(isPrunableMemory("preference", 0.1, 99 * MONTH)).toBe(false);
    });
  });

  describe("applyReinforcement × decay (the sterile-loop regression)", () => {
    it("reinforcement raises the decay BASELINE, not just confidence", () => {
      const data = applyReinforcement(
        { uses: 3, confidence: 0.5, originalConfidence: 0.5 },
        "2026-07-11T00:00:00.000Z",
      );
      expect(data.confidence).toBe(0.55);
      expect(data.originalConfidence).toBe(0.55); // baseline moved
      expect(data.uses).toBe(4);
      expect(data.lastReinforced).toBe("2026-07-11T00:00:00.000Z");
    });

    it("REGRESSION: a decay cycle right after reinforcement keeps the gain", () => {
      // Pre-fix: originalConfidence stayed 0.5, so decayMemories computed
      // target = decayedConfidence(0.5, <30d) = 0.5 and RESET the 0.55 —
      // every reinforcement was erased within ~2h, lessons never durably
      // climbed to the 0.65 injection bar.
      const data = applyReinforcement({ uses: 1, confidence: 0.5, originalConfidence: 0.5 });
      const target = decayedConfidence(data.originalConfidence!, DAY); // fresh age post-reinforce
      expect(target).toBe(0.55); // decays FROM the reinforced value
    });

    it("repeated reinforcement compounds toward the 0.65 injection bar", () => {
      let data: Record<string, unknown> & { confidence?: number; originalConfidence?: number } =
        { uses: 1, confidence: 0.5, originalConfidence: 0.5 };
      for (let i = 0; i < 3; i++) data = applyReinforcement(data);
      expect(data.confidence).toBe(0.65);
      expect(data.originalConfidence).toBe(0.65);
    });

    it("caps at 1.0", () => {
      const data = applyReinforcement({ confidence: 0.98 });
      expect(data.confidence).toBe(1.0);
      expect(data.originalConfidence).toBe(1.0);
    });
  });
});
