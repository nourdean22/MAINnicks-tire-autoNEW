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

const { alertSystem, isEnabled, getDb, sendSms, logOutboundSms, sendPauseHoldReason } = vi.hoisted(() => ({
  alertSystem: vi.fn((_title: string, _detail: string) => Promise.resolve(true)),
  isEnabled: vi.fn(async (_key: string) => true),
  getDb: vi.fn<() => Promise<unknown>>(async () => null),
  sendSms: vi.fn(),
  logOutboundSms: vi.fn(async () => undefined),
  // The real reader is pinned in sendPause.test.ts; here it would consume getDb's mockResolvedValueOnce.
  sendPauseHoldReason: vi.fn(async (_lane: string): Promise<string | null> => null),
}));

vi.mock("./sendPause", () => ({ sendPauseHoldReason }));
vi.mock("./telegram", () => ({ alertSystem }));
vi.mock("./featureFlags", () => ({ isEnabled }));
vi.mock("../db", () => ({ getDb }));
vi.mock("../sms", () => ({ sendSms, withOptOut: (s: string) => s }));
vi.mock("./smsInstrumentation", () => ({ logOutboundSms }));

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
  sendSms.mockReset();
  logOutboundSms.mockClear();
  sendPauseHoldReason.mockReset();
  sendPauseHoldReason.mockResolvedValue(null);
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

/**
 * heavy_rain must fire on rain, never on snow or on a lake-level flood alert (2026-10-20).
 * Before the fix "Snow Showers" matched /showers/ and "Lakeshore Flood Advisory" matched /flood/, so a
 * snow day texted lapsed customers "heavy rain today ... Worn tires = danger".
 */
describe("heavy_rain · real rain only (pure)", () => {
  /** The recorded forecast shifted to October, with the Thursday period (30h out) edited. */
  const withThursday = (shortForecast: string, pop: number, detailedForecast = "Mostly dry.") => {
    const f = shiftedForecast({});
    f.properties.periods[2] = {
      ...f.properties.periods[2],
      shortForecast,
      detailedForecast,
      probabilityOfPrecipitation: { value: pop },
    };
    return parsePeriods(f);
  };
  const alertOf = (event: string) => ({ event, severity: "Moderate", headline: "", onset: "2026-10-21T18:00:00-04:00", ends: null });
  const rainTriggered = (periods: ReturnType<typeof parsePeriods>, a: ReturnType<typeof alertOf>[] = []) =>
    evaluateForecast(periods, a, OCT_NOW).triggered.includes("heavy_rain");

  it("POSITIVE CONTROL: the recorded forecast with no edit fires no heavy_rain", () => {
    expect(rainTriggered(parsePeriods(shiftedForecast({})))).toBe(false);
  });

  it("rain showers at 80% fire it, 79% do not (the PoP boundary is pinned)", () => {
    expect(rainTriggered(withThursday("Showers And Thunderstorms", 80))).toBe(true);
    expect(rainTriggered(withThursday("Showers And Thunderstorms", 79))).toBe(false);
  });

  it("the words 'heavy rain' in the forecast text fire it at any chance", () => {
    expect(rainTriggered(withThursday("Rain", 40, "Heavy rain possible in the evening."))).toBe(true);
  });

  it("a rain period more than 48h out does not fire it", () => {
    const f = shiftedForecast({});
    f.properties.periods[6] = { ...f.properties.periods[6], shortForecast: "Showers", probabilityOfPrecipitation: { value: 95 } };
    expect(rainTriggered(parsePeriods(f))).toBe(false);
  });

  it.each([
    "Snow Showers",
    "Rain And Snow Showers",
    "Showers And Sleet",
    "Light Rain And Flurries",
    "Wintry Showers Likely",
  ])("%s at 90%% is not heavy rain, and a snow forecast still sees its own trigger", (shortForecast) => {
    const periods = withThursday(shortForecast, 90);
    expect(rainTriggered(periods)).toBe(false);
    // the rain control above is live: the same 90% with no frozen word does fire.
    expect(rainTriggered(withThursday(shortForecast.replace(/snow|sleet|flurries|wintry/gi, "").trim() || "Showers", 90))).toBe(true);
  });

  it.each(["Freezing Rain", "Light Freezing Rain", "Chance Freezing Rain", "Rain And Freezing Rain"])(
    "%s at 90%% is ice, not heavy rain (the text says hydroplaning, the road says glaze)",
    (shortForecast) => {
      expect(rainTriggered(withThursday(shortForecast, 90))).toBe(false);
      // control: the same words without 'freezing' are rain and do fire.
      expect(rainTriggered(withThursday(shortForecast.replace(/freezing /gi, ""), 90))).toBe(true);
    },
  );

  it("Freezing Drizzle at 90% fires no heavy_rain (it carries no rain word to begin with)", () => {
    expect(rainTriggered(withThursday("Freezing Drizzle", 90))).toBe(false);
    expect(rainTriggered(withThursday("Drizzle", 90))).toBe(false);
  });

  it("a snow forecast keeps firing snow_forecast (the fix did not blind the snow lane)", () => {
    const r = evaluateForecast(withThursday("Snow Showers", 90), [], OCT_NOW);
    expect(r.triggered).toContain("snow_forecast");
    expect(r.triggered).not.toContain("heavy_rain");
  });

  // A flood alert alone is not proof of rain: snowmelt, ice jams and dam or levee failures raise the same products
  // (weather.gov/safety/flood-hazards). It counts only beside an independent rain signal in the forecast.
  const FLOOD_ALERTS = ["Flood Watch", "Flood Warning", "Flood Advisory", "Flash Flood Watch", "Flash Flood Warning"];
  const DRY = () => parsePeriods(shiftedForecast({}));

  it.each(FLOOD_ALERTS)("the %s alert beside a dry forecast does NOT fire it (snowmelt and ice jams flood too)", (event) => {
    expect(rainTriggered(DRY(), [alertOf(event)])).toBe(false);
  });

  it.each(FLOOD_ALERTS)("the %s alert beside 60%% rain showers fires it", (event) => {
    expect(rainTriggered(withThursday("Rain Showers", 60), [alertOf(event)])).toBe(true);
  });

  it("the rain signal beside a flood alert starts at 50%: 50 fires, 49 does not", () => {
    expect(rainTriggered(withThursday("Rain Showers", 50), [alertOf("Flood Warning")])).toBe(true);
    expect(rainTriggered(withThursday("Rain Showers", 49), [alertOf("Flood Warning")])).toBe(false);
  });

  it.each(["Snow Showers", "Freezing Rain", "Rain And Sleet"])(
    "a flood warning beside %s at 60%% does not fire it (the signal is frozen, not rain)",
    (shortForecast) => {
      expect(rainTriggered(withThursday(shortForecast, 60), [alertOf("Flood Warning")])).toBe(false);
    },
  );

  it("a flood warning beside rain more than 48h out does not fire it", () => {
    const f = shiftedForecast({});
    f.properties.periods[6] = { ...f.properties.periods[6], shortForecast: "Rain Showers", probabilityOfPrecipitation: { value: 90 } };
    expect(rainTriggered(parsePeriods(f), [alertOf("Flood Warning")])).toBe(false);
  });

  it.each([
    "Lakeshore Flood Advisory",
    "Lakeshore Flood Warning",
    "Lakeshore Flood Watch",
    "Coastal Flood Advisory",
    "Coastal Flood Warning",
    "Coastal Flood Watch",
  ])("the %s alert is lake level, not rain, and does not fire it even beside 60%% rain showers", (event) => {
    expect(rainTriggered(withThursday("Rain Showers", 60), [alertOf(event)])).toBe(false);
  });

  it("alert matching ignores case and padding", () => {
    expect(rainTriggered(withThursday("Rain Showers", 60), [alertOf("  flash flood WARNING ")])).toBe(true);
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

  it("Q-21: a held-out control is neither logged as an outbound SMS nor counted as sent", async () => {
    freezeTonight();
    process.env.WEATHER_SMS_SEND = "1";
    const rows = (r: unknown[]) => ({ limit: async () => r, orderBy: () => ({ limit: async () => r }) });
    getDb.mockResolvedValueOnce({
      select: () => ({
        from: () => ({
          where: () => rows([{ id: 9, firstName: "Pat", phone: "2165550142" }]),
          innerJoin: () => ({ where: () => rows([]) }), // no cooldown hit
        }),
      }),
    });
    sendSms.mockResolvedValue({ success: true, heldOut: true, experimentId: "contact:weather_first_freeze:v1" });

    await checkWeatherTriggers();

    expect(sendSms).toHaveBeenCalledWith("2165550142", expect.any(String), expect.objectContaining({ variantKey: "weather_first_freeze" }));
    // An sms_messages row would put a control customer in the treatment readout.
    expect(logOutboundSms).not.toHaveBeenCalled();
    expect(alertSystem).not.toHaveBeenCalledWith(expect.stringMatching(/^Weather SMS/), expect.anything());
  });

  it("control: a real weather send IS logged (so the held-out assertion above is live)", async () => {
    freezeTonight();
    process.env.WEATHER_SMS_SEND = "1";
    const rows = (r: unknown[]) => ({ limit: async () => r, orderBy: () => ({ limit: async () => r }) });
    getDb.mockResolvedValueOnce({
      select: () => ({
        from: () => ({
          where: () => rows([{ id: 9, firstName: "Pat", phone: "2165550142" }]),
          innerJoin: () => ({ where: () => rows([]) }),
        }),
      }),
    });
    sendSms.mockResolvedValue({ success: true, sid: "SM1" });

    await checkWeatherTriggers();

    expect(logOutboundSms).toHaveBeenCalledTimes(1);
  });

  it.each(["send_pause:weather_sms", "send_pause_unreadable:weather_sms"])(
    "C5.5: armed but held (%s) -> shadow outcome: no audience query, no send",
    async (reason) => {
      freezeTonight();
      process.env.WEATHER_SMS_SEND = "1";
      sendPauseHoldReason.mockResolvedValue(reason);
      await checkWeatherTriggers();
      expect(sendPauseHoldReason).toHaveBeenCalledWith("weather_sms");
      expect(getDb).not.toHaveBeenCalled();
      expect(sendSms).not.toHaveBeenCalled();
    },
  );

  it.each(["send_pause:weather_sms", "send_pause_unreadable:weather_sms"])(
    "C5.5 round 2: a held run is readable in cron_log details as `Skipped · %s`",
    async (reason) => {
      freezeTonight();
      process.env.WEATHER_SMS_SEND = "1";
      sendPauseHoldReason.mockResolvedValue(reason);
      const r = await checkWeatherTriggers();
      expect(r.details).toContain(`Skipped · ${reason}`);
    },
  );

  it("CONTROL: an unheld armed run carries no Skipped note", async () => {
    freezeTonight();
    process.env.WEATHER_SMS_SEND = "1";
    const r = await checkWeatherTriggers();
    expect(r.details).not.toContain("Skipped");
  });

  describe("C5.5 round 2: pause set mid-run", () => {
    const threeTargets = () => {
      const rows = (r: unknown[]) => ({ limit: async () => r, orderBy: () => ({ limit: async () => r }) });
      getDb.mockResolvedValueOnce({
        select: () => ({
          from: () => ({
            where: () => rows([
              { id: 1, firstName: "Pat", phone: "2165550141" },
              { id: 2, firstName: "Sam", phone: "2165550142" },
              { id: 3, firstName: "Lee", phone: "2165550143" },
            ]),
            innerJoin: () => ({ where: () => rows([]) }), // no cooldown hit
          }),
        }),
      });
    };

    it("CONTROL: never paused -> all three texted", async () => {
      freezeTonight();
      process.env.WEATHER_SMS_SEND = "1";
      threeTargets();
      sendSms.mockResolvedValue({ success: true, sid: "SM1" });
      await checkWeatherTriggers();
      expect(sendSms).toHaveBeenCalledTimes(3);
    });

    it("pause flips after text 1 -> texts 2-3 never sent, Skipped noted with the count", async () => {
      freezeTonight();
      process.env.WEATHER_SMS_SEND = "1";
      threeTargets();
      sendSms.mockImplementation(async () => {
        sendPauseHoldReason.mockResolvedValue("send_pause:weather_sms");
        return { success: true, sid: "SM1" };
      });
      const r = await checkWeatherTriggers();
      expect(sendSms).toHaveBeenCalledTimes(1);
      expect(r.details).toContain("Skipped · send_pause:weather_sms");
      expect(r.details).toContain("not_attempted=2");
    });
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

  it("retries the operator alert after a failed delivery, then throttles only after success", async () => {
    freezeTonight();
    alertSystem.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await checkWeatherTriggers();
    await checkWeatherTriggers();
    expect(alertSystem).toHaveBeenCalledTimes(2);

    await checkWeatherTriggers();
    expect(alertSystem).toHaveBeenCalledTimes(2);
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
