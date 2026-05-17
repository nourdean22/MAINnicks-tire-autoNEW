/**
 * pricing-advisor · service tests · v10.0.526 · Arc C · Feature 3
 *
 * Unit-level. Prisma, fetch, and multiSourceSearch are mocked so the
 * math + bridge handling can be verified without touching Neon /
 * Tavily / Exa / Perplexity. Cron + aiChat integration coverage comes
 * from the route handler hitting real data in prod.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ---------- Hoisted mocks (vi.hoisted runs before module factories) ---------- */

const mocks = vi.hoisted(() => ({
  brainMemory: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  },
  multiSourceSearch: vi.fn(),
  aiChat: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: mocks.brainMemory,
  },
}));

vi.mock("@/lib/ai/multi-search", () => ({
  multiSourceSearch: mocks.multiSourceSearch,
}));

// makeTracedAiChat returns a function · we hand back our spy directly.
vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => mocks.aiChat,
}));

const ORIGINAL_ENV = { ...process.env };
const originalFetch = global.fetch;

beforeEach(() => {
  mocks.brainMemory.findFirst.mockReset();
  mocks.brainMemory.findMany.mockReset();
  mocks.brainMemory.create.mockReset();
  mocks.multiSourceSearch.mockReset();
  mocks.aiChat.mockReset();
  process.env = { ...ORIGINAL_ENV };
  process.env.NICKS_ADMIN_URL = "https://nick.example.com";
  process.env.STATENOUR_SYNC_KEY = "sync-key-x";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  global.fetch = originalFetch;
});

/* ---------- Helpers ---------- */

function mockBridgeFetchOk(body: unknown): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response) as unknown as typeof fetch;
}

function mockBridgeFetchFail(status: number): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response) as unknown as typeof fetch;
}

/* ---------- Tests ---------- */

import {
  computeWinRateByCategory,
  findOutlierCategories,
  getCompetitorPrices,
  median,
  draftPricingMoves,
  composeAdvisory,
  recallPricingWisdoms,
} from "@/lib/services/pricing-advisor";

describe("median helper · the fleet baseline math", () => {
  it("returns 0 on empty input · never throws", () => {
    expect(median([])).toBe(0);
  });

  it("returns the middle value for odd-count arrays", () => {
    expect(median([0.3, 0.5, 0.9])).toBeCloseTo(0.5, 5);
  });

  it("averages the two middle values for even-count arrays", () => {
    expect(median([0.4, 0.6, 0.8, 1.0])).toBeCloseTo(0.7, 5);
  });
});

describe("computeWinRateByCategory · win-rate math from bridge data", () => {
  it("computes winRate = converted/given per category and drops thin (<4 estimate) categories", async () => {
    mockBridgeFetchOk({
      range: "30d",
      given: 100,
      converted: 60,
      rate: 60,
      byService: [
        { service: "Pit-Stop Tire", given: 23, converted: 20 }, // 87%
        { service: "Used Tire", given: 18, converted: 11 },     // 61%
        { service: "Brake Service", given: 12, converted: 9 },  // 75%
        { service: "Niche Rebuild", given: 2, converted: 1 },   // dropped · n=2
      ],
    });

    const rows = await computeWinRateByCategory();
    const byName = Object.fromEntries(rows.map((r) => [r.service, r]));

    expect(rows).toHaveLength(3);
    expect(byName["Pit-Stop Tire"].winRate).toBeCloseTo(20 / 23, 5);
    expect(byName["Used Tire"].winRate).toBeCloseTo(11 / 18, 5);
    expect(byName["Brake Service"].winRate).toBeCloseTo(9 / 12, 5);
    expect(byName["Niche Rebuild"]).toBeUndefined();
  });

  it("returns [] on empty-data edge cases (bridge offline, missing creds, HTTP 5xx, empty byService)", async () => {
    // Bridge HTTP error.
    mockBridgeFetchFail(503);
    expect(await computeWinRateByCategory()).toEqual([]);

    // Missing env credentials.
    delete process.env.NICKS_ADMIN_URL;
    delete process.env.NICKSTIRE_BRIDGE_URL;
    expect(await computeWinRateByCategory()).toEqual([]);

    // Bridge OK but byService is missing/empty.
    process.env.NICKS_ADMIN_URL = "https://nick.example.com";
    mockBridgeFetchOk({ range: "30d", given: 0, converted: 0, rate: 0 });
    expect(await computeWinRateByCategory()).toEqual([]);

    // Bridge throws (timeout / network).
    global.fetch = vi.fn().mockRejectedValue(new Error("ETIMEDOUT")) as unknown as typeof fetch;
    expect(await computeWinRateByCategory()).toEqual([]);
  });
});

describe("findOutlierCategories · outlier detection vs fleet median", () => {
  it("flags categories ≥20pp below fleet median, sorted worst gap first", () => {
    const rows = [
      { service: "Pit-Stop Tire", given: 23, converted: 20, winRate: 0.87 },
      { service: "Brake Service", given: 12, converted: 10, winRate: 0.83 },
      { service: "Oil Change", given: 30, converted: 24, winRate: 0.80 },
      { service: "Used Tire", given: 18, converted: 11, winRate: 0.61 },  // -19pp
      { service: "Suspension", given: 9, converted: 4, winRate: 0.44 },   // -36pp
    ];
    const outliers = findOutlierCategories(rows, 0.20);
    // Median of [0.87, 0.83, 0.80, 0.61, 0.44] = 0.80.
    // 0.20 threshold → only categories <= 0.60 are outliers.
    // Suspension (0.44) is -36pp · Used Tire (0.61) is -19pp (NOT outlier @20).
    expect(outliers).toHaveLength(1);
    expect(outliers[0].service).toBe("Suspension");
    expect(outliers[0].fleetMedian).toBeCloseTo(0.80, 5);
    expect(outliers[0].gap).toBeCloseTo(0.36, 5);
  });

  it("returns [] when there are fewer than 3 categories (no stable baseline)", () => {
    const rows = [
      { service: "A", given: 5, converted: 5, winRate: 1.0 },
      { service: "B", given: 5, converted: 1, winRate: 0.2 },
    ];
    expect(findOutlierCategories(rows)).toEqual([]);
  });

  it("respects a custom threshold (lower threshold ⇒ more outliers)", () => {
    const rows = [
      { service: "A", given: 10, converted: 9, winRate: 0.9 },
      { service: "B", given: 10, converted: 8, winRate: 0.8 },
      { service: "C", given: 10, converted: 7, winRate: 0.7 },
      { service: "D", given: 10, converted: 5, winRate: 0.5 }, // gap 0.20
      { service: "E", given: 10, converted: 4, winRate: 0.4 }, // gap 0.30
    ];
    // Median = 0.7. At 0.05 threshold both D + E qualify; at 0.25
    // threshold only E does. Values chosen to avoid the 0.7-0.6 float
    // trap (0.09999... !>= 0.10).
    const out05 = findOutlierCategories(rows, 0.05);
    expect(out05.map((o) => o.service).sort()).toEqual(["D", "E"]);
    // At 0.25 threshold only E qualifies (gap 0.30 only).
    expect(findOutlierCategories(rows, 0.25).map((o) => o.service)).toEqual(["E"]);
  });
});

describe("getCompetitorPrices · multi-source web search + 24h cache", () => {
  it("hits the cache when a fresh BrainMemory row exists (no network call)", async () => {
    const cached = {
      category: "Used Tire",
      prices: [
        { source: "perplexity", snippet: "Cleveland used tires $30-60", url: "https://x.example/used" },
      ],
      consensus: "Cleveland used tires typically $30-60.",
      confidence: 0.82,
      cached: true,
    };
    mocks.brainMemory.findFirst.mockResolvedValueOnce({
      id: "m1",
      createdAt: new Date(),
      metadata: { competitorData: cached },
    });

    const result = await getCompetitorPrices("Used Tire");
    expect(result.cached).toBe(true);
    expect(result.consensus).toContain("$30-60");
    expect(mocks.multiSourceSearch).not.toHaveBeenCalled();
  });

  it("falls through to multiSourceSearch when cache is stale (>24h) and writes a fresh cache row", async () => {
    const stale = new Date(Date.now() - 48 * 3600 * 1000);
    mocks.brainMemory.findFirst.mockResolvedValueOnce({
      id: "old",
      createdAt: stale,
      metadata: {
        competitorData: { category: "Used Tire", prices: [], consensus: "stale", confidence: 0.4 },
      },
    });
    mocks.multiSourceSearch.mockResolvedValueOnce({
      consensus: "Cleveland used tires sit around $35-55.",
      sources: [
        { name: "perplexity", content: "Used tires in Cleveland run $35-55 installed.", citations: [], model: "p" },
      ],
      disagreement: null,
      confidence: 0.78,
      citations: [
        { source: "perplexity", url: "https://shop1.example", title: "Shop 1" },
        { source: "tavily", url: "https://shop2.example", title: "Shop 2" },
      ],
    });
    mocks.brainMemory.create.mockResolvedValueOnce({});

    const result = await getCompetitorPrices("Used Tire");

    expect(mocks.multiSourceSearch).toHaveBeenCalledTimes(1);
    expect(result.cached).toBe(false);
    expect(result.consensus).toContain("$35-55");
    expect(result.prices.length).toBeGreaterThan(0);
    expect(mocks.brainMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: "pricing_advisory",
          key: expect.stringMatching(/^competitor_used_tire/),
        }),
      }),
    );
  });
});

describe("recallPricingWisdoms · wisdom keyword recall (no embedding call)", () => {
  it("filters BrainMemory(category='wisdom') by pricing-related keywords", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      { key: "wisdom_munger_inversion", content: "Invert always invert.", confidence: 0.92 },
      { key: "wisdom_buffett_moat", content: "Price is what you pay, value is what you get.", confidence: 0.90 },
      { key: "wisdom_buffett_pricing_power", content: "Pricing power is the moat.", confidence: 0.85 },
    ]);
    const wisdoms = await recallPricingWisdoms(3);
    expect(wisdoms).toHaveLength(3);
    expect(wisdoms[0].key).toContain("munger");
  });

  it("returns [] when Prisma throws (DB hiccup)", async () => {
    mocks.brainMemory.findMany.mockRejectedValueOnce(new Error("conn refused"));
    expect(await recallPricingWisdoms()).toEqual([]);
  });
});

describe("draftPricingMoves · aiChat shape + JSON validation", () => {
  it("returns exactly 3 valid experiments per outlier when the model emits a clean JSON array", async () => {
    mocks.aiChat.mockResolvedValueOnce({
      content: JSON.stringify([
        {
          hypothesis: "Used Tire pricing is 8% above market.",
          variant: "Drop used-tire installed price by 8% for one month.",
          controlGroup: "Walk-ins after the first 25 estimates each week.",
          successMetric: "Win rate ≥75% over 30 estimates.",
          wisdomCited: "Munger inversion · ask what would GUARANTEE this category loses, then do less of that.",
        },
        {
          hypothesis: "Bundling installation lifts perceived value.",
          variant: "Bundle install + balance free above $60 tire spend.",
          controlGroup: "First 25 estimates/week, unbundled.",
          successMetric: "Win rate ≥73% over 30 estimates.",
          wisdomCited: "Buffett pricing power principle — price is what you pay, value is what you get.",
        },
        {
          hypothesis: "Operator hesitation at the counter loses winnable estimates.",
          variant: "Two-line script the operator reads before each used-tire estimate.",
          controlGroup: "Days where the operator opts out of the script.",
          successMetric: "Win rate uplift ≥6pp on script days vs control.",
          wisdomCited: "Buffett · the best moats are operator habits.",
        },
      ]),
    });

    const outliers = [
      { service: "Used Tire", given: 18, converted: 11, winRate: 0.61, fleetMedian: 0.85, gap: 0.24 },
    ];
    const compMap = new Map();
    compMap.set("Used Tire", {
      category: "Used Tire",
      prices: [{ source: "perplexity", snippet: "$35-55 in Cleveland.", url: "https://x.example" }],
      consensus: "$35-55 typical.",
      confidence: 0.8,
      cached: false,
    });
    const wisdoms = [
      { key: "wisdom_munger_inversion", content: "Invert always invert.", confidence: 0.92 },
    ];

    const drafted = await draftPricingMoves(outliers, compMap, wisdoms);
    expect(drafted["Used Tire"]).toHaveLength(3);
    expect(drafted["Used Tire"][0].wisdomCited.toLowerCase()).toContain("munger");
  });

  it("returns an empty array per category when the model emits non-JSON / malformed output (no fabrication leak)", async () => {
    mocks.aiChat.mockResolvedValueOnce({
      content: "I cannot generate experiments because of a policy thing.",
    });
    const outliers = [
      { service: "Used Tire", given: 18, converted: 11, winRate: 0.61, fleetMedian: 0.85, gap: 0.24 },
    ];
    const drafted = await draftPricingMoves(outliers, new Map(), []);
    expect(drafted["Used Tire"]).toEqual([]);
  });
});

describe("composeAdvisory · advisory-shape end-to-end with all sub-deps stubbed", () => {
  it("returns a fully-shaped AdvisorySnapshot when the bridge has data and there are outliers", async () => {
    // Bridge data.
    mockBridgeFetchOk({
      range: "30d",
      given: 80,
      converted: 56,
      rate: 70,
      byService: [
        { service: "Pit-Stop Tire", given: 23, converted: 20 }, // 87%
        { service: "Brake Service", given: 12, converted: 10 }, // 83%
        { service: "Oil Change", given: 30, converted: 24 },    // 80%
        { service: "Used Tire", given: 18, converted: 6 },      // 33% · -47pp from median 80
      ],
    });
    // No cache hits anywhere.
    mocks.brainMemory.findFirst.mockResolvedValue(null);
    // Competitor scan returns a citation.
    mocks.multiSourceSearch.mockResolvedValue({
      consensus: "Used tire prices in Cleveland $35-55 installed.",
      sources: [{ name: "perplexity", content: "Used tires $35-55.", citations: [], model: "p" }],
      disagreement: null,
      confidence: 0.8,
      citations: [{ source: "perplexity", url: "https://shop.example", title: "Shop" }],
    });
    // Wisdom recall.
    mocks.brainMemory.findMany.mockResolvedValue([
      { key: "wisdom_munger_inversion", content: "Invert.", confidence: 0.95 },
    ]);
    // aiChat draft.
    mocks.aiChat.mockResolvedValue({
      content: JSON.stringify([
        {
          hypothesis: "h",
          variant: "v",
          controlGroup: "c",
          successMetric: "m",
          wisdomCited: "Munger inversion",
        },
      ]),
    });
    mocks.brainMemory.create.mockResolvedValue({});

    const snap = await composeAdvisory();
    expect(snap.schemaVersion).toBe("pricing_advisory_v1");
    expect(snap.windowDays).toBe(30);
    expect(snap.outliers).toHaveLength(1);
    expect(snap.outliers[0].service).toBe("Used Tire");
    expect(snap.experimentsByCategory["Used Tire"]).toHaveLength(1);
    expect(snap.headline).toContain("Used Tire");
    expect(snap.empty).toBeUndefined();
  });

  it("returns an empty-state snapshot when the bridge returns no data", async () => {
    mockBridgeFetchOk({ range: "30d", given: 0, converted: 0, rate: 0, byService: [] });
    const snap = await composeAdvisory();
    expect(snap.outliers).toEqual([]);
    expect(snap.empty?.reason).toBe("no_data");
  });
});
