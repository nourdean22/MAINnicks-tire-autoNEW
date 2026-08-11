import { describe, expect, it } from "vitest";
import {
  CACHE_ROWS_PER_SIZE,
  cleanSize,
  computeSizePriceFloors,
  selectCheapestPriced,
  type CachedPriceLike,
} from "./tirePriceRanges";

function price(over: Partial<CachedPriceLike> = {}): CachedPriceLike {
  return {
    size: "205/55R16",
    brand: "FORTUNE",
    model: "Tormenta",
    wholesaleCost: 50,
    localQty: 2,
    fetchedAt: Date.now(),
    ...over,
  };
}

describe("cleanSize", () => {
  it("strips separators the same way the cache keys do", () => {
    expect(cleanSize("205/55R16")).toBe("2055516");
    expect(cleanSize("205 55 r16")).toBe("2055516");
  });
});

describe("selectCheapestPriced", () => {
  it("keeps the cheapest option even when the feed returns it past the cache cap", () => {
    // The regression this exists for: an unsorted feed with the cheapest
    // tire at position 20 used to be sliced away, so the published floor
    // overstated the real price.
    const feed = Array.from({ length: 25 }, (_, i) =>
      price({ wholesaleCost: i === 20 ? 30 : 100 + i, model: `M${i}` }),
    );
    const kept = selectCheapestPriced(feed);
    expect(kept).toHaveLength(CACHE_ROWS_PER_SIZE);
    expect(kept[0].wholesaleCost).toBe(30);
    expect(computeSizePriceFloors([{ size: "205/55R16", prices: kept }], 100)[0].fromPrice).toBe(60);
  });

  it("returns rows in ascending cost order", () => {
    const kept = selectCheapestPriced([
      price({ wholesaleCost: 90 }),
      price({ wholesaleCost: 40 }),
      price({ wholesaleCost: 65 }),
    ]);
    expect(kept.map((k) => k.wholesaleCost)).toEqual([40, 65, 90]);
  });

  it("drops $0 backorder rows so they cannot consume cache slots", () => {
    const kept = selectCheapestPriced([price({ wholesaleCost: 0 }), price({ wholesaleCost: 55 })]);
    expect(kept).toHaveLength(1);
    expect(kept[0].wholesaleCost).toBe(55);
  });

  it("does not mutate the caller's array", () => {
    const feed = [price({ wholesaleCost: 90 }), price({ wholesaleCost: 40 })];
    selectCheapestPriced(feed);
    expect(feed.map((f) => f.wholesaleCost)).toEqual([90, 40]);
  });

  it("returns everything when the feed is smaller than the cap", () => {
    expect(selectCheapestPriced([price({ wholesaleCost: 50 })])).toHaveLength(1);
    expect(selectCheapestPriced([])).toEqual([]);
  });
});

describe("computeSizePriceFloors", () => {
  it("applies markup with publicSearch's rounding and ceils the floor to whole dollars", () => {
    // wholesale 45.50 at 100% markup -> 91.00 exactly; 45.51 -> 91.02 -> floor 92
    const floors = computeSizePriceFloors(
      [{ size: "205/55R16", prices: [price({ wholesaleCost: 45.51 }), price({ wholesaleCost: 60 })] }],
      100,
    );
    expect(floors).toHaveLength(1);
    expect(floors[0].fromPrice).toBe(92);
  });

  it("filters $0 backorder rows and drops sizes with no priced options", () => {
    const floors = computeSizePriceFloors(
      [
        { size: "205/55R16", prices: [price({ wholesaleCost: 0 })] },
        { size: "215/60R16", prices: [] },
        { size: "215/60R17", prices: [price({ wholesaleCost: 0 }), price({ wholesaleCost: 40 })] },
      ],
      100,
    );
    expect(floors).toHaveLength(1);
    expect(floors[0]).toMatchObject({ size: "215/60R17", fromPrice: 80, optionCount: 1 });
  });

  it("counts in-stock options separately from priced options", () => {
    const floors = computeSizePriceFloors(
      [{
        size: "195/65R15",
        prices: [
          price({ wholesaleCost: 40, localQty: 3 }),
          price({ wholesaleCost: 55, localQty: 0 }),
        ],
      }],
      100,
    );
    expect(floors[0].optionCount).toBe(2);
    expect(floors[0].inStockCount).toBe(1);
  });

  it("returns an empty array when the cache is entirely cold", () => {
    expect(computeSizePriceFloors([], 100)).toEqual([]);
  });

  it("never emits a $0 or negative floor", () => {
    const floors = computeSizePriceFloors(
      [{ size: "205/55R16", prices: [price({ wholesaleCost: 0.01 })] }],
      0,
    );
    expect(floors[0].fromPrice).toBeGreaterThan(0);
  });
});
