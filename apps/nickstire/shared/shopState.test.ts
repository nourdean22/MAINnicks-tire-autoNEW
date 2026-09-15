import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { BUSINESS } from "./business";
import { ALL_ROUTES } from "./routes";
import {
  businessState,
  capacityBand,
  deriveShopState,
  lotBand,
  weatherCtaFromShopState,
  weatherRisk,
  LOT_FRESH_MS,
  LOT_STALE_MS,
  type ShopStateInputs,
} from "./shopState";

const TZ = BUSINESS.timezone;
const HOURS = BUSINESS.hours.structured as Record<string, string>;

/** A wall-clock instant in the shop's timezone, built without a date library. */
function at(isoLocal: string): Date {
  // isoLocal like "2026-09-16T10:30" interpreted as ET via the offset trick.
  const guess = new Date(`${isoLocal}:00Z`);
  const offsetMin = (() => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(guess);
    const h = Number(parts.find((p) => p.type === "hour")?.value) % 24;
    const m = Number(parts.find((p) => p.type === "minute")?.value);
    const local = h * 60 + m;
    const utc = guess.getUTCHours() * 60 + guess.getUTCMinutes();
    let diff = local - utc;
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    return diff;
  })();
  return new Date(guess.getTime() - offsetMin * 60_000);
}

const base = (over: Partial<ShopStateInputs> = {}): ShopStateInputs => ({
  now: at("2026-09-16T10:30"), // Wednesday
  timezone: TZ,
  hours: HOURS,
  capacity: { openBays: 3, totalBays: 4, waitIsFresh: true },
  lot: { activeVisits: 1, lastObservationAt: new Date(at("2026-09-16T10:30").getTime() - 60_000) },
  weather: { code: 1, tempF: 68 },
  ...over,
});

describe("businessState", () => {
  it("is open inside Wednesday hours and closed after", () => {
    expect(businessState(at("2026-09-16T10:30"), TZ, HOURS).state).toBe("open");
    expect(businessState(at("2026-09-16T18:30"), TZ, HOURS)).toMatchObject({ state: "closed", nextChange: "8:00 AM tomorrow" });
  });
  it("Sunday opens at 9 and closes at 4", () => {
    expect(businessState(at("2026-09-20T08:30"), TZ, HOURS)).toMatchObject({ state: "closed", nextChange: "9:00 AM today" });
    expect(businessState(at("2026-09-20T15:59"), TZ, HOURS).state).toBe("open");
    expect(businessState(at("2026-09-20T16:00"), TZ, HOURS).state).toBe("closed");
  });
});

describe("bands", () => {
  it("capacity: unknown when the numbers are the time-of-day guess", () => {
    expect(capacityBand({ openBays: 4, totalBays: 4, waitIsFresh: false }).band).toBe("unknown");
    expect(capacityBand(null).band).toBe("unknown");
    expect(capacityBand({ openBays: 0, totalBays: 4, waitIsFresh: true }).band).toBe("busy");
  });
  it("lot: fresh/stale/offline by observation age, never a band from a stale feed", () => {
    const now = new Date();
    expect(lotBand({ activeVisits: 5, lastObservationAt: new Date(now.getTime() - LOT_FRESH_MS + 1000) }, now)).toMatchObject({ band: "busy", sensorHealth: "fresh" });
    expect(lotBand({ activeVisits: 5, lastObservationAt: new Date(now.getTime() - LOT_FRESH_MS - 1000) }, now)).toMatchObject({ band: "unknown", sensorHealth: "stale" });
    expect(lotBand({ activeVisits: 5, lastObservationAt: new Date(now.getTime() - LOT_STALE_MS - 1000) }, now)).toMatchObject({ band: "unknown", sensorHealth: "offline" });
    expect(lotBand(null, now)).toMatchObject({ band: "unknown", sensorHealth: "offline" });
  });
  it("weather: snow / ice / heat, and rain is NOT a risk", () => {
    expect(weatherRisk({ code: 73, tempF: 28 }).risk).toBe("snow");
    expect(weatherRisk({ code: 66, tempF: 30 }).risk).toBe("ice");
    expect(weatherRisk({ code: 0, tempF: 94 }).risk).toBe("heat");
    expect(weatherRisk({ code: 63, tempF: 55 }).risk).toBe("none");
    expect(weatherRisk(null).risk).toBe("unknown");
  });
});

describe("deriveShopState", () => {
  it("light lot + capacity -> pull_up; busy -> drop_off; all unknown -> normal", () => {
    expect(deriveShopState(base()).recommendation).toBe("pull_up");
    expect(deriveShopState(base({ capacity: { openBays: 0, totalBays: 4, waitIsFresh: true } })).recommendation).toBe("drop_off");
    expect(deriveShopState(base({ capacity: null, lot: null })).recommendation).toBe("normal");
  });
  it("closed never recommends pulling up", () => {
    expect(deriveShopState(base({ now: at("2026-09-16T20:00") })).recommendation).toBe("normal");
  });
  it("evidence names every input", () => {
    const s = deriveShopState(base());
    expect(s.evidence.join("\n")).toMatch(/hours:/);
    expect(s.evidence.join("\n")).toMatch(/capacity:/);
    expect(s.evidence.join("\n")).toMatch(/lot:/);
    expect(s.evidence.join("\n")).toMatch(/weather:/);
  });
});

describe("privacy + truth invariants (property)", () => {
  const FORBIDDEN = /plate|customer|phone|vin|name|email/i;
  const inputs = fc.record({
    minute: fc.integer({ min: 0, max: 7 * 24 * 60 - 1 }),
    capacity: fc.option(fc.record({ openBays: fc.integer({ min: -2, max: 6 }), totalBays: fc.constant(4), waitIsFresh: fc.boolean() }), { nil: null }),
    lot: fc.option(
      fc.record({
        activeVisits: fc.integer({ min: -1, max: 40 }),
        ageMs: fc.option(fc.integer({ min: 0, max: 4 * 60 * 60_000 }), { nil: null }),
      }),
      { nil: null },
    ),
    weather: fc.option(fc.record({ code: fc.integer({ min: 0, max: 99 }), tempF: fc.integer({ min: -20, max: 110 }) }), { nil: null }),
  });

  it("no derived state ever carries a plate/customer/phone-shaped key, and open never contradicts hours", () => {
    fc.assert(
      fc.property(inputs, (i) => {
        const now = new Date(at("2026-09-14T00:00").getTime() + i.minute * 60_000);
        const state = deriveShopState({
          now,
          timezone: TZ,
          hours: HOURS,
          capacity: i.capacity,
          lot: i.lot ? { activeVisits: i.lot.activeVisits, lastObservationAt: i.lot.ageMs === null ? null : new Date(now.getTime() - i.lot.ageMs) } : null,
          weather: i.weather,
        });
        const keys = JSON.stringify(state, (k, v) => v);
        expect(keys).not.toMatch(FORBIDDEN);
        expect(state.business.state).toBe(businessState(now, TZ, HOURS).state);
        if (state.capacity.band !== "unknown") expect(state.capacity.fresh).toBe(true);
        if (state.lot.sensorHealth !== "fresh") expect(state.lot.band).toBe("unknown");
        if (state.business.state === "closed") expect(state.recommendation).toBe("normal");
      }),
      { numRuns: 400 },
    );
  });
});

describe("weatherCtaFromShopState", () => {
  it("fires only on snow, ice, heat; hrefs are registered routes", () => {
    const registered = new Set(ALL_ROUTES.map((r) => r.path));
    for (const [code, temp] of [[73, 28], [66, 30], [0, 95], [61, 55], [0, 70]] as const) {
      const cta = weatherCtaFromShopState(deriveShopState(base({ weather: { code, tempF: temp } })));
      if (code === 61 || (code === 0 && temp === 70)) expect(cta).toBeNull();
      else {
        expect(cta).not.toBeNull();
        expect(registered.has(cta!.ctaHref)).toBe(true);
      }
    }
    expect(weatherCtaFromShopState(null)).toBeNull();
  });
});
