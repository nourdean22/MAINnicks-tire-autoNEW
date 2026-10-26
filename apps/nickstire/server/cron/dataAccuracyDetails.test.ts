/**
 * describeDataAccuracy writes the data-accuracy-check details string in plain words with the population each
 * finding came from. 2026-10-25 the owner read "1 invoices missing customer phone in the last 7d (import may
 * be broken)" with no denominator, then probe codes (invoiceFreshness=fresh(0 shop-day-old) | ...) in the same line.
 * The Settings tab shows the text before " · probes: " (middle dot U+00B7); the codes stay after it for the log.
 */
import { describe, expect, it } from "vitest";
import { describeDataAccuracy } from "./dataAccuracyDetails";

const PROBES =
  "invoiceFreshness=fresh(0 shop-day-old) | invoicesVolume=unmeasured(n=0,history=1,z=?) | leadsVolume=unmeasured(n=0,history=1,z=?) | callbacksVolume=unmeasured(n=0,history=1,z=?)";

const base = {
  recentMissing: 1,
  total7d: 25,
  staleLeads: 0,
  staleCallbacks: 0,
  freshness: { state: "fresh" as const, reason: "last sync 2 min ago" },
  volumes: [] as Array<{ label: string; state: "normal" | "warn" | "error" | "unmeasured"; current: number | null; expectedMean: number | null; zScore: number | null }>,
  contractDetails: PROBES,
};

describe("describeDataAccuracy", () => {
  it("names the phone finding with its population, then the probes after the separator", () => {
    const out = describeDataAccuracy(base);
    expect(out.issues).toEqual([
      "1 of 25 invoices in the last 7 days have no customer phone (cannot be texted; the import or the phone backfill may be broken)",
    ]);
    expect(out.details).toBe(
      `1 of 25 invoices in the last 7 days have no customer phone (cannot be texted; the import or the phone backfill may be broken) · probes: ${PROBES}`,
    );
  });

  it("the words before the separator carry no probe codes", () => {
    const words = describeDataAccuracy(base).details.split(" · probes: ")[0];
    expect(words).not.toMatch(/Freshness=|Volume=|shop-day-old|z=\?/);
  });

  it("clean: says what was checked and over how many invoices, never a bare 'all clean'", () => {
    const out = describeDataAccuracy({ ...base, recentMissing: 0 });
    expect(out.issues).toEqual([]);
    expect(out.details).toBe(
      `All checks clean: 25 invoices in the last 7 days all carry a phone; no web lead untouched 7+ days · probes: ${PROBES}`,
    );
  });

  it("clean over zero invoices does not claim they all carry a phone", () => {
    const out = describeDataAccuracy({ ...base, recentMissing: 0, total7d: 0 });
    expect(out.issues).toEqual([]);
    expect(out.details).toContain("0 invoices in the last 7 days to check for a phone");
    expect(out.details).not.toContain("all carry a phone");
  });

  it("web leads: 4 or more is a finding, 1 to 3 is stated honestly but is not one", () => {
    expect(describeDataAccuracy({ ...base, recentMissing: 0, staleLeads: 4 }).issues).toEqual(["4 web leads untouched for 7+ days"]);
    const few = describeDataAccuracy({ ...base, recentMissing: 0, staleLeads: 2 });
    expect(few.issues).toEqual([]);
    expect(few.details).toContain("2 web leads untouched 7+ days (fewer than 4, not flagged)");
    expect(few.details).not.toContain("no web lead untouched");
  });

  it("unanswered callbacks are kept as a finding", () => {
    expect(describeDataAccuracy({ ...base, recentMissing: 0, staleCallbacks: 2 }).issues).toEqual(["2 callbacks unanswered for 24+ hours"]);
  });

  it("a stale mirror is a finding with the contract's own reason", () => {
    const out = describeDataAccuracy({ ...base, recentMissing: 0, freshness: { state: "warn", reason: "last sync 3 shop days ago" } });
    expect(out.issues).toEqual(["invoice mirror freshness warn: last sync 3 shop days ago"]);
  });

  it("volume: low or high against what the same weekday usually brings", () => {
    const out = describeDataAccuracy({
      ...base,
      recentMissing: 0,
      volumes: [
        { label: "invoices", state: "warn", current: 3, expectedMean: 12.4, zScore: -2.6 },
        { label: "leads", state: "error", current: 9, expectedMean: 2.04, zScore: 4 },
        { label: "callbacks", state: "normal", current: 2, expectedMean: 2, zScore: 0 },
        { label: "x", state: "unmeasured", current: null, expectedMean: null, zScore: null },
      ],
    });
    expect(out.issues).toEqual([
      "weekday invoices volume low: 3 today, about 12 expected",
      "weekday leads volume high: 9 today, about 2.0 expected",
    ]);
  });

  it("recordsProcessed stays the number of findings", () => {
    const out = describeDataAccuracy({ ...base, staleLeads: 5, staleCallbacks: 1 });
    expect(out.issues).toHaveLength(3);
  });

  it("a count that was not a number refuses to describe instead of reading as clean", () => {
    expect(() => describeDataAccuracy({ ...base, recentMissing: Number.NaN })).toThrow(/invoice counts/);
    expect(() => describeDataAccuracy({ ...base, total7d: Number.NaN })).toThrow(/invoice counts/);
    expect(() => describeDataAccuracy({ ...base, recentMissing: 30, total7d: 25 })).toThrow(/invoice counts/);
    expect(() => describeDataAccuracy({ ...base, staleLeads: Number.NaN })).toThrow(/lead or callback counts/);
    expect(() => describeDataAccuracy({ ...base, staleCallbacks: Number.NaN })).toThrow(/lead or callback counts/);
  });
});
