/**
 * Quote Guard · doctrine tests.
 *
 * The one invariant that matters most: THE GUARD NEVER FABRICATES A
 * PROFIT NUMBER. When parts cost is uncaptured (0), impliedPartsMarginPct
 * is null and the margin check is `unknown` — loudly, with the capture
 * instruction in the detail. Everything else is checklist mechanics.
 */
import { describe, it, expect } from "vitest";
import { evaluateQuoteChecks, extractTireSize } from "./quoteGuard";

const BASE = {
  amountCents: 45_000,
  serviceDescription: "front brake pads and rotors",
  estimatedPartsCostCents: 0,
  overlappingEstimateIds: [] as number[],
};

describe("no fabricated profit — the founding invariant", () => {
  it("uncaptured parts cost → margin unknown, marginPct null, capture instruction in detail", () => {
    const r = evaluateQuoteChecks({ ...BASE });
    const margin = r.checks.find((c) => c.check === "parts_margin")!;
    expect(margin.status).toBe("unknown");
    expect(margin.detail).toMatch(/NOT CAPTURED/);
    expect(r.impliedPartsMarginPct).toBeNull();
  });

  it("captured parts cost → real margin, explicitly labeled parts-only", () => {
    const r = evaluateQuoteChecks({ ...BASE, estimatedPartsCostCents: 27_000 });
    const margin = r.checks.find((c) => c.check === "parts_margin")!;
    expect(margin.status).toBe("pass");
    expect(margin.detail).toMatch(/parts-only, not gross profit/);
    expect(r.impliedPartsMarginPct).toBe(40); // (450-270)/450
  });

  it("quote below captured parts cost → FAIL, selling below cost", () => {
    const r = evaluateQuoteChecks({ ...BASE, amountCents: 20_000, estimatedPartsCostCents: 27_000 });
    expect(r.checks.find((c) => c.check === "parts_margin")!.status).toBe("fail");
  });
});

describe("checklist mechanics", () => {
  it("amount sanity band: $20–$20,000", () => {
    expect(evaluateQuoteChecks({ ...BASE, amountCents: 500 }).checks.find((c) => c.check === "amount_sane")!.status).toBe("fail");
    expect(evaluateQuoteChecks({ ...BASE, amountCents: 5_000_000 }).checks.find((c) => c.check === "amount_sane")!.status).toBe("fail");
    expect(evaluateQuoteChecks({ ...BASE }).checks.find((c) => c.check === "amount_sane")!.status).toBe("pass");
  });

  it("overlapping open estimates fail with the ids named", () => {
    const r = evaluateQuoteChecks({ ...BASE, overlappingEstimateIds: [1201, 1187] });
    const overlap = r.checks.find((c) => c.check === "no_overlapping_estimate")!;
    expect(overlap.status).toBe("fail");
    expect(overlap.detail).toContain("1201");
  });

  it("tire quote below cheapest LIVE supplier cost → fail; clearing it → pass", () => {
    const below = evaluateQuoteChecks({
      ...BASE,
      amountCents: 9_000,
      tireSupplier: { size: "225/65R17", cheapestSupplierCostCents: 11_000, brandsChecked: 6 },
    });
    expect(below.checks.find((c) => c.check === "tire_supplier_backing")!.status).toBe("fail");

    const clears = evaluateQuoteChecks({
      ...BASE,
      amountCents: 18_000,
      tireSupplier: { size: "225/65R17", cheapestSupplierCostCents: 11_000, brandsChecked: 6 },
    });
    expect(clears.checks.find((c) => c.check === "tire_supplier_backing")!.status).toBe("pass");
  });

  it("tire-shaped but Gateway silent → unknown, never assumed", () => {
    const r = evaluateQuoteChecks({ ...BASE, tireSupplier: null });
    expect(r.checks.find((c) => c.check === "tire_supplier_backing")!.status).toBe("unknown");
  });

  it("non-tire quotes carry no tire check at all (no list padding)", () => {
    const r = evaluateQuoteChecks({ ...BASE });
    expect(r.checks.find((c) => c.check === "tire_supplier_backing")).toBeUndefined();
  });

  it("uncapturable checks are stated unknown — the checklist IS the capture roadmap", () => {
    const r = evaluateQuoteChecks({ ...BASE });
    expect(r.checks.find((c) => c.check === "labor_included")!.status).toBe("unknown");
    expect(r.checks.find((c) => c.check === "calibration_or_programming")!.status).toBe("unknown");
  });
});

describe("extractTireSize · inflected/variant formats", () => {
  it("parses common formats to canonical", () => {
    expect(extractTireSize("2 used tires 225/65R17 installed")).toBe("225/65R17");
    expect(extractTireSize("tires 225 65 17 mount and balance")).toBe("225/65R17");
    expect(extractTireSize("225-65-17 pair")).toBe("225/65R17");
  });
  it("returns null when no size present", () => {
    expect(extractTireSize("front brake pads")).toBeNull();
    expect(extractTireSize(null)).toBeNull();
  });
});
