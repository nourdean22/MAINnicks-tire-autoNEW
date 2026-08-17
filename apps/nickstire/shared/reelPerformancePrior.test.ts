/**
 * The ranker must prefer DISTRIBUTION over reaction, and must never treat
 * "Instagram reported nothing" as "performed badly".
 */
import { describe, it, expect } from "vitest";
import {
  rankThemesByDistribution,
  scorePost,
  MIN_POSTS_PER_THEME,
} from "./reelPerformancePrior";

describe("scorePost", () => {
  it("returns null when no usable metric was reported — not a zero", () => {
    expect(scorePost({ themes: ["brakes"], reach: 1000 })).toBeNull();
    expect(scorePost({ themes: ["brakes"] })).toBeNull();
  });

  it("re-weights over present metrics so a missing one is not a penalty", () => {
    // Identical saves rate; one post also has retention data. The one WITHOUT
    // watch-time must not score lower for the absence.
    const withoutRetention = scorePost({ themes: ["a"], reach: 1000, saved: 50, shares: 20 })!;
    const withBadRetention = scorePost({ themes: ["a"], reach: 1000, saved: 50, shares: 20, skipRate: 0.9 })!;
    expect(withoutRetention.score).toBeGreaterThan(withBadRetention.score);
    expect(withoutRetention.basis).toEqual(["saves", "shares"]);
  });

  it("treats skipRate as inverted — lower skip is better", () => {
    const kept = scorePost({ themes: ["a"], reach: 1000, saved: 10, skipRate: 0.1 })!;
    const skipped = scorePost({ themes: ["a"], reach: 1000, saved: 10, skipRate: 0.9 })!;
    expect(kept.score).toBeGreaterThan(skipped.score);
  });

  it("caps a viral outlier so it cannot swamp the mean", () => {
    const strong = scorePost({ themes: ["a"], reach: 100, saved: 10 })!;   // 10% — the ceiling
    const absurd = scorePost({ themes: ["a"], reach: 100, saved: 90 })!;   // 90%
    expect(absurd.score).toBeCloseTo(strong.score, 5);
  });
});

describe("rankThemesByDistribution", () => {
  const post = (themes: string[], saved: number, shares = 0) => ({
    themes, reach: 1000, saved, shares,
  });

  it("ranks the theme that earned saves above the one that earned none", () => {
    const ranked = rankThemesByDistribution([
      post(["brake-noise"], 60),
      post(["brake-noise"], 55),
      post(["shop-selfie"], 1),
      post(["shop-selfie"], 2),
    ]);
    expect(ranked[0].theme).toBe("brake-noise");
    expect(ranked.map((r) => r.theme)).toContain("shop-selfie");
  });

  it("DROPS a theme with too few posts rather than ranking it low", () => {
    const ranked = rankThemesByDistribution([
      post(["one-hit-wonder"], 99),          // 1 post, spectacular
      post(["steady"], 40), post(["steady"], 40),
    ]);
    expect(MIN_POSTS_PER_THEME).toBe(2);
    expect(ranked.map((r) => r.theme)).not.toContain("one-hit-wonder");
    expect(ranked[0].theme).toBe("steady");
  });

  it("reports which metrics backed the score, so provenance is never assumed", () => {
    const ranked = rankThemesByDistribution([
      { themes: ["t"], reach: 1000, saved: 30, skipRate: 0.2 },
      { themes: ["t"], reach: 1000, saved: 30, skipRate: 0.2 },
    ]);
    expect(ranked[0].basis).toContain("saves");
    expect(ranked[0].basis).toContain("retention");
    expect(ranked[0].basis).not.toContain("shares");
  });

  it("ignores the no-caption sentinel and blank themes", () => {
    const ranked = rankThemesByDistribution([
      post(["no-caption", "  ", "real"], 40),
      post(["no-caption", "real"], 40),
    ]);
    expect(ranked.map((r) => r.theme)).toEqual(["real"]);
  });

  it("returns nothing when every post lacks usable metrics — degrades, not fabricates", () => {
    expect(rankThemesByDistribution([{ themes: ["a"] }, { themes: ["a"] }])).toEqual([]);
  });
});
