import { describe, it, expect } from "vitest";
import {
  assessReelStructureNovelty,
  reelStructureFingerprint,
} from "../shared/reelStructureFingerprint";
import { buildApprovedPackBriefForTest } from "./services/approvedReelPackRotation";

const templated = () => reelStructureFingerprint({
  beats: [
    { startSecond: 0, endSecond: 4, visual: "Extreme macro of tire tread under shop light", motion: "slow push in", purpose: "hook", audioCue: "low shop ambience" },
    { startSecond: 4, endSecond: 8, visual: "Second macro angle of the same tire", motion: "lateral slide", purpose: "identify", audioCue: "dry mechanical click" },
    { startSecond: 8, endSecond: 12, visual: "Neutral side by side technical comparison", motion: "static", purpose: "compare", audioCue: "low shop ambience" },
    { startSecond: 12, endSecond: 16, visual: "Close inspection reveal", motion: "slow push in", purpose: "reveal", audioCue: "confirmation click" },
    { startSecond: 16, endSecond: 20, visual: "Return to opening tire macro", motion: "slow pull out", purpose: "loop", audioCue: "low shop ambience" },
  ],
  ctaType: "visit",
  loopIdea: "return to the opening frame",
});

describe("reel production-grammar fingerprint", () => {
  it("flags a production twin even when the mechanic topic would be completely different", () => {
    const a = templated();
    const b = templated();
    const verdict = assessReelStructureNovelty(a, [b]);
    expect(verdict.isProductionTwin).toBe(true);
    expect(verdict.similarity).toBeGreaterThanOrEqual(0.95);
    expect(verdict.collisions).toContain("visual_sequence");
    expect(verdict.collisions).toContain("motion_sequence");
  });

  it("does not confuse a short handheld diagnosis with the 20-second macro template", () => {
    const a = templated();
    const b = reelStructureFingerprint({
      beats: [
        { startSecond: 0, endSecond: 2, visual: "Wide shop bay with vehicle on lift", motion: "handheld", purpose: "hook", audioCue: "shop ambience" },
        { startSecond: 2, endSecond: 6, visual: "Mechanic hand points to cracked belt", motion: "handheld", purpose: "identify", audioCue: "mechanical ratchet" },
        { startSecond: 6, endSecond: 10, visual: "Close-up of crack while belt flexes", motion: "static", purpose: "reveal", audioCue: "silence" },
      ],
      ctaType: "save",
      loopIdea: null,
    });
    const verdict = assessReelStructureNovelty(a, [b]);
    expect(verdict.isProductionTwin).toBe(false);
    expect(verdict.similarity).toBeLessThan(0.82);
  });

  it("reports the nearest recent structure instead of a meaningless aggregate score", () => {
    const candidate = templated();
    const novel = reelStructureFingerprint({
      beats: [
        { startSecond: 0, endSecond: 3, visual: "Wide shop bay", motion: "handheld", purpose: "hook" },
        { startSecond: 3, endSecond: 8, visual: "Technician hand with gauge", motion: "static", purpose: "reveal" },
      ],
      ctaType: "none",
      loopIdea: null,
    });
    const verdict = assessReelStructureNovelty(candidate, [novel, templated()]);
    expect(verdict.isProductionTwin).toBe(true);
    expect(verdict.nearest?.signature).toBe(candidate.signature);
  });

  it("wires the novelty verdict into a real approved-pack production brief", () => {
    const brief = buildApprovedPackBriefForTest("2026-08-17-pothole-damage");
    expect(brief).not.toBeNull();
    const novelty = brief?.productionGrammarNovelty as {
      similarity?: number;
      isProductionTwin?: boolean;
      collisions?: string[];
      comparisonWindow?: number;
    };
    expect(novelty.comparisonWindow).toBeGreaterThan(0);
    expect(novelty.similarity).toBeGreaterThanOrEqual(0);
    expect(novelty.similarity).toBeLessThanOrEqual(1);
    expect(typeof novelty.isProductionTwin).toBe("boolean");
    expect(Array.isArray(novelty.collisions)).toBe(true);
  });
});
