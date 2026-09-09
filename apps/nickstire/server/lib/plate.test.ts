import { describe, it, expect } from "vitest";
import { normalizePlate, plateVariants, maskPhone, maskPlate, bookingLinkage, classifyPlateMatches } from "./plate";

describe("plate normalization (ADR-0017 camera -> customer lookup)", () => {
  it("normalizes case, spaces and punctuation", () => {
    expect(normalizePlate("abc 1234")).toBe("ABC1234");
    expect(normalizePlate(" abc-1234 ")).toBe("ABC1234");
    expect(normalizePlate(null)).toBe("");
    expect(normalizePlate(undefined)).toBe("");
  });

  it("yields the plate first, then single-swap confusable variants, deduped and capped", () => {
    const v = plateVariants("AB0I");
    expect(v[0]).toBe("AB0I");
    expect(v).toContain("A80I");
    expect(v).toContain("ABOI");
    expect(v).toContain("AB01");
    expect(new Set(v).size).toBe(v.length);
    expect(plateVariants("OOOOOOOOOOOOOOOO", 5)).toHaveLength(5);
    expect(plateVariants("")).toEqual([]);
  });

  it("masks phones to the last four digits", () => {
    expect(maskPhone("+1 (216) 555-0199")).toBe("***-0199");
    expect(maskPhone("12")).toBe("***");
  });

  it("upgrades a phone-found booking only on a first-name or full-name agreement", () => {
    expect(bookingLinkage("Jane Member", "Jane")).toBe("phone+name");
    expect(bookingLinkage("Jane Member", "jane   member")).toBe("phone+name");
    expect(bookingLinkage("Jane Smith", "Bob Smith")).toBe("phone_only"); // shared household number
    expect(bookingLinkage("J. Smith", "Jane Smith")).toBe("phone_only"); // an initial is not a name
    expect(bookingLinkage(null, "Jane")).toBe("phone_only");
    expect(bookingLinkage("Jane", "")).toBe("phone_only");
  });

  it("masks plates to the first two characters for log lines", () => {
    expect(maskPlate("abc 1234")).toBe("AB*****");
    expect(maskPlate("AB")).toBe("**");
    expect(maskPlate("")).toBe("");
    expect(maskPlate(undefined)).toBe("");
  });
});

describe("plate match classification — a confusable hit is not an identity", () => {
  it("EXACT only when one stored plate equals the read, and only EXACT may auto-link", () => {
    const r = classifyPlateMatches("ABC1234", [{ plate: "ABC1234" }]);
    expect(r.matchClass).toBe("EXACT");
    expect(r.autoLinkAllowed).toBe(true);
    expect(r.exactCount).toBe(1);
  });

  it("a single confusable candidate is advisory, never auto-linked", () => {
    // ABCI234 is the OCR I/1 swap of ABC1234: plausible, not proven.
    const r = classifyPlateMatches("ABC1234", [{ plate: "ABCI234" }]);
    expect(r.matchClass).toBe("CONFUSABLE_UNIQUE");
    expect(r.autoLinkAllowed).toBe(false);
    expect(r.confusableCount).toBe(1);
  });

  it("several confusable candidates are AMBIGUOUS, so no customer is attached", () => {
    const r = classifyPlateMatches("ABC1234", [{ plate: "ABCI234" }, { plate: "A8C1234" }]);
    expect(r.matchClass).toBe("AMBIGUOUS");
    expect(r.autoLinkAllowed).toBe(false);
  });

  it("two stored plates equal to the read is AMBIGUOUS, not EXACT", () => {
    // Duplicate membership rows: the plate no longer identifies one customer,
    // and picking either would be a coin flip on someone's service history.
    const r = classifyPlateMatches("ABC1234", [{ plate: "ABC1234" }, { plate: "abc-1234" }]);
    expect(r.matchClass).toBe("AMBIGUOUS");
    expect(r.autoLinkAllowed).toBe(false);
    expect(r.exactCount).toBe(2);
  });

  it("an exact hit wins even when a confusable twin is also on file", () => {
    const r = classifyPlateMatches("ABC1234", [{ plate: "ABCI234" }, { plate: "ABC1234" }]);
    expect(r.matchClass).toBe("EXACT");
    expect(r.autoLinkAllowed).toBe(true);
  });

  it("no matches is NONE", () => {
    expect(classifyPlateMatches("ABC1234", []).matchClass).toBe("NONE");
  });

  it("nothing matches nothing — a blank read is NONE, not a near-miss", () => {
    // Regression: an unreadable plate ("") paired with a membership row that has
    // no plate on file scored CONFUSABLE_UNIQUE, so a blank read looked like a
    // near-miss on a real customer.
    const empty = classifyPlateMatches("", [{ plate: "" }]);
    expect(empty.matchClass).toBe("NONE");
    expect(empty.confusableCount).toBe(0);
    expect(empty.autoLinkAllowed).toBe(false);
  });

  it("a membership row with no plate on file is not a candidate", () => {
    const r = classifyPlateMatches("ABC1234", [{ plate: null }, { plate: "ABC1234" }]);
    expect(r.matchClass).toBe("EXACT");
    expect(r.confusableCount).toBe(0);
  });

  it("normalizes both sides, so punctuation never downgrades an exact match", () => {
    expect(classifyPlateMatches("abc 1234", [{ plate: "ABC-1234" }]).matchClass).toBe("EXACT");
  });
});
