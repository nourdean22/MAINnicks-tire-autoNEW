/**
 * Pins Nick's measured baseline and the scoring that uses it.
 *
 * The four published ratios are re-derived from the raw counts here, so a typo
 * in either the counts or the ratios shows up as a failing test rather than as
 * a confident wrong number in a report.
 */
import { describe, it, expect } from "vitest";
import { BASELINE, baselineRates, TARGETS, scoreAgainstBaseline } from "../../shared/reelBaseline";

describe("baseline ratios recompute from the raw counts", () => {
  it("interaction rate is 0.99%", () => {
    expect(baselineRates.interactionRate.pct).toBeCloseTo(0.99, 2);
  });
  it("profile-visit rate is 0.53%", () => {
    expect(baselineRates.profileVisitRate.pct).toBeCloseTo(0.53, 2);
  });
  it("unique-engaged rate is 1.07%", () => {
    expect(baselineRates.uniqueEngagedRate.pct).toBeCloseTo(1.07, 2);
  });
  it("the raw counts are the ones measured on 2026-08-28", () => {
    expect(BASELINE.views).toBe(13871);
    expect(BASELINE.interactions).toBe(137);
    expect(BASELINE.profileVisits).toBe(74);
    expect(BASELINE.websiteTaps).toBe(1);
    expect(BASELINE.postsTotal).toBe(630);
    expect(BASELINE.nonFollowerReachPct).toBe(70.5);
  });
});

describe("scoreAgainstBaseline", () => {
  // A post performing exactly at his current baseline is NOT progress.
  it("a baseline-equivalent post scores at-or-below-baseline", () => {
    const { verdicts } = scoreAgainstBaseline({ views: 13871, interactions: 137, profileVisits: 74 });
    expect(verdicts.every((v) => v.verdict === "at-or-below-baseline")).toBe(true);
  });

  // POSITIVE CONTROL: a genuinely better post must register as better.
  it("a post beating the targets scores above-target", () => {
    const { verdicts } = scoreAgainstBaseline({ views: 1000, interactions: 40, profileVisits: 30 });
    expect(verdicts.find((v) => v.metric === "interactionRate")?.verdict).toBe("above-target");
    expect(verdicts.find((v) => v.metric === "profileVisitRate")?.verdict).toBe("above-target");
  });

  it("a post between baseline and target is distinguished from both", () => {
    // 2% interactions: above the 0.99% baseline, below the 3% target.
    const { verdicts } = scoreAgainstBaseline({ views: 1000, interactions: 20, profileVisits: 5 });
    expect(verdicts.find((v) => v.metric === "interactionRate")?.verdict).toBe("above-baseline");
  });

  // Reach is the part that already works; trading it away is a regression even
  // if engagement improves.
  it("flags a reach-floor breach even when engagement is strong", () => {
    const r = scoreAgainstBaseline({ views: 1000, interactions: 50, profileVisits: 40, nonFollowerReachPct: 40 });
    expect(r.reachFloorBreached).toBe(true);
    expect(r.verdicts.find((v) => v.metric === "interactionRate")?.verdict).toBe("above-target");
  });

  it("does not flag a breach when reach holds at the floor", () => {
    expect(scoreAgainstBaseline({ views: 1000, interactions: 10, profileVisits: 5, nonFollowerReachPct: 70.5 }).reachFloorBreached).toBe(false);
  });

  it("targets are multiples of the baseline, not blog medians", () => {
    expect(TARGETS.interactionRatePct).toBeGreaterThan(baselineRates.interactionRate.pct * 2);
    expect(TARGETS.profileVisitRatePct).toBeGreaterThan(baselineRates.profileVisitRate.pct * 2);
  });
});

describe("every rate travels with its sample size", () => {
  it("each rate exposes numerator, denominator and a pasteable basis", () => {
    for (const [name, r] of Object.entries(baselineRates)) {
      expect(r.denominator, name).toBeGreaterThan(0);
      expect(r.numerator, name).toBeGreaterThanOrEqual(0);
      expect(r.basis, name).toMatch(/\d.*\/.*\d/);
    }
  });

  it("the basis strings name the real denominators", () => {
    expect(baselineRates.interactionRate.basis).toBe("137 interactions / 13,871 views");
    expect(baselineRates.uniqueEngagedRate.basis).toBe("35 unique accounts / 3,269 followers");
  });

  // The one-tap number: 1 website tap in 13,871 views is the whole finding.
  it("website-tap rate is carried explicitly with its denominator", () => {
    expect(baselineRates.websiteTapRate.numerator).toBe(1);
    expect(baselineRates.websiteTapRate.denominator).toBe(13871);
    expect(baselineRates.websiteTapRate.pct).toBeLessThan(0.01);
  });
});
