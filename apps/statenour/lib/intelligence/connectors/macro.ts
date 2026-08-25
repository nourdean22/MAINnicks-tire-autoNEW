/**
 * Multi-source macro connector — FRED + BLS + BEA + Census.
 *
 * WHY THIS EXISTS. The intelligence stack went dark on 2026-08-12 when one
 * batch of credentials expired, and macro went dark with it because FRED was
 * the only macro source. The outage brief's own recommendation, written from
 * inside the outage: "Stand up BLS/BEA/Census as fallback macro." This file is
 * that. Four independently-authenticated US-government sources; one expired
 * key can no longer blind the whole macro view.
 *
 * AUTH REALITY, measured live 2026-08-25 (not read off docs):
 *
 *   BLS    keyless works TODAY. One v1 POST returned 7 of our 8 series with
 *          July-2026 data and no key (v1: 25 series/query, 25 queries/day/IP).
 *          A free registration key upgrades to v2 (50 series/query, 500/day).
 *          Signup: https://data.bls.gov/registrationEngine/
 *   BEA    key REQUIRED. A placeholder UserID returns HTTP 200 with
 *          {"APIErrorCode":"4","APIErrorDescription":"This UserId is not
 *          active..."} — refusal INSIDE 200, same class as the VideoDB
 *          low_credit incident, so success is asserted on the payload, never
 *          on res.ok. Signup (free, instant): https://apps.bea.gov/API/signup/
 *   CENSUS key REQUIRED for this endpoint. Keyless AND dummy-key requests
 *          both 302 into an HTML "Missing Key"/"Invalid Key" page — the
 *          documented keyless tier does not exist for /data/timeseries/eits.
 *          A connector that JSON.parses that page crashes, so an HTML body is
 *          detected and reported as a key failure. Signup (free):
 *          https://api.census.gov/data/key_signup.html
 *   FRED   key required for every call (existing FRED_API_KEY; the outage key).
 *
 * SERIES SELECTION — argued, not mirrored. A macro block nobody reads is
 * prompt weight. Every series below earns its line for a tire shop in
 * Cleveland; the "why" is on each entry. Live values in comments are the
 * 2026-08-25 probe receipts proving the ID resolves.
 *
 * DELIBERATELY DROPPED: wholesale FRED mirroring, GDP (quarterly national —
 * no operational lever), housing (not this business). Consumer sentiment
 * (UMCSENT) is UMich-proprietary served only via FRED, so it rides the FRED
 * key with `chain: FRED only` — when FRED is dark, sentiment is dark and the
 * status footer says so. That is honest; inventing a fallback that doesn't
 * exist is not.
 *
 * FAILOVER IS OBSERVABLE, NEVER SILENT. Sources publish the same concept with
 * different adjustments (e.g. FRED CPIAUCSL is the SA series; a BLS NSA
 * fallback would differ by tenths). An operator comparing week to week must
 * know the source changed, so every indicator carries `source` and
 * `viaFallback`, the rendered report prints the source per line whenever it
 * is not the chain's primary, and a status footer names every provider's
 * state — including "waiting on <ENV VAR>" for keyless providers, so a
 * dormant source is VISIBLE rather than silently inert (the langfuse /
 * staged-cron pattern, shipped twice on 2026-08-25).
 *
 * AG-02 stands: unavailable data is EMPTY, never mocked. This file emits no
 * invented numbers on any path.
 */
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/connector/macro");

export type MacroProvider = "FRED" | "BLS" | "BEA" | "CENSUS";

export interface ChainLink {
  provider: MacroProvider;
  /** Provider-native series id. */
  id: string;
}

export interface MacroSeriesSpec {
  /** Stable key for tests and dedupe — never rendered as the display name. */
  key: string;
  name: string;
  unit: string;
  /**
   * Ordered provider chain. Link 0 is the primary; anything after it is a
   * fallback and its use is flagged on the indicator and in the report.
   */
  chain: ChainLink[];
}

export interface MacroIndicator {
  key: string;
  name: string;
  unit: string;
  value: number;
  /** Period label as the provider states it, e.g. "2026-07" or "2026Q1". */
  date: string;
  source: MacroProvider;
  sourceSeriesId: string;
  viaFallback: boolean;
  /** Set when viaFallback: the primary provider that did not serve. */
  fallbackFrom?: MacroProvider;
}

export type KeyState =
  | "present"
  | "absent" // provider unusable without a key (FRED, BEA, CENSUS)
  | "keyless-tier"; // BLS without BLS_API_KEY: usable at v1 limits

export interface ProviderStatus {
  provider: MacroProvider;
  keyState: KeyState;
  /** Env var that arms the provider — rendered so dormancy is visible. */
  envVar: string;
  /** Where the operator gets the free key. */
  signupUrl: string;
  attempted: boolean;
  served: number;
  failed: number;
  reason?: string;
}

export interface MacroFetchResult {
  indicators: MacroIndicator[];
  providers: ProviderStatus[];
}

/** value+period as fetched from one provider for one series id. */
export interface SeriesPoint {
  value: number;
  date: string;
}

/**
 * The registry. 11 series, 4 providers.
 *
 * FRED mirror ids for BLS-native series carry a caveat: FRED requires a key
 * even to probe, so those mirrors are UNVERIFIED until FRED first serves one
 * (the 2026-08-25 probes could only verify the BLS side). A wrong mirror id
 * fails soft, per-series, and shows in the provider status as failed — it
 * cannot fabricate data or hide.
 */
export const MACRO_SERIES: readonly MacroSeriesSpec[] = [
  // ── National anchors (FRED-primary; BLS is the origin agency, so the
  //    fallback is the same underlying series) ─────────────────────────────
  {
    key: "cpi-national",
    name: "CPI (all items, SA)",
    unit: "index",
    // BLS CUSR0000SA0 verified 2026-08-25: 332.813 @ 2026-M07 (keyless).
    chain: [
      { provider: "FRED", id: "CPIAUCSL" },
      { provider: "BLS", id: "CUSR0000SA0" },
    ],
  },
  {
    key: "unemployment-national",
    name: "Unemployment rate (US)",
    unit: "%",
    // BLS LNS14000000 verified 2026-08-25: 4.1% @ 2026-M07 (keyless).
    chain: [
      { provider: "FRED", id: "UNRATE" },
      { provider: "BLS", id: "LNS14000000" },
    ],
  },
  {
    key: "fed-funds",
    name: "Fed funds rate",
    unit: "%",
    // Fed-only series — no other agency publishes it. When FRED is dark this
    // line is dark and the report says so; a fake fallback would be worse.
    chain: [{ provider: "FRED", id: "FEDFUNDS" }],
  },
  {
    key: "consumer-sentiment",
    name: "Consumer sentiment (UMich)",
    unit: "index",
    // UMich-proprietary, served via FRED only. Big-ticket deferral mood —
    // tires are a deferrable purchase, sentiment moves the walk-in mix.
    chain: [{ provider: "FRED", id: "UMCSENT" }],
  },

  // ── Cleveland-relevant (BLS-primary; these are BLS-native series) ───────
  {
    key: "cpi-midwest",
    name: "CPI Midwest (all items, NSA)",
    unit: "index",
    // Verified 2026-08-25: 310.304 @ 2026-M07. Why Midwest and not Cleveland:
    // the Cleveland CBSA CPI publishes bimonthly with a lag; Midwest monthly
    // is the freshest regional price signal that actually exists.
    chain: [
      { provider: "BLS", id: "CUUR0200SA0" },
      { provider: "FRED", id: "CUUR0200SA0" }, // mirror id unverified — see header
    ],
  },
  {
    key: "gas-midwest",
    name: "Regular gasoline, Midwest",
    unit: "$/gal",
    // Verified 2026-08-25: $3.857 @ 2026-M07 (national APU000074714 was
    // $4.094 the same month — the regional gap is why the regional series).
    // Gas price drives miles driven, which drives tire wear AND deferral.
    chain: [
      { provider: "BLS", id: "APU020074714" },
      { provider: "FRED", id: "APU020074714" }, // mirror id unverified — see header
    ],
  },
  {
    key: "cpi-vehicle-maintenance",
    name: "CPI motor vehicle maintenance & repair",
    unit: "index",
    // Verified 2026-08-25: 460.185 @ 2026-M07. The shop's own pricing
    // environment — what customers expect repair prices to be doing.
    chain: [
      { provider: "BLS", id: "CUUR0000SETD" },
      { provider: "FRED", id: "CUUR0000SETD" }, // mirror id unverified — see header
    ],
  },
  {
    key: "ppi-tires",
    name: "PPI tires (wholesale)",
    unit: "index",
    // Verified 2026-08-25: 272.093 @ 2026-M07. The cost side — wholesale tire
    // prices are the shop's margin early-warning.
    chain: [
      { provider: "BLS", id: "WPU0713" },
      { provider: "FRED", id: "WPU0713" }, // mirror id unverified — see header
    ],
  },
  {
    key: "unemployment-cleveland",
    name: "Unemployment rate (Cleveland MSA)",
    unit: "%",
    // Verified 2026-08-25: 3.1% @ 2026-M07. LANDMINE, measured: the old
    // Cleveland-Elyria CBSA 17460 id (LAUMT391746000000003) returns "Series
    // does not exist" — the 2023 OMB re-delineation renamed the area to
    // Cleveland, OH CBSA 17410. Local demand signal; BLS-only, no verified
    // FRED mirror, and the report states the gap when BLS is dark.
    chain: [{ provider: "BLS", id: "LAUMT391741000000003" }],
  },

  // ── Capacity + sector demand (BEA / Census — dormant until keys) ────────
  {
    key: "ohio-personal-income",
    name: "Ohio personal income (quarterly)",
    unit: "$M SAAR",
    // BEA Regional / SQINC1 line 1 / GeoFips 39000. Customer capacity to
    // spend on repairs; the only sub-annual income read that exists. One
    // series only — BEA is quarterly, keep the prompt weight tiny.
    chain: [{ provider: "BEA", id: "SQINC1/1/39000" }],
  },
  {
    key: "retail-auto-parts",
    name: "Retail sales: motor vehicle & parts dealers (US, SA)",
    unit: "$M",
    // Census MARTS category 441. The sector demand cycle — the closest
    // monthly "are people spending on vehicles" series published anywhere.
    chain: [{ provider: "CENSUS", id: "MARTS/441/SM" }],
  },
];

export const PROVIDER_META: Record<
  MacroProvider,
  { envVar: string; signupUrl: string }
> = {
  FRED: {
    envVar: "FRED_API_KEY",
    signupUrl: "https://fred.stlouisfed.org/docs/api/api_key.html",
  },
  BLS: {
    envVar: "BLS_API_KEY",
    signupUrl: "https://data.bls.gov/registrationEngine/",
  },
  BEA: {
    envVar: "BEA_API_KEY",
    signupUrl: "https://apps.bea.gov/API/signup/",
  },
  CENSUS: {
    envVar: "CENSUS_API_KEY",
    signupUrl: "https://api.census.gov/data/key_signup.html",
  },
};

/* ────────────────────────────────────────────────────────────────────────
 * Provider fetchers. Each takes `fetchImpl` so tests drive them with
 * synthetic responses instead of the network (the nhtsa-test precedent),
 * and each returns a Map of series id → SeriesPoint plus never throws —
 * a provider failure is a status, not an exception.
 * ──────────────────────────────────────────────────────────────────────── */

type FetchLike = typeof fetch;

/**
 * BLS: ONE batched POST for every BLS id in the registry.
 * With BLS_API_KEY → v2 (50 series/query, 500 queries/day).
 * Without → v1 keyless tier (25 series/query, 25 queries/day/IP) — measured
 * working 2026-08-25, which makes BLS the only macro source that serves
 * with ZERO keys configured.
 */
export async function fetchBlsSeries(
  ids: readonly string[],
  apiKey: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<{ points: Map<string, SeriesPoint>; reason?: string }> {
  const points = new Map<string, SeriesPoint>();
  if (ids.length === 0) return { points };
  const version = apiKey ? "v2" : "v1";
  const url = `https://api.bls.gov/publicAPI/${version}/timeseries/data/`;
  const body: Record<string, unknown> = { seriesid: [...ids] };
  if (apiKey) body.registrationkey = apiKey;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { points, reason: `BLS HTTP ${res.status}` };
    const json = (await res.json()) as {
      status?: string;
      message?: string[];
      Results?: { series?: Array<{ seriesID: string; data?: Array<{ year: string; period: string; value: string }> }> };
    };
    if (json.status !== "REQUEST_SUCCEEDED") {
      return { points, reason: `BLS status ${json.status}: ${(json.message ?? []).join("; ").slice(0, 160)}` };
    }
    for (const s of json.Results?.series ?? []) {
      // data[0] is newest. Skip M13 (annual average) — it is not a month.
      const obs = (s.data ?? []).find((d) => d.period !== "M13");
      if (!obs) continue;
      const value = parseFloat(obs.value);
      if (!Number.isFinite(value)) continue;
      points.set(s.seriesID, { value, date: `${obs.year}-${obs.period.replace(/^M/, "")}` });
    }
    // "Series does not exist" arrives inside message[] with status SUCCEEDED —
    // per-series absence is visible via the chain resolver, not fatal here.
    return { points };
  } catch (err) {
    return { points, reason: `BLS fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** FRED: per-id GET, newest observation. Requires FRED_API_KEY for every call. */
export async function fetchFredSeries(
  ids: readonly string[],
  apiKey: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<{ points: Map<string, SeriesPoint>; reason?: string }> {
  const points = new Map<string, SeriesPoint>();
  if (!apiKey) return { points, reason: "FRED_API_KEY not set" };
  let firstError: string | undefined;
  for (const id of ids) {
    try {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
      const res = await fetchImpl(url);
      if (!res.ok) {
        firstError ??= `FRED HTTP ${res.status} on ${id}`;
        continue;
      }
      const data = (await res.json()) as { observations?: Array<{ date: string; value: string }> };
      const obs = data.observations?.[0];
      const value = obs ? parseFloat(obs.value) : NaN;
      if (obs && Number.isFinite(value)) points.set(id, { value, date: obs.date });
    } catch (err) {
      firstError ??= `FRED fetch failed on ${id}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return { points, reason: points.size === 0 ? (firstError ?? "FRED returned no observations") : undefined };
}

/**
 * BEA: Ohio quarterly personal income (Regional / SQINC1 / line 1 / 39000).
 * Success is asserted on the PAYLOAD, never res.ok — measured 2026-08-25:
 * an inactive UserID returns HTTP 200 with APIErrorCode 4.
 */
export async function fetchBeaSeries(
  apiKey: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<{ points: Map<string, SeriesPoint>; reason?: string }> {
  const points = new Map<string, SeriesPoint>();
  if (!apiKey) return { points, reason: "BEA_API_KEY not set" };
  try {
    const url =
      `https://apps.bea.gov/api/data/?UserID=${encodeURIComponent(apiKey)}` +
      `&method=GetData&datasetname=Regional&TableName=SQINC1&LineCode=1&GeoFips=39000&Year=LAST5&ResultFormat=JSON`;
    const res = await fetchImpl(url);
    const text = await res.text();
    if (!res.ok) return { points, reason: `BEA HTTP ${res.status}` };
    const json = JSON.parse(text) as {
      BEAAPI?: {
        Error?: { APIErrorCode?: string; APIErrorDescription?: string };
        Results?: {
          Error?: { APIErrorCode?: string; APIErrorDescription?: string };
          Data?: Array<{ TimePeriod?: string; DataValue?: string }>;
        };
      };
    };
    const errNode = json.BEAAPI?.Error ?? json.BEAAPI?.Results?.Error;
    if (errNode) {
      return { points, reason: `BEA API error ${errNode.APIErrorCode ?? "?"}: ${errNode.APIErrorDescription ?? "no description"}` };
    }
    const rows = json.BEAAPI?.Results?.Data ?? [];
    // Latest quarter: TimePeriod sorts lexicographically ("2026Q1" > "2025Q4").
    const latest = [...rows]
      .filter((r) => r.TimePeriod && r.DataValue)
      .sort((a, b) => (a.TimePeriod! < b.TimePeriod! ? 1 : -1))[0];
    if (!latest) return { points, reason: "BEA returned no data rows" };
    const value = parseFloat(latest.DataValue!.replace(/,/g, ""));
    if (!Number.isFinite(value)) return { points, reason: `BEA value unparseable: ${latest.DataValue}` };
    points.set("SQINC1/1/39000", { value, date: latest.TimePeriod! });
    return { points };
  } catch (err) {
    return { points, reason: `BEA fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Census MARTS: monthly retail sales, motor vehicle & parts dealers (441), SA.
 * Measured 2026-08-25: keyless AND invalid-key requests 302 into an HTML
 * "Missing Key"/"Invalid Key" page — so a non-JSON body is a KEY failure and
 * is reported as one instead of crashing JSON.parse. Columns are located by
 * the header row, not by position, so a param-order change cannot silently
 * shift values.
 */
export async function fetchCensusMarts(
  apiKey: string | undefined,
  fetchImpl: FetchLike = fetch,
  year: number = currentUtcYear(),
  retried = false,
): Promise<{ points: Map<string, SeriesPoint>; reason?: string }> {
  const points = new Map<string, SeriesPoint>();
  if (!apiKey) return { points, reason: "CENSUS_API_KEY not set" };
  try {
    const url =
      `https://api.census.gov/data/timeseries/eits/marts` +
      `?get=cell_value,data_type_code,seasonally_adj,category_code&for=us:*` +
      `&time=${year}&category_code=441&data_type_code=SM&key=${encodeURIComponent(apiKey)}`;
    const res = await fetchImpl(url);
    const text = await res.text();
    const trimmed = text.trimStart();
    if (trimmed.startsWith("<")) {
      // The measured refusal shape: an HTML key page, possibly behind a 302.
      return { points, reason: "Census rejected the key (HTML key page returned — check CENSUS_API_KEY)" };
    }
    if (!res.ok) return { points, reason: `Census HTTP ${res.status}` };
    const rows = JSON.parse(trimmed) as string[][];
    if (!Array.isArray(rows) || rows.length < 2) {
      // JANUARY SEAM, closed in review: MARTS publishes mid-month, so a
      // current-year query in early January legitimately has zero rows and
      // would page "no rows" for ~2 weeks every year. One retry against the
      // previous year keeps December's number serving until the first release.
      if (!retried) return fetchCensusMarts(apiKey, fetchImpl, year - 1, true);
      return { points, reason: `Census returned no ${year + 1} or ${year} rows for MARTS 441` };
    }
    const header = rows[0];
    const iValue = header.indexOf("cell_value");
    const iAdj = header.indexOf("seasonally_adj");
    const iTime = header.indexOf("time");
    if (iValue < 0 || iTime < 0) {
      return { points, reason: `Census response missing expected columns (got: ${header.join(",")})` };
    }
    const data = rows
      .slice(1)
      .filter((r) => iAdj < 0 || r[iAdj]?.toLowerCase() === "yes")
      .map((r) => ({ time: r[iTime], value: parseFloat(r[iValue]) }))
      .filter((r) => r.time && Number.isFinite(r.value))
      .sort((a, b) => (a.time < b.time ? 1 : -1));
    if (data.length === 0) return { points, reason: "Census returned rows but none seasonally adjusted/parseable" };
    points.set("MARTS/441/SM", { value: data[0].value, date: data[0].time });
    return { points };
  } catch (err) {
    return { points, reason: `Census fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** UTC year without touching the local clock (ET-clock rule: this is a UTC quantity). */
function currentUtcYear(): number {
  return new Date().getUTCFullYear();
}

/* ────────────────────────────────────────────────────────────────────────
 * Pure core — the part canaries drive with synthetic fixtures.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Resolve every series through its chain against already-fetched provider
 * maps. Pure: no fetch, no env, no clock — the ingestAllSources lesson
 * (a gate you can only grep is a gate a swapped argument defeats).
 */
export function resolveMacroChains(
  specs: readonly MacroSeriesSpec[],
  fetched: Partial<Record<MacroProvider, Map<string, SeriesPoint>>>,
): { indicators: MacroIndicator[]; unresolved: Array<{ spec: MacroSeriesSpec; triedProviders: MacroProvider[] }> } {
  const indicators: MacroIndicator[] = [];
  const unresolved: Array<{ spec: MacroSeriesSpec; triedProviders: MacroProvider[] }> = [];
  for (const spec of specs) {
    let hit: MacroIndicator | null = null;
    for (let i = 0; i < spec.chain.length; i++) {
      const link = spec.chain[i];
      const point = fetched[link.provider]?.get(link.id);
      if (!point) continue;
      hit = {
        key: spec.key,
        name: spec.name,
        unit: spec.unit,
        value: point.value,
        date: point.date,
        source: link.provider,
        sourceSeriesId: link.id,
        viaFallback: i > 0,
        ...(i > 0 ? { fallbackFrom: spec.chain[0].provider } : {}),
      };
      break;
    }
    if (hit) indicators.push(hit);
    else unresolved.push({ spec, triedProviders: spec.chain.map((l) => l.provider) });
  }
  return { indicators, unresolved };
}

/**
 * The loud-failure judge, mirroring ingestionFailure: null when healthy,
 * an operator-facing reason when the fetch must be treated as failed.
 * Zero indicators with ≥1 provider attempted is a FAILURE — a macro report
 * with no numbers must never ingest as a quiet success.
 */
export function macroFetchFailure(result: MacroFetchResult): string | null {
  const attempted = result.providers.filter((p) => p.attempted);
  if (result.indicators.length > 0) return null;
  const reasons = result.providers
    .map((p) => `${p.provider}: ${p.reason ?? (p.attempted ? "no series served" : `dormant — set ${p.envVar}`)}`)
    .join(" | ");
  return `macro fetch returned ZERO series across ${attempted.length} attempted provider(s) — ${reasons}`;
}

/**
 * Render the ingestable markdown report. Attribution rules:
 *   - a fallback-served line names BOTH providers inline — the operator
 *     comparing week to week must see the source changed;
 *   - a primary-served line stays clean (no noise on the healthy path);
 *   - unresolved series are LISTED, not omitted — an absent line is
 *     indistinguishable from a never-existed line;
 *   - the status footer names every provider including dormant ones with
 *     the exact env var and signup URL — dormant-but-visible.
 */
export function renderMacroReport(
  result: MacroFetchResult,
  unresolved: Array<{ spec: MacroSeriesSpec; triedProviders: MacroProvider[] }>,
  generatedAtIso: string,
  sourceUrl: string,
): string {
  const lines = result.indicators.map((ind) => {
    const attribution = ind.viaFallback
      ? ` — source: ${ind.source} (fallback; ${ind.fallbackFrom} did not serve)`
      : "";
    return `- **${ind.name}**: ${ind.value}${ind.unit === "%" ? "%" : ` ${ind.unit}`} (${ind.date})${attribution}`;
  });

  const missing = unresolved.map(
    (u) => `- ${u.spec.name}: UNAVAILABLE this run (tried ${u.triedProviders.join(" → ")})`,
  );

  const status = result.providers.map((p) => {
    if (!p.attempted && p.keyState === "absent") {
      return `${p.provider}: dormant — waiting on ${p.envVar} (free key: ${p.signupUrl})`;
    }
    const tier = p.provider === "BLS" && p.keyState === "keyless-tier" ? " (keyless v1 tier)" : "";
    if (p.served > 0) return `${p.provider}: OK, ${p.served} series${tier}`;
    return `${p.provider}: FAILED — ${p.reason ?? "no series served"}${tier}`;
  });

  return `# Macro Economic Report (multi-source)
Generated: ${generatedAtIso}
Source: ${sourceUrl}

Key observations:
${lines.length > 0 ? lines.join("\n") : "- No verified macro data available."}
${missing.length > 0 ? `\nUnavailable series:\n${missing.join("\n")}\n` : ""}
Macro source status:
${status.map((s) => `- ${s}`).join("\n")}
`;
}

/* ────────────────────────────────────────────────────────────────────────
 * Orchestrator — reads env, runs the fetchers, feeds the pure core.
 * ──────────────────────────────────────────────────────────────────────── */

export async function fetchMacroIndicators(
  fetchImpl: FetchLike = fetch,
): Promise<{ result: MacroFetchResult; unresolved: Array<{ spec: MacroSeriesSpec; triedProviders: MacroProvider[] }> }> {
  const fredKey = process.env.FRED_API_KEY?.trim() || undefined;
  const blsKey = process.env.BLS_API_KEY?.trim() || undefined;
  const beaKey = process.env.BEA_API_KEY?.trim() || undefined;
  const censusKey = process.env.CENSUS_API_KEY?.trim() || undefined;

  const idsFor = (provider: MacroProvider) =>
    MACRO_SERIES.flatMap((s) => s.chain.filter((l) => l.provider === provider).map((l) => l.id));

  // BLS runs keyless; FRED/BEA/CENSUS are skipped (dormant) without keys.
  const [bls, fred, bea, census] = await Promise.all([
    fetchBlsSeries(idsFor("BLS"), blsKey, fetchImpl),
    fredKey ? fetchFredSeries(idsFor("FRED"), fredKey, fetchImpl) : Promise.resolve({ points: new Map<string, SeriesPoint>(), reason: "FRED_API_KEY not set" }),
    beaKey ? fetchBeaSeries(beaKey, fetchImpl) : Promise.resolve({ points: new Map<string, SeriesPoint>(), reason: "BEA_API_KEY not set" }),
    censusKey ? fetchCensusMarts(censusKey, fetchImpl) : Promise.resolve({ points: new Map<string, SeriesPoint>(), reason: "CENSUS_API_KEY not set" }),
  ]);

  const { indicators, unresolved } = resolveMacroChains(MACRO_SERIES, {
    FRED: fred.points,
    BLS: bls.points,
    BEA: bea.points,
    CENSUS: census.points,
  });

  const served = (prov: MacroProvider) => indicators.filter((i) => i.source === prov).length;
  const providers: ProviderStatus[] = [
    {
      provider: "FRED",
      keyState: fredKey ? "present" : "absent",
      ...PROVIDER_META.FRED,
      attempted: Boolean(fredKey),
      served: served("FRED"),
      failed: fredKey ? idsFor("FRED").length - fred.points.size : 0,
      ...(fred.reason ? { reason: fred.reason } : {}),
    },
    {
      provider: "BLS",
      keyState: blsKey ? "present" : "keyless-tier",
      ...PROVIDER_META.BLS,
      attempted: true, // BLS is always attempted — the keyless tier works
      served: served("BLS"),
      failed: idsFor("BLS").length - bls.points.size,
      ...(bls.reason ? { reason: bls.reason } : {}),
    },
    {
      provider: "BEA",
      keyState: beaKey ? "present" : "absent",
      ...PROVIDER_META.BEA,
      attempted: Boolean(beaKey),
      served: served("BEA"),
      failed: beaKey ? idsFor("BEA").length - bea.points.size : 0,
      ...(bea.reason ? { reason: bea.reason } : {}),
    },
    {
      provider: "CENSUS",
      keyState: censusKey ? "present" : "absent",
      ...PROVIDER_META.CENSUS,
      attempted: Boolean(censusKey),
      served: served("CENSUS"),
      failed: censusKey ? idsFor("CENSUS").length - census.points.size : 0,
      ...(census.reason ? { reason: census.reason } : {}),
    },
  ];

  const result: MacroFetchResult = { indicators, providers };
  log.info("macro fetch complete", {
    indicators: indicators.length,
    unresolved: unresolved.length,
    providers: providers.map((p) => `${p.provider}:${p.served}/${p.served + p.failed}${p.attempted ? "" : ":dormant"}`),
  });
  return { result, unresolved };
}
