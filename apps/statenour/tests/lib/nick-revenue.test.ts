/**
 * Regression guard for the nickstire revenue payload-key-drift CLASS
 * (2026-05-29). nickstire sends { totalDollars, invoiceCount }; ~5 readers
 * historically guessed todayCents / todayEstimate / yesterday / weekRevenue
 * and silently showed $0 / omitted revenue. readNickRevenue is the single
 * tolerant accessor they now all route through. These tests lock the
 * tolerance so a future key change is caught here, not in production.
 */
import { describe, it, expect } from "vitest";
import { readNickRevenue } from "@/lib/nickstire/revenue";

describe("readNickRevenue", () => {
  it("reads the canonical bridge shape { totalDollars, invoiceCount }", () => {
    const r = readNickRevenue({ totalDollars: 2772.2, invoiceCount: 5 });
    expect(r.todayDollars).toBe(2772);
    expect(r.jobs).toBe(5);
    expect(r.hasToday).toBe(true);
  });

  it("THE BUG: { totalDollars } must NOT read as $0 (the /scoreboard failure)", () => {
    // Old code read todayCents/cents off this object → undefined → $0.
    expect(readNickRevenue({ totalDollars: 2772.2 }).todayDollars).toBe(2772);
  });

  it("reads the legacy todayEstimate dollar key", () => {
    expect(readNickRevenue({ todayEstimate: 3200 }).todayDollars).toBe(3200);
  });

  it("converts legacy todayCents to dollars", () => {
    expect(readNickRevenue({ todayCents: 277220 }).todayDollars).toBe(2772);
  });

  it("reads jobs from alternate keys", () => {
    expect(readNickRevenue({ totalDollars: 100, jobs: 3 }).jobs).toBe(3);
    expect(readNickRevenue({ totalDollars: 100, jobCount: 4 }).jobs).toBe(4);
  });

  it("reads week revenue across key variants", () => {
    expect(readNickRevenue({ weekRevenue: 21000 }).weekDollars).toBe(21000);
    expect(readNickRevenue({ weekDollars: 18000 }).weekDollars).toBe(18000);
  });

  it("tolerates string numbers", () => {
    expect(readNickRevenue({ totalDollars: "2772.2" }).todayDollars).toBe(2772);
  });

  it("returns zeros + hasToday=false on empty/garbage (honest, not a fake number)", () => {
    expect(readNickRevenue(undefined)).toEqual({
      todayDollars: 0,
      weekDollars: 0,
      jobs: 0,
      hasToday: false,
    });
    expect(readNickRevenue({}).hasToday).toBe(false);
    expect(readNickRevenue({ foo: "bar" }).hasToday).toBe(false);
    expect(readNickRevenue({ totalDollars: Infinity }).hasToday).toBe(false);
  });
});
