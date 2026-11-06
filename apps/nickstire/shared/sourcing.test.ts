import { describe, expect, it } from "vitest";
import { compareOffers, normalizeTireSize, type SupplierOffer } from "./sourcing";

const NOW = new Date("2026-11-06T15:00:00Z");
const fresh = "2026-11-06T14:58:00Z";

function offer(p: Partial<SupplierOffer> & Pick<SupplierOffer, "id">): SupplierOffer {
  return {
    supplierId: p.id.split(":")[0],
    supplierName: p.id.split(":")[0],
    location: null,
    sku: p.id,
    brand: "Brand",
    description: "Part",
    unitCost: 50,
    qtyAvailable: 4,
    tier: "shelf",
    statedArrival: null,
    runMinutes: { min: 30, max: 60 },
    runSource: "default",
    verifiedAt: fresh,
    source: "supplier_live",
    ...p,
  };
}

describe("compareOffers", () => {
  it("ranks availability before price: shelf beats a cheaper next-day offer", () => {
    const r = compareOffers(
      [offer({ id: "pa:1", tier: "next_day", unitCost: 30, statedArrival: "2026-11-07T12:30:00Z" }), offer({ id: "or:1", unitCost: 45 })],
      2,
      NOW,
    );
    expect(r.quickest?.id).toBe("or:1");
    expect(r.bestPrice?.id).toBe("pa:1");
    expect(r.sameOffer).toBe(false);
  });

  it("treats two shelf offers as a speed tie and lets price decide", () => {
    const r = compareOffers([offer({ id: "or:1", unitCost: 61 }), offer({ id: "pa:1", unitCost: 31.63 })], 2, NOW);
    expect(r.quickest?.id).toBe("pa:1");
    expect(r.speedTie).toBe(true);
    expect(r.sameOffer).toBe(true);
    expect(r.note).toMatch(/cheapest offer is also the quickest/);
  });

  it("orders a tier by stated arrival before price", () => {
    const r = compareOffers(
      [
        offer({ id: "a:1", tier: "next_day", unitCost: 20, statedArrival: "2026-11-07T15:00:00Z" }),
        offer({ id: "b:1", tier: "next_day", unitCost: 40, statedArrival: "2026-11-07T12:30:00Z" }),
      ],
      1,
      NOW,
    );
    expect(r.quickest?.id).toBe("b:1");
    expect(r.speedTie).toBe(false);
  });

  it("never lets a short quantity win either pick", () => {
    const r = compareOffers([offer({ id: "a:1", qtyAvailable: 2, unitCost: 10 }), offer({ id: "b:1", tier: "transfer", unitCost: 70 })], 4, NOW);
    expect(r.quickest?.id).toBe("b:1");
    expect(r.bestPrice?.id).toBe("b:1");
    const short = r.offers.find((o) => o.id === "a:1");
    expect(short?.coversQty).toBe(false);
    expect(short?.reasons[0]).toMatch(/Only 2 here - need 4/);
  });

  it("never ranks unknown availability for speed, and never lets an unpriced offer win price", () => {
    const r = compareOffers([offer({ id: "a:1", tier: "unknown", unitCost: 5 }), offer({ id: "b:1", unitCost: null })], 1, NOW);
    expect(r.quickest?.id).toBe("b:1");
    expect(r.bestPrice?.id).toBe("a:1");
    expect(r.offers.find((o) => o.id === "b:1")?.reasons).toContain("No price from supplier");
  });

  it("does not trust a stale or non-live shelf quantity", () => {
    const r = compareOffers(
      [offer({ id: "a:1", verifiedAt: "2026-11-06T13:00:00Z" }), offer({ id: "b:1", source: "cached" })],
      1,
      NOW,
    );
    expect(r.quickest).toBeNull();
    expect(r.note).toMatch(/call to confirm/);
    expect(r.offers.every((o) => o.reasons.includes("Stock not checked live - call to confirm"))).toBe(true);
  });

  it("handles no offers and clamps quantity to at least 1", () => {
    const r = compareOffers([], 0, NOW);
    expect(r.qtyNeeded).toBe(1);
    expect(r.quickest).toBeNull();
    expect(r.bestPrice).toBeNull();
    expect(r.note).toBe("No supplier returned an offer.");
  });
});
