import { describe, expect, it } from "vitest";
import {
  assessFreshness,
  assessWeekdayVolume,
  contractByKey,
  shopDaysElapsed,
} from "./businessDataContracts";

const TZ = "America/New_York";
const OPEN_ALL_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

describe("Q-26 freshness contracts", () => {
  it("counts shop calendar days, not elapsed 24-hour buckets", () => {
    expect(
      shopDaysElapsed({
        dataAsOf: new Date("2026-09-28T23:50:00Z"), // Sun 19:50 ET
        now: new Date("2026-09-29T12:00:00Z"), // Mon 08:00 ET
        timeZone: TZ,
        openWeekdays: OPEN_ALL_WEEK,
      }),
    ).toBe(1);
  });

  it("does not age a source again while still on the same shop date", () => {
    expect(
      shopDaysElapsed({
        dataAsOf: new Date("2026-09-29T12:00:00Z"),
        now: new Date("2026-09-29T23:55:00Z"),
        timeZone: TZ,
        openWeekdays: OPEN_ALL_WEEK,
      }),
    ).toBe(0);
  });

  it("respects closed weekdays supplied by the business-hours caller", () => {
    expect(
      shopDaysElapsed({
        dataAsOf: new Date("2026-09-25T21:00:00Z"), // Fri
        now: new Date("2026-09-28T14:00:00Z"), // Mon
        timeZone: TZ,
        openWeekdays: [1, 2, 3, 4, 5],
      }),
    ).toBe(1); // only Monday advanced
  });

  it("warns/errors invoice mirror freshness from the sync receipt, not invoice volume", () => {
    const contract = contractByKey("shopdriver_invoices");
    const warn = assessFreshness({
      contract,
      dataAsOf: new Date("2026-09-28T14:00:00Z"),
      now: new Date("2026-09-29T14:00:00Z"),
      timeZone: TZ,
      openWeekdays: OPEN_ALL_WEEK,
    });
    const error = assessFreshness({
      contract,
      dataAsOf: new Date("2026-09-27T14:00:00Z"),
      now: new Date("2026-09-29T14:00:00Z"),
      timeZone: TZ,
      openWeekdays: OPEN_ALL_WEEK,
    });
    expect(warn).toMatchObject({ state: "warn", shopDaysOld: 1 });
    expect(error).toMatchObject({ state: "error", shopDaysOld: 2 });
  });

  it("never calls quiet event demand 'stale data'", () => {
    const verdict = assessFreshness({
      contract: contractByKey("leads"),
      dataAsOf: null,
      now: new Date("2026-09-29T14:00:00Z"),
      timeZone: TZ,
      openWeekdays: OPEN_ALL_WEEK,
    });
    expect(verdict.state).toBe("unmeasured");
    expect(verdict.reason).toMatch(/zero new rows can be legitimate/);
  });
});

describe("Q-26 weekday-seasonal volume contracts", () => {
  it("compares current volume against same-weekday history", () => {
    const v = assessWeekdayVolume({
      contract: contractByKey("shopdriver_invoices"),
      current: 21,
      sameWeekdayHistory: [19, 20, 21, 22, 20, 21, 19, 22],
    });
    expect(v.state).toBe("normal");
    expect(v.historyPoints).toBe(8);
    expect(Math.abs(v.zScore ?? 999)).toBeLessThan(2.5);
  });

  it("flags an extreme collapse without pretending the expected mean is zero", () => {
    const v = assessWeekdayVolume({
      contract: contractByKey("shopdriver_invoices"),
      current: 0,
      sameWeekdayHistory: [18, 19, 20, 21, 19, 20, 18, 21],
    });
    expect(v.state).toBe("error");
    expect(v.expectedMean).toBeGreaterThan(18);
    expect(v.zScore).toBeLessThan(-4);
  });

  it("stays unmeasured until enough same-weekday history exists", () => {
    const v = assessWeekdayVolume({
      contract: contractByKey("callbacks"),
      current: 0,
      sameWeekdayHistory: [0, 1, 0],
    });
    expect(v).toMatchObject({ state: "unmeasured", historyPoints: 3 });
  });

  it("handles a flat historical series without NaN/Infinity", () => {
    const normal = assessWeekdayVolume({
      contract: contractByKey("leads"),
      current: 4,
      sameWeekdayHistory: [4, 4, 4, 4],
    });
    const changed = assessWeekdayVolume({
      contract: contractByKey("leads"),
      current: 0,
      sameWeekdayHistory: [4, 4, 4, 4],
    });
    expect(normal).toMatchObject({ state: "normal", zScore: 0 });
    expect(changed).toMatchObject({ state: "error", zScore: -99 });
    expect(Number.isFinite(changed.zScore)).toBe(true);
  });
});
