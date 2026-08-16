/**
 * Evidence sufficiency — the gate that replaces "did the operator type anything".
 *
 * These assert the MECHANISM, not merely that the function runs: each case pins
 * a specific rule that, if inverted, would let generic generation through.
 */
import { describe, expect, it } from "vitest";
import {
  assessEvidence,
  evidenceDirective,
  QUOTE_MIN_CHARS,
  OPERATOR_SUBSTANCE_MIN_CHARS,
  type EvidenceFact,
} from "../shared/evidenceSufficiency";

const fact = (over: Partial<EvidenceFact>): EvidenceFact => ({
  key: "k",
  label: "Label",
  value: "value",
  role: "context",
  basis: "recorded",
  ...over,
});

const LONG_QUOTE =
  "Mike showed me exactly why the tire could not be safely patched and walked me through it";

describe("a real quote outranks field count", () => {
  it("ONE recorded quote is sufficient — the anti-'three fields' rule", () => {
    const res = assessEvidence([
      fact({ key: "review_quote", label: "Review quote", value: LONG_QUOTE, role: "quote" }),
    ]);
    expect(res.sufficiency).toBe("sufficient");
    expect(res.groundingScore).toBe(10);
  });

  it("THREE weak context fields are NOT sufficient, though they outnumber the quote", () => {
    const res = assessEvidence([
      fact({ key: "a", value: "tires" }),
      fact({ key: "b", value: "winter" }),
      fact({ key: "c", value: "cleveland" }),
    ]);
    expect(res.sufficiency).not.toBe("sufficient");
  });

  it("a quote one character under the floor is a fragment, not a story", () => {
    const short = "x".repeat(QUOTE_MIN_CHARS - 1);
    const res = assessEvidence([fact({ key: "q", value: short, role: "quote" })]);
    expect(res.sufficiency).not.toBe("sufficient");
  });
});

describe("anchor + when/how-much reaches sufficiency", () => {
  it("vehicle + date is sufficient", () => {
    const res = assessEvidence([
      fact({ key: "vehicle", value: "2018 Ford Escape", role: "anchor" }),
      fact({ key: "declined_at", value: "2026-03-04", role: "temporal" }),
    ]);
    expect(res.sufficiency).toBe("sufficient");
  });

  it("an anchor ALONE is only thin, and names what is missing", () => {
    const res = assessEvidence([
      fact({ key: "vehicle", value: "2018 Ford Escape", role: "anchor" }),
    ]);
    expect(res.sufficiency).toBe("thin");
    expect(res.missing.join(" ")).toMatch(/date|figure/i);
  });
});

describe("basis is enforced independently of role — the fabrication guard", () => {
  it("INFERRED anchor + date can never be sufficient (an unmatched estimate is not a refusal)", () => {
    const res = assessEvidence([
      fact({ key: "declined_service", value: "front pads and rotors", role: "anchor", basis: "inferred" }),
      fact({ key: "estimate_date", value: "2026-03-04", role: "temporal", basis: "inferred" }),
    ]);
    expect(res.sufficiency).toBe("thin");
    expect(res.inferredKeys).toEqual(["declined_service", "estimate_date"]);
  });

  it("an OPERATOR-typed quote cannot launder itself into sufficiency", () => {
    const res = assessEvidence([
      fact({ key: "q", value: LONG_QUOTE, role: "quote", basis: "operator" }),
    ]);
    expect(res.sufficiency).not.toBe("sufficient");
  });

  it("the directive orders the writer to QUALIFY inferred facts, never assert them", () => {
    const res = assessEvidence([
      fact({ key: "declined_service", value: "brakes", role: "anchor", basis: "inferred" }),
    ]);
    const directive = evidenceDirective(res);
    expect(directive).toMatch(/INFERRED/);
    expect(directive).toMatch(/never state them as a customer's decision/);
  });
});

describe("the replaced defect: typing one character used to score 8/10", () => {
  it("a one-word context box is INSUFFICIENT and scores below the warning threshold", () => {
    const res = assessEvidence([], "brakes");
    expect(res.sufficiency).toBe("insufficient");
    expect(res.groundingScore).toBeLessThan(7);
  });

  it("empty evidence is insufficient and says so in operator language", () => {
    const res = assessEvidence([], "");
    expect(res.sufficiency).toBe("insufficient");
    expect(res.reason).toMatch(/no concrete evidence/i);
  });

  it("a substantive operator brief reaches thin — legitimate direction, still unverified", () => {
    const brief =
      "Customer kept asking why the TPMS light returns every October when it gets cold";
    expect(brief.length).toBeGreaterThanOrEqual(OPERATOR_SUBSTANCE_MIN_CHARS);
    const res = assessEvidence([], brief);
    expect(res.sufficiency).toBe("thin");
    // 7, not 8: below what typing a single character used to earn, but not a
    // permanent warning on every operator-authored brief.
    expect(res.groundingScore).toBe(7);
  });

  it("long operator prose with NO concrete token stays insufficient", () => {
    const vague = "we should really post something good about our great service today ok";
    expect(vague.length).toBeGreaterThanOrEqual(OPERATOR_SUBSTANCE_MIN_CHARS);
    expect(assessEvidence([], vague).sufficiency).toBe("insufficient");
  });
});

describe("directives degrade honestly instead of demanding specificity the facts cannot support", () => {
  it("thin evidence ORDERS general copy and forbids inventing specifics", () => {
    const d = evidenceDirective(assessEvidence([], "TPMS light keeps coming back in October cold"));
    expect(d).toMatch(/GENERAL/);
    expect(d).toMatch(/Do NOT invent a customer, a vehicle, a date, a price/);
  });

  it("sufficient evidence forbids adding anything beyond the listed facts", () => {
    const d = evidenceDirective(
      assessEvidence([fact({ key: "q", value: LONG_QUOTE, role: "quote" })]),
    );
    expect(d).toMatch(/add NO detail that is not among them/);
  });

  it("insufficient evidence forbids invention outright", () => {
    expect(evidenceDirective(assessEvidence([], ""))).toMatch(/Invent NOTHING/);
  });
});
