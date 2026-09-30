/**
 * Q-23 · the MEASURED / ESTIMATE / UNMEASURED fold over METRICS-CONTRACT.md evidence levels.
 */
import { describe, expect, it } from "vitest";

import { CANONICAL_METRICS } from "./metricsContract";
import { PROVENANCE_MEANING, metricProvenance, provenanceOf } from "./tileProvenance";

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

describe("metricProvenance", () => {
  it("reads the evidence level from the contract", () => {
    expect(metricProvenance("Estimated recovery opportunity")).toBe("ESTIMATE"); // modeled
    expect(metricProvenance("Abandoned calls")).toBe("ESTIMATE"); // inferred
    expect(metricProvenance("Paid call conversions")).toBe("MEASURED"); // verified
    expect(metricProvenance("Tool engagements")).toBe("MEASURED"); // observed
  });

  it("no modeled metric in the contract can ever be labelled MEASURED", () => {
    const modeled = CANONICAL_METRICS.filter((m) => m.evidence === "modeled");
    expect(modeled.length).toBeGreaterThan(0);
    for (const m of modeled) expect(metricProvenance(m.name)).toBe("ESTIMATE");
  });

  it("labels every canonical metric with one of the three words", () => {
    for (const m of CANONICAL_METRICS) {
      expect(Object.keys(PROVENANCE_MEANING)).toContain(metricProvenance(m.name));
    }
  });

  // An invented synonym must fail loudly, not silently pick a label (ROS-003).
  it("throws on a name the contract does not carry", () => {
    expect(() => metricProvenance("Conversions")).toThrow(/not in CANONICAL_METRICS/);
  });
});
