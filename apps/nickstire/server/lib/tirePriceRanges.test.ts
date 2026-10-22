import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_ROWS_PER_SIZE,
  cleanSize,
  computeSizePriceFloors,
  dropPriceOutliers,
  selectCheapestPriced,
  type CachedPriceLike,
} from "./tirePriceRanges";

// publicSearch harness: no DB (markup falls back to 100%), the pipeline cache
// and the D&K search are stubbed per test. pickWholesaleCost stays real.
const { getCachedPrices, searchTiresBySize } = vi.hoisted(() => ({
  getCachedPrices: vi.fn(),
  searchTiresBySize: vi.fn(),
}));
vi.mock("./db-helper", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db-helper")>()),
  db: vi.fn().mockResolvedValue(null),
}));
vi.mock("../services/dataPipelines", () => ({ getCachedPrices }));
vi.mock("../services/gatewayClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/gatewayClient")>()),
  searchTiresBySize,
}));

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

/**
 * REAL rows, read 2026-10-22 from the public tire finder
 * (gatewayTire.publicSearch, price-low): the 15 cheapest RETAIL prices per
 * size, how many priced options the size had, and the median retail price of
 * that whole list. Wholesale = retail / 2 (100% markup).
 */
const REAL = {
  // VENEZIA CROSSROAD SXT at 25.77 is a feed error: the same tire is 167.66 in 275/60R20.
  "265/70R18": { n: 173, medianRetail: 362.5, cheapest: [25.77, 147.89, 171.8, 180.34, 180.57, 190.52, 199.21, 199.6, 200.26, 201.54, 202.7, 207.05, 215.46, 219.8, 221.69] },
  "275/60R20": { n: 219, medianRetail: 362.62, cheapest: [64.42, 167.66, 170.68, 199, 204.02, 204.09, 206.46, 208.22, 211.69, 214.29, 226, 227.5, 231.23, 231.69, 233.42] },
  // Real budget clusters: every row must survive.
  "205/55R16": { n: 166, medianRetail: 170.76, cheapest: [79.09, 80.13, 85.46, 86.54, 86.64, 88.36, 88.5, 88.68, 90.54, 91.86, 92.6, 92.63, 93.86, 94.16, 94.5] },
  "195/65R15": { n: 116, medianRetail: 129, cheapest: [58.68, 67.81, 68.88, 70.8, 78.42, 79.32, 80.31, 81.64, 83.7, 85, 85.02, 86.2, 86.7, 86.7, 86.74] },
  // A take-off (115.95) and a blem (117.63): real, cheap, and only 0.36 of the
  // full-list median, so a full-list median at 0.4 would wrongly hide them.
  "265/70R17": { n: 391, medianRetail: 321.26, cheapest: [115.95, 117.63, 166.5, 171.22, 172.5, 175.57, 178.58, 179.9, 181.1, 181.15, 193, 193.24, 193.88, 198, 198.58] },
} as const;
type RealSize = keyof typeof REAL;
const OUTLIER_RETAIL: Partial<Record<RealSize, number>> = { "265/70R18": 25.77, "275/60R20": 64.42 };

/** The size's 15 cheapest rows: what the cache held on 2026-10-21. */
function cut15(size: RealSize): CachedPriceLike[] {
  return REAL[size].cheapest.map((retail, i) =>
    price({ size, brand: `REAL${i}`, model: `row-${i}`, wholesaleCost: retail / 2 }),
  );
}

/**
 * The full feed: the 15 real rows plus a SYNTHETIC tail (n - 15 rows, evenly
 * spaced from the 15th price to 2 x median - p15) so the list has the real
 * size and a median near the real one.
 */
function fullList(size: RealSize): CachedPriceLike[] {
  const { n, medianRetail, cheapest } = REAL[size];
  const from = cheapest[cheapest.length - 1];
  const to = 2 * medianRetail - from;
  const m = n - cheapest.length;
  const tail = Array.from({ length: m }, (_, i) =>
    price({ size, brand: "SYNTH", model: `synthetic-${i}`, wholesaleCost: (from + ((to - from) * i) / (m - 1)) / 2 }),
  );
  return [...cut15(size), ...tail];
}

const retailOf = (rows: CachedPriceLike[]) => rows.map((r) => Math.round(r.wholesaleCost * 2 * 100) / 100);

describe("cleanSize", () => {
  it("strips separators the same way the cache keys do", () => {
    expect(cleanSize("205/55R16")).toBe("2055516");
    expect(cleanSize("205 55 r16")).toBe("2055516");
  });
});

describe("dropPriceOutliers", () => {
  for (const shape of ["full feed", "15-cheapest cut"] as const) {
    const rowsFor = shape === "full feed" ? fullList : cut15;

    it(`${shape}: drops exactly the two feed errors`, () => {
      for (const size of ["265/70R18", "275/60R20"] as const) {
        const rows = rowsFor(size);
        const kept = dropPriceOutliers(rows, "test");
        expect(retailOf(kept)).not.toContain(OUTLIER_RETAIL[size]);
        expect(kept).toHaveLength(rows.length - 1);
      }
    });

    it(`${shape}: keeps every row of the real budget clusters`, () => {
      for (const size of ["205/55R16", "195/65R15", "265/70R17"] as const) {
        const rows = rowsFor(size);
        expect(dropPriceOutliers(rows, "test")).toEqual(rows);
      }
    });
  }

  it("leaves fewer than 4 priced rows alone: there is no distribution to judge by", () => {
    const rows = [12.88, 73.94, 85.9].map((w) => price({ wholesaleCost: w }));
    expect(dropPriceOutliers(rows, "test")).toEqual(rows);
  });

  it("ignores $0 rows for the median and passes them through to the caller's own $0 filter", () => {
    const zeros = Array.from({ length: 6 }, () => price({ wholesaleCost: 0 }));
    const rows = [...zeros, price({ wholesaleCost: 10 }), ...[50, 52, 55, 58].map((w) => price({ wholesaleCost: w }))];
    // Counting the zeros would put the median at 0 and keep the $10 row.
    const kept = dropPriceOutliers(rows, "test");
    expect(kept.map((r) => r.wholesaleCost)).toEqual([0, 0, 0, 0, 0, 0, 50, 52, 55, 58]);
  });

  it("keeps the input order", () => {
    const rows = [90, 12, 70, 85, 60, 75].map((w) => price({ wholesaleCost: w }));
    expect(dropPriceOutliers(rows, "test").map((r) => r.wholesaleCost)).toEqual([90, 70, 85, 60, 75]);
  });
});

describe("selectCheapestPriced", () => {
  it("keeps the cheapest option even when the feed returns it past the cache cap", () => {
    // The regression this exists for: an unsorted feed with the cheapest
    // tire at position 20 used to be sliced away, so the published floor
    // overstated the real price.
    const feed = Array.from({ length: 25 }, (_, i) =>
      price({ wholesaleCost: i === 20 ? 60 : 100 + i, model: `M${i}` }),
    );
    const kept = selectCheapestPriced(feed);
    expect(kept).toHaveLength(CACHE_ROWS_PER_SIZE);
    expect(kept[0].wholesaleCost).toBe(60);
    expect(computeSizePriceFloors([{ size: "205/55R16", prices: kept }], 100)[0].fromPrice).toBe(120);
  });

  it("never caches the feed-error row, and still fills the cut", () => {
    for (const size of ["265/70R18", "275/60R20"] as const) {
      const kept = selectCheapestPriced(fullList(size));
      expect(kept).toHaveLength(CACHE_ROWS_PER_SIZE);
      expect(retailOf(kept)).not.toContain(OUTLIER_RETAIL[size]);
      expect(retailOf(kept)[0]).toBe(REAL[size].cheapest[1]);
    }
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
  it("publishes the real cheapest tire, not the feed error, from a cache that still holds it", () => {
    const floors = computeSizePriceFloors(
      [
        { size: "265/70R18", prices: cut15("265/70R18") },
        { size: "275/60R20", prices: cut15("275/60R20") },
        { size: "205/55R16", prices: cut15("205/55R16") },
      ],
      100,
    );
    expect(floors.map((f) => [f.size, f.fromPrice])).toEqual([
      ["265/70R18", 148], // ceil(147.89), not 26
      ["275/60R20", 168], // ceil(167.66), not 65
      ["205/55R16", 80], // budget floor unchanged
    ]);
    expect(floors[0].optionCount).toBe(14);
  });

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

describe("gatewayTire.publicSearch never offers a feed-error price", () => {
  beforeEach(() => {
    getCachedPrices.mockReset();
    searchTiresBySize.mockReset();
  });

  async function search(size: string) {
    const { gatewayTireRouter } = await import("../routers/gatewayTire");
    const caller = gatewayTireRouter.createCaller({ req: { ip: "203.0.113.5", headers: {} }, res: {} } as never);
    return caller.publicSearch({ size, category: "all", sortBy: "price-low" });
  }

  /** A D&K /quicksearch/cache item; selling_price is Nick's cost. */
  const dkItem = (r: CachedPriceLike) => ({
    make: r.brand,
    minor_name: r.model,
    invent_size: r.size,
    on_hand: 0,
    pricing_data: [{ selling_price: r.wholesaleCost, cost_price: r.wholesaleCost * 2 }],
  });

  it("cache path: a cache that still holds the error row does not show it", async () => {
    getCachedPrices.mockReturnValue(cut15("265/70R18"));
    const res = await search("265/70R18");
    expect(res.source).toBe("pipeline-cache");
    expect(res.tires.map((t) => t.shopPrice)).not.toContain(25.77);
    expect(res.tires[0].shopPrice).toBe(147.89);
    expect(res.tires).toHaveLength(14);
  });

  it("cache path: a real budget cluster is offered in full", async () => {
    getCachedPrices.mockReturnValue(cut15("205/55R16"));
    const res = await search("205/55R16");
    expect(res.tires.map((t) => t.shopPrice)).toEqual(REAL["205/55R16"].cheapest);
  });

  it("live path: the full feed is filtered before it is sorted", async () => {
    getCachedPrices.mockReturnValue(null);
    searchTiresBySize.mockResolvedValue(fullList("275/60R20").map(dkItem));
    const res = await search("275/60R20");
    expect(res.source).toBe("live");
    expect(res.tires.map((t) => t.shopPrice)).not.toContain(64.42);
    expect(res.tires[0].shopPrice).toBe(167.66);
    expect(res.tires).toHaveLength(REAL["275/60R20"].n - 1);
  });

  it("live path: a real budget cluster is offered in full", async () => {
    getCachedPrices.mockReturnValue(null);
    searchTiresBySize.mockResolvedValue(fullList("195/65R15").map(dkItem));
    const res = await search("195/65R15");
    expect(res.tires).toHaveLength(REAL["195/65R15"].n);
    expect(res.tires.slice(0, 15).map((t) => t.shopPrice)).toEqual(REAL["195/65R15"].cheapest);
  });
});
