/**
 * weather.ts on the NWS hourly forecast (recorded fixtures, no network).
 * The public WeatherData shape (WMO weather_code) is unchanged, so the
 * notification bar, shop state and voice greeting need no change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nwsFixtures, stubNwsFetch } from "./__tests__/nwsWeatherFixtures";
import { NWS_USER_AGENT, __resetNwsCacheForTests } from "./lib/nwsWeather";
import { __resetWeatherCacheForTests, getWeather, getWeatherAlert, nwsForecastToWmoCode } from "./weather";

beforeEach(() => {
  __resetNwsCacheForTests();
  __resetWeatherCacheForTests();
});
afterEach(() => vi.unstubAllGlobals());

describe("weather.ts via NWS", () => {
  it("reads the current hour from the recorded hourly forecast, with the NWS User-Agent", async () => {
    const spy = stubNwsFetch();
    const w = await getWeather();
    expect(w).toMatchObject({ weather_code: 3, weather_condition: "overcast", is_day: true, precipitation_mm: 0 });
    expect(typeof w!.temperature_f).toBe("number");
    expect(spy.mock.calls.map((c) => String(c[0]))).toContain("https://api.weather.gov/gridpoints/CLE/88,68/forecast/hourly");
    for (const c of spy.mock.calls) {
      expect(new Headers((c[1] as RequestInit).headers).get("User-Agent")).toBe(NWS_USER_AGENT);
    }
  });

  it("uses the hourly period covering now, not a stale first period", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const hourly = nwsFixtures.hourly();
      vi.setSystemTime(Date.parse(String(hourly.properties.periods[1].startTime)) + 60_000);
      hourly.properties.periods[1] = { ...hourly.properties.periods[1], shortForecast: "Heavy Snow" };
      stubNwsFetch({ hourly });
      await expect(getWeather()).resolves.toMatchObject({ weather_code: 75 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("degrades to null (no bar) when NWS fails and nothing is cached", async () => {
    stubNwsFetch({ hourly: new Response("down", { status: 503 }) });
    await expect(getWeather()).resolves.toBeNull();
  });

  it("maps NWS forecast text onto the WMO codes the alert bar reads", () => {
    const cases: [string, number | null, number][] = [
      ["Sunny", null, 0],
      ["Mostly Clear", null, 1],
      ["Partly Cloudy", null, 2],
      ["Cloudy", null, 3],
      ["Patchy Fog", null, 45],
      ["Light Rain", 90, 61],
      ["Rain", 90, 63],
      ["Heavy Rain", 90, 65],
      ["Rain Showers Likely", 70, 81],
      ["Freezing Rain", 80, 66],
      ["Light Snow", 80, 71],
      ["Snow", 80, 73],
      ["Heavy Snow", 90, 75],
      ["Snow Showers", 70, 85],
      ["Showers And Thunderstorms", 70, 95],
      ["Chance Rain Showers", 30, 3], // a 30% chance this hour is not rain now
      ["Chance Snow", 60, 73],
    ];
    for (const [text, pop, code] of cases) expect(nwsForecastToWmoCode(text, pop), text).toBe(code);
  });

  it("a mapped heavy-snow hour still raises the danger bar", () => {
    const alert = getWeatherAlert({ temperature_f: 25, wind_speed_mph: 10, weather_code: nwsForecastToWmoCode("Heavy Snow", 90), weather_condition: "heavy_snow", is_day: true, precipitation_mm: 0 });
    expect(alert).toMatchObject({ active: true, severity: "danger", icon: "snowflake" });
  });
});
