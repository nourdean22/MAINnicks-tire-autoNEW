/**
 * The site-wide weather banner reads like the shop wrote it (job 2026-10-30-antislop-humanizer-pages, PR I,
 * manager GO 2026-10-31 14:26Z). Drives every branch of getWeatherAlert and checks the customer-facing message.
 */
import { describe, it, expect } from "vitest";
import { getWeatherAlert, type WeatherData } from "./weather";

const base: WeatherData = { temperature_f: 60, wind_speed_mph: 5, weather_code: 0, weather_condition: "x", is_day: true, precipitation_mm: 0 };
const BRANCHES: Array<[string, Partial<WeatherData>]> = [
  ["heavy snow", { weather_code: 75, temperature_f: 25 }],
  ["hail storm", { weather_code: 96 }],
  ["freezing rain", { weather_code: 66, temperature_f: 30 }],
  ["extreme cold", { temperature_f: 5 }],
  ["snow", { weather_code: 73, temperature_f: 28 }],
  ["thunderstorm", { weather_code: 95 }],
  ["heavy rain", { weather_code: 65 }],
  ["high wind", { wind_speed_mph: 45 }],
  ["freezing precipitation", { weather_code: 51, temperature_f: 30 }],
  ["light snow", { weather_code: 71, temperature_f: 34 }],
  ["fog", { weather_code: 45 }],
  ["rain", { weather_code: 63 }],
  ["extreme heat", { temperature_f: 100 }],
  ["hot day", { temperature_f: 88 }],
  ["cold morning", { temperature_f: 40 }],
];
const DASH = /—|\s--\s/;

describe("weather banner copy", () => {
  it("the dash check catches a planted dash (positive control)", () => {
    expect(DASH.test("Roads are dangerous — drive slow")).toBe(true);
    expect(DASH.test("Roads are dangerous. Drive slow")).toBe(false);
  });

  it.each(BRANCHES)("%s: an active banner with no em dash", (_name, over) => {
    const alert = getWeatherAlert({ ...base, ...over });
    expect(alert.active).toBe(true);
    expect(alert.message).not.toMatch(DASH);
  });

  it("covers every distinct banner message", () => {
    const messages = new Set(BRANCHES.map(([, over]) => getWeatherAlert({ ...base, ...over }).message.replace(/-?\d+/g, "#")));
    expect(messages.size).toBe(BRANCHES.length);
  });
});
