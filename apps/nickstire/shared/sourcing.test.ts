import { describe, expect, it } from "vitest";
import {
  compareOffers,
  normalizeTireSize,
  UNKNOWN,
  type OfferLocation,
  type SupplierOffer,
  type SupplierSchedule,
} from "./sourcing";

const NOW = new Date("2026-11-06T15:00:00Z");
const ISO = NOW.toISOString();
const min = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();

const sched = (runMin: number, runMax: number): SupplierSchedule => ({
  name: "x",
  runMinutes: { min: runMin, max: runMax },
  shelfMaxAgeMinutes: 15,
  basis: "schedule, not live",
  source: "test",
});
const SCHEDULES = { a: sched(30, 60), b: sched(30, 60), c: sched(45, 90), slow: sched(120, 180) };

function loc(p: Partial<OfferLocation> = {}): OfferLocation {
  return {
    branchCode: "local",
    branchName: "Local",
    kind: "warehouse",
    qty: 8,
    qtySource: "supplier_live",
    orderable: "yes",
    arrival: { tier: "shelf", at: UNKNOWN, orderBy: UNKNOWN },
    fulfillmentMode: "route",
    ...p,
  };
}

function offer(supplierId: string, sku: string, p: Partial<SupplierOffer> = {}, l: Partial<OfferLocation> = {}): SupplierOffer {
  return {
    supplierId,
    supplierName: supplierId.toUpperCase(),
    sku,
    description: `Tire ${sku}`,
    priceStatus: "priced",
    unitPrice: 80,
    fet: 0,
    core: "not_applicable",
    priceSource: "supplier_live",
    fitConfidence: "confirmed",
    fitConditions: [],
    lastVerifiedAt: ISO,
    locations: [loc(l)],
    ...p,
  };
}

const run = (offers: SupplierOffer[], qty = 4) => compareOffers(offers, qty, NOW, SCHEDULES);
const byKey = (r: ReturnType<typeof run>, key: string) => r.candidates.find((c) => c.key === key)!;

describe("compareOffers: Quickest arrival ranks where the part is first", () => {
  it("a shelf offer beats a cheaper next-day offer for speed; the cheaper one wins price", () => {
    const r = run([
      offer("a", "1", { unitPrice: 90 }),
      offer("b", "2", { unitPrice: 50 }, { arrival: { tier: "next_day", at: min(16 * 60), orderBy: min(120) } }),
    ]);
    expect(r.quickest?.key).toBe("a:1:local");
    expect(r.bestPrice?.key).toBe("b:2:local");
  });

  it("two shelf offers in the same run window tie, and the cheaper one is shown as quickest", () => {
    const r = run([offer("a", "1", { unitPrice: 90 }), offer("b", "2", { unitPrice: 70 })]);
    expect(r.quickest?.key).toBe("b:2:local");
    expect(r.sameWindow.map((c) => c.key)).toEqual(["a:1:local"]);
  });

  it("overlapping run windows from different suppliers are still one window", () => {
    const r = run([offer("a", "1", { unitPrice: 90 }), offer("c", "2", { unitPrice: 70 })]);
    expect(r.quickest?.key).toBe("c:2:local");
    expect(r.sameWindow.map((c) => c.key)).toEqual(["a:1:local"]);
  });

  it("a shelf offer whose run window does not overlap loses speed even when cheaper", () => {
    const r = run([offer("a", "1", { unitPrice: 90 }), offer("slow", "2", { unitPrice: 40 })]);
    expect(r.quickest?.key).toBe("a:1:local");
    expect(r.sameWindow).toEqual([]);
  });

  it("inside a later tier the earlier stated time wins, not the price", () => {
    const nd = (at: string) => ({ arrival: { tier: "next_day" as const, at, orderBy: UNKNOWN } });
    const r = run([offer("a", "1", { unitPrice: 40 }, nd(min(21 * 60))), offer("b", "2", { unitPrice: 60 }, nd(min(16 * 60)))]);
    expect(r.quickest?.key).toBe("b:2:local");
  });

  it("the shelf window is now plus the supplier's run time", () => {
    const r = run([offer("a", "1")]);
    expect(r.quickest?.window).toEqual({ from: min(30), to: min(60) });
  });

  it("a transfer with no stated time never wins speed (doc 26 section 5: ETA unknown - call)", () => {
    const r = run([offer("a", "1", {}, { branchCode: "regional", arrival: { tier: "transfer", at: UNKNOWN, orderBy: UNKNOWN } })]);
    expect(r.quickest).toBeNull();
    expect(r.candidates[0].window).toBe(UNKNOWN);
    expect(r.candidates[0].reasons.join(" ")).toMatch(/arrival time not stated/i);
  });

  it("unknown availability never wins speed but can still be the best price", () => {
    const r = run([offer("a", "1", {}, { arrival: { tier: "unknown", at: UNKNOWN, orderBy: UNKNOWN } })]);
    expect(r.quickest).toBeNull();
    expect(r.bestPrice?.key).toBe("a:1:local");
  });

  it("a shelf quantity read more than 15 minutes ago is not on the shelf any more", () => {
    const stale = offer("a", "1", { lastVerifiedAt: min(-16) });
    const r = run([stale]);
    expect(r.quickest).toBeNull();
    expect(byKey(r, "a:1:local").reasons.join(" ")).toMatch(/16 min ago.*call to confirm/i);
  });

  it("exactly 15 minutes old still counts as live", () => {
    expect(run([offer("a", "1", { lastVerifiedAt: min(-15) })]).quickest?.key).toBe("a:1:local");
  });

  it("a cached shelf quantity never ranks as on the shelf", () => {
    expect(run([offer("a", "1", {}, { qtySource: "cached" })]).quickest).toBeNull();
  });

  it("a supplier with no delivery schedule on file cannot win speed", () => {
    const r = run([offer("zz", "1")]);
    expect(r.quickest).toBeNull();
    expect(r.bestPrice?.key).toBe("zz:1:local");
  });
});

describe("compareOffers: what can never win", () => {
  it("a short quantity wins neither pick", () => {
    const r = run([offer("a", "1", { unitPrice: 10 }, { qty: 2 }), offer("b", "2", { unitPrice: 99 })]);
    expect(r.quickest?.key).toBe("b:2:local");
    expect(r.bestPrice?.key).toBe("b:2:local");
    expect(byKey(r, "a:1:local").reasons).toContain("Only 2 here, need 4");
  });

  it("an unstated quantity wins neither pick", () => {
    const r = run([offer("a", "1", { unitPrice: 10 }, { qty: UNKNOWN })]);
    expect(r.quickest).toBeNull();
    expect(r.bestPrice).toBeNull();
    expect(r.candidates[0].reasons.join(" ")).toMatch(/quantity not stated/i);
  });

  it("not priced and call-for-price never win Best price but can still be quickest", () => {
    const r = run([
      offer("a", "1", { priceStatus: "not_priced", unitPrice: UNKNOWN }),
      offer("b", "2", { priceStatus: "call_for_price", unitPrice: UNKNOWN }),
    ]);
    expect(r.bestPrice).toBeNull();
    expect(r.quickest).not.toBeNull();
    expect(byKey(r, "b:2:local").reasons).toContain("Call for price");
  });

  it("a priced status with a zero or missing price is not a price", () => {
    const r = run([offer("a", "1", { unitPrice: 0 })]);
    expect(r.bestPrice).toBeNull();
  });

  it("unknown FET means the landed price is unknown, so it cannot win Best price", () => {
    const r = run([offer("a", "1", { unitPrice: 10, fet: UNKNOWN }), offer("b", "2", { unitPrice: 99 })]);
    expect(byKey(r, "a:1:local").landedUnit).toBe(UNKNOWN);
    expect(r.bestPrice?.key).toBe("b:2:local");
  });

  it("Best price compares landed cost: unit plus FET plus core", () => {
    const r = run([offer("a", "1", { unitPrice: 80, fet: 12 }), offer("b", "2", { unitPrice: 85, fet: 0, core: 4 })]);
    expect(byKey(r, "a:1:local").landedUnit).toBe(92);
    expect(r.bestPrice?.key).toBe("b:2:local");
  });

  it("a location this account cannot order from wins neither pick", () => {
    const r = run([offer("a", "1", {}, { orderable: "no" })]);
    expect(r.quickest).toBeNull();
    expect(r.bestPrice).toBeNull();
    expect(r.candidates[0].reasons.join(" ")).toMatch(/call to source/i);
  });

  it("orderable not confirmed competes on price only", () => {
    const r = run([offer("a", "1", {}, { orderable: UNKNOWN })]);
    expect(r.quickest).toBeNull();
    expect(r.bestPrice?.key).toBe("a:1:local");
  });

  it("a size that does not match is never a pick", () => {
    const r = run([offer("a", "1", { fitConfidence: "not_confirmed" })]);
    expect(r.quickest).toBeNull();
    expect(r.bestPrice).toBeNull();
  });

  it("a conditional fit can win and carries its condition", () => {
    const r = run([offer("a", "1", { fitConfidence: "conditional", fitConditions: ["Front axle only"] })]);
    expect(r.quickest?.reasons).toContain("Fits only if: Front axle only");
  });
});

describe("compareOffers: shape", () => {
  it("each location of an offer is its own candidate, speed-eligible first", () => {
    const o = offer("a", "1");
    o.locations.push(loc({ branchCode: "regional", qty: 20, orderable: UNKNOWN, arrival: { tier: "transfer", at: UNKNOWN, orderBy: UNKNOWN } }));
    const r = run([o]);
    expect(r.candidates.map((c) => c.key)).toEqual(["a:1:local", "a:1:regional"]);
  });

  it("clamps the quantity to a whole number of at least 1", () => {
    expect(compareOffers([], 0, NOW).qtyNeeded).toBe(1);
    expect(compareOffers([], 3.7, NOW).qtyNeeded).toBe(3);
  });

  it("an empty list has no picks", () => {
    const r = run([]);
    expect([r.quickest, r.bestPrice, r.candidates.length]).toEqual([null, null, 0]);
  });
});

describe("normalizeTireSize", () => {
  it.each([
    ["225/65R17", "225/65R17"],
    ["2256517", "225/65R17"],
    ["225 65 17", "225/65R17"],
    ["225/65-17", "225/65R17"],
    ["p225/65r17", "225/65R17"],
    ["245/40ZR18", "245/40R18"],
    ["225/65R17 102H", "225/65R17"],
  ])("%s -> %s", (raw, want) => expect(normalizeTireSize(raw)).toBe(want));

  it.each(["LT265/70R17", "abc", "22565", "225/65R17/9", ""])("rejects %s", (raw) => expect(normalizeTireSize(raw)).toBeNull());
});

// Added after the mutation run: deleting the tier sort key, the unknown-window guard or the same-tier tie
// condition left every earlier test green.
describe("compareOffers: rules the mutation run showed were unpinned", () => {
  it("tier ranks before the clock: a shipment stated to land in 10 min still loses Quickest to shelf stock", () => {
    const r = run([
      offer("a", "1", { unitPrice: 90 }),
      offer("b", "2", { unitPrice: 50 }, { arrival: { tier: "ship", at: min(10), orderBy: UNKNOWN }, fulfillmentMode: "ship" }),
    ]);
    expect(r.quickest?.key).toBe("a:1:local");
    expect(r.candidates[0].key).toBe("a:1:local");
  });

  it.each([
    ["transfer with no stated time", { tier: "transfer" as const, at: UNKNOWN, orderBy: UNKNOWN }],
    ["unknown tier", { tier: "unknown" as const, at: UNKNOWN, orderBy: UNKNOWN }],
  ])("an orderable offer with %s never wins Quickest, but can win price", (_label, arrival) => {
    const r = run([offer("a", "1", {}, { arrival, fulfillmentMode: "transfer" })]);
    expect(r.quickest).toBeNull();
    expect(r.bestPrice?.key).toBe("a:1:local");
    expect(byKey(r, "a:1:local").canWinQuickest).toBe(false);
  });

  it("a cheaper transfer whose window overlaps the shelf run is not a speed tie: ties stay inside one tier", () => {
    const r = run([
      offer("a", "1", { unitPrice: 90 }),
      offer("b", "2", { unitPrice: 50 }, { arrival: { tier: "transfer", at: min(0), orderBy: UNKNOWN }, fulfillmentMode: "transfer" }),
    ]);
    expect(r.quickest?.key).toBe("a:1:local");
    expect(r.sameWindow).toEqual([]);
  });
});

describe("compareOffers: second-reader findings", () => {
  it("two offers with no part number stay separate, so a cheaper cached one is not hidden behind the quickest", () => {
    const fast = offer("a", "", { unitPrice: 100 });
    const cheap = offer("a", "", { unitPrice: 70 }, { qtySource: "cached" });
    const r = run([fast, cheap]);
    expect(new Set(r.candidates.map((c) => c.key)).size).toBe(r.candidates.length);
    expect(r.quickest?.offer).toBe(fast);
    expect(r.bestPrice?.offer).toBe(cheap);
    expect(r.quickest?.key).not.toBe(r.bestPrice?.key);
  });
});
