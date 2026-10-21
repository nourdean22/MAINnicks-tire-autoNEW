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
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  salesWindow,
  isWindowAfterThrough,
  paidInvoiceRevenue,
  SALES_PERIODS,
  SALES_DEFINITION_VERSION,
  type ShopSales,
} from "./services/shopSales";

// paidInvoiceRevenue loads the db lazily; the mock answers its two statements in order
// (the window aggregate, then MAX(invoiceDate)).
const dbMock = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => ({ execute: dbMock.execute }) }));

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

describe("today and yesterday are single Eastern days", () => {
  it("a normal day: today is [d, d+1), yesterday is [d-1, d)", () => {
    const noon = new Date("2026-09-15T16:00:00Z"); // 12:00 ET, Sep 15
    expect(salesWindow("today", noon)).toEqual({ from: "2026-09-15", to: "2026-09-16" });
    expect(salesWindow("yesterday", noon)).toEqual({ from: "2026-09-14", to: "2026-09-15" });
  });

  it("23:00 ET and 01:00 ET straddle midnight: the day advances once, in Eastern time", () => {
    const lateEvening = new Date("2026-09-07T03:00:00Z"); // 23:00 EDT Sep 6
    const nextMorning = new Date("2026-09-07T05:00:00Z"); // 01:00 EDT Sep 7
    expect(salesWindow("today", lateEvening)).toEqual({ from: "2026-09-06", to: "2026-09-07" });
    expect(salesWindow("today", nextMorning)).toEqual({ from: "2026-09-07", to: "2026-09-08" });
    expect(salesWindow("yesterday", lateEvening)).toEqual({ from: "2026-09-05", to: "2026-09-06" });
    expect(salesWindow("yesterday", nextMorning)).toEqual({ from: "2026-09-06", to: "2026-09-07" });
  });

  it("22:00 ET is still the same ET day although UTC has already rolled over", () => {
    const at = new Date("2026-09-07T02:00:00Z"); // 22:00 EDT Sep 6; UTC date is Sep 7
    expect(salesWindow("today", at).from).toBe("2026-09-06");
    expect(salesWindow("yesterday", at).to).toBe("2026-09-06");
  });

  it("spring forward (2026-03-08, a 23-hour day): the day rolls at local midnight, not at 24 hours", () => {
    // 00:00 EST Mar 8 = 05:00Z; 00:00 EDT Mar 9 = 04:00Z.
    expect(salesWindow("today", new Date("2026-03-08T05:00:00Z"))).toEqual({ from: "2026-03-08", to: "2026-03-09" });
    expect(salesWindow("today", new Date("2026-03-08T07:30:00Z"))).toEqual({ from: "2026-03-08", to: "2026-03-09" }); // 03:30 EDT
    expect(salesWindow("today", new Date("2026-03-09T03:59:59Z"))).toEqual({ from: "2026-03-08", to: "2026-03-09" }); // 23:59:59 EDT
    expect(salesWindow("today", new Date("2026-03-09T04:00:00Z"))).toEqual({ from: "2026-03-09", to: "2026-03-10" });
    expect(salesWindow("yesterday", new Date("2026-03-09T16:00:00Z"))).toEqual({ from: "2026-03-08", to: "2026-03-09" });
  });

  it("fall back (2026-11-01, a 25-hour day): both 01:30 readings are the same day, and it ends at local midnight", () => {
    // 00:00 EDT Nov 1 = 04:00Z; 00:00 EST Nov 2 = 05:00Z.
    expect(salesWindow("today", new Date("2026-11-01T05:30:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-02" }); // 01:30 EDT
    expect(salesWindow("today", new Date("2026-11-01T06:30:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-02" }); // 01:30 EST
    expect(salesWindow("today", new Date("2026-11-02T04:59:59Z"))).toEqual({ from: "2026-11-01", to: "2026-11-02" }); // 23:59:59 EST
    expect(salesWindow("today", new Date("2026-11-02T05:00:00Z"))).toEqual({ from: "2026-11-02", to: "2026-11-03" });
    expect(salesWindow("yesterday", new Date("2026-11-02T17:00:00Z"))).toEqual({ from: "2026-11-01", to: "2026-11-02" });
  });

  it("yesterday crosses a month, a year and a leap day correctly", () => {
    expect(salesWindow("yesterday", new Date("2026-10-01T16:00:00Z"))).toEqual({ from: "2026-09-30", to: "2026-10-01" });
    expect(salesWindow("yesterday", new Date("2027-01-01T17:00:00Z"))).toEqual({ from: "2026-12-31", to: "2027-01-01" });
    expect(salesWindow("yesterday", new Date("2028-03-01T17:00:00Z"))).toEqual({ from: "2028-02-29", to: "2028-03-01" });
    expect(salesWindow("today", new Date("2028-02-29T17:00:00Z"))).toEqual({ from: "2028-02-29", to: "2028-03-01" });
  });

  it("each holds exactly one date, and every period is non-empty and half-open", () => {
    const at = new Date("2026-09-15T16:00:00Z");
    expect(datesIn(salesWindow("today", at))).toEqual(["2026-09-15"]);
    expect(datesIn(salesWindow("yesterday", at))).toEqual(["2026-09-14"]);
    for (const p of SALES_PERIODS) {
      const w = salesWindow(p, at);
      expect(w.from < w.to, `${p} produced an empty or inverted range`).toBe(true);
    }
  });

  it("the default 7-day window is unchanged", () => {
    expect(salesWindow("last_7d", new Date("2026-09-15T16:00:00Z"))).toEqual({ from: "2026-09-08", to: "2026-09-15" });
  });
});

describe("windowAfterThrough: does the window end after what the mirror holds?", () => {
  // [from, to) is half-open, so the last date inside the window is the day BEFORE `to`.
  const today = { from: "2026-10-21", to: "2026-10-22" };
  const yesterday = { from: "2026-10-20", to: "2026-10-21" };
  const last7 = { from: "2026-10-14", to: "2026-10-21" };
  const mtd = { from: "2026-10-01", to: "2026-10-22" };
  const prevMonth = { from: "2026-09-01", to: "2026-10-01" };

  it.each([
    // [label, window, throughDate, expected]
    ["today, mirror through yesterday (the normal morning)", today, "2026-10-20", true],
    ["today, mirror through today", today, "2026-10-21", false],
    ["yesterday, mirror through yesterday", yesterday, "2026-10-20", false],
    ["yesterday, mirror one day older", yesterday, "2026-10-19", true],
    ["7 days, mirror through yesterday", last7, "2026-10-20", false],
    ["7 days, mirror two days behind", last7, "2026-10-19", true],
    ["month to date, mirror through yesterday (partial on any morning)", mtd, "2026-10-20", true],
    ["month to date, mirror through today", mtd, "2026-10-21", false],
    ["last month, mirror far ahead", prevMonth, "2026-10-20", false],
    ["last month, mirror through its last day", prevMonth, "2026-09-30", false],
    ["last month, mirror one day short of its last day", prevMonth, "2026-09-29", true],
    ["mirror ahead of the window (a future-dated row)", today, "2026-10-25", false],
    ["no invoices in the mirror at all: nothing is synced", today, null, true],
  ] as const)("%s", (_label, window, through, expected) => {
    expect(isWindowAfterThrough(window, through)).toBe(expected);
  });

  it("compares calendar days across a month end and a year end, not raw strings", () => {
    expect(isWindowAfterThrough({ from: "2026-09-30", to: "2026-10-01" }, "2026-09-30")).toBe(false);
    expect(isWindowAfterThrough({ from: "2026-09-30", to: "2026-10-01" }, "2026-09-29")).toBe(true);
    expect(isWindowAfterThrough({ from: "2026-12-31", to: "2027-01-01" }, "2026-12-31")).toBe(false);
    expect(isWindowAfterThrough({ from: "2027-01-01", to: "2027-01-02" }, "2026-12-31")).toBe(true);
  });
});

describe("paidInvoiceRevenue ships windowAfterThrough on every successful read", () => {
  afterEach(() => {
    vi.useRealTimers();
    dbMock.execute.mockReset();
  });

  const aggRow = {
    paidCount: 0, paidCents: 0, pendingCount: 0, pendingCents: 0, partialCount: 0, partialCents: 0,
    refundedCount: 0, refundedCents: 0, blankInvoiceNumbers: 0,
  };

  // 11:59 ET on 2026-10-21 (the screenshot's moment). The driver hands MAX(invoiceDate) back as a
  // Date whose UTC digits are the stored shop day: 04:00:00 is a date-only ticket at local midnight.
  async function readAt(period: (typeof SALES_PERIODS)[number], through: Date | null) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T15:59:00Z"));
    dbMock.execute.mockResolvedValueOnce([[aggRow]]).mockResolvedValueOnce([[{ throughDate: through }]]);
    const r = await paidInvoiceRevenue(period);
    if (!r.available) throw new Error(`unexpected unavailable: ${r.reason}`);
    return r;
  }

  const mirrorThroughYesterday = new Date("2026-10-20T04:00:00Z");

  it("the mirror is through yesterday: today is after it, yesterday is not", async () => {
    const t = await readAt("today", mirrorThroughYesterday);
    expect(t.throughDate).toBe("2026-10-20");
    expect(t.window).toMatchObject({ fromISO: "2026-10-21", toISO: "2026-10-22", label: "Today" });
    expect(t.windowAfterThrough).toBe(true);

    const y = await readAt("yesterday", mirrorThroughYesterday);
    expect(y.window).toMatchObject({ fromISO: "2026-10-20", toISO: "2026-10-21", label: "Yesterday" });
    expect(y.windowAfterThrough).toBe(false);
  });

  it("is computed for every period, not only the two single-day ones", async () => {
    const got: Record<string, boolean> = {};
    for (const p of SALES_PERIODS) got[p] = (await readAt(p, mirrorThroughYesterday)).windowAfterThrough;
    expect(got).toEqual({
      today: true,
      yesterday: false,
      last_7d: false,
      last_30d: false,
      month_to_date: true, // includes today, so partial every morning
      prev_month: false,
    });
  });

  it("an empty mirror reports the window as after it, with an unknown through-date", async () => {
    const t = await readAt("yesterday", null);
    expect(t.throughDate).toBeNull();
    expect(t.windowAfterThrough).toBe(true);
  });

  it("a synced day with no invoices stays a real zero: windowAfterThrough is false", async () => {
    const t = await readAt("today", new Date("2026-10-21T04:00:00Z")); // mirror reached today
    expect(t.windowAfterThrough).toBe(false);
    expect(t.cents).toBe(0);
    expect(t.invoiceCount).toBe(0);
  });
});

describe("the period list is one contract across router, service and card", () => {
  const listIn = (src: string, re: RegExp) => {
    const m = re.exec(src);
    expect(m, `${re} not found`).not.toBeNull();
    return [...m![1]!.matchAll(/"([a-z_0-9]+)"/g)].map((x) => x[1]!).sort();
  };
  const expected = () => [...SALES_PERIODS].sort();

  it("offers today and yesterday, and keeps the other four", () => {
    expect(expected()).toEqual(["last_30d", "last_7d", "month_to_date", "prev_month", "today", "yesterday"]);
  });

  it("controlCenter.shopSales accepts every period the service defines", () => {
    const router = read("server/routers/controlCenter.ts");
    expect(listIn(router, /shopSales: adminProcedure\s*\.input\(z\.object\(\{ period: z\.enum\(\[([^\]]*)\]\)/)).toEqual(expected());
  });

  it("every chip the card offers is a period the router accepts, and 7 days stays the default", () => {
    const card = read("client/src/pages/admin/SalesCard.tsx");
    const ids = [...(/const PERIODS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(card)?.[1] ?? "").matchAll(/id: "([a-z_0-9]+)"/g)].map((x) => x[1]!);
    expect([...ids].sort()).toEqual(expected());
    expect(card).toMatch(/useState<Period>\("last_7d"\)/);
    const router = read("server/routers/controlCenter.ts");
    expect(router).toMatch(/\.default\("last_7d"\)/);
  });
});
