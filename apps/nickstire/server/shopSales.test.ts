/**
 * shopSales — the window arithmetic, and the shape that makes zero impossible.
 *
 * WHY THE WINDOW GETS ITS OWN TESTS. Every "revenue for a period" bug this repo
 * has recorded came from the window, not the SUM: a UTC `CURDATE()` on an
 * Eastern shop (already tomorrow in Cleveland from 20:00 ET), a Monday-based
 * `WEEKDAY()` paired with a Sunday-based JS loop, and a per-transacting-day
 * average multiplied by 30 calendar days. The money is easy; the boundaries are
 * where it goes wrong, so the boundaries are what is pinned.
 *
 * The 20:00-ET case is the one that matters most: for four hours every evening a
 * UTC-derived "today" is the NEXT calendar day, which silently shifts a whole
 * day of invoices into the wrong bucket. It is asserted directly.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { salesWindow, SALES_DEFINITION_VERSION, type ShopSales } from "./services/shopSales";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the window is Eastern, not UTC", () => {
  it("22:00 ET on Sep 6 is still Sep 6 — not Sep 7", () => {
    // 2026-09-07T02:00Z === 2026-09-06 22:00 EDT. A bare CURDATE() on a UTC
    // session returns 2026-09-07 here and buckets four hours of invoices into
    // tomorrow. AGENTS.md forbids exactly this.
    const at = new Date("2026-09-07T02:00:00Z");
    const { to } = salesWindow("last_7d", at);
    expect(to).toBe("2026-09-06"); // exclusive upper bound = ET today (the window ends yesterday)
    const mtd = salesWindow("month_to_date", at);
    expect(mtd.from).toBe("2026-09-01");
    expect(mtd.to).toBe("2026-09-07"); // month-to-date includes today → exclusive bound is ET tomorrow
  });

  it("01:00 ET is the same ET day as 23:00 ET before it", () => {
    const lateEvening = salesWindow("month_to_date", new Date("2026-09-07T03:00:00Z")); // 23:00 ET Sep 6
    const nextMorning = salesWindow("month_to_date", new Date("2026-09-07T05:00:00Z")); // 01:00 ET Sep 7
    // These are DIFFERENT ET days, so the exclusive bound must advance by one.
    expect(lateEvening.to).toBe("2026-09-07");
    expect(nextMorning.to).toBe("2026-09-08");
  });
});

/**
 * Every calendar date a half-open [from, to) window contains, as yyyy-mm-dd.
 * The window is date-only, so this is pure UTC-date arithmetic — no DST.
 */
function datesIn(w: { from: string; to: string }): string[] {
  const out: string[] = [];
  let d = new Date(`${w.from}T00:00:00Z`);
  const end = new Date(`${w.to}T00:00:00Z`);
  while (d < end) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

describe("period boundaries", () => {
  const at = new Date("2026-09-15T16:00:00Z"); // 12:00 ET, Sep 15

  // The old assertions here were `{ from: "2026-09-08", to: "2026-09-16" }` for
  // "a 7-day span" — eight dates, Sep 8 through Sep 15. A test that pins the
  // literals does not count them; these count them.
  it("last_7d contains exactly 7 dates, ending yesterday", () => {
    const w = salesWindow("last_7d", at);
    const dates = datesIn(w);
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-09-08");
    expect(dates[dates.length - 1]).toBe("2026-09-14"); // yesterday, never today
    expect(dates).not.toContain("2026-09-15");
  });

  it("last_30d contains exactly 30 dates, ending yesterday", () => {
    const dates = datesIn(salesWindow("last_30d", at));
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe("2026-08-16");
    expect(dates[29]).toBe("2026-09-14");
  });

  it("month_to_date includes today, so on the 15th it holds 15 dates", () => {
    const dates = datesIn(salesWindow("month_to_date", at));
    expect(dates).toHaveLength(15);
    expect(dates[14]).toBe("2026-09-15");
  });

  it("cardinality holds across a month boundary, a year boundary and a leap day", () => {
    // 12:00 ET on each date; the 7-day window must still be exactly 7 dates.
    for (const iso of ["2026-10-02T16:00:00Z", "2027-01-03T17:00:00Z", "2028-03-02T17:00:00Z"]) {
      const w = salesWindow("last_7d", new Date(iso));
      expect(datesIn(w), iso).toHaveLength(7);
      expect(datesIn(salesWindow("last_30d", new Date(iso))), iso).toHaveLength(30);
    }
    // Leap day sits inside the window and is counted once.
    const leap = datesIn(salesWindow("last_7d", new Date("2028-03-02T17:00:00Z")));
    expect(leap).toContain("2028-02-29");
  });

  it("cardinality holds across both DST transitions (spring forward, fall back)", () => {
    // 2026-03-08 02:00 ET spring forward; 2026-11-01 02:00 ET fall back.
    for (const iso of ["2026-03-10T16:00:00Z", "2026-11-03T17:00:00Z"]) {
      expect(datesIn(salesWindow("last_7d", new Date(iso))), iso).toHaveLength(7);
      expect(datesIn(salesWindow("last_30d", new Date(iso))), iso).toHaveLength(30);
    }
  });

  it("the boundary invoice dates are the ones intended: from is included, today is excluded", () => {
    const w = salesWindow("last_7d", at);
    // SQL is `invoiceDate >= from AND invoiceDate < to`; assert the literals the
    // query will receive, not just the count.
    expect(w).toEqual({ from: "2026-09-08", to: "2026-09-15" });
  });

  it("month_to_date starts on the 1st", () => {
    expect(salesWindow("month_to_date", at)).toEqual({ from: "2026-09-01", to: "2026-09-16" });
  });

  it("prev_month is a whole month and never overlaps this one", () => {
    expect(salesWindow("prev_month", at)).toEqual({ from: "2026-08-01", to: "2026-09-01" });
  });

  it("prev_month crosses the year boundary correctly", () => {
    const jan = new Date("2026-01-10T17:00:00Z"); // 12:00 ET, Jan 10
    expect(salesWindow("prev_month", jan)).toEqual({ from: "2025-12-01", to: "2026-01-01" });
  });

  it("month_to_date on the 1st is a single day, not an empty range", () => {
    const first = new Date("2026-09-01T16:00:00Z");
    const w = salesWindow("month_to_date", first);
    expect(w.from).toBe("2026-09-01");
    expect(w.to).toBe("2026-09-02");
    expect(w.from < w.to).toBe(true);
  });

  it("every window is non-empty and half-open", () => {
    for (const p of ["last_7d", "last_30d", "month_to_date", "prev_month"] as const) {
      const w = salesWindow(p, at);
      expect(w.from < w.to, `${p} produced an empty or inverted range`).toBe(true);
    }
  });
});

describe("a failed read has no number to render", () => {
  it("the unavailable branch carries no cents field at all", () => {
    // Type-level guarantee, asserted at runtime so a future widening of the
    // union to `cents?: number` is caught. `$0` must be unreachable.
    const failed: ShopSales = { available: false, reason: "Database not available" };
    expect("cents" in failed).toBe(false);
    expect("invoiceCount" in failed).toBe(false);
  });

  it("the service never returns a zeroed payload on catch", () => {
    const src = read("server/services/shopSales.ts");
    // Both exits return the union's false branch, not a shaped zero.
    expect(src).toMatch(/return \{ available: false, reason: "Database not available" \}/);
    expect(src).not.toMatch(/cents:\s*0\s*,\s*available:\s*false/);
  });
});

describe("the definition travels with the number", () => {
  it("states its basis, its gross/net status and its version", () => {
    const src = read("server/services/shopSales.ts");
    expect(SALES_DEFINITION_VERSION).toMatch(/invoice-date/);
    expect(src).toMatch(/basis: "invoice_date"/);
    expect(src).toMatch(/grossOrNet: "gross_tax_inclusive"/);
  });

  it("is NOT claimed as reconciled to the shop's own report", () => {
    // The operator's authoritative total is an ALG/ShopDriver report. Until a
    // period has been compared line by line this is internally consistent only,
    // and the card must not call it "Total Sales".
    const src = read("server/services/shopSales.ts");
    expect(src).toMatch(/reconciledToShopReport: false/);
    const card = read("client/src/pages/admin/SalesCard.tsx");
    expect(card).toMatch(/not yet reconciled to the shop report/);
    // NOTE: "does the card SAY 'Total Sales'" is asserted against the RENDERED
    // output in client/src/__tests__/sales-card.test.tsx, not here. A source
    // grep matches the docblock explaining why the phrase is avoided — the
    // second time this file's own prose failed an assertion about prose.
  });

  it("counts what it excluded, so the gap is measurable rather than assumed", () => {
    const src = read("server/services/shopSales.ts");
    for (const bucket of ["pendingCount", "partialCount", "refundedCount", "blankInvoiceNumbers"]) {
      expect(src, `${bucket} missing from exclusions`).toMatch(new RegExp(bucket));
    }
    // partial is excluded ENTIRELY — there is no amountPaid column — so its full
    // value is reported as the maximum size of the blind spot.
    expect(src).toMatch(/partialCentsFullValue/);
  });

  it("names the paymentStatus trap rather than inheriting it silently", () => {
    const src = read("server/services/shopSales.ts");
    expect(src).toMatch(/ticket-lifecycle string/);
    expect(src).toMatch(/unknown or empty maps to 'paid'/);
  });
});
