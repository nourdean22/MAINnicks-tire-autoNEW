/**
 * The facts store exists to end fact drift and false warranty claims. These lock
 * the two things that must never regress: the warranty facts match the SHOP
 * INVOICE (not the code's old "12mo/12k"), and the drafter's warranty preamble
 * never lets the AI apply the repair warranty (or road hazard) to a used tire.
 */
import { describe, it, expect } from "vitest";
import { SEED_FACTS, buildWarrantyFactsPreamble, getFact } from "./services/businessFacts";
import { BUSINESS } from "@shared/business";

const byKey = new Map(SEED_FACTS.map((f) => [f.factKey, f]));

describe("SEED_FACTS — invoice-accurate, provenance-carrying", () => {
  it("every fact carries full provenance (source, approver, dates, channels)", () => {
    for (const f of SEED_FACTS) {
      expect(f.source, f.factKey).toBeTruthy();
      expect(f.approvedBy, f.factKey).toBeTruthy();
      expect(f.effectiveDate, f.factKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.verifiedDate, f.factKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.channels.length, f.factKey).toBeGreaterThan(0);
    }
  });

  it("used-tire warranty is 7-day defect-only with NO road hazard", () => {
    const v = byKey.get("used_tire.warranty")!.value;
    expect(v).toMatch(/7-day/i);
    expect(v).toMatch(/defect/i);
    expect(v.toLowerCase()).toContain("no road-hazard");
    expect(v).not.toMatch(/12[\s-]?month|12,000|1-year/i); // never the repair terms
  });

  it("repair warranty matches the invoice: 1-year parts, 90-day labor — not 12k miles", () => {
    expect(byKey.get("repair.parts_warranty")!.value).toMatch(/1-year limited parts/i);
    expect(byKey.get("repair.labor_warranty")!.value).toMatch(/90-day limited labor/i);
    // The fabricated mileage cap must appear nowhere in the store.
    for (const f of SEED_FACTS) expect(f.value).not.toContain("12,000");
  });

  it("used-tire price stays linked to the BUSINESS SSOT (no re-hardcode)", () => {
    expect(byKey.get("used_tire.price")!.value).toContain(BUSINESS.usedTires.priceDisplay);
  });
});

describe("buildWarrantyFactsPreamble", () => {
  const p = buildWarrantyFactsPreamble();
  it("carries the used-tire, parts, and labor warranties", () => {
    expect(p).toMatch(/7-day/i);
    expect(p).toMatch(/1-year limited parts/i);
    expect(p).toMatch(/90-day limited labor/i);
  });
  it("explicitly forbids applying the repair warranty to a used tire", () => {
    expect(p).toMatch(/NEVER apply the parts\/labor repair warranty to a used tire/i);
  });
});

describe("getFact falls back to the seed when the DB is unavailable", () => {
  it("returns the seed fact for a known key", async () => {
    // No DB env in the worktree → getFact must still resolve from SEED_FACTS.
    const f = await getFact("used_tire.warranty");
    expect(f?.value).toMatch(/7-day/i);
  });
  it("returns null for an unknown key", async () => {
    expect(await getFact("does.not.exist")).toBeNull();
  });
});
