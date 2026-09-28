import { describe, expect, it } from "vitest";
import { HOUSE_REEL_PATTERN_SEEDS } from "./reelPatternSeeds";

describe("HOUSE_REEL_PATTERN_SEEDS", () => {
  it("defines four stable, explicitly unmeasured house hypotheses", () => {
    expect(HOUSE_REEL_PATTERN_SEEDS).toHaveLength(4);
    expect(new Set(HOUSE_REEL_PATTERN_SEEDS.map((p) => p.id)).size).toBe(4);
    expect(new Set(HOUSE_REEL_PATTERN_SEEDS.map((p) => p.hookType)).size).toBe(4);
    expect(new Set(HOUSE_REEL_PATTERN_SEEDS.map((p) => p.loopType)).size).toBe(4);

    for (const p of HOUSE_REEL_PATTERN_SEEDS) {
      expect(p.id).toMatch(/^rp_house_/);
      expect(p.sourceLabel).toMatch(/house hypothesis · unmeasured bootstrap/i);
      expect(p.sourceUrl).toBeUndefined();
      expect(p.nickAdaptation.length).toBeGreaterThanOrEqual(10);
      expect(p.shareTrigger.length).toBeGreaterThan(0);
      expect(p.saveTrigger.length).toBeGreaterThan(0);
      expect(p.pacing.totalSeconds).toBeGreaterThanOrEqual(3);
      expect(p.pacing.totalSeconds).toBeLessThanOrEqual(90);
      expect(p.pacing.beatCount).toBeGreaterThanOrEqual(1);
      expect(p.captionStyle.wordsPerBeat).toBeGreaterThanOrEqual(1);
      expect(p.captionStyle.wordsPerBeat).toBeLessThanOrEqual(12);
    }
  });

  it("contains the useful-absurdity hypothesis without representing it as observed evidence", () => {
    const absurd = HOUSE_REEL_PATTERN_SEEDS.find((p) => p.id === "rp_house_useful_absurdity");
    expect(absurd).toBeDefined();
    expect(absurd?.hookType).toBe("impossible_object");
    expect(absurd?.nickAdaptation).toMatch(/real mechanic truth/i);
    expect(absurd?.nickAdaptation).toMatch(/not as a fabricated claim/i);
    expect(absurd?.sourceLabel).toMatch(/unmeasured/i);
  });
});
