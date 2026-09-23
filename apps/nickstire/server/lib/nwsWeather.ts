/**
 * National Weather Service (api.weather.gov) client for the shop's location.
 *
 * WHY NWS. The data is US-government open data, "free to use for any purpose"
 * (weather.gov/documentation/services-web-api, read 2026-09-23), so a
 * commercial business may use it. It replaces:
 *   - OpenWeather in services/weatherIntelligence.ts, which needed an
 *     OPENWEATHER_API_KEY that MAINnicks-tire-auto never had (.railway/railway.ts),
 *     so the weather lane never ran;
 *   - Open-Meteo in weather.ts, whose free API is non-commercial only
 *     (open-meteo.com/en/terms: "You may only use the free API services for
 *     non-commercial purposes"; commercial includes integrating it into a
 *     commercial product).
 *
 * CONTRACT
 *   - No key. NWS requires a User-Agent that identifies the app; including
 *     contact details lets them reach us if the string is tied to a security
 *     event. Built from the shop's PUBLIC constants only.
 *   - Flow: /points/{lat},{lon} -> the returned forecast / forecastHourly URLs,
 *     plus /alerts/active?point={lat},{lon}.
 *   - Every fetch has a timeout. A non-2xx, a timeout or a body that does not
 *     have the expected shape THROWS. Callers decide how to degrade; this
 *     module never turns a failure into an empty forecast.
 *   - Responses are cached in-process (forecasts/alerts 45 min, the points
 *     grid mapping 24 h — NWS asks clients to re-check /points periodically).
 */

import { BUSINESS, SITE_URL } from "../../shared/business";

const NWS_BASE = "https://api.weather.gov";
const FETCH_TIMEOUT_MS = 8_000;
export const NWS_CACHE_MS = 45 * 60 * 1000;
const POINTS_CACHE_MS = 24 * 60 * 60 * 1000;

/** NWS asks for a unique app identifier plus contact info. Public contact only. */
export const NWS_USER_AGENT = `NicksTireAuto/1.0 (${SITE_URL}; ${BUSINESS.phone.display})`;

/** The shop's GBP-pinned coordinates, rounded to the 4 decimals NWS accepts. */
export const SHOP_POINT = {
  lat: Number(BUSINESS.geo.lat.toFixed(4)),
  lon: Number(BUSINESS.geo.lng.toFixed(4)),
};

export interface NwsPeriod {
  name: string;
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperatureF: number;
  windMph: number | null;
  shortForecast: string;
  detailedForecast: string;
  precipChancePct: number | null;
}

export interface NwsAlert {
  event: string;
  severity: string;
  headline: string;
  onset: string | null;
  ends: string | null;
}

interface PointsInfo {
  forecast: string;
  forecastHourly: string;
}

type CacheEntry<T> = { at: number; value: T };
const cache = new Map<string, CacheEntry<unknown>>();

/** Test-only: drop every cached response. */
export function __resetNwsCacheForTests(): void {
  cache.clear();
}

async function cachedGet<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function nwsGetJson(url: string): Promise<unknown> {
  if (!url.startsWith(`${NWS_BASE}/`)) throw new Error(`NWS: refusing non-NWS URL ${url}`);
  const res = await fetch(url, {
    headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`NWS ${res.status} for ${url}`);
  try {
    return await res.json();
  } catch (err) {
    throw new Error(`NWS: invalid JSON from ${url}`, { cause: err });
  }
}

function fail(what: string): never {
  throw new Error(`NWS: unexpected response shape (${what})`);
}

const asObj = (v: unknown, what: string): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(what);
const asStr = (v: unknown, what: string): string => (typeof v === "string" ? v : fail(what));

/** "13 mph" / "7 to 12 mph" -> the upper bound in mph. null when absent. */
export function parseWindMph(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const nums = [...raw.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (nums.length === 0) return null;
  const top = Math.max(...nums);
  return /km\/h/i.test(raw) ? Math.round(top / 1.609) : top;
}

export function parsePoints(json: unknown): PointsInfo {
  const props = asObj(asObj(json, "points body").properties, "points.properties");
  return {
    forecast: asStr(props.forecast, "points.forecast"),
    forecastHourly: asStr(props.forecastHourly, "points.forecastHourly"),
  };
}

export function parsePeriods(json: unknown): NwsPeriod[] {
  const props = asObj(asObj(json, "forecast body").properties, "forecast.properties");
  const raw = props.periods;
  if (!Array.isArray(raw) || raw.length === 0) fail("forecast.periods empty or missing");
  return raw.map((p, i) => {
    const o = asObj(p, `period[${i}]`);
    if (typeof o.temperature !== "number" || !Number.isFinite(o.temperature)) fail(`period[${i}].temperature`);
    const unit = o.temperatureUnit === "C" ? "C" : o.temperatureUnit === "F" ? "F" : fail(`period[${i}].temperatureUnit`);
    const temperatureF = unit === "C" ? Math.round((o.temperature as number) * 9 / 5 + 32) : (o.temperature as number);
    const pop = (o.probabilityOfPrecipitation as { value?: unknown } | null | undefined)?.value;
    return {
      name: typeof o.name === "string" ? o.name : "",
      startTime: asStr(o.startTime, `period[${i}].startTime`),
      endTime: asStr(o.endTime, `period[${i}].endTime`),
      isDaytime: o.isDaytime === true,
      temperatureF,
      windMph: parseWindMph(o.windSpeed),
      shortForecast: typeof o.shortForecast === "string" ? o.shortForecast : "",
      detailedForecast: typeof o.detailedForecast === "string" ? o.detailedForecast : "",
      precipChancePct: typeof pop === "number" ? pop : null,
    };
  });
}

export function parseAlerts(json: unknown): NwsAlert[] {
  const features = asObj(json, "alerts body").features;
  if (!Array.isArray(features)) fail("alerts.features");
  return features.map((f, i) => {
    const p = asObj(asObj(f, `alert[${i}]`).properties, `alert[${i}].properties`);
    return {
      event: asStr(p.event, `alert[${i}].event`),
      severity: typeof p.severity === "string" ? p.severity : "Unknown",
      headline: typeof p.headline === "string" ? p.headline : "",
      onset: typeof p.onset === "string" ? p.onset : null,
      ends: typeof p.ends === "string" ? p.ends : null,
    };
  });
}

async function getPoints(): Promise<PointsInfo> {
  const url = `${NWS_BASE}/points/${SHOP_POINT.lat},${SHOP_POINT.lon}`;
  return cachedGet(url, POINTS_CACHE_MS, async () => parsePoints(await nwsGetJson(url)));
}

/** 12-hour day/night periods, about 7 days ahead. */
export async function getForecastPeriods(): Promise<NwsPeriod[]> {
  const { forecast } = await getPoints();
  return cachedGet(forecast, NWS_CACHE_MS, async () => parsePeriods(await nwsGetJson(forecast)));
}

/** Hourly periods; the first one is the current hour. */
export async function getHourlyPeriods(): Promise<NwsPeriod[]> {
  const { forecastHourly } = await getPoints();
  return cachedGet(forecastHourly, NWS_CACHE_MS, async () => parsePeriods(await nwsGetJson(forecastHourly)));
}

/** Active watches/warnings/advisories covering the shop. */
export async function getActiveAlerts(): Promise<NwsAlert[]> {
  const url = `${NWS_BASE}/alerts/active?point=${SHOP_POINT.lat},${SHOP_POINT.lon}`;
  return cachedGet(url, NWS_CACHE_MS, async () => parseAlerts(await nwsGetJson(url)));
}
