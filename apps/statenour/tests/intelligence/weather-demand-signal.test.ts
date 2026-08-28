/**
 * Canaries for the Cleveland weather demand signal — the keyless replacement
 * that made the intelligence layer MORE actionable, not less. Everything drives
 * the code with SYNTHETIC fixtures and carries its positive control in the same
 * block: an assertion that only exercises the fired direction cannot be told
 * apart from a dead detector, so every "fires" test is paired with a "stays
 * quiet" negative control on the same function.
 *
 * The behaviours under guard, and the failure each one answers:
 *   1. ALERTS ARE CLASSIFIED, NOT BLANKET — snow/freeze → HIGH winter, rain →
 *      MEDIUM wet, heat → LOW; a mild day → NOTHING. (A detector that always
 *      fires is as useless as one that never does.)
 *   2. OFFICIAL NWS ALERTS OUTRANK FORECASTS and non-tire events are dropped.
 *   3. FAILOVER IS ATTRIBUTED — an Open-Meteo-served result names weather.gov as
 *      the failed primary; a silent source swap corrupts week-over-week reads.
 *   4. ZERO DATA IS LOUD — both keyless sources dark fails ingestion with a
 *      per-source reason, never the old "simulated typical Cleveland weather".
 *   5. THE SIGNAL IS ACTIONABLE, NOT DECORATIVE — a HIGH/official alert leads
 *      the brief block with an act-now banner; a quiet day still renders
 *      (dormant-but-visible); a dead source says so out loud, never a blank
 *      that reads as "calm".
 *   6. THE PRODUCER/CONSUMER FORMAT IS ONE CONTRACT — renderWeatherRawContent
 *      (what ingest.ts writes) round-trips through parseWeatherSignal (what the
 *      brief reads) with hasHigh and attribution intact.
 */
import { describe, it, expect } from "vitest";
import {
  classifyAlerts,
  alertFromNwsEvent,
  fetchWeatherMetrics,
  weatherFetchFailure,
  renderWeatherRawContent,
  type WeatherAlert,
  type WeatherResult,
} from "@/lib/intelligence/connectors/weather";
import { parseWeatherSignal, renderWeatherBlock } from "@/lib/intelligence/weather-block";

/* ── fake fetch — routes by URL substring, no network ──────────────────── */

type FakeBody = Record<string, unknown>;
const res = (body: FakeBody, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

function fakeFetch(routes: Array<[string, () => Response]>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [needle, make] of routes) {
      if (url.includes(needle)) return make();
    }
    throw new Error(`unrouted fetch: ${url}`);
  }) as unknown as typeof fetch;
}

// weather.gov happy path: /points → forecast URL → periods; plus an active alert.
const NWS_HEALTHY = (event = "Winter Storm Warning"): Array<[string, () => Response]> => [
  ["/alerts/active", () => res({ features: [{ properties: { event, headline: `${event} until 6 PM` } }] })],
  ["/gridpoints/", () => res({ properties: { periods: [{ temperature: 28, shortForecast: "Snow", detailedForecast: "Snow showers, 3 to 5 inches." }] } })],
  ["/points/", () => res({ properties: { forecast: "https://api.weather.gov/gridpoints/CLE/83,65/forecast" } })],
];

/* ── 1 · classifyAlerts: classified, not blanket ───────────────────────── */

describe("classifyAlerts — demand classes, with a quiet-day control", () => {
  it("snow keyword → HIGH winter (independent of temperature)", () => {
    const [a] = classifyAlerts("Snow showers likely", 40); // 40°F is NOT cold; keyword alone
    expect(a.severity).toBe("HIGH");
    expect(a.event).toBe("Winter Hazard");
    expect(a.opportunity).toMatch(/winter-tire|battery|pressure/i);
  });

  it("freezing temperature → HIGH winter (independent of keyword)", () => {
    const [a] = classifyAlerts("Clear skies", 30); // no winter word; temp path fires
    expect(a.severity).toBe("HIGH");
    expect(a.event).toBe("Winter Hazard");
  });

  it("rain → MEDIUM wet-road", () => {
    const [a] = classifyAlerts("Rain likely this afternoon", 55);
    expect(a.severity).toBe("MEDIUM");
    expect(a.opportunity).toMatch(/brake|tread|wiper/i);
  });

  it("heat ≥ 88°F → LOW heat advisory", () => {
    const [a] = classifyAlerts("Sunny and hot", 92);
    expect(a.severity).toBe("LOW");
    expect(a.opportunity).toMatch(/blowout|pressure|tread/i);
  });

  // NEGATIVE CONTROL — a mild, dry day must produce NO alert. Without this a
  // detector hard-wired to always emit a Winter Hazard would pass every test above.
  it("mild dry day → NO alert", () => {
    expect(classifyAlerts("Partly cloudy", 70)).toEqual([]);
  });
});

/* ── 2 · alertFromNwsEvent: official, and non-tire events dropped ──────── */

describe("alertFromNwsEvent — official mapping with a non-tire control", () => {
  it("Winter Storm Warning → HIGH, official", () => {
    const a = alertFromNwsEvent("Winter Storm Warning", "Warning until 6 PM");
    expect(a?.severity).toBe("HIGH");
    expect(a?.official).toBe(true);
  });

  it("Flood Warning → MEDIUM, official", () => {
    const a = alertFromNwsEvent("Flood Warning", "Areal flooding");
    expect(a?.severity).toBe("MEDIUM");
    expect(a?.official).toBe(true);
  });

  // NEGATIVE CONTROL — a real NWS event with no tire-demand meaning is dropped.
  it("Air Quality Alert → null (not a tire-demand signal)", () => {
    expect(alertFromNwsEvent("Air Quality Alert", "Ozone action day")).toBeNull();
  });
});

/* ── 3 · fetchWeatherMetrics: attributed failover ──────────────────────── */

describe("fetchWeatherMetrics — primary, attributed failover, both-down", () => {
  it("weather.gov serves → source weather.gov, no fallback, official alert merged", async () => {
    const r = await fetchWeatherMetrics(fakeFetch(NWS_HEALTHY()));
    expect(r.ok).toBe(true);
    expect(r.source).toBe("weather.gov");
    expect(r.viaFallback).toBe(false);
    expect(r.alerts.some((a) => a.official)).toBe(true);
  });

  it("weather.gov down → Open-Meteo serves, FALLBACK NAMES THE PRIMARY", async () => {
    const r = await fetchWeatherMetrics(
      fakeFetch([
        ["/points/", () => res({}, false, 503)], // primary dark
        ["open-meteo", () => res({ daily: { temperature_2m_min: [30], temperature_2m_max: [38], snowfall_sum: [2], precipitation_sum: [0.5] } })],
      ]),
    );
    expect(r.ok).toBe(true);
    expect(r.source).toBe("open-meteo");
    expect(r.viaFallback).toBe(true);
    expect(r.reason).toMatch(/weather\.gov/); // attribution, not a silent swap
    expect(r.alerts[0]?.severity).toBe("HIGH"); // 30°F + snowfall → winter
  });

  it("both keyless sources down → ok:false, reason names BOTH (loud, never mocked)", async () => {
    const r = await fetchWeatherMetrics(
      fakeFetch([
        ["/points/", () => res({}, false, 503)],
        ["open-meteo", () => res({}, false, 500)],
      ]),
    );
    expect(r.ok).toBe(false);
    expect(r.temperature).toBeNull();
    expect(r.reason).toMatch(/weather\.gov/);
    expect(r.reason).toMatch(/open-meteo/);
  });

  it("weatherFetchFailure: null when healthy, an operator reason when dark", async () => {
    const healthy = await fetchWeatherMetrics(fakeFetch(NWS_HEALTHY()));
    expect(weatherFetchFailure(healthy)).toBeNull();

    const dark: WeatherResult = { ok: false, source: null, viaFallback: false, location: "Cleveland, OH", temperature: null, condition: "", forecast: "", alerts: [], reason: "weather.gov: x | open-meteo: y" };
    expect(weatherFetchFailure(dark)).toMatch(/no data/);
  });
});

/* ── 4 · full format round-trip + the actionable brief block ───────────── */

const HIGH_OFFICIAL: WeatherAlert = {
  event: "Winter Storm Warning",
  severity: "HIGH",
  description: "Warning until 6 PM",
  opportunity: "Launch the winter-tire/battery push before it lands.",
  official: true,
};
const resultWith = (alerts: WeatherAlert[], over: Partial<WeatherResult> = {}): WeatherResult => ({
  ok: true, source: "weather.gov", viaFallback: false, location: "Cleveland, OH",
  temperature: 28, condition: "Snow", forecast: "Snow showers.", alerts, ...over,
});

describe("renderWeatherRawContent → parseWeatherSignal → renderWeatherBlock", () => {
  it("HIGH official alert round-trips and LEADS the block with an act-now banner", () => {
    const raw = renderWeatherRawContent(resultWith([HIGH_OFFICIAL]), "2026-08-28T12:00:00.000Z");
    expect(raw).toContain("ACTIVE NWS ALERT"); // producer emitted the token

    const signal = parseWeatherSignal(raw);
    expect(signal.hasHigh).toBe(true); // consumer parsed it back

    const block = renderWeatherBlock(signal);
    expect(block).toContain("HIGH: act ahead of the surge"); // ACTIONABLE, not decorative
    expect(block).toContain("Winter Storm Warning");
  });

  it("fallback attribution survives the round-trip into the block", () => {
    const raw = renderWeatherRawContent(resultWith([HIGH_OFFICIAL], { source: "open-meteo", viaFallback: true }), "2026-08-28T12:00:00.000Z");
    const block = renderWeatherBlock(parseWeatherSignal(raw));
    expect(block).toContain("open-meteo (fallback; weather.gov did not serve)");
  });

  // NEGATIVE CONTROL — a quiet day renders WITHOUT the urgent banner, but the
  // block is still present (dormant-but-visible, not silently dropped).
  it("quiet day → block present, NO act-now banner", () => {
    const raw = renderWeatherRawContent(resultWith([]), "2026-08-28T12:00:00.000Z");
    const signal = parseWeatherSignal(raw);
    expect(signal.hasHigh).toBe(false);
    const block = renderWeatherBlock(signal);
    expect(block).toContain("Weather Demand Signal");
    expect(block).not.toContain("act ahead of the surge");
    expect(block).toContain("No weather-driven demand signal today");
  });

  // A dead source must say so — never a blank that reads as a calm day.
  it("null signal → 'source dormant or failed', out loud", () => {
    const block = renderWeatherBlock(null);
    expect(block).toContain("source dormant or failed");
    expect(block).toContain("not a quiet day");
  });
});
