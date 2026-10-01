import { describe, expect, it } from "vitest";
import {
  rankPatternsByDistribution,
  scoreForObjective,
  selectLearnedPattern,
} from "./reelStructureLearning";
import { scorePost } from "./reelPerformancePrior";
import type { RotatablePattern } from "./reelStructureRotation";

const p = (id: string, timesUsed = 0): RotatablePattern => ({
  id,
  label: id,
  hookType: id,
  loopType: "hard_cut",
  timesUsed,
  lastUsedAt: timesUsed ? new Date(timesUsed * 1000) : null,
});

const rows = (patternId: string, n: number, saveRate: number) =>
  Array.from({ length: n }, (_, i) => ({
    patternId,
    themes: [],
    reach: 1000,
    saved: Math.round(1000 * saveRate),
    shares: Math.round(1000 * saveRate / 2),
    skipRate: 0.4,
    views: 1200 + i,
  }));

describe("rankPatternsByDistribution", () => {
  it("ranks measured structures using the existing distribution scorer", () => {
    const ranked = rankPatternsByDistribution([
      ...rows("strong", 6, 0.08),
      ...rows("weak", 6, 0.01),
    ]);
    expect(ranked[0].patternId).toBe("strong");
    expect(ranked[0].posts).toBe(6);
    expect(ranked[0].basis).toContain("saves");
  });

  it("does not fabricate zeroes for missing Instagram metrics", () => {
    const ranked = rankPatternsByDistribution([
      { patternId: "unknown", themes: [], reach: null, saved: null, shares: null, skipRate: null },
    ]);
    expect(ranked).toEqual([]);
  });
});

describe("selectLearnedPattern", () => {
  it("stays on fair rotation before evidence is mature", () => {
    const evidence = rankPatternsByDistribution([
      ...rows("a", 3, 0.08),
      ...rows("b", 3, 0.01),
    ]);
    const decision = selectLearnedPattern([p("a", 4), p("b", 1)], evidence);
    expect(decision.mode).toBe("rotation");
    expect(decision.pattern?.id).toBe("b");
  });

  it("exploits the best proven structure once the cohort is large enough", () => {
    const evidence = rankPatternsByDistribution([
      ...rows("a", 6, 0.08),
      ...rows("b", 6, 0.01),
    ]);
    // totalUses=13 -> not the deterministic exploration turn
    const decision = selectLearnedPattern([p("a", 8), p("b", 5)], evidence);
    expect(decision.mode).toBe("learned_exploit");
    expect(decision.pattern?.id).toBe("a");
  });

  it("reserves deterministic exploration for an under-sampled challenger", () => {
    const evidence = rankPatternsByDistribution([
      ...rows("a", 6, 0.08),
      ...rows("b", 6, 0.01),
    ]);
    const patterns = [p("a", 8), p("b", 4), p("new", 0)];
    // totalUses=12 -> exploration turn when modulus is 4.
    expect(12 % 4).toBe(0);
    const decision = selectLearnedPattern(patterns, evidence);
    expect(decision.mode).toBe("learned_explore");
    expect(decision.pattern?.id).toBe("new");
  });

  it("keeps an exploration floor even after every active pattern is proven", () => {
    const evidence = rankPatternsByDistribution([
      ...rows("a", 6, 0.08),
      ...rows("b", 6, 0.01),
    ]);
    const decision = selectLearnedPattern([p("a", 8), p("b", 4)], evidence);
    expect(decision.mode).toBe("learned_explore");
    expect(decision.pattern?.id).toBe("b");
  });

  it("does not let retired-pattern history satisfy the active-pool sample threshold", () => {
    const evidence = rankPatternsByDistribution([
      ...rows("a", 3, 0.08),
      ...rows("b", 3, 0.01),
      ...rows("retired", 20, 0.2),
    ]);
    const decision = selectLearnedPattern([p("a", 4), p("b", 1)], evidence);
    expect(decision.mode).toBe("rotation");
    expect(decision.pattern?.id).toBe("b");
  });

  it("never violates a hook-type exclusion just because the top scorer won", () => {
    const evidence = rankPatternsByDistribution([
      ...rows("a", 6, 0.08),
      ...rows("b", 6, 0.01),
    ]);
    const decision = selectLearnedPattern(
      [p("a", 8), p("b", 5)],
      evidence,
      { excludeHookTypes: ["a"] },
    );
    expect(decision.pattern?.id).toBe("b");
  });
});

describe("scoreForObjective (Pattern Lab 2.0)", () => {
  // Two structures, same metrics in both runs. "keeper" saves hard and gets
  // skipped; "hooker" holds viewers and gets sent on but is rarely saved.
  const keeper = { patternId: "keeper", themes: [], reach: 1000, saved: 80, shares: 10, skipRate: 0.8, avgWatchTimeMs: 3000, comments: 2 };
  const hooker = { patternId: "hooker", themes: [], reach: 1000, saved: 5, shares: 60, skipRate: 0.3, avgWatchTimeMs: 12000, comments: 40 };
  const corpus = [keeper, keeper, keeper, hooker, hooker, hooker];

  it("ranks the same metrics differently under two objectives", () => {
    const reference = rankPatternsByDistribution(corpus, "reference").map((r) => r.patternId);
    const discovery = rankPatternsByDistribution(corpus, "discovery").map((r) => r.patternId);
    expect(reference).toEqual(["keeper", "hooker"]);
    expect(discovery).toEqual(["hooker", "keeper"]);
    const conversation = rankPatternsByDistribution(corpus, "conversation").map((r) => r.patternId);
    expect(conversation).toEqual(["hooker", "keeper"]);
  });

  it("blended is the default and is byte-identical to the pre-objective score", () => {
    const explicit = rankPatternsByDistribution(corpus, "blended");
    const implicit = rankPatternsByDistribution(corpus);
    expect(explicit).toEqual(implicit);
    for (const row of corpus) {
      expect(scoreForObjective(row, "blended")).toEqual(scorePost(row));
    }
  });

  it("conversion is UNKNOWN (null, empty ranking) when no profile/site actions were reported", () => {
    expect(scoreForObjective(keeper, "conversion")).toBeNull();
    expect(rankPatternsByDistribution(corpus, "conversion")).toEqual([]);
    const withActions = { ...hooker, profileVisits: 30 };
    expect(scoreForObjective(withActions, "conversion")).toEqual({ score: 0.6, basis: ["profile_visits"] });
  });

  it("discovery uses watch ratio only when the reel's own length is known, and never fabricates a term", () => {
    const noLength = scoreForObjective(hooker, "discovery");
    expect(noLength?.basis).toEqual(["retention", "shares"]);
    const withLength = scoreForObjective({ ...hooker, durationSeconds: 24 }, "discovery");
    expect(withLength?.basis).toEqual(["retention", "watch_ratio", "shares"]);
    expect(withLength!.score).toBeCloseTo((0.7 * 0.4 + 0.5 * 0.2 + 0.6 * 0.4) / 1.0, 6);
    expect(scoreForObjective({ patternId: "x", themes: [], reach: null, saved: null, shares: null, skipRate: null }, "discovery")).toBeNull();
  });

  it("floors and exploration cadence are untouched by an objective", () => {
    // Same proven-cohort fixture as above, scored under "reference": the 1-in-4
    // exploration turn still fires and the 3-post / 12-post floors still hold.
    const evidence = rankPatternsByDistribution([...rows("a", 6, 0.08), ...rows("b", 6, 0.01)], "reference");
    expect(selectLearnedPattern([p("a", 8), p("b", 4)], evidence).mode).toBe("learned_explore");
    const thin = rankPatternsByDistribution([...rows("a", 3, 0.08), ...rows("b", 3, 0.01)], "reference");
    expect(selectLearnedPattern([p("a", 4), p("b", 1)], thin).mode).toBe("rotation");
  });
});
