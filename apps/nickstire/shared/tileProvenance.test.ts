/**
 * Q-23 · the MEASURED / ESTIMATE / UNMEASURED fold over METRICS-CONTRACT.md evidence levels.
 */
import { describe, expect, it } from "vitest";

import { CANONICAL_METRICS } from "./metricsContract";
import { PROVENANCE_MEANING, provenanceOf } from "./tileProvenance";

describe("provenanceOf", () => {
  it("observed and verified are MEASURED", () => {
    expect(provenanceOf("observed")).toBe("MEASURED");
    expect(provenanceOf("verified")).toBe("MEASURED");
  });

  it("inferred and modeled are ESTIMATE, never MEASURED", () => {
    expect(provenanceOf("inferred")).toBe("ESTIMATE");
    expect(provenanceOf("modeled")).toBe("ESTIMATE");
  });

  // A failed read of the most trustworthy metric is still a failed read.
  it("an unavailable read is UNMEASURED at every evidence level", () => {
    for (const ev of ["observed", "verified", "inferred", "modeled"] as const) {
      expect(provenanceOf(ev, "unavailable")).toBe("UNMEASURED");
    }
  });

  // A partial count is a lower bound; calling it MEASURED overclaims.
  it("a partial read of a counted metric is an ESTIMATE", () => {
    expect(provenanceOf("verified", "partial")).toBe("ESTIMATE");
    expect(provenanceOf("observed", "partial")).toBe("ESTIMATE");
  });
});

