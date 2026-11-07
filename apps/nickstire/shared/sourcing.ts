/**
 * Supplier offers and the two counter picks: Quickest arrival and Best price.
 *
 * Contract: docs/plans/shop-os/26-VENDOR-SCHEMATICS.md section 2 (fields table, "Delivery reality", "Rules that
 * follow") and section 5. Nour, 2026-11-06: route suppliers run "about 30 min to an hour unless held up" and
 * "the availability is what differs", so speed ranks WHERE THE PART IS before any clock.
 *
 * UNKNOWN is a value, never null or zero: an adapter that cannot read a field says UNKNOWN, and nothing here turns
 * UNKNOWN into a number. Pure: no I/O, and the only clock is the `now` argument.
 */

export const UNKNOWN = "UNKNOWN" as const;
export type Unknown = typeof UNKNOWN;
export type Maybe<T> = T | Unknown;

/** Rank order, fastest first (doc 26 section 2 table). `unknown` never ranks for speed. */
const AVAILABILITY_TIERS = ["shelf", "transfer", "next_day", "ship", "unknown"] as const;
export type AvailabilityTier = (typeof AVAILABILITY_TIERS)[number];

/** Where a figure came from (doc 26 `sourceTags`). Only `supplier_live` stock can rank as on the shelf. */
export type SourceTag = "supplier_live" | "cached" | "catalog_fitment" | "manual";

export interface OfferLocation {
  /** Stable within the offer ("local", "regional", a branch number). */
  branchCode: string;
  branchName: string;
  kind: "store" | "warehouse" | "coop" | "network" | Unknown;
  qty: Maybe<number>;
  qtySource: SourceTag;
  /** Can THIS account order from this location online? Doc 26: a "no" location is call-to-source, never a pick. */
  orderable: "yes" | "no" | Unknown;
  /** `at`: when the supplier says it leaves for or reaches the shop (ISO). `orderBy`: the cutoff for that time. */
  arrival: { tier: AvailabilityTier; at: Maybe<string>; orderBy: Maybe<string> };
  fulfillmentMode: "route" | "pickup" | "ship" | "transfer" | "courier" | Unknown;
}

export interface SupplierOffer {
  supplierId: string;
  supplierName: string;
  sku: string;
  description: string;
  priceStatus: "priced" | "not_priced" | "call_for_price";
  /** Dealer cost per unit, USD. */
  unitPrice: Maybe<number>;
  /** Federal excise tax per unit. */
  fet: Maybe<number>;
  /** Core deposit per unit; tires carry none. */
  core: Maybe<number> | "not_applicable";
  priceSource: SourceTag;
  /** Size match for a size search; vehicle fit once a vehicle lookup exists. A not-confirmed fit is never a pick. */
  fitConfidence: "confirmed" | "conditional" | "not_confirmed";
  fitConditions: string[];
  /** When this offer's stock and price were read from the supplier (ISO). */
  lastVerifiedAt: string;
  locations: OfferLocation[];
}

/**
 * Per-supplier delivery table - schedule, not live. Doc 26: "Per-supplier static table until an API says otherwise".
 * Replace runMinutes with the measured median / 90th percentile once ~20 received deliveries exist.
 */
export interface SupplierSchedule {
  name: string;
  runMinutes: { min: number; max: number };
  /** A shelf quantity read longer ago than this no longer ranks as on the shelf. */
  shelfMaxAgeMinutes: number;
  basis: "schedule, not live";
  source: string;
}

export const SUPPLIER_SCHEDULES: Readonly<Record<string, SupplierSchedule>> = {
  gateway_dk: {
    name: "Gateway Tire (D&K)",
    runMinutes: { min: 30, max: 60 },
    shelfMaxAgeMinutes: 15,
    basis: "schedule, not live",
    source: "Nour 2026-11-06, docs/plans/shop-os/26-VENDOR-SCHEMATICS.md section 2",
  },
};

export interface Candidate {
  /** supplierId:sku:branchCode, unique in one comparison. */
  key: string;
  offer: SupplierOffer;
  location: OfferLocation;
  /** Unit price plus FET and core; UNKNOWN when any fee is unknown. */
  landedUnit: Maybe<number>;
  /** Earliest and latest arrival at the shop (ISO); UNKNOWN when no time can be honestly computed. */
  window: Maybe<{ from: string; to: string }>;
  canWinQuickest: boolean;
  canWinPrice: boolean;
  /** Why it cannot win, or what to check before promising it, in counter words. */
  reasons: string[];
}

export interface Comparison {
  qtyNeeded: number;
  now: string;
  quickest: Candidate | null;
  /** Other offers in the quickest one's tier and run window: a speed tie, cheapest first. */
  sameWindow: Candidate[];
  bestPrice: Candidate | null;
  /** Quickest-eligible by speed, then the rest by price. */
  candidates: Candidate[];
}

/**
 * 2256517, 225/65R17, 225/65-17, 225 65 17, P225/65ZR17 102H -> 225/65R17; anything else -> null.
 * shortcut: LT sizes are refused because gatewayClient.searchTiresBySize mangles a leading "LT"; accept them once it doesn't.
 */
export function normalizeTireSize(raw: string): string | null {
  const m = /^\s*P?\s*(\d{3})\s*[/ -]?\s*(\d{2})\s*(?:Z?R|-|\s)?\s*(\d{2})(?:\s+\d{2,3}[A-Z]{1,2})?\s*$/i.exec(raw);
  return m ? `${m[1]}/${m[2]}R${m[3]}` : null;
}

const MINUTE = 60_000;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function landedUnit(o: SupplierOffer): Maybe<number> {
  if (o.priceStatus !== "priced" || !isNum(o.unitPrice) || o.unitPrice <= 0) return UNKNOWN;
  if (!isNum(o.fet)) return UNKNOWN;
  if (o.core !== "not_applicable" && !isNum(o.core)) return UNKNOWN;
  return o.unitPrice + o.fet + (o.core === "not_applicable" ? 0 : o.core);
}

function rankOne(
  o: SupplierOffer,
  l: OfferLocation,
  need: number,
  nowMs: number,
  schedules: Readonly<Record<string, SupplierSchedule>>,
): Candidate {
  const reasons: string[] = [];
  let speed = true;
  let price = true;

  if (l.qty === UNKNOWN) {
    reasons.push("Quantity not stated - call to confirm");
    speed = price = false;
  } else if (l.qty < need) {
    reasons.push(`Only ${l.qty} here, need ${need}`);
    speed = price = false;
  }

  if (l.orderable === "no") {
    reasons.push("Not orderable on this account - call to source");
    speed = price = false;
  } else if (l.orderable === UNKNOWN) {
    reasons.push("Not confirmed orderable online - call to confirm");
    speed = false;
  }

  if (o.fitConfidence === "not_confirmed") {
    reasons.push("Size not confirmed");
    speed = price = false;
  } else if (o.fitConfidence === "conditional" && o.fitConditions.length > 0) {
    reasons.push(`Fits only if: ${o.fitConditions.join(", ")}`);
  }

  const landed = landedUnit(o);
  if (o.priceStatus === "call_for_price") reasons.push("Call for price");
  else if (o.priceStatus === "not_priced" || !isNum(o.unitPrice) || o.unitPrice <= 0) reasons.push("No price from supplier");
  else if (landed === UNKNOWN) reasons.push("Fees not stated - call for the total");
  if (landed === UNKNOWN) price = false;

  const ageMin = Math.round((nowMs - Date.parse(o.lastVerifiedAt)) / MINUTE);
  const sched = schedules[o.supplierId];
  let window: Candidate["window"] = UNKNOWN;
  const { tier, at } = l.arrival;
  if (!sched) {
    reasons.push("No delivery schedule on file for this supplier");
  } else if (!Number.isFinite(ageMin) || ageMin > sched.shelfMaxAgeMinutes) {
    reasons.push(`Stock checked ${Number.isFinite(ageMin) ? `${ageMin} min ago` : "at an unknown time"} - call to confirm`);
  } else if (tier === "unknown") {
    reasons.push("No arrival information - call to confirm");
  } else if (tier === "shelf") {
    if (l.qtySource === "supplier_live") {
      window = span(nowMs, sched.runMinutes);
    } else {
      reasons.push("Stock not checked live - call to confirm");
    }
  } else if (at === UNKNOWN || !Number.isFinite(Date.parse(at))) {
    reasons.push("Arrival time not stated - call to confirm");
  } else {
    window = tier === "ship" ? span(Date.parse(at), { min: 0, max: 0 }) : span(Date.parse(at), sched.runMinutes);
  }
  if (window === UNKNOWN) speed = false;

  return {
    key: `${o.supplierId}:${o.sku}:${l.branchCode}`,
    offer: o,
    location: l,
    landedUnit: landed,
    window,
    canWinQuickest: speed,
    canWinPrice: price,
    reasons,
  };
}

function span(startMs: number, run: { min: number; max: number }) {
  return { from: new Date(startMs + run.min * MINUTE).toISOString(), to: new Date(startMs + run.max * MINUTE).toISOString() };
}

const tierOf = (c: Candidate) => AVAILABILITY_TIERS.indexOf(c.location.arrival.tier);
const win = (c: Candidate) => (c.window === UNKNOWN ? null : { from: Date.parse(c.window.from), to: Date.parse(c.window.to) });
const cost = (c: Candidate) => (c.landedUnit === UNKNOWN ? Infinity : c.landedUnit);

function bySpeed(a: Candidate, b: Candidate): number {
  const wa = win(a);
  const wb = win(b);
  return (
    tierOf(a) - tierOf(b) ||
    (wa?.from ?? Infinity) - (wb?.from ?? Infinity) ||
    (wa?.to ?? Infinity) - (wb?.to ?? Infinity) ||
    cost(a) - cost(b) ||
    a.key.localeCompare(b.key)
  );
}

const byPrice = (a: Candidate, b: Candidate) => cost(a) - cost(b) || bySpeed(a, b);

export function compareOffers(
  offers: readonly SupplierOffer[],
  qtyNeeded: number,
  now: Date,
  schedules: Readonly<Record<string, SupplierSchedule>> = SUPPLIER_SCHEDULES,
): Comparison {
  const need = Math.max(1, Math.floor(qtyNeeded));
  const nowMs = now.getTime();
  const all = offers.flatMap((o) => o.locations.map((l) => rankOne(o, l, need, nowMs, schedules)));

  const fast = all.filter((c) => c.canWinQuickest).sort(bySpeed);
  // Doc 26: offers in one tier whose run windows overlap are a speed tie; price decides between them.
  const lead = fast[0];
  const leadWin = lead ? win(lead) : null;
  const group = lead
    ? fast
        .filter((c) => {
          const w = win(c);
          return tierOf(c) === tierOf(lead) && w !== null && leadWin !== null && w.from <= leadWin.to && leadWin.from <= w.to;
        })
        .sort(byPrice)
    : [];

  return {
    qtyNeeded: need,
    now: now.toISOString(),
    quickest: group[0] ?? null,
    sameWindow: group.slice(1),
    bestPrice: all.filter((c) => c.canWinPrice).sort(byPrice)[0] ?? null,
    candidates: [...fast, ...all.filter((c) => !c.canWinQuickest).sort(byPrice)],
  };
}
