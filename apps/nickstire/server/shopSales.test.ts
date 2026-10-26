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
  paidInvoiceRevenue,
  SALES_PERIODS,
  SALES_DEFINITION_VERSION,
  type ShopSales,
} from "./services/shopSales";

// paidInvoiceRevenue loads the db lazily; the mock answers its three statements in order
// (the sync watermark, the window aggregate, then MAX(invoiceDate)).
const dbMock = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => ({ execute: dbMock.execute }) }));

// Whether a probe is running now: the budget's state and the page-load refresh's own flag.
const live = vi.hoisted(() => ({ budgetInFlight: false, refreshInFlight: false, stateThrows: false }));
vi.mock("./services/algProbeBudget", () => ({
  getProbeBudgetState: () => {
    if (live.stateThrows) throw new Error("state unavailable");
    return { inFlight: live.budgetInFlight };
  },
}));
vi.mock("./lib/adminActivity", () => ({ isAdminRefreshProbeInFlight: () => live.refreshInFlight }));

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

describe("whether a window is synced comes from the ShopDriver sync log, not from the newest invoice", () => {
  afterEach(() => {
    vi.useRealTimers();
    dbMock.execute.mockReset();
    live.budgetInFlight = false;
    live.refreshInFlight = false;
    live.stateThrows = false;
  });

  const aggRow = {
    paidCount: 0, paidCents: 0, pendingCount: 0, pendingCents: 0, partialCount: 0, partialCents: 0,
    refundedCount: 0, refundedCents: 0, blankInvoiceNumbers: 0,
  };
  const NOW_ISO = "2026-10-21T15:59:00Z"; // 11:59 ET on Wed 2026-10-21 (the screenshot's moment)
  type Period = (typeof SALES_PERIODS)[number];
  const epoch = (iso: string) => Date.parse(iso) / 1000;

  // The three statements, in order: the newest SUCCESSFUL probe (UNIX_TIMESTAMP, a number: no
  // driver Date to shift), the window aggregate, then MAX(invoiceDate) over shopdriver rows.
  async function read(
    period: Period,
    opts: { now?: string; agg?: Record<string, number>; through?: Date | null; probe?: string | null | "reject" } = {},
  ) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(opts.now ?? NOW_ISO));
    if (opts.probe === "reject") dbMock.execute.mockRejectedValueOnce(new Error("alg_probe_log unreadable"));
    else dbMock.execute.mockResolvedValueOnce([opts.probe ? [{ probeEpoch: epoch(opts.probe) }] : []]);
    dbMock.execute
      .mockResolvedValueOnce([[{ ...aggRow, ...opts.agg }]])
      .mockResolvedValueOnce([[{ throughDate: opts.through ?? null }]]);
    const r = await paidInvoiceRevenue(period);
    if (!r.available) throw new Error(`unexpected unavailable: ${r.reason}`);
    return r;
  }

  const sqlText = (call: unknown[]) =>
    (call[0] as { queryChunks: Array<{ value?: string[] } | unknown> }).queryChunks
      .map((c) => (c && typeof c === "object" && Array.isArray((c as { value?: string[] }).value) ? (c as { value: string[] }).value.join("") : "?"))
      .join("");

  it("a zero-sale day with a successful probe today is a real, synced $0", async () => {
    const t = await read("today", { probe: "2026-10-21T15:42:00Z" });
    expect(t.cents).toBe(0);
    expect(t.invoiceCount).toBe(0);
    expect(t.windowSynced).toBe(true);
    expect(t.sync).toEqual({ state: "ok", lastAt: "2026-10-21T15:42:00.000Z", etDate: "2026-10-21", etTime: "11:42 AM" });
  });

  it("a manual invoice today with no probe today is NOT synced, whatever the newest invoice date says", async () => {
    // A booking or tire-order write stamped today; the last ShopDriver probe was last night's 8 PM.
    const t = await read("today", {
      agg: { paidCount: 1, paidCents: 25000 },
      through: new Date("2026-10-21T04:00:00Z"),
      probe: "2026-10-21T00:00:00Z", // 20:00 ET Oct 20
    });
    expect(t.windowSynced).toBe(false);
    expect(t.sync).toMatchObject({ state: "ok", etDate: "2026-10-20", etTime: "8:00 PM" });
  });

  it("the probe lookup counts only `success`: the outcome that means the invoices were read", async () => {
    await read("today", { probe: "2026-10-21T15:42:00Z" });
    const text = sqlText(dbMock.execute.mock.calls[0]!);
    expect(text).toMatch(/FROM alg_probe_log/);
    expect(text).toMatch(/WHERE outcome = 'success'/);
    // `empty` was also what a failed invoice fetch was logged as, so it can no longer vouch for a sync.
    for (const bad of ["empty", "auth_failed", "error", "dedup", "skipped_recent"]) expect(text).not.toContain(bad);
    expect(text).toMatch(/UNIX_TIMESTAMP\(startedAt\)/);
  });

  it("the sync watermark is read BEFORE the invoice aggregate", async () => {
    // A probe that lands between the two reads can then only make us say "not synced" about data
    // that is already fresh. In the other order the aggregate could miss the probe's rows while
    // the watermark saw the probe, and we would say "synced" about stale data.
    await read("today", { probe: "2026-10-21T15:42:00Z" });
    const [first, second, third] = dbMock.execute.mock.calls.map(sqlText);
    expect(first).toMatch(/FROM alg_probe_log/);
    expect(second).toMatch(/paidCount[\s\S]*FROM invoices\s+WHERE invoiceDate >=/);
    expect(third).toMatch(/MAX\(invoiceDate\)/);
  });

  it("a probe that landed between the two reads can only make the day look unsynced, never synced", async () => {
    // The watermark read saw last night's probe; the aggregate (read after) already holds rows
    // the new probe wrote. Result: fresh rows labelled "not synced". The reverse order would give
    // a stale aggregate labelled with the new probe's time.
    const t = await read("today", { agg: { paidCount: 4, paidCents: 120000 }, probe: "2026-10-21T00:00:00Z" });
    expect(t.windowSynced).toBe(false);
    expect(t.cents).toBe(120000);
  });

  it("a day with no successful probe on record is not synced", async () => {
    const t = await read("today", { probe: null });
    expect(t.sync).toEqual({ state: "never" });
    expect(t.windowSynced).toBe(false);
  });

  it("an unreadable probe log is UNKNOWN: the read still answers, but never claims synced", async () => {
    const t = await read("today", { agg: { paidCount: 3, paidCents: 90000 }, probe: "reject" });
    expect(t.sync).toMatchObject({ state: "unreadable" });
    expect(t.windowSynced).toBeNull();
    for (const p of SALES_PERIODS) {
      const r = await read(p, { probe: "reject" });
      expect(r.windowSynced, p).toBeNull();
    }
  });

  it("the data date is read from ShopDriver rows only", async () => {
    await read("yesterday", { probe: "2026-10-21T15:42:00Z" });
    expect(sqlText(dbMock.execute.mock.calls[2]!)).toMatch(/MAX\(invoiceDate\) AS throughDate FROM invoices WHERE source = 'shopdriver'/);
  });

  it("every period is judged against the probe: with a probe at 11:42 ET today they are all synced", async () => {
    const got: Record<string, boolean | null> = {};
    for (const p of SALES_PERIODS) got[p] = (await read(p, { probe: "2026-10-21T15:42:00Z" })).windowSynced;
    expect(got).toEqual({ today: true, yesterday: true, last_7d: true, last_30d: true, month_to_date: true, prev_month: true });
  });

  it("with only last night's 8 PM probe, anything that includes the end of yesterday or today is not synced", async () => {
    const got: Record<string, boolean | null> = {};
    for (const p of SALES_PERIODS) got[p] = (await read(p, { probe: "2026-10-21T00:00:00Z" })).windowSynced;
    expect(got).toEqual({
      today: false, // nothing ran today
      yesterday: false, // the probe ran before yesterday ended
      last_7d: false,
      last_30d: false,
      month_to_date: false,
      prev_month: true, // a whole month that ended Oct 1, probed after
    });
  });

  it.each([
    // [label, now, period, probe instant, windowSynced]
    ["probe at 23:59:59 ET last night does not cover today (UTC date is already today)", "2026-10-21T15:59:00Z", "today", "2026-10-21T03:59:59Z", false],
    ["probe at 00:00:01 ET today covers today", "2026-10-21T15:59:00Z", "today", "2026-10-21T04:00:01Z", true],
    ["probe at 00:00:01 ET today covers yesterday (it ran after yesterday ended)", "2026-10-21T15:59:00Z", "yesterday", "2026-10-21T04:00:01Z", true],
    ["probe at 23:59:59 ET last night does not cover yesterday (yesterday had only just ended)", "2026-10-21T15:59:00Z", "yesterday", "2026-10-21T03:59:59Z", false],
    ["22:00 ET Oct 21, probe 21:30 ET the same day: today synced", "2026-10-22T02:00:00Z", "today", "2026-10-22T01:30:00Z", true],
    ["month end: yesterday is Sep 30, probe on Oct 1 covers it", "2026-10-01T15:59:00Z", "yesterday", "2026-10-01T12:00:00Z", true],
    ["month end: yesterday is Sep 30, probe Sep 30 evening does not", "2026-10-01T15:59:00Z", "yesterday", "2026-10-01T00:30:00Z", false],
    ["year end: yesterday is Dec 31, probe Jan 1 covers it", "2027-01-01T17:00:00Z", "yesterday", "2027-01-01T15:00:00Z", true],
    ["fall back day (2026-11-01): probe 01:30 EST covers today", "2026-11-01T17:00:00Z", "today", "2026-11-01T06:30:00Z", true],
    ["spring forward day (2026-03-08): probe 23:30 EST the day before does not cover today", "2026-03-08T17:00:00Z", "today", "2026-03-08T04:30:00Z", false],
  ] as const)("windowSynced: %s", async (_label, now, period, probe, expected) => {
    expect((await read(period, { now, probe })).windowSynced).toBe(expected);
  });

  it("a driver that hands the epoch back as a string still decides", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
    dbMock.execute
      .mockResolvedValueOnce([[{ probeEpoch: String(epoch("2026-10-21T15:42:00Z")) }]])
      .mockResolvedValueOnce([[aggRow]])
      .mockResolvedValueOnce([[{ throughDate: null }]]);
    const r = await paidInvoiceRevenue("today");
    expect(r.available && r.windowSynced).toBe(true);
  });

  it("a fetch begun at 23:59 ET that was logged at 00:01 ET covers yesterday's night, not today", async () => {
    // writeProbeLog stores startedAt as NOW() minus the duration, so the row says 23:59 even
    // though it was inserted after midnight. Read at 00:01 ET: not a probe today.
    expect((await read("today", { now: "2026-10-21T04:01:00Z", probe: "2026-10-21T03:59:30Z" })).windowSynced).toBe(false);
    expect((await read("today", { now: "2026-10-21T04:01:00Z", probe: "2026-10-21T04:00:30Z" })).windowSynced).toBe(true);
  });
});

describe("syncInFlight: the read says whether a probe is running, so the card can follow it", () => {
  afterEach(() => {
    vi.useRealTimers();
    dbMock.execute.mockReset();
    live.budgetInFlight = false;
    live.refreshInFlight = false;
    live.stateThrows = false;
  });
  const aggRow = { paidCount: 0, paidCents: 0, pendingCount: 0, pendingCents: 0, partialCount: 0, partialCents: 0, refundedCount: 0, refundedCents: 0, blankInvoiceNumbers: 0 };
  async function inFlight() {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T15:59:00Z"));
    dbMock.execute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[aggRow]]).mockResolvedValueOnce([[{ throughDate: null }]]);
    const r = await paidInvoiceRevenue("today");
    if (!r.available) throw new Error("unexpected unavailable");
    return r.syncInFlight;
  }

  it("is false when nothing is running", async () => {
    expect(await inFlight()).toBe(false);
  });
  it("is true while the probe budget has a probe or a manual sync running (OAuth callback, chat, another tab, sync-now)", async () => {
    live.budgetInFlight = true;
    expect(await inFlight()).toBe(true);
  });
  it("is true while this page-load refresh is starting its probe", async () => {
    live.refreshInFlight = true;
    expect(await inFlight()).toBe(true);
  });
  it("is false, not an error, when the probe state cannot be read", async () => {
    live.stateThrows = true;
    expect(await inFlight()).toBe(false);
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

  it("controlCenter.shopSales builds its input enum from the service's list, not a copy", () => {
    const router = read("server/routers/controlCenter.ts");
    expect(router).toMatch(/import \{ SALES_PERIODS \} from "\.\.\/services\/shopSales"/);
    expect(router).toMatch(/shopSales: adminProcedure\s*\.input\(z\.object\(\{ period: z\.enum\(SALES_PERIODS\)/);
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

describe("previous: the same figures for the window of the same length just before", () => {
  afterEach(() => {
    vi.useRealTimers();
    dbMock.execute.mockReset();
  });

  const aggRow = {
    paidCount: 0, paidCents: 0, pendingCount: 0, pendingCents: 0, partialCount: 0, partialCents: 0,
    refundedCount: 0, refundedCents: 0, blankInvoiceNumbers: 0,
  };
  const NOW_ISO = "2026-10-21T15:59:00Z"; // 11:59 ET, Wed 2026-10-21
  const epoch = (iso: string) => Date.parse(iso) / 1000;

  // Four statements, in order: the sync watermark, the current aggregate, MAX(invoiceDate), then
  // the previous window's aggregate.
  async function readBoth(
    period: (typeof SALES_PERIODS)[number],
    opts: {
      now?: string;
      agg?: Record<string, number>;
      prev?: Record<string, number>;
      probe?: string | null;
      prevFails?: boolean;
    } = {},
  ) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(opts.now ?? NOW_ISO));
    dbMock.execute
      .mockResolvedValueOnce([opts.probe ? [{ probeEpoch: epoch(opts.probe) }] : []])
      .mockResolvedValueOnce([[{ ...aggRow, ...opts.agg }]])
      .mockResolvedValueOnce([[{ throughDate: null }]]);
    if (opts.prevFails) dbMock.execute.mockRejectedValueOnce(new Error("previous aggregate failed"));
    else dbMock.execute.mockResolvedValueOnce([[{ ...aggRow, ...opts.prev }]]);
    return paidInvoiceRevenue(period);
  }
  async function readOk(...args: Parameters<typeof readBoth>) {
    const r = await readBoth(...args);
    if (!r.available) throw new Error(`unexpected unavailable: ${r.reason}`);
    return r;
  }

  const chunksOf = (call: unknown[]) => (call[0] as { queryChunks: unknown[] }).queryChunks;
  const textOf = (call: unknown[]) =>
    chunksOf(call)
      .map((c) => (c && typeof c === "object" && Array.isArray((c as { value?: string[] }).value) ? (c as { value: string[] }).value.join("") : "?"))
      .join("");
  const paramsOf = (call: unknown[]) => chunksOf(call).filter((c): c is string => typeof c === "string");

  it("last_7d: 6 invoices / $4,249 now, 8 / $5,193 before, with the average beside each count", async () => {
    const r = await readOk("last_7d", { agg: { paidCount: 6, paidCents: 424900 }, prev: { paidCount: 8, paidCents: 519300 } });
    expect(r.cents).toBe(424900);
    expect(r.invoiceCount).toBe(6);
    expect(r.averageCents).toBe(70817); // 424900 / 6 = 70816.67
    expect(r.previous).toEqual({
      cents: 519300,
      invoiceCount: 8,
      averageCents: 64913, // 519300 / 8 = 64912.5, rounded half up
      window: { fromISO: "2026-10-07", toISO: "2026-10-14", label: "7 days before" },
      windowSynced: false, // no probe on record
    });
    // The current window is untouched: Oct 14 .. Oct 20 (7 dates).
    expect(r.window).toEqual({ fromISO: "2026-10-14", toISO: "2026-10-21", label: "Last 7 days" });
  });

  it("the previous aggregate is the SAME statement over the previous dates: same exclusions, same source rule", async () => {
    await readOk("last_7d", { probe: "2026-10-21T15:42:00Z" });
    const calls = dbMock.execute.mock.calls;
    expect(calls).toHaveLength(4);
    expect(textOf(calls[3]!)).toBe(textOf(calls[1]!));
    expect(textOf(calls[3]!)).toMatch(/SUM\(CASE WHEN paymentStatus = 'paid'\s+THEN totalAmount/);
    expect(paramsOf(calls[1]!)).toEqual(["2026-10-14", "2026-10-21"]);
    expect(paramsOf(calls[3]!)).toEqual(["2026-10-07", "2026-10-14"]);
  });

  it("an empty previous window is a real 0 with no average, not an average of 0", async () => {
    const r = await readOk("last_7d", { agg: { paidCount: 2, paidCents: 50000 }, prev: {} });
    expect(r.previous).toMatchObject({ cents: 0, invoiceCount: 0, averageCents: null });
    const quiet = await readOk("last_7d", { agg: {}, prev: {} });
    expect(quiet.averageCents).toBeNull();
    expect(quiet.cents).toBe(0);
  });

  it("today: the previous window is yesterday", async () => {
    const r = await readOk("today", { prev: { paidCount: 5, paidCents: 100000 } });
    expect(r.previous).toMatchObject({ cents: 100000, invoiceCount: 5, averageCents: 20000, window: { fromISO: "2026-10-20", toISO: "2026-10-21", label: "Yesterday" } });
  });

  it("yesterday: the previous window is the day before", async () => {
    const r = await readOk("yesterday");
    expect(r.previous?.window).toMatchObject({ fromISO: "2026-10-19", toISO: "2026-10-20" });
  });

  it("last_30d: the 30 dates before", async () => {
    const r = await readOk("last_30d");
    expect(r.window).toMatchObject({ fromISO: "2026-09-21", toISO: "2026-10-21" });
    expect(r.previous?.window).toMatchObject({ fromISO: "2026-08-22", toISO: "2026-09-21" });
  });

  it("month_to_date on the 25th: last month's completed days only (the 1st to the 24th), because today is still open", async () => {
    const r = await readOk("month_to_date", { now: "2026-10-25T16:00:00Z" });
    expect(r.window).toMatchObject({ fromISO: "2026-10-01", toISO: "2026-10-26" }); // 25 dates, today included
    // 2026-10-26 audit: comparing them with Sep 1..25 put a full billed day against today, which the
    // overnight mirror leaves empty, so "This month" read "down" by about one shop day every day.
    expect(r.previous?.window).toMatchObject({ fromISO: "2026-09-01", toISO: "2026-09-25", label: "Same days last month, before today's date" }); // 24 dates
  });

  it("month_to_date on the 1st has no earlier window: the month so far is only today, still open", async () => {
    const r = await readOk("month_to_date", { now: "2026-10-01T16:00:00Z" });
    expect(r.previous).toBeNull();
  });

  it("month_to_date on the 31st stops at the end of a 30-day last month, never into this month", async () => {
    const r = await readOk("month_to_date", { now: "2026-10-31T16:00:00Z" });
    expect(r.previous?.window).toMatchObject({ fromISO: "2026-09-01", toISO: "2026-10-01" });
  });

  it("prev_month: the month before it, across the year boundary too", async () => {
    const r = await readOk("prev_month");
    expect(r.window).toMatchObject({ fromISO: "2026-09-01", toISO: "2026-10-01" });
    expect(r.previous?.window).toMatchObject({ fromISO: "2026-08-01", toISO: "2026-09-01" });
    const jan = await readOk("prev_month", { now: "2026-01-10T17:00:00Z" });
    expect(jan.previous?.window).toMatchObject({ fromISO: "2025-11-01", toISO: "2025-12-01" });
  });

  it("never overlaps the current window and ends where it begins, for every period", async () => {
    for (const p of SALES_PERIODS) {
      for (const now of ["2026-10-21T15:59:00Z", "2026-03-10T16:00:00Z", "2026-11-03T17:00:00Z", "2027-01-03T17:00:00Z", "2028-03-02T17:00:00Z", "2026-10-31T16:00:00Z"]) {
        const r = await readOk(p, { now });
        const prev = r.previous!;
        expect(prev.window.toISO <= r.window.fromISO, `${p} @ ${now}: previous reaches into the current window`).toBe(true);
        expect(prev.window.fromISO < prev.window.toISO, `${p} @ ${now}: empty previous window`).toBe(true);
        if (p !== "month_to_date" && p !== "prev_month") {
          expect(prev.window.toISO, `${p} @ ${now}: gap between the windows`).toBe(r.window.fromISO);
          expect(datesIn({ from: prev.window.fromISO, to: prev.window.toISO }), `${p} @ ${now}`).toHaveLength(
            datesIn({ from: r.window.fromISO, to: r.window.toISO }).length,
          );
        }
        dbMock.execute.mockReset();
      }
    }
  });

  it("the previous window is judged against the probe on its own end date, not the current window's", async () => {
    // Last night's 8 PM probe: the current last_7d (ends yesterday) is not covered, but the
    // 7 dates before it ended a week ago and are.
    const r = await readOk("last_7d", { probe: "2026-10-21T00:00:00Z" });
    expect(r.windowSynced).toBe(false);
    expect(r.previous?.windowSynced).toBe(true);
  });

  it("an unreadable probe log leaves the previous windowSynced unknown, like the current one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
    dbMock.execute
      .mockRejectedValueOnce(new Error("alg_probe_log unreadable"))
      .mockResolvedValueOnce([[aggRow]])
      .mockResolvedValueOnce([[{ throughDate: null }]])
      .mockResolvedValueOnce([[aggRow]]);
    const r = await paidInvoiceRevenue("last_7d");
    expect(r.available && r.windowSynced).toBeNull();
    expect(r.available && r.previous?.windowSynced).toBeNull();
  });

  it("a failed previous read makes the whole answer unavailable, never a previous of 0", async () => {
    const r = await readBoth("last_7d", { agg: { paidCount: 6, paidCents: 424900 }, prevFails: true });
    expect(r).toEqual({ available: false, reason: "previous aggregate failed" });
    expect("cents" in r).toBe(false);
  });
});
