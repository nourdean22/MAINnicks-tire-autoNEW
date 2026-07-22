/**
 * Closed-loop Experiment factory — the two correctness-critical pure functions:
 *  - nudgeAuthScore: the bounded, reversible, damped feedback step (write path)
 *  - applyAuthTrust: the bounded teeth that fold learned trust into priority (read path)
 *
 * These lock the safety properties the adversarial review demanded: no runaway, no
 * absorbing state, always in [0,100].
 */
import { describe, it, expect } from "vitest";
import { nudgeAuthScore } from "@/lib/intelligence/experiment-measure";
import { applyAuthTrust } from "@/lib/intelligence/scoring";

describe("nudgeAuthScore · bounded reversible EWMA feedback", () => {
  it("held_up (+1) pulls toward 100, failed (-1) pulls toward 0", () => {
    expect(nudgeAuthScore(70, 1)).toBe(72.4); // 70 + 0.08*(100-70)
    expect(nudgeAuthScore(70, -1)).toBe(64.4); // 70 + 0.08*(0-70)
    expect(nudgeAuthScore(70, 1)).toBeGreaterThan(70);
    expect(nudgeAuthScore(70, -1)).toBeLessThan(70);
  });

  it("stays within [0,100] at and past the extremes", () => {
    expect(nudgeAuthScore(0, 1)).toBe(8);
    expect(nudgeAuthScore(0, -1)).toBe(0); // no absorbing overshoot below 0
    expect(nudgeAuthScore(100, -1)).toBe(92);
    expect(nudgeAuthScore(100, 1)).toBe(100); // no overshoot above 100
    for (const start of [0, 12.5, 50, 70, 87.3, 100]) {
      for (const r of [1, -1] as const) {
        const out = nudgeAuthScore(start, r);
        expect(out).toBeGreaterThanOrEqual(0);
        expect(out).toBeLessThanOrEqual(100);
      }
    }
  });

  it("a single outcome moves the score by at most 8 points (damping)", () => {
    for (const start of [0, 25, 50, 70, 100]) {
      expect(Math.abs(nudgeAuthScore(start, 1) - start)).toBeLessThanOrEqual(8);
      expect(Math.abs(nudgeAuthScore(start, -1) - start)).toBeLessThanOrEqual(8);
    }
  });

  it("is reversible — no terminal state; a bad step is recovered by a later good one", () => {
    const start = 70;
    const afterFail = nudgeAuthScore(start, -1);
    const recovered = nudgeAuthScore(afterFail, 1);
    expect(afterFail).toBeLessThan(start); // went down
    expect(recovered).toBeGreaterThan(afterFail); // came back up
    expect(recovered).toBeLessThanOrEqual(100);
    // Repeated held_up from the floor climbs back toward the ceiling (recovers fully).
    let v = 0;
    for (let i = 0; i < 100; i++) v = nudgeAuthScore(v, 1);
    expect(v).toBeGreaterThan(95);
  });
});

describe("applyAuthTrust · bounded teeth (learned trust -> priority)", () => {
  it("maps authScore to a ±10% factor", () => {
    expect(applyAuthTrust(50, 100)).toBe(55); // 1.1x
    expect(applyAuthTrust(50, 0)).toBe(45); // 0.9x
    expect(applyAuthTrust(50, 70)).toBe(52); // 1.04x
    expect(applyAuthTrust(50, 100)).toBeGreaterThan(applyAuthTrust(50, 0));
  });

  it("caps at [0,100] even when the boost would overflow", () => {
    expect(applyAuthTrust(95, 100)).toBe(100); // 104.5 -> capped
    expect(applyAuthTrust(0, 100)).toBe(0);
    expect(applyAuthTrust(100, 0)).toBe(90);
  });

  it("clamps out-of-range authScore before applying", () => {
    expect(applyAuthTrust(50, -20)).toBe(45); // treated as 0 -> 0.9x
    expect(applyAuthTrust(50, 200)).toBe(55); // treated as 100 -> 1.1x
  });
});
