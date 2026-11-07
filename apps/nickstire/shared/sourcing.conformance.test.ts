/**
 * Supplier adapter conformance: every adapter (Gateway today, parts suppliers later) is listed in ADAPTERS below and
 * must pass these rules on recorded fixtures before its offers reach compareOffers. The suite must also catch a bad
 * adapter, not just pass a good one: a toy adapter that follows the contract passes, and each broken copy breaks one
 * rule and must be named by that rule. The rules live in this test file, not a shared module, because nothing in
 * production calls them.
 */
import { describe, expect, it } from "vitest";
import {
  compareOffers,
  SUPPLIER_SCHEDULES,
  UNKNOWN,
  type Candidate,
  type OfferLocation,
  type SupplierOffer,
  type SupplierSchedule,
} from "./sourcing";
import { gatewayItemsToOffers } from "../server/services/sourcingGateway";

interface AdapterUnderTest<Raw> {
  supplierId: string;
  /** false when the supplier's data never carries a delivery or cutoff time (Gateway's search does not). */
  statesArrivalTimes: boolean;
  /** Branch codes proven orderable from this account; any other "yes" is a claim the adapter cannot back. */
  confirmedOrderableBranches: readonly string[];
  toOffers(raw: Raw, ctx: { size: string; verifiedAt: string }): SupplierOffer[];
  fixtures: { typical: Raw; zeroStock: Raw; missingEverything: Raw };
}

const CTX = { size: "225/65R17", verifiedAt: "2026-11-06T15:00:00.000Z" };
const blank = (v: unknown) => v === null || v === undefined;
const badNumber = (v: unknown) => typeof v === "number" && (!Number.isFinite(v) || v < 0);

/** Rules for one emitted location; `where` names it in each problem line. */
function locationProblems(
  where: string,
  l: OfferLocation,
  a: Pick<AdapterUnderTest<unknown>, "statesArrivalTimes" | "confirmedOrderableBranches">,
): string[] {
  const problems: string[] = [];
  for (const v of [l.qty, l.orderable, l.kind, l.arrival?.at, l.arrival?.orderBy, l.fulfillmentMode]) {
    if (blank(v)) problems.push(`no-null: ${where} has a null or missing field, use UNKNOWN`);
  }
  if (badNumber(l.qty)) problems.push(`numbers: ${where} qty ${String(l.qty)}`);
  if (l.qtyAtLeast && typeof l.qty !== "number") problems.push(`capped: ${where} marks a cap on a quantity it does not state`);
  if (!a.statesArrivalTimes && (l.arrival.at !== UNKNOWN || l.arrival.orderBy !== UNKNOWN)) {
    problems.push(`no-invented-times: ${where} has a time the supplier never states`);
  }
  if (l.orderable === "yes" && !a.confirmedOrderableBranches.includes(l.branchCode)) {
    problems.push(`orderable: ${where} claims orderable without proof`);
  }
  return problems;
}

/** One line per broken rule, "rule: detail". Empty means the adapter conforms. */
function adapterConformanceProblems<Raw>(
  a: AdapterUnderTest<Raw>,
  schedules: Readonly<Record<string, SupplierSchedule>> = SUPPLIER_SCHEDULES,
): string[] {
  const problems: string[] = [];
  const out: Record<keyof AdapterUnderTest<Raw>["fixtures"], SupplierOffer[]> = { typical: [], zeroStock: [], missingEverything: [] };

  for (const name of Object.keys(out) as (keyof typeof out)[]) {
    const raw = a.fixtures[name];
    const before = JSON.stringify(raw);
    const first = a.toOffers(raw, CTX);
    if (JSON.stringify(raw) !== before) problems.push(`pure: toOffers changed its ${name} input`);
    else if (JSON.stringify(a.toOffers(raw, CTX)) !== JSON.stringify(first)) problems.push(`pure: ${name} gave two different answers`);
    out[name] = first;
  }

  if (!out.typical.some((o) => o.locations.length > 0)) problems.push("located: the typical fixture produced no offer location");

  for (const [name, offers] of Object.entries(out)) {
    for (const o of offers) {
      const at = `${name} ${o.sku}`;
      for (const f of ["unitPrice", "fet", "core", "priceStatus", "lastVerifiedAt"] as const) {
        if (blank(o[f])) problems.push(`no-null: ${at} ${f} is ${String(o[f])}, use UNKNOWN`);
      }
      if (badNumber(o.unitPrice) || badNumber(o.fet) || badNumber(o.core)) problems.push(`numbers: ${at} has a negative or non-finite price`);
      const hasPrice = typeof o.unitPrice === "number" && o.unitPrice > 0;
      if ((o.priceStatus === "priced") !== hasPrice) problems.push(`price-status: ${at} is ${o.priceStatus} with unitPrice ${String(o.unitPrice)}`);
      if (o.lastVerifiedAt !== CTX.verifiedAt) problems.push(`verified-at: ${at} stamped ${o.lastVerifiedAt}, not the lookup time`);
      if (o.supplierId !== a.supplierId || !schedules[o.supplierId]) problems.push(`schedule: ${at} supplier ${o.supplierId} has no schedule row`);
      const codes = new Set<string>();
      for (const l of o.locations) {
        const where = `${at}@${l.branchCode}`;
        if (codes.has(l.branchCode)) problems.push(`branch-unique: ${where} appears twice`);
        codes.add(l.branchCode);
        problems.push(...locationProblems(where, l, a));
      }
    }
  }

  for (const o of out.missingEverything) {
    const known = o.locations.some((l) => l.qty !== UNKNOWN) || o.unitPrice !== UNKNOWN || o.fet !== UNKNOWN;
    if (known) problems.push(`unknown-not-zero: missing fields in ${o.sku} came out as values, not UNKNOWN`);
  }
  if (!out.zeroStock.some((o) => o.locations.some((l) => l.qty === 0))) problems.push("zero-is-zero: a stated 0 did not come out as 0");

  return problems;
}

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
    ["capped", bend((o) => ((o.locations[0].qty = UNKNOWN), (o.locations[0].qtyAtLeast = true)))],
    ["pure", { ...good, fixtures: structuredClone(good.fixtures), toOffers: (raw, ctx) => (raw.push({ sku: "X" }), toyOffers(raw, ctx)) }],
    ["pure", { ...good, toOffers: (raw, ctx) => toyOffers(raw, { ...ctx, size: String(Math.random()) }) }],
  ])("names a broken %s rule", (rule, adapter) => {
    const problems = adapterConformanceProblems(adapter);
    expect(problems.some((p) => p.startsWith(`${rule}:`)), problems.join("\n")).toBe(true);
  });
});

// Every real adapter goes in this list. The Gateway fixture row uses the recorded /quicksearch/cache key set
// (server/__tests__/fixtures/gatewayOrder/dk.json), values invented.
type GatewayRow = Parameters<typeof gatewayItemsToOffers>[0][number];

const FIXTURE_ROW: GatewayRow = {
  dk_part_number: "NX-2256517",
  make: "NEXEN",
  minor_name: "NEX - N PRIZ S",
  invent_size: "225/65R17",
  on_hand: 6,
  trade_region_quantity: 20,
  pricing_data: [{ site_name: "Seville, OH", selling_price: 88.5, cost_price: 177, quantity: 6, fet: 0 }],
};

const gatewayAdapter: AdapterUnderTest<GatewayRow[]> = {
  supplierId: "gateway_dk",
  statesArrivalTimes: false,
  confirmedOrderableBranches: ["local"],
  toOffers: gatewayItemsToOffers,
  fixtures: {
    typical: [FIXTURE_ROW],
    zeroStock: [{ ...FIXTURE_ROW, on_hand: 0, trade_region_quantity: 0 }],
    missingEverything: [{ dk_part_number: "NX-2256517", invent_size: "225/65R17" }],
  },
};

describe("registered adapters", () => {
  it.each([["gateway_dk", gatewayAdapter]])("%s passes the conformance rules on its recorded fixtures", (_id, adapter) => {
    expect(adapterConformanceProblems(adapter)).toEqual([]);
  });
});

/*
 * docs/plans/shop-os/30-PORTAL-NETWORK-SCHEMATICS.md section 11: one fixture per captured vendor shape, catalog values
 * only, each with the doc 26 locations an adapter for that vendor must emit. Gateway has a real adapter (above; the
 * s.3 row is in sourcingGateway.test.ts). O'Reilly, ATD, Capital and Parts Authority have none yet, and Capital and
 * Parts Authority pages are not to be scraped (doc 30 s.10 item 5), so these pin what the contract carries and how the
 * ranking treats it before any adapter exists. `raw` keeps the vendor's own field names for that adapter's test.
 */
const T0 = "2026-11-06T14:30:00.000Z";
const at0 = (m: number) => new Date(Date.parse(T0) + m * 60_000).toISOString();

function vendorLoc(
  branchCode: string,
  tier: OfferLocation["arrival"]["tier"],
  qty: OfferLocation["qty"],
  p: Partial<OfferLocation> = {},
): OfferLocation {
  return {
    branchCode,
    branchName: branchCode,
    kind: "warehouse",
    qty,
    qtySource: "supplier_live",
    orderable: UNKNOWN,
    arrival: { tier, at: UNKNOWN, orderBy: UNKNOWN },
    fulfillmentMode: tier === "ship" ? "ship" : tier === "transfer" ? "transfer" : "route",
    ...p,
  };
}

const VENDOR_SHAPES = {
  // s.8 products/availability: store 0, servicing DC 1 on a route, two linked DCs and a store without one.
  // A route present = orderable is doc 30 s.9's INFERRED reading; it is the only "yes" here.
  oreilly: {
    statesArrivalTimes: true,
    confirmedOrderableBranches: ["dc-11"],
    raw: {
      product: { line: "FRA", itemNumber: "PH3614", quantityRequested: 1 },
      availability: {
        quantityRequested: 1,
        quantityFromStore: 0,
        suppliersWithRoutes: [
          {
            supplierLocationNumber: 11,
            quantityOnHand: 1,
            quantityToSource: 1,
            relationshipToStore: "SERVICING_DC",
            nextRoute: { supplierCity: "Twinsburg", cutoffTime: "2026-11-06T14:55:00Z", estimatedArrivalTime: "2026-11-06T17:35:00Z" },
          },
        ],
        suppliersWithoutRoutes: [
          { supplierLocationNumber: 12, quantityOnHand: 1, relationshipToStore: "LINKED_DC" },
          { supplierLocationNumber: 13, quantityOnHand: 1, relationshipToStore: "LINKED_DC" },
          { supplierLocationNumber: 14, quantityOnHand: 1, relationshipToStore: "SURROUNDING_STORE" },
        ],
      },
    },
    emits: [
      vendorLoc("store", "shelf", 0, { kind: "store" }),
      vendorLoc("dc-11", "transfer", 1, {
        branchName: "Twinsburg",
        orderable: "yes",
        arrival: { tier: "transfer", at: "2026-11-06T17:35:00.000Z", orderBy: "2026-11-06T14:55:00.000Z", atIs: "arrival" },
        fulfillmentMode: "route",
      }),
      vendorLoc("dc-12", "unknown", 1),
      vendorLoc("dc-13", "unknown", 1),
      vendorLoc("store-14", "unknown", 1, { kind: "store" }),
    ],
  },
  // s.4 card text for one size: six tiers, counts capped at 99+. Orderable stays UNKNOWN until an order flow is
  // captured (doc 30 s.0 item 4).
  atd: {
    statesArrivalTimes: false,
    confirmedOrderableBranches: [],
    raw: "Pickup 7 | Today 0 | Tomorrow 0 | Mon 11/9 7 | Multi-Day 99+ | National 99+ (3-5 Business Days)",
    emits: [
      vendorLoc("pickup", "shelf", 7, { fulfillmentMode: "pickup" }),
      vendorLoc("today", "shelf", 0),
      vendorLoc("tomorrow", "next_day", 0),
      vendorLoc("named-date", "next_day", 7),
      vendorLoc("multi-day", "ship", 99, { qtyAtLeast: true }),
      vendorLoc("national", "ship", 99, { qtyAtLeast: true, kind: "network" }),
    ],
  },
  // s.5 row text: Available / Regional, with "Out of stock" and the 50+ cap.
  capital: {
    statesArrivalTimes: false,
    confirmedOrderableBranches: [],
    raw: "Available: Out of stock | Regional: 50+",
    emits: [vendorLoc("available", "shelf", 0), vendorLoc("regional", "transfer", 50, { qtyAtLeast: true, kind: "network" })],
  },
  // s.7: branch, Transfers and Shipping counts, plus Other: Yes/NO with no count.
  partsAuthority: {
    statesArrivalTimes: false,
    confirmedOrderableBranches: [],
    raw: ["29 Cleveland, OH : 3", "Transfers : 6", "Shipping : 2", "Other: Yes"],
    emits: [
      vendorLoc("branch-29", "shelf", 3, { kind: "store", branchName: "29 Cleveland, OH" }),
      vendorLoc("transfers", "transfer", 6),
      vendorLoc("shipping", "ship", 2),
      vendorLoc("other", "unknown", UNKNOWN, { kind: "network" }),
    ],
  },
};

// s.8 pricing/basket: one priced item and one the basket lists under error: true (doc 26 not_priced).
const OREILLY_BASKET = {
  items: [
    { productKey: { line: "FRA", itemNumber: "PH3614" }, quantity: 1, costPrice: 4.89, corePrice: 0, error: false },
    { productKey: { line: "FRA", itemNumber: "PH9999" }, quantity: 1, costPrice: undefined, corePrice: undefined, error: true },
  ],
};

function partOffer(
  supplierId: string,
  sku: string,
  unitPrice: number | typeof UNKNOWN,
  locations: readonly OfferLocation[],
  core: number | "not_applicable" = "not_applicable",
): SupplierOffer {
  return {
    supplierId,
    supplierName: supplierId,
    sku,
    description: `${supplierId} ${sku}`,
    priceStatus: unitPrice === UNKNOWN ? "not_priced" : "priced",
    unitPrice,
    fet: 0,
    core,
    priceSource: "supplier_live",
    fitConfidence: "confirmed",
    fitConditions: [],
    lastVerifiedAt: T0,
    locations: structuredClone([...locations]),
  };
}

// ALG ticket line field names (doc 30 s.2 ticketItems[]), from one captured part line; values invented.
const ALG_PART_LINE = {
  id: 2, order: 2, type: 2, description: "Oil filter", technicianId: 3, technicianName: "Tech", partId: 44,
  partCode: "PH3614", vendorId: 5, jobLaborId: null, packageJobId: null, miscellaneousChargeId: null,
  miscellaneousChargeVersion: null, unitPrice: 9.78, partMarkup: 100, quantity: 1, rate: 0, subTotal: 9.78,
  taxRate: 0.08, taxRates: [], tax: 0.78, total: 10.56, isTaxable: true, inInventory: false, inventoryStockId: null,
  inventoryUsed: false, coreTrackingEnabled: false, coreTrackingId: null, coreValue: 0, returned: false,
  refunded: false, fifoLayers: [],
};

/*
 * A pick attached to an ALG part line fills these fields and no others. vendorId is ALG's own id from its vendor
 * settings, not read yet, so it stays UNKNOWN. unitPrice is dealer cost (ALG's partMarkup prices it for the
 * customer). The line has no FET field: whether FET rides in unitPrice or as a misc charge line is UNKNOWN until
 * one tire invoice is read.
 */
function toAlgPartLine(c: Candidate, quantity: number) {
  return {
    partCode: c.offer.sku,
    description: c.offer.description,
    vendorId: UNKNOWN,
    unitPrice: c.offer.unitPrice,
    quantity,
    coreValue: c.offer.core === "not_applicable" ? 0 : c.offer.core,
  };
}

describe("doc 30 s.11 vendor shapes", () => {
  it.each(Object.entries(VENDOR_SHAPES))("%s: every emitted location follows the location rules", (vendor, shape) => {
    expect(shape.emits.flatMap((l) => locationProblems(`${vendor}@${l.branchCode}`, l, shape))).toEqual([]);
  });

  it("O'Reilly: the servicing DC on a route is Quickest at its stated arrival; no-route locations never are", () => {
    const r = compareOffers([partOffer("oreilly_fco", "PH3614", 4.89, VENDOR_SHAPES.oreilly.emits, 0)], 1, new Date(T0));
    expect(r.quickest?.location.branchCode).toBe("dc-11");
    expect(r.quickest?.window).toEqual({ from: "2026-11-06T17:35:00.000Z", to: "2026-11-06T17:35:00.000Z" });
    for (const code of ["dc-12", "dc-13", "store-14"]) {
      expect(r.candidates.find((c) => c.location.branchCode === code)?.canWinQuickest).toBe(false);
    }
  });

  it("O'Reilly: once the 14:55 cutoff passes on screen, nothing is promised as Quickest", () => {
    const o = partOffer("oreilly_fco", "PH3614", 4.89, VENDOR_SHAPES.oreilly.emits, 0);
    o.lastVerifiedAt = at0(20);
    expect(compareOffers([o], 1, new Date(at0(26))).quickest).toBeNull();
  });

  it("O'Reilly basket: an item listed under error is not priced and never the best price", () => {
    const routed = VENDOR_SHAPES.oreilly.emits.filter((l) => l.branchCode === "dc-11");
    const offers = OREILLY_BASKET.items.map((i) =>
      partOffer("oreilly_fco", i.productKey.itemNumber, i.error ? UNKNOWN : (i.costPrice ?? UNKNOWN), routed, i.corePrice ?? 0),
    );
    const r = compareOffers(offers, 1, new Date(T0));
    expect(r.bestPrice?.offer.sku).toBe("PH3614");
    expect(r.candidates.find((c) => c.offer.sku === "PH9999")?.reasons).toContain("No price from supplier");
  });

  it("ATD and Capital: a capped 99+ or 50+ count covers a full set; Out of stock is 0, not unknown", () => {
    const atd = compareOffers([partOffer("atd", "N-PRIZ", 88, VENDOR_SHAPES.atd.emits)], 4, new Date(T0));
    expect(atd.candidates.find((c) => c.location.branchCode === "multi-day")?.reasons).not.toContainEqual(expect.stringMatching(/^Only/));
    const capital = compareOffers([partOffer("capital", "N-PRIZ", 85, VENDOR_SHAPES.capital.emits)], 4, new Date(T0));
    expect(capital.candidates.find((c) => c.location.branchCode === "available")?.reasons).toContain("Only 0 here, need 4");
    expect(capital.bestPrice?.location.branchCode).toBe("regional");
  });

  it("Parts Authority: Other: Yes has no count, so it is never a pick", () => {
    const r = compareOffers([partOffer("pa", "PH3614", 5.1, VENDOR_SHAPES.partsAuthority.emits)], 1, new Date(T0));
    const other = r.candidates.find((c) => c.location.branchCode === "other");
    expect([other?.canWinQuickest, other?.canWinPrice]).toEqual([false, false]);
  });

  it("every pick attaches to an ALG ticket part line using only fields that line has", () => {
    const algFields = new Set(Object.keys(ALG_PART_LINE));
    const results = [
      compareOffers([partOffer("oreilly_fco", "PH3614", 4.89, VENDOR_SHAPES.oreilly.emits, 0)], 1, new Date(T0)),
      compareOffers([partOffer("capital", "N-PRIZ", 85, VENDOR_SHAPES.capital.emits)], 4, new Date(T0)),
      compareOffers(gatewayItemsToOffers([FIXTURE_ROW], CTX), 4, new Date(CTX.verifiedAt)),
    ];
    const picks = results.flatMap((r) => [r.quickest, r.bestPrice].filter((c): c is Candidate => !!c).map((c) => [c, r.qtyNeeded] as const));
    expect(picks.length).toBeGreaterThanOrEqual(4);
    for (const [c, qty] of picks) {
      const line = toAlgPartLine(c, qty);
      expect(Object.keys(line).filter((k) => !algFields.has(k))).toEqual([]);
      expect(line.partCode).not.toBe("");
      expect(typeof line.unitPrice).toBe("number");
      expect(typeof line.coreValue).toBe("number");
      expect(line.quantity).toBe(qty);
    }
  });
});
