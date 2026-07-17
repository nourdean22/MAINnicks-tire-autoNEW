import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_OBJECTIVES,
  TERRITORY_TO_REEL,
  creativeGenomeSchema,
  genomeFromCarouselBrief,
  genomeFromReelBrief,
  genomeToCarouselSeed,
  genomeToPhotoSeed,
  genomeToReelSeed,
  validateGenomeClaimSafety,
  type CreativeGenome,
} from "../client/src/lib/creativeGenome";
import { CREATIVE_TERRITORIES } from "../client/src/lib/igCarouselStudio";
import { MOTION_LENSES, REEL_ARCHETYPES } from "../client/src/lib/facelessReelStudio";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";

const GENOME: CreativeGenome = {
  version: 1,
  objective: "save",
  audienceMoment: "The driver hit a pothole on Euclid Ave and the steering wheel no longer sits straight.",
  driverTension: "They cannot tell whether it is harmless or the start of an expensive problem.",
  mechanicTruth: "A crooked wheel after an impact can point to tire, wheel, alignment or suspension damage; only an inspection can tell which.",
  proprietaryProof: ["NHTSA - Tires: tread depth and safety guidance"],
  emotionalTurn: "Recognition, then relief at a clear next step.",
  visualMetaphor: "The vehicle walking in one straight shoe and one crooked shoe.",
  creativeTerritory: "road_villain",
  clevelandAngle: "Pothole season on Cleveland's east side arterials.",
  nickSignature: "Road-survival intelligence without panic or sales pressure.",
  desiredAction: "Save this and have the vehicle inspected if the symptom persists.",
};

describe("creativeGenomeSchema", () => {
  it("accepts a complete genome", () => {
    expect(creativeGenomeSchema.parse(GENOME)).toEqual(GENOME);
  });
  it("rejects an unknown territory and a too-short mechanic truth", () => {
    expect(() => creativeGenomeSchema.parse({ ...GENOME, creativeTerritory: "vibes" })).toThrow();
    expect(() => creativeGenomeSchema.parse({ ...GENOME, mechanicTruth: "trust us" })).toThrow();
  });
  it("objective enum matches the published list", () => {
    expect(CAMPAIGN_OBJECTIVES).toContain("shop_visit");
    expect(() => creativeGenomeSchema.parse({ ...GENOME, objective: "virality" })).toThrow();
  });
});

describe("validateGenomeClaimSafety", () => {
  it("passes the clean genome", () => {
    expect(validateGenomeClaimSafety(GENOME)).toEqual([]);
  });
  it("flags guarantees and overdiagnosis wherever they hide", () => {
    const dirty = validateGenomeClaimSafety({
      ...GENOME,
      nickSignature: "We guarantee the straightest wheels in town.",
      mechanicTruth: "This means your strut is shot; you definitely need a replacement today.",
    });
    const rules = dirty.map((f) => f.rule).join(" ");
    expect(rules).toContain("forbidden-claim:no-guarantees");
    expect(rules).toContain("overdiagnosis");
    expect(dirty.map((f) => f.field)).toContain("nickSignature");
  });
});

describe("bridges from existing briefs", () => {
  it("maps a sample reel brief into genome space with proof labels", () => {
    const g = genomeFromReelBrief(SAMPLE_REEL_BRIEFS[0]);
    expect(creativeGenomeSchema.parse(g)).toBeTruthy();
    expect(g.audienceMoment).toBe(SAMPLE_REEL_BRIEFS[0].topic);
    expect(g.proprietaryProof.length).toBeGreaterThan(0); // samples carry proof notes
    expect(g.desiredAction).toContain(SAMPLE_REEL_BRIEFS[0].campaignKeyword);
  });
  it("maps a carousel brief and preserves its territory", () => {
    const g = genomeFromCarouselBrief({ topic: "Why winter kills batteries in Cleveland driveways", creativeTerritory: "warning_system", campaignKeyword: "BATTERY" });
    expect(g.creativeTerritory).toBe("warning_system");
    expect(creativeGenomeSchema.parse(g)).toBeTruthy();
  });
});

describe("seeds into today's generators", () => {
  it("TERRITORY_TO_REEL covers every territory with REAL lenses and archetypes", () => {
    expect(Object.keys(TERRITORY_TO_REEL).sort()).toEqual(Object.keys(CREATIVE_TERRITORIES).sort());
    for (const { motionLens, archetype } of Object.values(TERRITORY_TO_REEL)) {
      expect(MOTION_LENSES[motionLens]).toBeTruthy();
      expect(REEL_ARCHETYPES[archetype]).toBeTruthy();
    }
  });
  it("reel seed fits the wizard's 300-char budget and carries the truth + proof ask", () => {
    const seed = genomeToReelSeed(GENOME);
    expect(seed.topic.length).toBeLessThanOrEqual(300);
    expect(seed.topic).toContain("crooked wheel");
    expect(seed.topic).toContain("Proof: NHTSA");
    expect(seed.motionLens).toBe("hyperreal_cinematic");
    // No-proof genomes ask the model to attach one from the accepted families.
    const noProof = genomeToReelSeed({ ...GENOME, proprietaryProof: [] });
    expect(noProof.topic).toContain("PROOF source note");
  });
  it("carousel + photo seeds derive from the same genome", () => {
    expect(genomeToCarouselSeed(GENOME).creativeTerritory).toBe("road_villain");
    const photo = genomeToPhotoSeed(GENOME);
    expect(photo).toContain(GENOME.visualMetaphor);
    expect(photo).toContain("DO NOT INCLUDE:");
    expect(photo).toContain(CREATIVE_TERRITORIES.road_villain.grammar.slice(0, 30));
  });
});
