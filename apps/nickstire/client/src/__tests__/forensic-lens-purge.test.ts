/**
 * The forensic_evidence_scan motion lens is retired from client choice and
 * sample code. The type member and its style entries stay so old jobs still
 * parse and render; this test only guards the choice mapping and the samples.
 */
import { describe, it, expect } from "vitest";
import { TERRITORY_TO_REEL } from "../lib/creativeGenome";
import { SAMPLE_REEL_BRIEFS } from "../lib/facelessReelStudioSamples";

describe("forensic_evidence_scan purged from client choice and samples", () => {
  it("no creative territory maps to the forensic lens", () => {
    const lenses = Object.values(TERRITORY_TO_REEL).map((entry) => entry.motionLens);
    expect(lenses).not.toContain("forensic_evidence_scan");
  });

  it("no sample reel brief uses the forensic lens", () => {
    expect(JSON.stringify(SAMPLE_REEL_BRIEFS)).not.toContain("forensic_evidence_scan");
  });
});
