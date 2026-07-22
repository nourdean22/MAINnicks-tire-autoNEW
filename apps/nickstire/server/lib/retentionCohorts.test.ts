import { describe, expect, it } from "vitest";
import {
  computeRetentionCohorts,
  REACTIVATION_MIN_DAYS,
  REACTIVATION_MAX_DAYS,
  type CustomerStatRow,
} from "./retentionCohorts";

const NOW = new Date("2026-07-22T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("computeRetentionCohorts", () => {
  const rows: CustomerStatRow[] = [
    { totalVisits: 1, totalSpent: 10000, lastVisitDate: daysAgo(300) }, // one-and-done + reactivation-eligible
    { totalVisits: 1, totalSpent: 8000, lastVisitDate: daysAgo(30) }, // one-and-done, still active
    { totalVisits: 3, totalSpent: 50000, lastVisitDate: daysAgo(400) }, // repeat + reactivation-eligible
    { totalVisits: 2, totalSpent: 20000, lastVisitDate: daysAgo(1000) }, // repeat, lapsed too long
    { totalVisits: 0, totalSpent: 0, lastVisitDate: null }, // never visited — excluded from cohorts
  ];
  const s = computeRetentionCohorts(rows, NOW);

  it("counts total vs visited customers (never-visited imports excluded)", () => {
    expect(s.totalCustomers).toBe(5);
    expect(s.customersWithVisits).toBe(4);
  });

  it("splits one-and-done vs repeat as percentages of VISITED customers", () => {
    expect(s.oneAndDone).toEqual({ count: 2, pct: 50 });
    expect(s.repeat).toEqual({ count: 2, pct: 50 });
  });

  it("averages visits over visited customers", () => {
    expect(s.avgVisitsPerCustomer).toBe(1.75); // (1+1+3+2)/4
  });

  it("attributes lifetime value to the repeat cohort", () => {
    expect(s.repeatLifetimeValueCents).toBe(70000); // 50000 + 20000
  });

  it("flags only customers lapsed within the winnable window as reactivation-eligible", () => {
    // 300d and 400d fall in [180,730]; 30d too recent, 1000d too old.
    expect(s.reactivationEligible).toEqual({ count: 2, lifetimeValueCents: 60000 }); // 10000 + 50000
  });

  it("treats the reactivation window boundaries as inclusive", () => {
    const boundary: CustomerStatRow[] = [
      { totalVisits: 1, totalSpent: 100, lastVisitDate: daysAgo(REACTIVATION_MIN_DAYS) }, // in
      { totalVisits: 1, totalSpent: 100, lastVisitDate: daysAgo(REACTIVATION_MAX_DAYS) }, // in
      { totalVisits: 1, totalSpent: 100, lastVisitDate: daysAgo(REACTIVATION_MIN_DAYS - 1) }, // out (too recent)
      { totalVisits: 1, totalSpent: 100, lastVisitDate: daysAgo(REACTIVATION_MAX_DAYS + 1) }, // out (too old)
    ];
    expect(computeRetentionCohorts(boundary, NOW).reactivationEligible.count).toBe(2);
  });

  it("returns safe zeros for empty input (no divide-by-zero)", () => {
    const z = computeRetentionCohorts([], NOW);
    expect(z.customersWithVisits).toBe(0);
    expect(z.oneAndDone).toEqual({ count: 0, pct: 0 });
    expect(z.avgVisitsPerCustomer).toBe(0);
    expect(z.reactivationEligible).toEqual({ count: 0, lifetimeValueCents: 0 });
  });
});
