/**
 * tests/services/cashflow-forecast-resolution.test.ts · 2026-10-02 · census E5
 *
 * The weekly digest wrote a `prediction` row every Sunday and promised a
 * resolution loop that never existed. Pinned: a forecast is correct when the
 * week's actual revenue lands inside its band; a week still running is not
 * scored; a bridge that cannot give the actual leaves the row UNTOUCHED (never a
 * miss by default); rows written before the band was stored are scored from
 * the digest line; the digest names HIT / MISS / why-not.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, queryNick, recordOutcome } = vi.hoisted(() => ({
  findMany: vi.fn(),
  queryNick: vi.fn(),
  recordOutcome: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { intelligenceOutcome: { findMany } } }));
vi.mock("@/lib/nickstire/query", () => ({ queryNick }));
vi.mock("@/lib/services/outcome-ledger", () => ({ recordOutcome }));

import {
  buildCashflowForecast,
  forecastBandHit,
  forecastDigestLine,
  forecastResolutionLine,
  parseForecastBand,
  resolveForecastPredictions,
} from "@/lib/services/cashflow-forecast";

/** queryNick's real answer: nickstire's route wraps the handler's result as `data`. */
const bridge = (data: unknown) => ({ data, query: "revenue_range", timestamp: "2026-10-04T10:00:00.000Z" });

const now = new Date("2026-10-04T10:00:00Z"); // a Sunday; week of 09-20 has elapsed, 09-27 has too, 10-04 has not

beforeEach(() => {
  findMany.mockReset();
  queryNick.mockReset();
  recordOutcome.mockReset();
  recordOutcome.mockResolvedValue(true);
});

describe("pure helpers", () => {
  it("band hit is inclusive on both ends and false outside or on garbage", () => {
    expect(forecastBandHit(800, { low: 800, high: 1200 })).toBe(true);
    expect(forecastBandHit(1200, { low: 800, high: 1200 })).toBe(true);
    expect(forecastBandHit(1201, { low: 800, high: 1200 })).toBe(false);
    expect(forecastBandHit(NaN, { low: 800, high: 1200 })).toBe(false);
  });

  it("parses the band from an old digest line (en dash or hyphen) and refuses the UNAVAILABLE shape", () => {
    expect(parseForecastBand("Revenue-side forecast: $800–$1200 next week (mid $1000, confidence 0.6, data fresh).")).toEqual({ low: 800, high: 1200 });
    expect(parseForecastBand("$800-$1200 next week")).toEqual({ low: 800, high: 1200 });
    expect(parseForecastBand("Revenue-side forecast: UNAVAILABLE (3 data gaps — bridge did not answer).")).toBeNull();
    expect(parseForecastBand("$1200–$800")).toBeNull();
  });
});

describe("resolveForecastPredictions", () => {
  it("scores an elapsed week inside the stored band as useful, with the actual on the resultRef", async () => {
    findMany.mockResolvedValue([
      { id: "r1", summary: "x", shownAt: new Date("2026-09-27T10:00:00Z"), evidenceRefs: { weekStart: "2026-09-27", projectedRevenue: { low: 800, mid: 1000, high: 1200 } } },
    ]);
    queryNick.mockResolvedValue(bridge({ totalDollars: 950.4, invoiceCount: 3 }));
    const out = await resolveForecastPredictions(now);
    // `to` is inclusive: the week of 09-27 ends on 10-03, not on the next week's first day.
    expect(queryNick).toHaveBeenCalledWith("revenue_range", { from: "2026-09-27", to: "2026-10-03" });
    expect(recordOutcome).toHaveBeenCalledWith({ id: "r1", useful: true, resultRef: "week:2026-09-27:actual:950" });
    expect(out).toEqual([{ weekStart: "2026-09-27", band: { low: 800, high: 1200 }, actual: 950.4, hit: true }]);
  });

  it("an actual outside the band is a miss (useful false), never silently dropped", async () => {
    findMany.mockResolvedValue([
      { id: "r2", summary: "x", shownAt: new Date("2026-09-20T10:00:00Z"), evidenceRefs: { weekStart: "2026-09-20", projectedRevenue: { low: 800, mid: 1000, high: 1200 } } },
    ]);
    queryNick.mockResolvedValue(bridge({ totalDollars: 1500, invoiceCount: 5 }));
    const out = await resolveForecastPredictions(now);
    expect(recordOutcome).toHaveBeenCalledWith({ id: "r2", useful: false, resultRef: "week:2026-09-20:actual:1500" });
    expect(out[0]).toMatchObject({ hit: false, actual: 1500 });
  });

  it("a week still running is not a candidate — nothing read from the bridge, nothing written", async () => {
    findMany.mockResolvedValue([
      { id: "r3", summary: "x", shownAt: now, evidenceRefs: { weekStart: "2026-10-04", projectedRevenue: { low: 1, mid: 2, high: 3 } } },
    ]);
    const out = await resolveForecastPredictions(now);
    expect(out).toEqual([]);
    expect(queryNick).not.toHaveBeenCalled();
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it("a bridge with no numeric total leaves the row untouched and says why — a missing actual is not a miss", async () => {
    findMany.mockResolvedValue([
      { id: "r4", summary: "x", shownAt: new Date("2026-09-27T10:00:00Z"), evidenceRefs: { weekStart: "2026-09-27", projectedRevenue: { low: 800, mid: 1000, high: 1200 } } },
    ]);
    queryNick.mockResolvedValue(bridge({ error: "No DB" }));
    const out = await resolveForecastPredictions(now);
    expect(recordOutcome).not.toHaveBeenCalled();
    expect(out[0]).toMatchObject({ hit: null, actual: null, reason: expect.stringContaining("actual unavailable") });
  });

  it("a transport failure (queryNick's own { error }) leaves the row untouched too", async () => {
    findMany.mockResolvedValue([
      { id: "r5", summary: "x", shownAt: new Date("2026-09-27T10:00:00Z"), evidenceRefs: { weekStart: "2026-09-27", projectedRevenue: { low: 800, mid: 1000, high: 1200 } } },
    ]);
    queryNick.mockResolvedValue({ error: "HTTP 502: bad gateway", statusCode: 502 });
    const out = await resolveForecastPredictions(now);
    expect(recordOutcome).not.toHaveBeenCalled();
    expect(out[0]).toMatchObject({ hit: null, actual: null });
  });

  it("a row written before the band was stored is scored from its digest line; an UNAVAILABLE row is named, not scored", async () => {
    findMany.mockResolvedValue([
      { id: "old", summary: "Revenue-side forecast: $500–$700 next week (mid $600, confidence 0.5, data stale).", shownAt: new Date("2026-09-20T10:00:00Z"), evidenceRefs: { weekStart: "2026-09-20" } },
      { id: "unavail", summary: "Revenue-side forecast: UNAVAILABLE (4 data gaps — bridge did not answer).", shownAt: new Date("2026-09-13T10:00:00Z"), evidenceRefs: { weekStart: "2026-09-13" } },
    ]);
    queryNick.mockResolvedValue(bridge({ totalDollars: 650, invoiceCount: 2 }));
    const out = await resolveForecastPredictions(now);
    expect(recordOutcome).toHaveBeenCalledTimes(1);
    expect(recordOutcome).toHaveBeenCalledWith({ id: "old", useful: true, resultRef: "week:2026-09-20:actual:650" });
    expect(out[1]).toMatchObject({ weekStart: "2026-09-13", band: null, hit: null, reason: expect.stringContaining("no band") });
  });

  it("a stored $0–$0 band (an empty projection) is no forecast — never a MISS against every positive actual", async () => {
    findMany.mockResolvedValue([
      { id: "zero", summary: "x", shownAt: new Date("2026-09-20T10:00:00Z"), evidenceRefs: { weekStart: "2026-09-20", projectedRevenue: { low: 0, mid: 0, high: 0 } } },
    ]);
    const out = await resolveForecastPredictions(now);
    expect(recordOutcome).not.toHaveBeenCalled();
    expect(queryNick).not.toHaveBeenCalled();
    expect(out[0]).toMatchObject({ band: null, hit: null, reason: expect.stringContaining("no band") });
    expect(parseForecastBand("$0–$0 next week")).toBeNull();
  });

  it("asks the ledger only for elapsed, scorable rows (no current week, no UNAVAILABLE) so they cannot starve the window", async () => {
    findMany.mockResolvedValue([]);
    await resolveForecastPredictions(now);
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ kind: "prediction", sourceEngine: "cashflow-forecast", outcomeAt: null, NOT: { summary: { contains: "UNAVAILABLE" } } });
    // 6 days: last week's row is written seconds after that run's `now`.
    expect(where.shownAt.lte.toISOString()).toBe("2026-09-28T10:00:00.000Z");
  });

  it("a failed ledger read is an empty result, never a throw into the digest", async () => {
    findMany.mockRejectedValue(new Error("db down"));
    await expect(resolveForecastPredictions(now)).resolves.toEqual([]);
  });
});

describe("buildCashflowForecast", () => {
  it("reads each trailing week's dollars from the bridge answer, as four 7-day weeks that do not overlap", async () => {
    queryNick.mockImplementation(async (query: string, filters?: { from: string; to: string }) =>
      query === "revenue_range"
        ? bridge({ from: filters?.from, to: filters?.to, totalDollars: 1000, invoiceCount: 4 })
        : bridge({ statusBreakdown: [] }),
    );
    const f = await buildCashflowForecast(now);
    const windows = queryNick.mock.calls.filter((c) => c[0] === "revenue_range").map((c) => c[1]);
    expect(windows).toEqual([
      { from: "2026-09-06", to: "2026-09-12" },
      { from: "2026-09-13", to: "2026-09-19" },
      { from: "2026-09-20", to: "2026-09-26" },
      { from: "2026-09-27", to: "2026-10-03" },
    ]);
    expect(f.basis.trailingWeeks).toEqual([1000, 1000, 1000, 1000]);
    expect(f.dataGaps.filter((g) => g.startsWith("revenue_range"))).toEqual([]);
    expect(forecastDigestLine(f)).not.toContain("UNAVAILABLE");
  });

  it("a week whose read failed is a named gap, never a $0 week", async () => {
    queryNick.mockImplementation(async (query: string, filters?: { from: string }) =>
      query === "revenue_range" && filters?.from === "2026-09-20"
        ? bridge({ error: "No DB" })
        : bridge({ totalDollars: 900, invoiceCount: 3 }),
    );
    const f = await buildCashflowForecast(now);
    expect(f.basis.trailingWeeks).toEqual([900, 900, 900]);
    expect(f.dataGaps).toContain("revenue_range week -2: no numeric total");
  });
});

describe("forecastResolutionLine", () => {
  it("names HIT, MISS, the reason it could not score, or that there was nothing to score", () => {
    expect(forecastResolutionLine([{ weekStart: "2026-09-27", band: { low: 800, high: 1200 }, actual: 950.4, hit: true }])).toBe(
      "Last week's forecast (week of 2026-09-27): $800–$1200 · actual $950 · HIT.",
    );
    expect(forecastResolutionLine([{ weekStart: "2026-09-27", band: { low: 800, high: 1200 }, actual: 1500, hit: false }])).toContain("MISS");
    expect(forecastResolutionLine([{ weekStart: "2026-09-27", band: null, actual: null, hit: null, reason: "no band on the row (forecast was UNAVAILABLE)" }])).toBe(
      "Last week's forecast (week of 2026-09-27): not scored — no band on the row (forecast was UNAVAILABLE).",
    );
    expect(forecastResolutionLine([])).toContain("nothing to score yet");
  });
});
