import { describe, expect, it } from "vitest";
import {
  EXPLORATION_EVERY_N_SELECTIONS,
  MIN_POSTS_PER_PATTERN,
  rankPatternsByDistribution,
  selectLearnedPattern,
} from "./reelStructureLearning";
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
      { patternId: "unknown", reach: null, saved: null, shares: null, skipRate: null },
    ]);
    expect(ranked).toEqual([]);
  });
});

describe("selectLearnedPattern", () => {
  it("stays on fair rotation before evidence is mature", () => {
    const evidence = rankPatternsByDistribution([
      ...rows("a", MIN_POSTS_PER_PATTERN, 0.08),
      ...rows("b", MIN_POSTS_PER_PATTERN, 0.01),
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
    expect(12 % EXPLORATION_EVERY_N_SELECTIONS).toBe(0);
    const decision = selectLearnedPattern(patterns, evidence);
    expect(decision.mode).toBe("learned_explore");
    expect(decision.pattern?.id).toBe("new");
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
