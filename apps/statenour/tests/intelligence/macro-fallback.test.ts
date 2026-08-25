/**
 * Canaries for the multi-source macro connector (connectors/macro.ts).
 *
 * Everything here drives the code with SYNTHETIC fixtures and carries its
 * positive control in the same test — the ingestAllSources lesson applies
 * verbatim: an assertion that only exercises the suppressed direction cannot
 * be told apart from a dead detector, and a grep-shaped assertion survives
 * argument swaps that invert the gate.
 *
 * The three behaviours under guard, and the outage each one answers:
 *   1. FAILOVER IS ATTRIBUTED — a fallback-served number names both providers
 *      (sources publish the same concept with different adjustments; a silent
 *      source change corrupts week-over-week comparison).
 *   2. ZERO SERIES IS LOUD — the 2026-08-12 shape: every provider dark must
 *      fail ingestion with per-provider reasons, never succeed empty.
 *   3. DORMANT IS VISIBLE — an unkeyed provider appears in the report with
 *      its exact env var, so "waiting on a key" and "silently inert" are
 *      distinguishable from the brief itself.
 */
import { describe, it, expect } from "vitest";
import {
  MACRO_SERIES,
  PROVIDER_META,
  resolveMacroChains,
  macroFetchFailure,
  renderMacroReport,
  fetchBlsSeries,
  fetchBeaSeries,
  fetchCensusMarts,
  type MacroFetchResult,
  type MacroProvider,
  type MacroSeriesSpec,
  type ProviderStatus,
  type SeriesPoint,
} from "@/lib/intelligence/connectors/macro";

/* ── fixtures ──────────────────────────────────────────────────────────── */

const SPEC_CPI: MacroSeriesSpec = {
  key: "cpi-national",
  name: "CPI (all items, SA)",
  unit: "index",
  chain: [
    { provider: "FRED", id: "CPIAUCSL" },
    { provider: "BLS", id: "CUSR0000SA0" },
  ],
};
const SPEC_BLS_ONLY: MacroSeriesSpec = {
  key: "unemployment-cleveland",
  name: "Unemployment rate (Cleveland MSA)",
  unit: "%",
  chain: [{ provider: "BLS", id: "LAUMT391741000000003" }],
};

const pt = (value: number, date = "2026-07"): SeriesPoint => ({ value, date });
const m = (entries: Array<[string, SeriesPoint]>) => new Map(entries);

const status = (
  provider: MacroProvider,
  over: Partial<ProviderStatus> = {},
): ProviderStatus => ({
  provider,
  keyState: "present",
  envVar: PROVIDER_META[provider].envVar,
  signupUrl: PROVIDER_META[provider].signupUrl,
  attempted: true,
  served: 0,
  failed: 0,
  ...over,
});

/** A fetch stub that returns a canned Response-like object. */
const fetchStub = (body: string, init: { ok?: boolean; status?: number } = {}) =>
  (async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => body,
    json: async () => JSON.parse(body),
  })) as unknown as typeof fetch;

/* ── 1 · chain resolution + attribution ────────────────────────────────── */

describe("resolveMacroChains · failover is attributed, both directions", () => {
  it("FRED dark → BLS serves the SAME series, flagged as fallback; FRED up → no flag", () => {
    // The defect direction: primary dark, fallback serves.
    const dark = resolveMacroChains([SPEC_CPI], {
      FRED: m([]),
      BLS: m([["CUSR0000SA0", pt(332.813)]]),
    });
    expect(dark.indicators).toHaveLength(1);
    expect(dark.indicators[0].source).toBe("BLS");
    expect(dark.indicators[0].viaFallback).toBe(true);
    expect(dark.indicators[0].fallbackFrom).toBe("FRED");
    expect(dark.indicators[0].value).toBe(332.813);

    // POSITIVE CONTROL — without it, a resolver that always reports
    // viaFallback:true (or always picks the last link) would pass above.
    const healthy = resolveMacroChains([SPEC_CPI], {
      FRED: m([["CPIAUCSL", pt(320.5)]]),
      BLS: m([["CUSR0000SA0", pt(332.813)]]),
    });
    expect(healthy.indicators[0].source).toBe("FRED");
    expect(healthy.indicators[0].viaFallback).toBe(false);
    expect(healthy.indicators[0].value).toBe(320.5); // primary's value, not the fallback's
  });

  it("a series no provider served lands in `unresolved`, never silently vanishes", () => {
    const r = resolveMacroChains([SPEC_CPI, SPEC_BLS_ONLY], {
      FRED: m([["CPIAUCSL", pt(320.5)]]),
      BLS: m([]), // Cleveland has no fallback — BLS dark means gone
    });
    expect(r.indicators).toHaveLength(1);
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0].spec.key).toBe("unemployment-cleveland");
    expect(r.unresolved[0].triedProviders).toEqual(["BLS"]);
  });

  it("REGISTRY INVARIANT: the two headline series have ≥2 independent providers", () => {
    // The whole point of the build: no single credential failure takes out
    // macro entirely. CPI and unemployment must each survive FRED dying.
    for (const key of ["cpi-national", "unemployment-national"]) {
      const spec = MACRO_SERIES.find((s) => s.key === key)!;
      const providers = new Set(spec.chain.map((l) => l.provider));
      expect(providers.size, `${key} must have ≥2 providers`).toBeGreaterThanOrEqual(2);
    }
    // And BLS must serve keyless — the zero-key floor. Measured 2026-08-25:
    // 7 series returned July-2026 data with no key on the v1 endpoint.
    const blsServed = MACRO_SERIES.filter((s) => s.chain.some((l) => l.provider === "BLS"));
    expect(blsServed.length).toBeGreaterThanOrEqual(5);

    // KEYLESS CEILING: the v1 tier allows 25 series per query and the whole
    // BLS fetch is ONE batched POST. Cross it and the keyless floor — the one
    // provider that works with zero keys — silently stops fitting in a query.
    const blsIds = MACRO_SERIES.flatMap((s) => s.chain.filter((l) => l.provider === "BLS"));
    expect(blsIds.length, "BLS ids must stay within the keyless v1 25-series/query ceiling").toBeLessThanOrEqual(25);
  });
});

/* ── 2 · zero series is loud ───────────────────────────────────────────── */

describe("macroFetchFailure · the 2026-08-12 shape cannot recur quietly", () => {
  it("THE DEFECT: every provider dark → failure message naming each provider's reason", () => {
    const result: MacroFetchResult = {
      indicators: [],
      providers: [
        status("FRED", { reason: "FRED HTTP 400 on CPIAUCSL" }),
        status("BLS", { reason: "BLS fetch failed: network down" }),
        status("BEA", { attempted: false, keyState: "absent", reason: "BEA_API_KEY not set" }),
        status("CENSUS", { attempted: false, keyState: "absent", reason: "CENSUS_API_KEY not set" }),
      ],
    };
    const msg = macroFetchFailure(result);
    expect(msg).not.toBeNull();
    expect(msg).toContain("ZERO series");
    // The actionable part: WHICH credential died, per provider.
    expect(msg).toContain("FRED HTTP 400");
    expect(msg).toContain("network down");
    expect(msg).toContain("BEA_API_KEY");

    // POSITIVE CONTROL: one indicator anywhere → healthy, no failure. A judge
    // that always returns a message would page daily and be muted in a week.
    const healthy: MacroFetchResult = {
      indicators: [
        { key: "cpi-national", name: "CPI", unit: "index", value: 332.8, date: "2026-07", source: "BLS", sourceSeriesId: "CUSR0000SA0", viaFallback: true, fallbackFrom: "FRED" },
      ],
      providers: result.providers,
    };
    expect(macroFetchFailure(healthy)).toBeNull();
  });
});

/* ── 3 · the rendered report: attribution + dormant-but-visible ────────── */

describe("renderMacroReport · the operator can see source changes and dormant providers", () => {
  const indicators: MacroFetchResult["indicators"] = [
    { key: "cpi-national", name: "CPI (all items, SA)", unit: "index", value: 332.813, date: "2026-07", source: "BLS", sourceSeriesId: "CUSR0000SA0", viaFallback: true, fallbackFrom: "FRED" },
    { key: "gas-midwest", name: "Regular gasoline, Midwest", unit: "$/gal", value: 3.857, date: "2026-07", source: "BLS", sourceSeriesId: "APU020074714", viaFallback: false },
  ];
  const providers: ProviderStatus[] = [
    status("FRED", { served: 0, failed: 4, reason: "FRED HTTP 400" }),
    status("BLS", { keyState: "keyless-tier", served: 2 }),
    status("BEA", { attempted: false, keyState: "absent" }),
    status("CENSUS", { attempted: false, keyState: "absent" }),
  ];
  const report = renderMacroReport(
    { indicators, providers },
    [{ spec: SPEC_BLS_ONLY, triedProviders: ["BLS"] }],
    "2026-08-25T18:00:00.000Z",
    "https://api.stlouisfed.org",
  );

  it("a fallback-served line names BOTH providers; a primary-served line stays clean", () => {
    expect(report).toContain("source: BLS (fallback; FRED did not serve)");
    // POSITIVE CONTROL — the primary-served gasoline line must NOT carry the
    // marker, or the marker means nothing.
    const gasLine = report.split("\n").find((l) => l.includes("gasoline"))!;
    expect(gasLine).toBeDefined();
    expect(gasLine).not.toContain("fallback");
  });

  it("DORMANT IS VISIBLE: an unkeyed provider appears with its exact env var and signup URL", () => {
    expect(report).toContain("BEA: dormant — waiting on BEA_API_KEY");
    expect(report).toContain("https://apps.bea.gov/API/signup/");
    expect(report).toContain("CENSUS: dormant — waiting on CENSUS_API_KEY");
    // POSITIVE CONTROL: a provider that DID serve shows OK with a count, so
    // "dormant" and "working" render differently.
    expect(report).toContain("BLS: OK, 2 series (keyless v1 tier)");
    // And a failed-with-key provider shows the failure, distinct from dormant.
    expect(report).toContain("FRED: FAILED — FRED HTTP 400");
  });

  it("an unresolved series is LISTED as unavailable, not omitted", () => {
    expect(report).toContain("Unemployment rate (Cleveland MSA): UNAVAILABLE this run (tried BLS)");
  });
});

/* ── 4 · provider fetchers against the MEASURED refusal shapes ─────────── */

describe("fetchBlsSeries · keyless v1 vs keyed v2, and M13 hygiene", () => {
  const blsBody = JSON.stringify({
    status: "REQUEST_SUCCEEDED",
    Results: {
      series: [
        {
          seriesID: "CUSR0000SA0",
          data: [
            { year: "2025", period: "M13", value: "999" }, // annual avg — must be skipped
            { year: "2026", period: "M07", value: "332.813" },
          ],
        },
      ],
    },
  });

  it("no key → v1 URL with no registrationkey; key → v2 URL carrying it (captured, not assumed)", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const capture = (async (url: string, init: { body: string }) => {
      calls.push({ url: String(url), body: init.body });
      return { ok: true, status: 200, json: async () => JSON.parse(blsBody), text: async () => blsBody };
    }) as unknown as typeof fetch;

    await fetchBlsSeries(["CUSR0000SA0"], undefined, capture);
    expect(calls[0].url).toContain("/publicAPI/v1/");
    expect(calls[0].body).not.toContain("registrationkey");

    await fetchBlsSeries(["CUSR0000SA0"], "test-key-123", capture);
    expect(calls[1].url).toContain("/publicAPI/v2/");
    expect(calls[1].body).toContain("registrationkey");
  });

  it("skips the M13 annual-average row and serves the newest real month", async () => {
    const { points } = await fetchBlsSeries(["CUSR0000SA0"], undefined, fetchStub(blsBody));
    expect(points.get("CUSR0000SA0")).toEqual({ value: 332.813, date: "2026-07" });
  });

  it("a non-SUCCEEDED status becomes a reason, never a throw", async () => {
    const body = JSON.stringify({ status: "REQUEST_NOT_PROCESSED", message: ["daily threshold exceeded"] });
    const { points, reason } = await fetchBlsSeries(["CUSR0000SA0"], undefined, fetchStub(body));
    expect(points.size).toBe(0);
    expect(reason).toContain("REQUEST_NOT_PROCESSED");
    expect(reason).toContain("daily threshold");
  });
});

describe("fetchBeaSeries · refusal INSIDE HTTP 200 (measured 2026-08-25)", () => {
  it("APIErrorCode 4 in a 200 body is a key failure with the API's own words", async () => {
    // The exact live response shape a placeholder UserID produced.
    const body = JSON.stringify({
      BEAAPI: { Error: { APIErrorCode: "4", APIErrorDescription: "This UserId is not active. Please activate it and try again." } },
    });
    const { points, reason } = await fetchBeaSeries("dummy", fetchStub(body));
    expect(points.size).toBe(0);
    expect(reason).toContain("APIErrorCode".replace("APIErrorCode", "BEA API error 4"));
    expect(reason).toContain("not active");
  });

  it("POSITIVE CONTROL: a valid payload serves the LATEST quarter, not the first row", async () => {
    const body = JSON.stringify({
      BEAAPI: {
        Results: {
          Data: [
            { TimePeriod: "2025Q4", DataValue: "812,345.0" },
            { TimePeriod: "2026Q1", DataValue: "823,456.7" },
          ],
        },
      },
    });
    const { points, reason } = await fetchBeaSeries("real-key", fetchStub(body));
    expect(reason).toBeUndefined();
    expect(points.get("SQINC1/1/39000")).toEqual({ value: 823456.7, date: "2026Q1" });
  });
});

describe("fetchCensusMarts · the HTML key-page refusal (measured 2026-08-25)", () => {
  it("an HTML body is reported as a key failure, never fed to JSON.parse", async () => {
    // Keyless AND invalid-key requests 302 into this page shape live.
    const html = `<html style="font-size: 14px;"><head><title>Invalid Key</title></head></html>`;
    const { points, reason } = await fetchCensusMarts("bad-key", fetchStub(html));
    expect(points.size).toBe(0);
    expect(reason).toContain("HTML key page");
    expect(reason).toContain("CENSUS_API_KEY");
  });

  it("POSITIVE CONTROL: header-addressed parsing serves the newest SA month even with reordered columns", async () => {
    // Columns deliberately NOT in request order — the parser must find them
    // by header name, or a param reorder silently shifts every value.
    const body = JSON.stringify([
      ["time", "seasonally_adj", "cell_value", "data_type_code", "category_code", "us"],
      ["2026-05", "yes", "112233", "SM", "441", "1"],
      ["2026-06", "yes", "115000", "SM", "441", "1"],
      ["2026-06", "no", "999999", "SM", "441", "1"], // NSA row must be ignored
    ]);
    const { points, reason } = await fetchCensusMarts("real-key", fetchStub(body), 2026);
    expect(reason).toBeUndefined();
    expect(points.get("MARTS/441/SM")).toEqual({ value: 115000, date: "2026-06" });
  });

  it("JANUARY SEAM: an empty current year retries the previous year once — and only once", async () => {
    // MARTS publishes mid-month, so early-January queries legitimately return
    // no current-year rows. One retry serves December; a second empty year is
    // a real failure, not a loop.
    const empty = JSON.stringify([["time", "cell_value"]]); // header only
    const dec = JSON.stringify([
      ["time", "seasonally_adj", "cell_value", "data_type_code", "category_code", "us"],
      ["2026-12", "yes", "118000", "SM", "441", "1"],
    ]);
    const byYear = (async (url: string) => {
      const body = String(url).includes("time=2027") ? empty : dec;
      return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
    }) as unknown as typeof fetch;
    const { points, reason } = await fetchCensusMarts("real-key", byYear, 2027);
    expect(reason).toBeUndefined();
    expect(points.get("MARTS/441/SM")).toEqual({ value: 118000, date: "2026-12" });

    // POSITIVE CONTROL: both years empty → one retry, then a reason naming
    // both years — never an infinite recursion, never a silent success.
    let calls = 0;
    const alwaysEmpty = (async () => {
      calls++;
      return { ok: true, status: 200, text: async () => empty, json: async () => JSON.parse(empty) };
    }) as unknown as typeof fetch;
    const failed = await fetchCensusMarts("real-key", alwaysEmpty, 2027);
    expect(calls).toBe(2);
    expect(failed.points.size).toBe(0);
    expect(failed.reason).toContain("2027");
    expect(failed.reason).toContain("2026");
  });

  it("no key → dormant reason without a network call", async () => {
    const mustNotCall = (() => {
      throw new Error("fetch must not be called without a key");
    }) as unknown as typeof fetch;
    const { points, reason } = await fetchCensusMarts(undefined, mustNotCall);
    expect(points.size).toBe(0);
    expect(reason).toContain("CENSUS_API_KEY");
  });
});
