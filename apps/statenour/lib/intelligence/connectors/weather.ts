/**
 * Weather connector — the highest-value keyless demand signal for a Cleveland
 * tire shop, and until 2026-08-28 it was triple-broken and never ran.
 *
 * A tire shop's largest demand driver is weather: snow and ice sell winter-tire
 * swaps and batteries; a hard freeze pops tire pressure and cracks; potholes
 * after a thaw sell alignments. This is the one signal keyless US-gov data can
 * give better than any paid feed — and nobody had it.
 *
 * THREE DEFECTS this rewrite fixes, all measured 2026-08-28:
 *   1. WRONG GRIDPOINT. The old code hardcoded `CLE/85,73`, which returns ZERO
 *      forecast periods — so every call threw "No periods". Cleveland's real
 *      gridpoint is CLE/83,65 (resolved via /points/41.4993,-81.6944, probed
 *      live: 14 periods, "Today 76 Sunny"). We resolve it from lat/lon rather
 *      than trusting a constant, so a NWS grid renumber cannot re-dark it.
 *   2. MOCK FALLBACK. The old catch block "Simulated typical seasonal Cleveland
 *      weather" — fabricated data with today's date, the exact AG-02 violation
 *      the macro purge removed. Gone. Failover is now a SECOND REAL keyless
 *      source (Open-Meteo), then empty. Unavailable data is EMPTY, never mocked.
 *   3. NEVER SEEDED. connectors/weather.ts existed and ingest.ts handled
 *      domain "weather", but prod had ZERO weather source rows, so it never
 *      fired. Seeded in prisma/seeds/seed-sources.ts.
 *
 * KEYLESS, no card, ever. api.weather.gov needs only a descriptive User-Agent
 * (~5,000 req/hr). Open-Meteo needs nothing. Attribution is per line so an
 * operator comparing week to week can see which source served, and the failover
 * is visible — never a silent source swap.
 *
 * Pure helpers (classifyAlerts, pickForecast) are exported so the canaries drive
 * behaviour with synthetic fixtures rather than the network.
 */
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/connector/weather");

const UA = "ClevelandTireNourishing (statenour intelligence; nourdean22@gmail.com)";
// Cleveland, OH — Public Square. lat/lon drives the NWS point lookup so a grid
// renumber cannot silently break us the way the hardcoded CLE/85,73 did.
const CLE_LAT = 41.4993;
const CLE_LON = -81.6944;

export type WeatherProvider = "weather.gov" | "open-meteo";

export interface WeatherAlert {
  event: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  description: string;
  /** The tire-shop demand move this weather implies. */
  opportunity: string;
  /** True for an OFFICIAL NWS active alert (a warning/advisory in force), vs a
   *  forecast-derived heads-up. Official alerts are the strongest demand signal. */
  official: boolean;
}

export interface WeatherResult {
  ok: boolean;
  source: WeatherProvider | null;
  viaFallback: boolean;
  location: string;
  temperature: number | null;
  condition: string;
  forecast: string;
  alerts: WeatherAlert[];
  /** Why the primary did not serve, when we fell back or failed. */
  reason?: string;
}

type FetchLike = typeof fetch;

/* ── pure core ──────────────────────────────────────────────────────────── */

/**
 * Turn a forecast string + temperature into tire-shop demand alerts. Pure so
 * the canary can assert snow → winter swap, freeze → pressure, heat → blowout,
 * without a network call. Winter hazards outrank wet outrank heat.
 */
export function classifyAlerts(forecast: string, temp: number | null): WeatherAlert[] {
  const t = forecast.toLowerCase();
  const cold = temp != null && temp <= 35;
  if (t.includes("snow") || t.includes("ice") || t.includes("freez") || t.includes("blizzard") || cold) {
    return [
      {
        event: "Winter Hazard",
        severity: "HIGH",
        description: `Snow, ice, or freezing temperatures forecast for Cleveland${temp != null ? ` (${temp}°F)` : ""}. ${forecast}`,
        opportunity:
          "Snow/freeze drives winter-tire swaps, battery failures, and pressure-loss checks — push the winter package and TPMS checks NOW, ahead of the walk-in surge.",
        official: false,
      },
    ];
  }
  if (t.includes("rain") || t.includes("thunder") || t.includes("flood") || t.includes("storm")) {
    return [
      {
        event: "Wet Road Advisory",
        severity: "MEDIUM",
        description: `Wet conditions forecast. ${forecast}`,
        opportunity: "Wet roads sell brake inspections, tread-depth checks, and wiper/tire replacement — surface overdue-maintenance customers.",
        official: false,
      },
    ];
  }
  if (temp != null && temp >= 88) {
    return [
      {
        event: "Heat Advisory",
        severity: "LOW",
        description: `Heat forecast (${temp}°F). ${forecast}`,
        opportunity: "Heat raises blowout risk on under-inflated/worn tires — nudge pressure checks and tread inspections.",
        official: false,
      },
    ];
  }
  return [];
}

/** Map an NWS active-alert event name to a demand alert. Official = true. */
export function alertFromNwsEvent(event: string, headline: string): WeatherAlert | null {
  const e = event.toLowerCase();
  const winter = /winter|snow|ice|freez|blizzard|wind chill/.test(e);
  const wet = /flood|rain|thunderstorm|storm/.test(e);
  if (!winter && !wet) return null;
  return {
    event,
    severity: winter ? "HIGH" : "MEDIUM",
    description: headline || event,
    opportunity: winter
      ? "An ACTIVE NWS winter warning is the strongest pre-storm demand signal — launch the winter-tire/battery push and staff the bays before it lands."
      : "Active wet-weather warning — surface brake/tread/wiper offers to overdue customers.",
    official: true,
  };
}

/* ── weather.gov (primary, keyless) ─────────────────────────────────────── */

async function nwsForecast(fetchImpl: FetchLike): Promise<{ temp: number | null; condition: string; forecast: string } | { error: string }> {
  // Resolve the gridpoint from lat/lon — never a hardcoded grid (the 2026-08-28
  // defect). The /points response carries the exact forecast URL to use.
  const pts = await fetchImpl(`https://api.weather.gov/points/${CLE_LAT},${CLE_LON}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!pts.ok) return { error: `weather.gov points HTTP ${pts.status}` };
  const pj = (await pts.json()) as { properties?: { forecast?: string } };
  const url = pj.properties?.forecast;
  if (!url) return { error: "weather.gov points returned no forecast URL" };

  const res = await fetchImpl(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return { error: `weather.gov forecast HTTP ${res.status}` };
  const data = (await res.json()) as {
    properties?: { periods?: Array<{ temperature: number; detailedForecast: string; shortForecast: string }> };
  };
  const periods = data.properties?.periods ?? [];
  if (periods.length === 0) return { error: "weather.gov forecast returned no periods" };
  const p = periods[0];
  return { temp: p.temperature, condition: p.shortForecast, forecast: p.detailedForecast };
}

/** Active NWS alerts for the Cleveland area (Cuyahoga County zone), keyless. */
async function nwsAlerts(fetchImpl: FetchLike): Promise<WeatherAlert[]> {
  try {
    const res = await fetchImpl(`https://api.weather.gov/alerts/active?point=${CLE_LAT},${CLE_LON}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { features?: Array<{ properties?: { event?: string; headline?: string } }> };
    const out: WeatherAlert[] = [];
    for (const f of j.features ?? []) {
      const a = alertFromNwsEvent(f.properties?.event ?? "", f.properties?.headline ?? "");
      if (a) out.push(a);
    }
    return out;
  } catch {
    return []; // alerts are best-effort; the forecast is the required signal
  }
}

/* ── open-meteo (keyless failover) ──────────────────────────────────────── */

async function openMeteo(fetchImpl: FetchLike): Promise<{ temp: number | null; condition: string; forecast: string } | { error: string }> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${CLE_LAT}&longitude=${CLE_LON}` +
    `&daily=temperature_2m_min,temperature_2m_max,snowfall_sum,precipitation_sum&forecast_days=2&temperature_unit=fahrenheit&timezone=America/New_York`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { error: `open-meteo HTTP ${res.status}` };
    const j = (await res.json()) as {
      daily?: { temperature_2m_min?: number[]; temperature_2m_max?: number[]; snowfall_sum?: number[]; precipitation_sum?: number[] };
    };
    const d = j.daily;
    if (!d?.temperature_2m_min?.length) return { error: "open-meteo returned no daily data" };
    const min = d.temperature_2m_min[0];
    const max = d.temperature_2m_max?.[0] ?? min;
    const snow = d.snowfall_sum?.[0] ?? 0;
    const precip = d.precipitation_sum?.[0] ?? 0;
    const parts = [`Low ${Math.round(min)}°F, high ${Math.round(max)}°F`];
    if (snow > 0) parts.push(`snowfall ${snow}in`);
    else if (precip > 0) parts.push(`precipitation ${precip}in`);
    const forecast = parts.join(", ") + " (Open-Meteo).";
    const condition = snow > 0 ? "Snow" : precip > 0 ? "Rain" : min <= 35 ? "Cold" : "Clear";
    return { temp: Math.round(min), condition, forecast };
  } catch (err) {
    return { error: `open-meteo fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/* ── orchestrator ───────────────────────────────────────────────────────── */

export async function fetchWeatherMetrics(fetchImpl: FetchLike = fetch): Promise<WeatherResult> {
  const empty = (reason: string): WeatherResult => ({
    ok: false,
    source: null,
    viaFallback: false,
    location: "Cleveland, OH",
    temperature: null,
    condition: "",
    forecast: "",
    alerts: [],
    reason,
  });

  const primary = await nwsForecast(fetchImpl);
  if (!("error" in primary)) {
    const official = await nwsAlerts(fetchImpl);
    const derived = classifyAlerts(primary.forecast, primary.temp);
    // Official active alerts lead; forecast-derived heads-up follows only if it
    // adds a class the official alerts did not already cover.
    const officialEvents = new Set(official.map((a) => a.severity + a.event.slice(0, 6)));
    const merged = [...official, ...derived.filter((d) => !officialEvents.has(d.severity + d.event.slice(0, 6)))];
    return {
      ok: true,
      source: "weather.gov",
      viaFallback: false,
      location: "Cleveland, OH",
      temperature: primary.temp,
      condition: primary.condition,
      forecast: primary.forecast,
      alerts: merged,
    };
  }

  // weather.gov failed — try the keyless failover, VISIBLY (never a silent swap).
  log.warn(`weather.gov failed (${primary.error}); falling back to Open-Meteo`);
  const fb = await openMeteo(fetchImpl);
  if (!("error" in fb)) {
    return {
      ok: true,
      source: "open-meteo",
      viaFallback: true,
      location: "Cleveland, OH",
      temperature: fb.temp,
      condition: fb.condition,
      forecast: fb.forecast,
      alerts: classifyAlerts(fb.forecast, fb.temp),
      reason: `weather.gov unavailable (${primary.error})`,
    };
  }

  // Both keyless sources down — EMPTY, never mock (AG-02).
  log.warn(`both weather sources failed: gov=${primary.error} · open-meteo=${fb.error}`);
  return empty(`weather.gov: ${primary.error} | open-meteo: ${fb.error}`);
}

/**
 * Render a WeatherResult into the SourceDocument rawContent the brief parses.
 * PURE and single-sourced: ingest.ts calls this, parseWeatherSignal reads its
 * output, and the canary drives both ends through it — so the producer/consumer
 * format is one tested function, never a hand-copied string that can drift.
 * Failover is attributed in the Source line (never a silent source swap).
 */
export function renderWeatherRawContent(r: WeatherResult, generatedIso: string): string {
  const attribution = r.viaFallback ? `${r.source} (fallback; weather.gov did not serve)` : String(r.source);
  const alerts =
    r.alerts.length === 0
      ? "- No weather-driven demand signal today."
      : r.alerts
          .map(
            (a) => `### ${a.event} (${a.severity}${a.official ? " · ACTIVE NWS ALERT" : ""})
- **Signal:** ${a.description}
- **Demand move:** ${a.opportunity}`,
          )
          .join("\n\n");
  return `# Cleveland Weather Demand Signal
Generated: ${generatedIso}
Location: ${r.location}
Source: ${attribution}
Temperature: ${r.temperature ?? "n/a"}°F
Condition: ${r.condition}
Forecast: ${r.forecast}

Demand Alerts:
${alerts}
`;
}

/** The loud-failure judge, mirroring macroFetchFailure: null when healthy, an
 *  operator-facing reason when the fetch must be treated as failed. */
export function weatherFetchFailure(result: WeatherResult): string | null {
  if (result.ok) return null;
  return `weather fetch returned no data — ${result.reason ?? "both keyless sources unavailable"}`;
}
