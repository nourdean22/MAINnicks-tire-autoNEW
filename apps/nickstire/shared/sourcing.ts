/**
 * Supplier offer comparison: Best Price and Quickest Arrival.
 *
 * Source: docs/plans/shop-os/26-VENDOR-SCHEMATICS.md section 2 ("Delivery reality") and
 * 03-VENDORS.md correction 7. Nour, 2026-11-06: route suppliers "are all usually about 30 min to
 * an hour unless held up" - what differs is availability. So Quickest Arrival ranks by WHERE THE
 * PART IS first (availability tier), then by a stated arrival time, then by price. Two offers on
 * the shelf at their servicing branches are a speed tie and the cheaper one wins.
 *
 * Pure: no I/O, no clock reads except the `now` argument. Supplier adapters turn their own data
 * into `SupplierOffer`s; this module never guesses a value an adapter did not supply.
 */

/** Rank order, fastest first. `unknown` is never ranked for speed. */
const AVAILABILITY_TIERS = ["shelf", "transfer", "next_day", "ship", "unknown"] as const;
export type AvailabilityTier = (typeof AVAILABILITY_TIERS)[number];

export const TIER_LABEL: Record<AvailabilityTier, string> = {
  shelf: "On the shelf",
  transfer: "Transfer from another branch",
  next_day: "Next day",
  ship: "Shipped",
  unknown: "Unknown - call",
};

/** Stated default run time for local route delivery (Nour, 2026-11-06). Replaced per supplier once measured. */
export const DEFAULT_RUN_MINUTES = { min: 30, max: 60 } as const;

/** A shelf quantity older than this is not trusted as "on the shelf". */
const LIVE_STOCK_MAX_AGE_MINUTES = 15;

export interface SupplierOffer {
  /** Unique within one comparison (supplier + sku + location). */
  id: string;
  supplierId: string;
  supplierName: string;
  /** Branch or stock bucket as the supplier labels it ("Local", "Regional", "Euclid store"). */
  location: string | null;
  sku: string;
  brand: string;
  description: string;
  /** Dealer cost per unit in USD. null = the supplier gave no price (never wins Best Price). */
  unitCost: number | null;
  /** Units the supplier says are available at `location`. null = not stated. */
  qtyAvailable: number | null;
  tier: AvailabilityTier;
  /** Earliest arrival the supplier itself states (ISO). null when it states none. */
  statedArrival: string | null;
  /** Run time to the shop for local deliveries, and where that number came from. */
  runMinutes: { min: number; max: number } | null;
  runSource: "default" | "measured" | null;
  /** When the quantity and price were read from the supplier (ISO). */
  verifiedAt: string;
  source: "supplier_live" | "cached" | "manual";
  /** Extra caveats the adapter wants shown (e.g. "Regional timing unknown - call"). */
  notes?: string[];
}

export interface RankedOffer extends SupplierOffer {
  /** qtyAvailable >= qtyNeeded; null when the supplier did not state a quantity. */
  coversQty: boolean | null;
  /** Eligible to win Quickest Arrival. */
  rankableForSpeed: boolean;
  /** Eligible to win Best Price. */
  rankableForPrice: boolean;
  /** Why the offer is demoted or excluded, in counter language. */
  reasons: string[];
}

export interface OfferComparison {
  qtyNeeded: number;
  /** Speed-eligible offers fastest first, then the rest cheapest first. */
  offers: RankedOffer[];
  bestPrice: RankedOffer | null;
  quickest: RankedOffer | null;
  /** The same offer won both picks. */
  sameOffer: boolean;
  /** The quickest offer shares its tier and arrival with at least one other offer (price broke the tie). */
  speedTie: boolean;
  /** One line for the counter, or null. */
  note: string | null;
}

const tierIndex = (t: AvailabilityTier): number => AVAILABILITY_TIERS.indexOf(t);

function arrivalMs(o: SupplierOffer): number | null {
  if (!o.statedArrival) return null;
  const ms = Date.parse(o.statedArrival);
  return Number.isFinite(ms) ? ms : null;
}

function cmpNullableAsc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function rankOne(o: SupplierOffer, qtyNeeded: number, nowMs: number): RankedOffer {
  const reasons: string[] = [];
  const coversQty = o.qtyAvailable === null ? null : o.qtyAvailable >= qtyNeeded;
  if (coversQty === false) reasons.push(`Only ${o.qtyAvailable} here - need ${qtyNeeded}`);
  if (coversQty === null) reasons.push("Quantity not stated");

  let rankableForSpeed = o.tier !== "unknown" && coversQty !== false;
  if (o.tier === "unknown") reasons.push("No arrival information - call to confirm");

  const ageMin = (nowMs - Date.parse(o.verifiedAt)) / 60_000;
  const stale = !Number.isFinite(ageMin) || ageMin > LIVE_STOCK_MAX_AGE_MINUTES;
  if (o.tier === "shelf" && (o.source !== "supplier_live" || stale)) {
    rankableForSpeed = false;
    reasons.push("Stock not checked live - call to confirm");
  }

  const rankableForPrice = o.unitCost !== null && o.unitCost > 0 && coversQty !== false;
  if (o.unitCost === null || o.unitCost <= 0) reasons.push("No price from supplier");

  return { ...o, coversQty, rankableForSpeed, rankableForPrice, reasons: [...reasons, ...(o.notes ?? [])] };
}

/** Speed order: tier, then stated arrival (known before unknown), then price (priced before unpriced). */
function speedOrder(a: RankedOffer, b: RankedOffer): number {
  return (
    tierIndex(a.tier) - tierIndex(b.tier) ||
    cmpNullableAsc(arrivalMs(a), arrivalMs(b)) ||
    cmpNullableAsc(a.unitCost, b.unitCost) ||
    a.id.localeCompare(b.id)
  );
}

/** Price order: price, then speed as the tie-break. */
function priceOrder(a: RankedOffer, b: RankedOffer): number {
  return cmpNullableAsc(a.unitCost, b.unitCost) || speedOrder(a, b);
}

/** Accepts 2256517, 225/65R17, 225/65-17, 225 65 17 and returns 225/65R17; anything else is null. */
export function normalizeTireSize(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!/^\d{7}$/.test(digits)) return null;
  return `${digits.slice(0, 3)}/${digits.slice(3, 5)}R${digits.slice(5)}`;
}

export function compareOffers(
  input: readonly SupplierOffer[],
  qtyNeeded: number,
  now: Date = new Date(),
): OfferComparison {
  const need = Math.max(1, Math.floor(qtyNeeded));
  const nowMs = now.getTime();
  const ranked = input.map((o) => rankOne(o, need, nowMs));

  const speedPool = ranked.filter((o) => o.rankableForSpeed).sort(speedOrder);
  const rest = ranked.filter((o) => !o.rankableForSpeed).sort(priceOrder);
  const quickest = speedPool[0] ?? null;
  const bestPrice = ranked.filter((o) => o.rankableForPrice).sort(priceOrder)[0] ?? null;

  const speedTie =
    quickest !== null &&
    speedPool.some(
      (o) => o.id !== quickest.id && o.tier === quickest.tier && arrivalMs(o) === arrivalMs(quickest),
    );
  const sameOffer = quickest !== null && bestPrice !== null && quickest.id === bestPrice.id;

  let note: string | null = null;
  if (ranked.length === 0) note = "No supplier returned an offer.";
  else if (!quickest && !bestPrice) note = "Nothing can be confirmed for this quantity - call the suppliers.";
  else if (sameOffer) note = "The cheapest offer is also the quickest.";
  else if (speedTie) note = "Several suppliers are in the same delivery window - the cheaper one is shown as quickest.";
  else if (!quickest) note = "No offer has confirmed live stock - call to confirm before promising a time.";

  return { qtyNeeded: need, offers: [...speedPool, ...rest], bestPrice, quickest, sameOffer, speedTie, note };
}
