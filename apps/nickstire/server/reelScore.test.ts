/**
 * Distribution-score honesty pins: renormalized coverage, refusal below
 * MIN_COVERAGE, and no per-reach fabrication without reach.
 */
import { describe, expect, it } from "vitest";
import {
  computeReelDistributionScore,
  scoreFromAnalyticsRow,
  MIN_COVERAGE,
  REEL_SCORE_WEIGHTS,
} from "../shared/reelScore";

describe("computeReelDistributionScore", () => {
  it("weights sum to exactly 1", () => {
    const total = Object.values(REEL_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("full inputs at the ceilings score 100 with coverage 1", () => {
    const r = computeReelDistributionScore({
      watchPct: 0.9, sharesPerReach: 0.02, savesPerReach: 0.03,
      commentsPerReach: 0.01, followsPerReach: 0.005, intentPerReach: 0.01,
    });
    expect(r).toEqual({ score: 100, coverage: 1, missing: [] });
  });

  it("refuses to score when measured weight is below MIN_COVERAGE — one input is noise wearing a number", () => {
    const r = computeReelDistributionScore({
      watchPct: 0.5, sharesPerReach: null, savesPerReach: null,
      commentsPerReach: null, followsPerReach: null, intentPerReach: null,
    });
    // watchPct alone is 0.30 < MIN_COVERAGE
    expect(MIN_COVERAGE).toBeGreaterThan(0.3);
    expect(r).toBeNull();
  });

  it("renormalizes over the measured components and reports coverage + missing", () => {
    // shares+saves+comments = 0.55 coverage; all at half their ceilings → 50.
    const r = computeReelDistributionScore({
      watchPct: null, sharesPerReach: 0.01, savesPerReach: 0.015,
      commentsPerReach: 0.005, followsPerReach: null, intentPerReach: null,
    });
    expect(r).not.toBeNull();
    expect(r!.coverage).toBeCloseTo(0.55, 5);
    expect(r!.score).toBe(50);
    expect(r!.missing).toEqual(["watchPct", "followsPerReach", "intentPerReach"]);
  });

  it("clamps a component at its ceiling instead of letting one metric run the score", () => {
    const capped = computeReelDistributionScore({
      watchPct: null, sharesPerReach: 5, savesPerReach: 0,
      commentsPerReach: 0, followsPerReach: null, intentPerReach: null,
    });
    // shares maxed (0.25) over 0.55 coverage → 45 (not thousands).
    expect(capped!.score).toBe(45);
  });

  it("treats negative or non-finite inputs as missing, not as data", () => {
    const r = computeReelDistributionScore({
      watchPct: Number.NaN, sharesPerReach: -1, savesPerReach: null,
      commentsPerReach: null, followsPerReach: null, intentPerReach: null,
    });
    expect(r).toBeNull();
  });
});

describe("scoreFromAnalyticsRow", () => {
  it("returns null without reach — per-reach rates without reach are fabrication", () => {
    expect(scoreFromAnalyticsRow({ reach: null, saved: 10, shares: 5, comments: 2 })).toBeNull();
    expect(scoreFromAnalyticsRow({ reach: 0, saved: 10, shares: 5, comments: 2 })).toBeNull();
  });

  it("scores today's stored fields (saves/shares/comments per reach) at partial coverage", () => {
    const r = scoreFromAnalyticsRow({ reach: 1000, saved: 15, shares: 10, comments: 5 });
    expect(r).not.toBeNull();
    expect(r!.coverage).toBeCloseTo(0.55, 5);
    expect(r!.missing).toContain("watchPct");
    expect(r!.score).toBeGreaterThan(0);
    expect(r!.score).toBeLessThanOrEqual(100);
  });
});
