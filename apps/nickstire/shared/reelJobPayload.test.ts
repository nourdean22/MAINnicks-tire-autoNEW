/**
 * parseReelJobPayload — the one canonical reader for reel_jobs.payload,
 * added post-merge (2026-08-13) to replace five mutually-inconsistent
 * ad-hoc inline types the audit found scattered across this run's new code.
 */
import { describe, it, expect } from "vitest";
import { parseReelJobPayload } from "./reelJobPayload";

describe("parseReelJobPayload", () => {
  it("parses a real payload shape into its typed fields", () => {
    const payload = JSON.stringify({
      topic: "bald tires",
      archetype: "proof",
      objectCharacter: "tire",
      mechanicTruth: "tread depth matters",
      clevelandAngle: "Euclid winters",
      storyboardBeats: [{ beatNumber: 1, visual: "a tire", motion: "", onScreenText: "text" }],
      episodeContract: { script: { ctaType: "SEND", voiceover: "hello" }, evidence: [{ entailment: "supported" }] },
      approvedPackSlug: "2026-08-16-wheel-bearing-hum",
      approvedPackPool: "active_slate",
      approvedPackSlateRevision: "2026-09-27T20:00:00.000Z",
      productionSlot: "morning",
      productionGrammarFingerprint: { durationBucket: "20s", beatCount: 5, purposeFamilies: [], visualFamilies: [], motionFamilies: [], audioFamilies: [], ctaType: "visit", loopType: "visual", signature: "sig" },
      productionGrammarNovelty: { similarity: 0.88, isProductionTwin: true, collisions: ["visual_sequence"], nearestSignature: "prior", comparisonWindow: 12 },
      approvedProductionPack: { packId: "2026-08-16-wheel-bearing-hum", contentSha256: "a".repeat(64) },
    });
    const v = parseReelJobPayload(payload);
    expect(v.topic).toBe("bald tires");
    expect(v.storyboardBeats?.[0].beatNumber).toBe(1);
    expect(v.episodeContract?.script?.ctaType).toBe("SEND");
    expect(v.episodeContract?.evidence?.[0].entailment).toBe("supported");
    expect(v.approvedPackSlug).toBe("2026-08-16-wheel-bearing-hum");
    expect(v.approvedPackPool).toBe("active_slate");
    expect(v.approvedPackSlateRevision).toBe("2026-09-27T20:00:00.000Z");
    expect(v.productionSlot).toBe("morning");
    expect(v.productionGrammarNovelty?.isProductionTwin).toBe(true);
    expect(v.productionGrammarNovelty?.nearestSignature).toBe("prior");
    expect(v.approvedProductionPack?.packId).toBe("2026-08-16-wheel-bearing-hum");
  });

  it("never throws on unparsable JSON — returns an empty view", () => {
    expect(parseReelJobPayload("{truncated")).toEqual({});
  });

  it("null/undefined/empty payload returns an empty view without attempting to parse", () => {
    expect(parseReelJobPayload(null)).toEqual({});
    expect(parseReelJobPayload(undefined)).toEqual({});
    expect(parseReelJobPayload("")).toEqual({});
  });
});
