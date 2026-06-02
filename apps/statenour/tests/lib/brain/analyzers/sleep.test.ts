import { describe, it, expect } from "vitest";

import {
  computeSleep,
  type DailySleepRow,
  type BodySleepRow,
} from "@/lib/brain/analyzers/sleep";

const NOW = new Date(2026, 1, 1); // fixed — no Date.now()

/** Deterministic date n days after a fixed epoch (no Date.now). */
function day(offset: number): Date {
  return new Date(2026, 0, 1 + offset);
}
/** ET YYYY-MM-DD key for the same offset (body rows are string-dated). */
function dayStr(offset: number): string {
  return day(offset).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function daily(offset: number, hours: number | null): DailySleepRow {
  return { logDate: day(offset), sleepHours: hours };
}
function bodyNight(offset: number, hours: number | null): BodySleepRow {
  return { date: dayStr(offset), sleepHours: hours };
}

describe("computeSleep", () => {
  it("flags insufficient data with fewer than 5 nights", () => {
    const rows = [daily(0, 7), daily(1, 8), daily(2, 6)];
    const r = computeSleep({ daily: rows, body: [], days: 30 }, NOW);
    expect(r.dataCompleteness.sufficient).toBe(false);
    expect(r.dataCompleteness.nights).toBe(3);
    expect(r.sleep).not.toBeNull();
    expect(r.dataCompleteness.note).toMatch(/directional/i);
  });

  it("returns an honest gap with zero nights", () => {
    const r = computeSleep({ daily: [], body: [], days: 30 }, NOW);
    expect(r.sleep).toBeNull();
    expect(r.dataCompleteness.nights).toBe(0);
    expect(r.dataCompleteness.note).toMatch(/no sleep logged/i);
  });

  it("computes average, consistency, short-nights, and sleep debt", () => {
    // 7 nights: 5,5,6,8,8,7,7 -> avg ~6.57; two nights <6h; debt vs 7.5h
    const hrs = [5, 5, 6, 8, 8, 7, 7];
    const rows = hrs.map((h, i) => daily(i, h));
    const r = computeSleep({ daily: rows, body: [], days: 30 }, NOW);
    expect(r.dataCompleteness.sufficient).toBe(true);
    expect(r.sleep?.avgHours).toBeCloseTo(6.6, 1);
    expect(r.sleep?.shortNights).toBe(2); // the two 5h nights (<6)
    expect(r.sleep?.shortNightPct ?? 0).toBeCloseTo(round2(2 / 7), 2);
    // debt = (2.5+2.5+1.5+0+0+0.5+0.5) = 7.5h
    expect(r.sleep?.sleepDebtHours).toBeCloseTo(7.5, 1);
    expect(r.sleep?.targetHours).toBe(7.5);
  });

  it("detects a declining sleep trend", () => {
    // sleep drops 8 -> 5 over 8 nights
    const rows = Array.from({ length: 8 }, (_, i) =>
      daily(i, Math.max(5, 8 - i * 0.4)),
    );
    const r = computeSleep({ daily: rows, body: [], days: 30 }, NOW);
    expect(r.sleep?.direction).toBe("declining");
    expect(r.sleep?.perMonthChange ?? 0).toBeLessThan(-0.5);
  });

  it("falls back to body sleepHours when the daily-log night is missing", () => {
    // daily logs nights 0-2 only; body covers 3-6 -> 7 nights total, no dupes
    const dailyRows = [daily(0, 7), daily(1, 7), daily(2, 7)];
    const bodyRows = [
      bodyNight(3, 6),
      bodyNight(4, 6),
      bodyNight(5, 6),
      bodyNight(6, 6),
    ];
    const r = computeSleep({ daily: dailyRows, body: bodyRows, days: 30 }, NOW);
    expect(r.dataCompleteness.nights).toBe(7);
    expect(r.dataCompleteness.fromDailyLog).toBe(3);
    expect(r.dataCompleteness.fromBodyFallback).toBe(4);
  });

  it("daily-log value wins over body on the same date (no double count)", () => {
    // both sources log night 0; daily=8 should win, body ignored, count once
    const dailyRows = [daily(0, 8), daily(1, 8), daily(2, 8), daily(3, 8), daily(4, 8)];
    const bodyRows = [bodyNight(0, 4)]; // would skew the avg if it leaked in
    const r = computeSleep({ daily: dailyRows, body: bodyRows, days: 30 }, NOW);
    expect(r.dataCompleteness.nights).toBe(5);
    expect(r.dataCompleteness.fromBodyFallback).toBe(0);
    expect(r.sleep?.avgHours).toBe(8); // body 4h never merged
  });

  it("reports best and worst nights", () => {
    const hrs = [6, 9, 5, 7, 8];
    const rows = hrs.map((h, i) => daily(i, h));
    const r = computeSleep({ daily: rows, body: [], days: 30 }, NOW);
    expect(r.sleep?.bestNight.hours).toBe(9);
    expect(r.sleep?.worstNight.hours).toBe(5);
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
