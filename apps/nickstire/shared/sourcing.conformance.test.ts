/**
 * Supplier adapter conformance: every adapter (Gateway today, parts suppliers later) is listed in ADAPTERS below and
 * must pass these rules on recorded fixtures before its offers reach compareOffers. The suite must also catch a bad
 * adapter, not just pass a good one: a toy adapter that follows the contract passes, and each broken copy breaks one
 * rule and must be named by that rule. The rules live in this test file, not a shared module, because nothing in
 * production calls them.
 */
import { describe, expect, it } from "vitest";
import { SUPPLIER_SCHEDULES, UNKNOWN, type SupplierOffer, type SupplierSchedule } from "./sourcing";
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
        for (const v of [l.qty, l.orderable, l.kind, l.arrival?.at, l.arrival?.orderBy, l.fulfillmentMode]) {
          if (blank(v)) problems.push(`no-null: ${where} has a null or missing field, use UNKNOWN`);
        }
        if (badNumber(l.qty)) problems.push(`numbers: ${where} qty ${String(l.qty)}`);
        if (!a.statesArrivalTimes && (l.arrival.at !== UNKNOWN || l.arrival.orderBy !== UNKNOWN)) {
          problems.push(`no-invented-times: ${where} has a time the supplier never states`);
        }
        if (l.orderable === "yes" && !a.confirmedOrderableBranches.includes(l.branchCode)) {
          problems.push(`orderable: ${where} claims orderable without proof`);
        }
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
  total_qty: 20,
  pricing_data: [{ site_name: "Seville, OH", selling_price: 88.5, cost_price: 177, quantity: 6, fet: 0 }],
};

const gatewayAdapter: AdapterUnderTest<GatewayRow[]> = {
  supplierId: "gateway_dk",
  statesArrivalTimes: false,
  confirmedOrderableBranches: ["local"],
  toOffers: gatewayItemsToOffers,
  fixtures: {
    typical: [FIXTURE_ROW],
    zeroStock: [{ ...FIXTURE_ROW, on_hand: 0, total_qty: 0 }],
    missingEverything: [{ dk_part_number: "NX-2256517", invent_size: "225/65R17" }],
  },
};

describe("registered adapters", () => {
  it.each([["gateway_dk", gatewayAdapter]])("%s passes the conformance rules on its recorded fixtures", (_id, adapter) => {
    expect(adapterConformanceProblems(adapter)).toEqual([]);
  });
});
