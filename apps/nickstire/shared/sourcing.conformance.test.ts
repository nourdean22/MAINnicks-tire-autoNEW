/**
 * The conformance suite must catch a bad adapter, not just pass a good one. A toy adapter that follows the contract
 * passes; each broken copy breaks one rule and must be named by that rule.
 */
import { describe, expect, it } from "vitest";
import { adapterConformanceProblems, type AdapterUnderTest } from "./sourcing.conformance";
import { UNKNOWN, type SupplierOffer } from "./sourcing";

type Row = { sku: string; qty?: number; price?: number; fet?: number };
type Raw = Row[];

function toyOffers(raw: Raw, ctx: { size: string; verifiedAt: string }): SupplierOffer[] {
  return raw.map((r) => ({
    supplierId: "gateway_dk",
    supplierName: "Toy",
    sku: r.sku,
    description: `Toy ${ctx.size}`,
    priceStatus: typeof r.price === "number" && r.price > 0 ? "priced" : "not_priced",
    unitPrice: typeof r.price === "number" && r.price > 0 ? r.price : UNKNOWN,
    fet: typeof r.fet === "number" ? r.fet : UNKNOWN,
    core: "not_applicable",
    priceSource: "supplier_live",
    fitConfidence: "confirmed",
    fitConditions: [],
    lastVerifiedAt: ctx.verifiedAt,
    locations: [
      {
        branchCode: "local",
        branchName: "Local",
        kind: "warehouse",
        qty: typeof r.qty === "number" ? r.qty : UNKNOWN,
        qtySource: "supplier_live",
        orderable: "yes",
        arrival: { tier: "shelf", at: UNKNOWN, orderBy: UNKNOWN },
        fulfillmentMode: "route",
      },
    ],
  }));
}

const good: AdapterUnderTest<Raw> = {
  supplierId: "gateway_dk",
  statesArrivalTimes: false,
  confirmedOrderableBranches: ["local"],
  toOffers: toyOffers,
  fixtures: {
    typical: [{ sku: "A", qty: 6, price: 80, fet: 0 }],
    zeroStock: [{ sku: "B", qty: 0, price: 80, fet: 0 }],
    missingEverything: [{ sku: "C" }],
  },
};

const bend = (patch: (o: SupplierOffer) => void): AdapterUnderTest<Raw> => ({
  ...good,
  toOffers: (raw, ctx) => toyOffers(raw, ctx).map((o) => (patch(o), o)),
});

describe("adapterConformanceProblems", () => {
  it("a contract-following adapter has no problems", () => {
    expect(adapterConformanceProblems(good)).toEqual([]);
  });

  it.each<[string, AdapterUnderTest<Raw>]>([
    ["located", { ...good, toOffers: () => [] }],
    ["no-null", bend((o) => ((o.locations[0] as { qty: unknown }).qty = null))],
    ["no-null", bend((o) => ((o as { fet: unknown }).fet = undefined))],
    ["numbers", bend((o) => (o.unitPrice = -5))],
    ["price-status", bend((o) => (o.priceStatus = "priced"))],
    ["verified-at", bend((o) => (o.lastVerifiedAt = "2026-01-01T00:00:00.000Z"))],
    ["schedule", bend((o) => (o.supplierId = "nobody"))],
    ["no-invented-times", bend((o) => (o.locations[0].arrival.at = "2026-11-06T16:00:00.000Z"))],
    ["orderable", bend((o) => o.locations.push({ ...o.locations[0], branchCode: "regional" }))],
    ["unknown-not-zero", { ...good, toOffers: (raw, ctx) => toyOffers(raw.map((r) => ({ qty: 0, price: 1, fet: 0, ...r })), ctx) }],
    ["zero-is-zero", bend((o) => o.locations[0].qty === 0 && (o.locations[0].qty = UNKNOWN))],
    ["branch-unique", bend((o) => o.locations.push({ ...o.locations[0], orderable: UNKNOWN }))],
    ["pure", { ...good, fixtures: structuredClone(good.fixtures), toOffers: (raw, ctx) => (raw.push({ sku: "X" }), toyOffers(raw, ctx)) }],
    ["pure", { ...good, toOffers: (raw, ctx) => toyOffers(raw, { ...ctx, size: String(Math.random()) }) }],
  ])("names a broken %s rule", (rule, adapter) => {
    const problems = adapterConformanceProblems(adapter);
    expect(problems.some((p) => p.startsWith(`${rule}:`)), problems.join("\n")).toBe(true);
  });
});
