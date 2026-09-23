/**
 * weather-intel · OpenWeather precipitation is already millimetres (2026-09-23)
 *
 * WHAT WAS WRONG. Both weather entry points read `rain["1h"] * 25.4`, treating
 * the value as inches because the request uses `units=imperial`. OpenWeather's
 * current-weather docs (https://openweathermap.org/current, "rain.1h" /
 * "snow.1h"): "Precipitation, mm/h. Please note that only mm/h as units of
 * measurement are available for this parameter" — `units` never changes them.
 * So `heavy_rain` (rainMm > 20) fired above ~0.79 mm/h, i.e. light rain, and
 * the lane texted lapsed customers "heavy rain today in Cleveland".
 *
 * WHAT THIS PINS, through the real module with only the network and the side
 * effects stubbed:
 *   · the parser keeps rain/snow in mm (no conversion)
 *   · 1 and 5 mm/h rain -> no heavy_rain; 25 mm/h -> heavy_rain (both entry points)
 *   · the SENDING entry point does not alert or reach the SMS gate on light rain
 *   · POSITIVE CONTROL: it DOES alert and reach the SMS gate on real heavy rain,
 *     so the "not called" assertions above are not vacuous
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const alertSystem = vi.fn().mockResolvedValue(undefined);
vi.mock("./telegram", () => ({ alertSystem: (...a: unknown[]) => alertSystem(...a) }));

// The SMS gate: sendWeatherSms returns before any DB/SMS work when this is false.
const isEnabled = vi.fn().mockResolvedValue(false);
vi.mock("./featureFlags", () => ({ isEnabled: (...a: unknown[]) => isEnabled(...a) }));

import * as weather from "./weatherIntelligence";
import { checkWeatherTriggers, evaluateWeatherTriggers } from "./weatherIntelligence";

// Mild September day: no temperature- or month-driven trigger can fire.
const reading = (rain1h?: number, snow1h?: number) => ({
  main: { temp_max: 62, temp_min: 55 },
  weather: [{ description: "rain" }],
  ...(rain1h !== undefined ? { rain: { "1h": rain1h } } : {}),
  ...(snow1h !== undefined ? { snow: { "1h": snow1h } } : {}),
});

function stubWeather(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
}

beforeEach(() => {
  vi.stubEnv("OPENWEATHER_API_KEY", "test-key");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-23T15:00:00Z"));
  alertSystem.mockClear();
  isEnabled.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("parseCurrentWeather — OpenWeather rain/snow are mm/h already", () => {
  it("passes rain.1h and snow.1h through unconverted", () => {
    const parse = (weather as Record<string, unknown>).parseCurrentWeather as
      | ((raw: unknown, now?: Date) => { rainMm: number; snowMm: number; month: number })
      | undefined;
    expect(parse, "parseCurrentWeather is not exported").toBeTypeOf("function");
    const d = parse!(reading(1, 2.5), new Date("2026-01-15T12:00:00Z"));
    expect(d.rainMm).toBe(1);
    expect(d.snowMm).toBe(2.5);
    expect(d.month).toBe(1);
  });
});

describe("heavy_rain threshold is 20 mm/h, in both entry points", () => {
  for (const [label, fn] of [
    ["evaluateWeatherTriggers", evaluateWeatherTriggers],
    ["checkWeatherTriggers", checkWeatherTriggers],
  ] as const) {
    it(`${label}: 1 mm/h and 5 mm/h rain do not fire heavy_rain`, async () => {
      for (const mm of [1, 5]) {
        stubWeather(reading(mm));
        const r = await fn();
        expect(r.triggered, `${mm} mm/h`).not.toContain("heavy_rain");
      }
    });

    it(`${label}: 25 mm/h rain fires heavy_rain`, async () => {
      stubWeather(reading(25));
      expect((await fn()).triggered).toContain("heavy_rain");
    });
  }

  it("snow is read in mm too: 1 mm/h snow does not inflate to 25.4", async () => {
    const parse = (weather as Record<string, unknown>).parseCurrentWeather as
      | ((raw: unknown, now?: Date) => { snowMm: number })
      | undefined;
    expect(parse, "parseCurrentWeather is not exported").toBeTypeOf("function");
    expect(parse!(reading(undefined, 1)).snowMm).toBe(1);
  });
});

describe("the sending path stays quiet on light rain", () => {
  it("1 mm/h: no Telegram alert, SMS gate never consulted", async () => {
    stubWeather(reading(1));
    await checkWeatherTriggers();
    expect(alertSystem).not.toHaveBeenCalled();
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it("POSITIVE CONTROL — 25 mm/h: alerts and reaches the SMS gate", async () => {
    stubWeather(reading(25));
    await checkWeatherTriggers();
    expect(alertSystem).toHaveBeenCalled();
    expect(isEnabled).toHaveBeenCalledWith("weather_triggered_sms");
  });
});
