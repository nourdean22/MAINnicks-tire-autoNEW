/**
 * shared/payCalculator.ts — numbers a technician will check by hand. A wrong
 * overtime multiplier or a guarantee applied backwards on a public page is a
 * credibility hit with exactly the skeptical reader it is meant to win.
 */
import { describe, expect, it } from "vitest";
import { annualize, breakEvenFlagHours, weeklyFlatRatePay, weeklyHourlyPay } from "../shared/payCalculator";

describe("hourly", () => {
  it("40 hours at $30 is $1,200 — no overtime at exactly 40", () => {
    expect(weeklyHourlyPay({ ratePerHour: 30, hoursWorked: 40 })).toBe(1200);
  });
  it("hours over 40 are paid at 1.5x", () => {
    // 40 x 30 + 5 x 45 = 1200 + 225
    expect(weeklyHourlyPay({ ratePerHour: 30, hoursWorked: 45 })).toBe(1425);
  });
  it("clamps nonsense instead of producing negative or NaN pay", () => {
    expect(weeklyHourlyPay({ ratePerHour: -5, hoursWorked: 40 })).toBe(0);
    expect(weeklyHourlyPay({ ratePerHour: 30, hoursWorked: Number.NaN })).toBe(0);
  });
});

describe("flat rate", () => {
  it("pays flagged hours when above the guarantee", () => {
    expect(weeklyFlatRatePay({ ratePerFlagHour: 40, flaggedHours: 45, guaranteedHours: 40 })).toBe(1800);
  });
  it("a slow week falls back to the guarantee, not to what was flagged", () => {
    expect(weeklyFlatRatePay({ ratePerFlagHour: 40, flaggedHours: 22, guaranteedHours: 40 })).toBe(1600);
  });
  it("no guarantee means a slow week is a small check", () => {
    expect(weeklyFlatRatePay({ ratePerFlagHour: 40, flaggedHours: 22, guaranteedHours: 0 })).toBe(880);
  });
});

describe("break-even and annual", () => {
  it("flag hours needed to match 45 hourly hours at $30 on a $40 flag rate", () => {
    // 1425 / 40 = 35.625 -> 35.6
    expect(breakEvenFlagHours({ ratePerHour: 30, hoursWorked: 45 }, 40)).toBe(35.6);
  });
  it("a zero flag rate has no break-even rather than Infinity", () => {
    expect(breakEvenFlagHours({ ratePerHour: 30, hoursWorked: 40 }, 0)).toBeNull();
  });
  it("annualizes over 50 working weeks by default", () => {
    expect(annualize(1200)).toBe(60000);
    expect(annualize(1200, 52)).toBe(62400);
  });
});
