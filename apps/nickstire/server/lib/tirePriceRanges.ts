/**
 * Tire price floors — pure aggregation over the Gateway pipeline price
 * cache, for the public /tire-prices-cleveland AEO page.
 *
 * Wholesale numbers NEVER leave this module: callers get retail floors
 * only ("shop price" = wholesale x (1 + markup%)), using the exact
 * rounding publicSearch applies (server/routers/gatewayTire.ts), so
 * this page and the tire finder can never disagree on a price.
 */

export interface CachedPriceLike {
  size: string; // formatted, e.g. "205/55R16"
  brand: string;
  model: string;
  /** Nick's cost. D&K's field naming is inverted — see gatewayClient.pickWholesaleCost. */
  wholesaleCost: number;
  localQty: number;
  fetchedAt: number;
}

export interface SizePriceFloor {
  /** Formatted size, e.g. "205/55R16" */
  size: string;
  /** Whole dollars, per tire (install included in the package model). */
  fromPrice: number;
  /** Priced options in the distributor feed for this size. */
  optionCount: number;
  /** Options with local quantity on hand (same-day). */
  inStockCount: number;
}

/**
 * The sizes the daily refresh cron prices. Single source of truth —
 * refreshGatewayPrices (dataPipelines) and publicPriceRanges
 * (gatewayTire) both iterate this list.
 */
export const PRICED_SIZES = [
  "205/55R16", "215/60R16", "215/60R17", "225/70R17", "235/65R18",
  "245/70R16", "265/70R17", "265/70R18", "275/60R20", "195/65R15",
] as const;

/** Cache keys are the size with separators stripped ("205/55R16" -> "2055516"). */
export function cleanSize(size: string): string {
  return size.replace(/[/Rr\s-]/g, "");
}

/**
 * How many priced options the refresh keeps per size in the cache.
 * The cap exists to bound memory + the persisted snapshot, not to pick
 * a subset of the catalog — see selectCheapestPriced for why order matters.
 */
export const CACHE_ROWS_PER_SIZE = 15;

/**
 * Keep the CHEAPEST priced options for a size, not the first N the
 * distributor happened to return.
 *
 * 2026-08-11: the refresh sliced the raw D&K response before sorting, so
 * an unsorted feed could push the true cheapest tire past the cut and the
 * published "from $X" floor OVERSTATED the real price (measured: floor
 * said $97 while a live search showed an $88.36 option in the same size).
 * Overstating is the safe direction for a public claim, but it costs the
 * page its point. Sorting first makes the floor exact for the same cache
 * size. $0 rows (backorder rows with no pricing attached — audit #152)
 * are dropped here so they stop consuming cache slots.
 */
export function selectCheapestPriced<T extends { wholesaleCost: number }>(
  rows: readonly T[],
  limit: number = CACHE_ROWS_PER_SIZE,
): T[] {
  return rows
    .filter((r) => r.wholesaleCost > 0)
    .slice()
    .sort((a, b) => a.wholesaleCost - b.wholesaleCost)
    .slice(0, limit);
}

export function computeSizePriceFloors(
  bySize: ReadonlyArray<{ size: string; prices: ReadonlyArray<CachedPriceLike> }>,
  markupPct: number,
): SizePriceFloor[] {
  const floors: SizePriceFloor[] = [];
  for (const { size, prices } of bySize) {
    // $0 rows are backorder rows with no pricing attached (audit #152) —
    // never let them produce a "$0 from" floor.
    const priced = prices.filter((p) => p.wholesaleCost > 0);
    if (priced.length === 0) continue;
    // Identical rounding to publicSearch: ceil to cents per tire, then
    // ceil the minimum to a whole dollar — "from $X" is a floor claim.
    const retail = priced.map(
      (p) => Math.ceil(p.wholesaleCost * (1 + markupPct / 100) * 100) / 100,
    );
    floors.push({
      size,
      fromPrice: Math.ceil(Math.min(...retail)),
      optionCount: priced.length,
      inStockCount: priced.filter((p) => p.localQty > 0).length,
    });
  }
  return floors;
}
