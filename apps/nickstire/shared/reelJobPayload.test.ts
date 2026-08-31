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
      productionSlot: "morning",
      approvedProductionPack: { packId: "2026-08-16-wheel-bearing-hum", contentSha256: "a".repeat(64) },
    });
    const v = parseReelJobPayload(payload);
    expect(v.topic).toBe("bald tires");
    expect(v.storyboardBeats?.[0].beatNumber).toBe(1);
    expect(v.episodeContract?.script?.ctaType).toBe("SEND");
    expect(v.episodeContract?.evidence?.[0].entailment).toBe("supported");
    expect(v.approvedPackSlug).toBe("2026-08-16-wheel-bearing-hum");
    expect(v.productionSlot).toBe("morning");
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
