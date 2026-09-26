/**
 * NWS client contract, against recorded api.weather.gov fixtures (no network):
 *   · every request identifies the app with the shop's PUBLIC contact
 *   · points -> forecast/forecastHourly URL flow, then a 45-minute cache
 *   · a non-2xx, a bad JSON body or a wrong shape THROWS — never an empty forecast
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nwsFixtures, stubNwsFetch } from "../__tests__/nwsWeatherFixtures";
import {
  NWS_CACHE_MS,
  NWS_USER_AGENT,
  __resetNwsCacheForTests,
  getActiveAlerts,
  getForecastPeriods,
  getHourlyPeriods,
  parseWindMph,
} from "./nwsWeather";

beforeEach(() => __resetNwsCacheForTests());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const headersOf = (call: unknown[]) => new Headers((call[1] as RequestInit).headers);

describe("nwsWeather", () => {
  it("sends the identifying User-Agent (site + public phone) on every request", async () => {
    expect(NWS_USER_AGENT).toBe("NicksTireAuto/1.0 (https://nickstire.org; (216) 862-0005)");
    const spy = stubNwsFetch();
    await getForecastPeriods();
    await getActiveAlerts();
    expect(spy.mock.calls.length).toBe(3); // points, forecast, alerts
    for (const call of spy.mock.calls) {
      expect(headersOf(call).get("User-Agent")).toBe(NWS_USER_AGENT);
      expect((call[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("follows /points to the returned forecast URLs and parses the recorded periods", async () => {
    const spy = stubNwsFetch();
    const periods = await getForecastPeriods();
    const urls = spy.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe("https://api.weather.gov/points/41.5525,-81.5572");
    expect(urls[1]).toBe("https://api.weather.gov/gridpoints/CLE/88,68/forecast");
    expect(periods).toHaveLength(14);
    expect(periods[0]).toMatchObject({ name: "Today", isDaytime: true });
    expect(typeof periods[0].temperatureF).toBe("number");

    const hourly = await getHourlyPeriods();
    expect(String(spy.mock.calls.at(-1)![0])).toBe("https://api.weather.gov/gridpoints/CLE/88,68/forecast/hourly");
    expect(hourly[0].shortForecast).toBe("Cloudy");
  });

  it("reads active alerts for the shop's point", async () => {
    const spy = stubNwsFetch();
    const alerts = await getActiveAlerts();
    expect(String(spy.mock.calls[0][0])).toBe("https://api.weather.gov/alerts/active?point=41.5525,-81.5572");
    expect(alerts.map((a) => a.event)).toEqual(["Beach Hazards Statement"]);
  });

  it("caches for 45 minutes, then refetches", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const spy = stubNwsFetch();
    await getForecastPeriods();
    await getForecastPeriods();
    expect(spy).toHaveBeenCalledTimes(2); // points + forecast, once
    vi.setSystemTime(Date.now() + NWS_CACHE_MS + 1);
    await getForecastPeriods();
    expect(spy).toHaveBeenCalledTimes(3); // forecast again; points is cached 24h
  });

  it("THROWS on a non-2xx response", async () => {
    stubNwsFetch({ forecast: new Response("busy", { status: 503 }) });
    await expect(getForecastPeriods()).rejects.toThrow(/NWS 503/);
  });

  it("THROWS on a body that is not JSON", async () => {
    stubNwsFetch({ forecast: new Response("<html>oops</html>", { status: 200 }) });
    await expect(getForecastPeriods()).rejects.toThrow(/invalid JSON/);
  });

  it("THROWS on a JSON body with the wrong shape", async () => {
    const noPeriods = nwsFixtures.forecast();
    noPeriods.properties.periods = [];
    stubNwsFetch({ forecast: noPeriods });
    await expect(getForecastPeriods()).rejects.toThrow(/unexpected response shape/);

    __resetNwsCacheForTests();
    const badTemp = nwsFixtures.forecast();
    badTemp.properties.periods[0].temperature = null;
    stubNwsFetch({ forecast: badTemp });
    await expect(getForecastPeriods()).rejects.toThrow(/period\[0\]\.temperature/);
  });

  it("does not cache a failure", async () => {
    stubNwsFetch({ forecast: new Response("busy", { status: 503 }) });
    await expect(getForecastPeriods()).rejects.toThrow();
    stubNwsFetch();
    await expect(getForecastPeriods()).resolves.toHaveLength(14);
  });

  it("parses NWS wind strings to the upper bound in mph", () => {
    expect(parseWindMph("13 mph")).toBe(13);
    expect(parseWindMph("7 to 12 mph")).toBe(12);
    expect(parseWindMph(undefined)).toBeNull();
  });
});
