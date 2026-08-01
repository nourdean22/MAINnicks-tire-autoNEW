import { describe, it, expect } from "vitest";
import { evaluateEntailment, entailmentAllowsAutonomousPublish } from "./claimEntailment";

/**
 * Provenance proves a URL was fetched. Entailment proves the URL SAYS this.
 * These lock the asymmetry: the checker refutes strongly and confirms weakly,
 * so it can never bless a paraphrase it does not understand.
 */
describe("refuting", () => {
  it("a number the source never states is not supported", () => {
    const r = evaluateEntailment(
      "Ohio E-Check is required every 2 years in 7 counties.",
      "Ohio E-Check testing is required every 2 years for vehicles registered in certain counties.",
    );
    expect(r.verdict).toBe("not_supported");
    expect(r.unsupportedNumbers).toContain("7");
  });

  it("catches a negation flip on otherwise matching text", () => {
    const r = evaluateEntailment(
      "Vehicles under 4 years old are required to be tested.",
      "Vehicles under 4 years old are not required to be tested.",
    );
    expect(r.verdict).toBe("contradicted");
    expect(r.reasons.join(" ")).toMatch(/negation/i);
  });

  it("counts a single negation ONCE, whatever phrase it sits in", () => {
    // The markers must not overlap each other. With both "not" and "are not"
    // in the list, "are not required" counted 2 — even parity, identical to
    // "are required", and the contradiction vanished. Each of these contains
    // exactly one negation and must flip polarity against a positive claim.
    for (const negated of [
      "Vehicles are not required to be tested.",
      "Vehicles do not need to be tested.",
      "Vehicles cannot be tested.",
      "Vehicles aren't required to be tested.",
    ]) {
      const r = evaluateEntailment("Vehicles are required to be tested.", negated);
      expect(r.verdict, negated).toBe("contradicted");
    }
  });

  it("treats a genuine double negative as affirmative, not as a flip", () => {
    const r = evaluateEntailment(
      "Testing is required for these vehicles.",
      "It is not true that testing is not required for these vehicles.",
    );
    expect(r.verdict).not.toBe("contradicted");
  });

  it("rejects an excerpt that is simply about something else", () => {
    const r = evaluateEntailment(
      "Worn brake pads cause rotor scoring and longer stopping distances.",
      "Tire pressure should be checked monthly when tires are cold.",
    );
    expect(r.verdict).toBe("not_supported");
  });

  it("flags an absolute the source never made", () => {
    const r = evaluateEntailment(
      "Underinflated tires always cause a blowout.",
      "Underinflated tires can increase the risk of a blowout and reduce fuel economy.",
    );
    expect(r.verdict).toBe("partially_supported");
    expect(r.unsupportedUniversals).toContain("always");
  });
});

describe("confirming — deliberately hard", () => {
  it("supports a claim whose numbers and terms all appear in the source", () => {
    const r = evaluateEntailment(
      "Tire pressure should be checked monthly when tires are cold.",
      "Tire pressure should be checked monthly, when tires are cold, using a gauge.",
    );
    expect(r.verdict).toBe("supported");
  });

  it("will not reach supported on vocabulary overlap alone", () => {
    // Same domain words, different assertion. Overlap must not be mistaken for
    // meaning — this is the case an LLM would happily wave through.
    const r = evaluateEntailment(
      "Brake fluid should be replaced every 3 years.",
      "Brake fluid absorbs moisture over time, which affects braking performance.",
    );
    expect(r.verdict).not.toBe("supported");
  });

  it("refuses to evaluate against a title or a URL", () => {
    const r = evaluateEntailment(
      "NHTSA reports 11,000 crashes annually from tire failure.",
      null,
    );
    expect(r.verdict).toBe("not_evaluated");
    expect(r.reasons.join(" ")).toMatch(/provenance only/i);
  });
});

describe("publication gate", () => {
  it("lets a supported claim through", () => {
    expect(entailmentAllowsAutonomousPublish("supported", "any script").allowed).toBe(true);
  });

  it("blocks not_evaluated — a citation is not a statement", () => {
    const g = entailmentAllowsAutonomousPublish("not_evaluated", "any script");
    expect(g.allowed).toBe(false);
    expect(g.reason).toMatch(/provenance alone/i);
  });

  it("blocks contradicted and not_supported outright", () => {
    expect(entailmentAllowsAutonomousPublish("contradicted", "s").allowed).toBe(false);
    expect(entailmentAllowsAutonomousPublish("not_supported", "s").allowed).toBe(false);
  });

  it("allows partial support ONLY when the qualifier survived into the script", () => {
    const blocked = entailmentAllowsAutonomousPublish(
      "partially_supported",
      "Underinflated tires cause blowouts.",
      ["can increase the risk"],
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/missing from the final script/i);

    const allowed = entailmentAllowsAutonomousPublish(
      "partially_supported",
      "Underinflation can increase the risk of a blowout.",
      ["can increase the risk"],
    );
    expect(allowed.allowed).toBe(true);
  });

  it("blocks partial support that declares no qualifier at all", () => {
    expect(entailmentAllowsAutonomousPublish("partially_supported", "s", []).allowed).toBe(false);
  });
});
