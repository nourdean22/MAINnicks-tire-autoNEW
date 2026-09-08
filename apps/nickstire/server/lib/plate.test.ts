import { describe, it, expect } from "vitest";
import { normalizePlate, plateVariants, maskPhone, maskPlate, bookingLinkage } from "./plate";

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
