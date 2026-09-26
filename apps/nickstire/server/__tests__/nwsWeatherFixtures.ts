/**
 * Recorded api.weather.gov responses for the shop's point (41.5525,-81.5572),
 * captured 2026-09-23 ~15:25 UTC: points -> gridpoints CLE/88,68, the 12-hour
 * forecast (14 periods), the hourly forecast (trimmed to its first 6 periods)
 * and active alerts (one Beach Hazards Statement). Tests never touch the
 * network: stubNwsFetch() serves these by URL.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";

const load = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(__dirname, "fixtures/nws", name), "utf8"));

export const nwsFixtures = {
  points: () => load("points.json"),
  forecast: () => load("forecast.json") as { properties: { periods: Record<string, unknown>[] } },
  hourly: () => load("forecast-hourly.json") as { properties: { periods: Record<string, unknown>[] } },
  alerts: () => load("alerts-active.json") as { features: unknown[] },
};

type Overrides = Partial<Record<"points" | "forecast" | "hourly" | "alerts", unknown | Response>>;

/** Stub global fetch with the recorded fixtures; returns the spy for header/URL assertions. */
export function stubNwsFetch(overrides: Overrides = {}) {
  const pick = (key: keyof Overrides, fallback: () => unknown) => {
    const v = key in overrides ? overrides[key] : fallback();
    return v instanceof Response ? v : new Response(JSON.stringify(v), { status: 200 });
  };
  const spy = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("/points/")) return pick("points", nwsFixtures.points);
    if (url.endsWith("/forecast/hourly")) return pick("hourly", nwsFixtures.hourly);
    if (url.endsWith("/forecast")) return pick("forecast", nwsFixtures.forecast);
    if (url.includes("/alerts/active")) return pick("alerts", nwsFixtures.alerts);
    return new Response("unexpected URL in test", { status: 599 });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** Shift every period's start/end by `days` and apply per-index temperatures (°F). */
export function editForecast(
  body: { properties: { periods: Record<string, unknown>[] } },
  days: number,
  temps: Record<number, number> = {},
) {
  const shift = (iso: unknown) => {
    const s = String(iso);
    const offset = s.slice(-6); // keep the recorded "-04:00" offset
    const d = new Date(Date.parse(s) + days * 86_400_000 - 4 * 3_600_000); // wall time at -04:00
    return d.toISOString().slice(0, 19) + offset;
  };
  body.properties.periods = body.properties.periods.map((p, i) => ({
    ...p,
    startTime: shift(p.startTime),
    endTime: shift(p.endTime),
    ...(i in temps ? { temperature: temps[i] } : {}),
  }));
  return body;
}
