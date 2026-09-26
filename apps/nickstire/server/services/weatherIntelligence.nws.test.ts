/**
 * weather-intel on the NWS forecast (recorded fixtures, no network).
 *
 *   · POSITIVE CONTROL: the recorded late-September forecast fires nothing
 *   · a freeze in the forecast fires first_freeze days ahead, with the NCEI
 *     normals context in the operator line — but only an IMMINENT one (24h)
 *     is ever handed to customer SMS
 *   · customer SMS stays SHADOW with the flag ON until WEATHER_SMS_SEND=1:
 *     the send path is never entered, and arming it is what reaches the DB
 *   · a failed or malformed NWS read THROWS from both entry points
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { alertSystem, isEnabled, getDb, sendSms } = vi.hoisted(() => ({
  alertSystem: vi.fn((_title: string, _detail: string) => Promise.resolve()),
  isEnabled: vi.fn(async (_key: string) => true),
  getDb: vi.fn(async () => null),
  sendSms: vi.fn(),
}));

vi.mock("./telegram", () => ({ alertSystem }));
vi.mock("./featureFlags", () => ({ isEnabled }));
vi.mock("../db", () => ({ getDb }));
vi.mock("../sms", () => ({ sendSms, withOptOut: (s: string) => s }));

import { editForecast, nwsFixtures, stubNwsFetch } from "../__tests__/nwsWeatherFixtures";
import { __resetNwsCacheForTests, parseAlerts, parsePeriods } from "../lib/nwsWeather";
import {
  __resetWeatherAlertMemoryForTests,
  checkWeatherTriggers,
  evaluateForecast,
  evaluateWeatherTriggers,
} from "./weatherIntelligence";

const RECORDED_NOW = new Date("2026-09-23T15:30:00Z");
const OCT_NOW = new Date("2026-10-21T15:30:00Z"); // recorded forecast shifted +28 days
const TONIGHT = 1; // "Tonight" period index in the recorded forecast
const SUNDAY_NIGHT = 9; // four days out

const shiftedForecast = (temps: Record<number, number>) => editForecast(nwsFixtures.forecast(), 28, temps);
const alerts = () => parseAlerts(nwsFixtures.alerts());

beforeEach(() => {
  __resetNwsCacheForTests();
  __resetWeatherAlertMemoryForTests();
  alertSystem.mockClear();
  isEnabled.mockClear();
  getDb.mockClear();
  sendSms.mockClear();
});
afterEach(() => {
  delete process.env.WEATHER_SMS_SEND;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("evaluateForecast (pure)", () => {
  it("POSITIVE CONTROL: the recorded September forecast fires no trigger", () => {
    const r = evaluateForecast(parsePeriods(nwsFixtures.forecast()), alerts(), RECORDED_NOW);
    expect(r.triggered).toEqual([]);
    expect(r.imminent).toEqual([]);
    expect(r.data.freezeAt).toBeNull();
    expect(r.details).toMatch(/^NWS 7-day 50-75°F/);
    expect(r.details).toContain("alerts: Beach Hazards Statement");
  });

  it("a freeze four days out fires first_freeze now — for alerts/drafts, not for SMS", () => {
    const r = evaluateForecast(parsePeriods(shiftedForecast({ [SUNDAY_NIGHT]: 29 })), alerts(), OCT_NOW);
    expect(r.triggered).toContain("first_freeze");
    expect(r.imminent).not.toContain("first_freeze");
    expect(r.data.tempMin).toBe(29);
    expect(r.details).toContain("freeze Sun, Oct 25 (typical-early for Cleveland (median first freeze Nov 3))");
  });

  it("a freeze tonight is imminent", () => {
    const r = evaluateForecast(parsePeriods(shiftedForecast({ [TONIGHT]: 30 })), alerts(), OCT_NOW);
    expect(r.triggered).toContain("first_freeze");
    expect(r.imminent).toContain("first_freeze");
  });

  it("an NWS Freeze Warning fires first_freeze even when no period is at 32°F", () => {
    const warn = { event: "Freeze Warning", severity: "Moderate", headline: "", onset: "2026-10-22T02:00:00-04:00", ends: null };
    const r = evaluateForecast(parsePeriods(shiftedForecast({})), [warn], OCT_NOW);
    expect(r.triggered).toContain("first_freeze");
    expect(r.imminent).toContain("first_freeze");
  });

  it("a Frost Advisory alone is not a freeze", () => {
    const frost = { event: "Frost Advisory", severity: "Minor", headline: "", onset: "2026-10-22T02:00:00-04:00", ends: null };
    const r = evaluateForecast(parsePeriods(shiftedForecast({})), [frost], OCT_NOW);
    expect(r.triggered).not.toContain("first_freeze");
  });

  it("snow and heat are seen ahead", () => {
    const f = shiftedForecast({ 4: 95 });
    f.properties.periods[3] = { ...f.properties.periods[3], shortForecast: "Snow Likely", probabilityOfPrecipitation: { value: 70 } };
    const r = evaluateForecast(parsePeriods(f), [], OCT_NOW);
    expect(r.triggered).toEqual(expect.arrayContaining(["snow_forecast", "extreme_heat"]));
    expect(r.imminent).not.toContain("extreme_heat"); // Friday is 2 days out
  });
});

describe("checkWeatherTriggers (cron handler)", () => {
  const freezeTonight = () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(OCT_NOW);
    return stubNwsFetch({ forecast: shiftedForecast({ [TONIGHT]: 30 }) });
  };

  it("alerts the operator and stays SMS-SHADOW with the flag ON when WEATHER_SMS_SEND is unset", async () => {
    freezeTonight();
    const r = await checkWeatherTriggers();
    expect(r.triggered).toContain("first_freeze");
    expect(alertSystem).toHaveBeenCalledWith("Weather: First Freeze", expect.stringContaining("freeze Wed, Oct 21"));
    expect(isEnabled).toHaveBeenCalledWith("weather_triggered_sms");
    expect(getDb).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("WEATHER_SMS_SEND=1 is what opens the send path (control for the shadow test)", async () => {
    freezeTonight();
    process.env.WEATHER_SMS_SEND = "1";
    await checkWeatherTriggers();
    expect(getDb).toHaveBeenCalled(); // reaches the audience query (null DB here -> 0 sent)
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("does not hand a days-ahead trigger to SMS even when armed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(OCT_NOW);
    stubNwsFetch({ forecast: shiftedForecast({ [SUNDAY_NIGHT]: 29 }) });
    process.env.WEATHER_SMS_SEND = "1";
    const r = await checkWeatherTriggers();
    expect(r.triggered).toContain("first_freeze");
    expect(alertSystem).toHaveBeenCalled();
    expect(isEnabled).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("repeats an operator alert at most once per 20h for the same trigger", async () => {
    freezeTonight();
    await checkWeatherTriggers();
    await checkWeatherTriggers();
    expect(alertSystem).toHaveBeenCalledTimes(1);
  });

  it("THROWS when the NWS read fails, from both entry points", async () => {
    stubNwsFetch({ forecast: new Response("down", { status: 500 }) });
    await expect(checkWeatherTriggers()).rejects.toThrow(/NWS 500/);
    await expect(evaluateWeatherTriggers()).rejects.toThrow(/NWS 500/);
    expect(alertSystem).not.toHaveBeenCalled();
  });

  it("THROWS on a malformed forecast body", async () => {
    stubNwsFetch({ forecast: { properties: {} } });
    await expect(checkWeatherTriggers()).rejects.toThrow(/unexpected response shape/);
  });
});
