/**
 * The bridge's date-range reads, `revenue_range` and `marketing_attribution` (2026-10-09).
 *
 * Both took `from`/`to` as YYYY-MM-DD and ran `col BETWEEN from AND to` against a DATETIME
 * column. A date string compared with a DATETIME means midnight, so the end day was cut at
 * 00:00 and every row timed on it was dropped: month-to-date revenue omitted today's tickets.
 * Both defaulted to the UTC day, which is already tomorrow in Cleveland from 20:00 ET. And a
 * malformed date went straight into the query and came back as a confident total.
 *
 * The fake database below applies MySQL's comparison rules to fixture rows (a date-only string
 * against a DATETIME is that day's 00:00:00; CONVERT_TZ moves a New York wall clock to UTC), so
 * these tests assert WHICH rows a read counts, not only what its SQL text says. A predicate the
 * fake does not model throws, so a rewrite of the SQL cannot pass by going unrecognised.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const getDb = vi.fn();
vi.mock("../db", () => ({ getDb: () => getDb() }));

import { QUERY_HANDLERS } from "./nour-os-query";

/** Flatten a drizzle sql object to its text and params. */
function flat(q: { queryChunks: unknown[] }): { text: string; params: unknown[] } {
  const text: string[] = [];
  const params: unknown[] = [];
  const walk = (chunks: unknown[]) => {
    for (const c of chunks) {
      if (c && typeof c === "object" && "queryChunks" in (c as object)) walk((c as { queryChunks: unknown[] }).queryChunks);
      else if (c && typeof c === "object" && "value" in (c as object) && Array.isArray((c as { value: unknown }).value)) text.push((c as { value: string[] }).value.join(""));
      else { params.push(c); text.push("?"); }
    }
  };
  walk(q.queryChunks);
  return { text: text.join("").replace(/\s+/g, " ").trim(), params };
}

/** MySQL reads a date-only string compared with a DATETIME as that day's midnight. */
const asDatetime = (s: string) => (s.length === 10 ? `${s} 00:00:00` : s);
const nextDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** CONVERT_TZ('<date> 00:00:00', 'America/New_York', '+00:00') as a UTC 'YYYY-MM-DD HH:MM:SS'. */
function nyMidnightAsUtc(date: string): string {
  for (const offset of ["-04:00", "-05:00"]) {
    const ms = Date.parse(`${date}T00:00:00${offset}`);
    const wall = new Date(ms).toLocaleString("sv-SE", { timeZone: "America/New_York" });
    if (wall === `${date} 00:00:00`) return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  }
  throw new Error(`no New York midnight for ${date}`);
}

/** A bound the fake can evaluate: `?`, `DATE_ADD(?, INTERVAL 1 DAY)`, or CONVERT_TZ of either. */
const BOUND = String.raw`CONVERT_TZ\((?:DATE_ADD\(\?, INTERVAL 1 DAY\)|\?), '[^']+', '[^']+'\)|DATE_ADD\(\?, INTERVAL 1 DAY\)|\?`;

function evalBound(expr: string, take: () => string): string {
  const tz = /^CONVERT_TZ\((.*), '([^']+)', '([^']+)'\)$/.exec(expr);
  if (tz) {
    const day = evalBound(tz[1], take);
    if (tz[2] === "America/New_York" && tz[3] === "+00:00" && day.length === 10) return nyMidnightAsUtc(day);
    throw new Error(`the fake database does not model ${expr}`);
  }
  if (expr === "DATE_ADD(?, INTERVAL 1 DAY)") return nextDay(take());
  if (expr === "?") return take();
  throw new Error(`the fake database does not model ${expr}`);
}

/** The row test a captured WHERE clause applies to `col`, in MySQL semantics. */
function predicate(col: string, text: string, params: unknown[]): (ts: string) => boolean {
  const p = params.map(String);
  let i = 0;
  const take = () => p[i++];
  const esc = col.replace(/\./g, "\\.");
  // The pre-2026-10-09 revenue_today / cars_today shape, which read the column as UTC. Modelled
  // so a run against it shows WHICH rows it took, not only that the fake did not recognise it.
  if (new RegExp(`DATE\\(CONVERT_TZ\\(${esc}, '\\+00:00', 'America/New_York'\\)\\) = DATE\\(CONVERT_TZ\\(NOW\\(\\), '\\+00:00', 'America/New_York'\\)\\)`).test(text)) {
    const nyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const today = nyDay(new Date());
    return (ts) => nyDay(new Date(`${ts.replace(" ", "T")}Z`)) === today;
  }
  if (new RegExp(`${esc} BETWEEN \\? AND \\?`).test(text)) {
    const [lo, hi] = [asDatetime(take()), asDatetime(take())];
    return (ts) => ts >= lo && ts <= hi;
  }
  const m = new RegExp(`${esc} (>=|>) (${BOUND}) AND ${esc} (<=|<) (${BOUND})`).exec(text);
  if (m) {
    const lo = asDatetime(evalBound(m[2], take));
    const hi = asDatetime(evalBound(m[4], take));
    const above = m[1] === ">=" ? (ts: string) => ts >= lo : (ts: string) => ts > lo;
    const below = m[3] === "<" ? (ts: string) => ts < hi : (ts: string) => ts <= hi;
    return (ts) => above(ts) && below(ts);
  }
  throw new Error(`the fake database does not model this ${col} predicate: ${text}`);
}

/** Invoices as stored: `invoiceDate` is the shop-local wall clock. */
function invoiceDb(invoices: Array<{ invoiceDate: string; totalAmount: number }>) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const execute = vi.fn(async (q: { queryChunks: unknown[] }) => {
    const f = flat(q);
    calls.push(f);
    const keep = predicate("invoiceDate", f.text, f.params);
    const hit = invoices.filter((i) => keep(i.invoiceDate));
    const total = hit.reduce((s, i) => s + i.totalAmount, 0);
    return [[{ totalCents: total, invoiceCount: hit.length, avgTicketCents: hit.length ? total / hit.length : null }]];
  });
  return { db: { execute }, calls };
}

/** Leads as stored: `createdAt` is the database's NOW() at insert, UTC. */
function leadDb(leads: Array<{ createdAt: string; source: string }>) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const execute = vi.fn(async (q: { queryChunks: unknown[] }) => {
    const f = flat(q);
    calls.push(f);
    const keep = predicate("l.createdAt", f.text, f.params);
    const bySource = new Map<string, number>();
    for (const l of leads.filter((x) => keep(x.createdAt))) bySource.set(l.source, (bySource.get(l.source) ?? 0) + 1);
    const rows = [...bySource].map(([source, leadCount]) => ({
      source, utmSource: null, leadCount, bookedCount: 0, completedCount: 0, lostCount: 0,
      conversionCount: 0, totalCents: 0, avgTicketCents: 0,
    }));
    return [rows];
  });
  return { db: { execute }, calls };
}

type RevenueRange = { from: string; to: string; totalDollars: number; invoiceCount: number; avgTicket: number };
type Attribution = { from: string; to: string; sources: Array<{ source: string; leadCount: number }>; totals: { leadCount: number } };

const revenueRange = (filters: Record<string, unknown>) => QUERY_HANDLERS.revenue_range(filters) as Promise<RevenueRange>;
const attribution = (filters: Record<string, unknown>) => QUERY_HANDLERS.marketing_attribution(filters) as Promise<Attribution>;

/** Run `fn` with the clock at `iso`, faking only Date so dynamic imports still resolve. */
async function at<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date(iso));
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("revenue_range counts the whole end day", () => {
  const INVOICES = [
    { invoiceDate: "2026-09-30 17:45:00", totalAmount: 1_000 }, // the day before `from`
    { invoiceDate: "2026-10-01 00:00:00", totalAmount: 20_000 }, // date-only ticket on `from`
    { invoiceDate: "2026-10-04 11:00:00", totalAmount: 30_000 },
    { invoiceDate: "2026-10-08 00:00:00", totalAmount: 40_000 }, // date-only ticket on `to`
    { invoiceDate: "2026-10-08 14:30:00", totalAmount: 50_000 }, // timed ticket on `to`
    { invoiceDate: "2026-10-08 23:59:59", totalAmount: 60_000 }, // last second of `to`
    { invoiceDate: "2026-10-09 00:00:00", totalAmount: 7_000 }, // the day after `to`
  ];

  it("includes tickets timed after midnight on `to`, and nothing from the day after", async () => {
    const { db } = invoiceDb(INVOICES);
    getDb.mockResolvedValue(db);
    const out = await revenueRange({ from: "2026-10-01", to: "2026-10-08" });
    expect(out).toEqual({ from: "2026-10-01", to: "2026-10-08", totalDollars: 2_000, invoiceCount: 5, avgTicket: 400 });
  });

  it("a one-day range (from = to) is that whole day, not only its date-only tickets", async () => {
    const { db } = invoiceDb(INVOICES);
    getDb.mockResolvedValue(db);
    const out = await revenueRange({ from: "2026-10-08", to: "2026-10-08" });
    expect(out.invoiceCount).toBe(3);
    expect(out.totalDollars).toBe(1_500);
  });

  it("sends a half-open range on the bare column, so idx_invoice_date still serves it", async () => {
    const { db, calls } = invoiceDb([]);
    getDb.mockResolvedValue(db);
    await revenueRange({ from: "2026-10-01", to: "2026-10-08" });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("WHERE invoiceDate >= ? AND invoiceDate < DATE_ADD(?, INTERVAL 1 DAY)");
    expect(calls[0].text).not.toMatch(/BETWEEN/);
    expect(calls[0].params).toEqual(["2026-10-01", "2026-10-08"]);
  });
});

describe("marketing_attribution buckets UTC lead timestamps by the New York day", () => {
  // 2026-10 is EDT (UTC-4): New York's Oct 1 is 2026-10-01 04:00Z through 2026-10-09 04:00Z for `to` Oct 8.
  const LEADS = [
    { createdAt: "2026-10-01 02:00:00", source: "web" }, // 22:00 ET Sep 30: NOT in Oct 1-8
    { createdAt: "2026-10-01 04:00:00", source: "web" }, // 00:00 ET Oct 1: in
    { createdAt: "2026-10-08 15:00:00", source: "phone" }, // 11:00 ET Oct 8: in
    { createdAt: "2026-10-09 02:00:00", source: "phone" }, // 22:00 ET Oct 8: in (UTC already says Oct 9)
    { createdAt: "2026-10-09 04:00:00", source: "phone" }, // 00:00 ET Oct 9: NOT in
  ];

  it("counts the evening of `to` and drops the evening before `from`", async () => {
    const { db, calls } = leadDb(LEADS);
    getDb.mockResolvedValue(db);
    const out = await attribution({ from: "2026-10-01", to: "2026-10-08" });
    // Per source, not only the total: reading createdAt as shop-local would wrongly take the
    // Sep 30 evening web lead AND wrongly drop the Oct 8 evening phone lead, and still total 3.
    expect(Object.fromEntries(out.sources.map((s) => [s.source, s.leadCount]))).toEqual({ web: 1, phone: 2 });
    expect(out.totals.leadCount).toBe(3);
    expect(out.from).toBe("2026-10-01");
    expect(out.to).toBe("2026-10-08");
    expect(calls[0].params).toEqual(["2026-10-01", "2026-10-08"]);
    expect(calls[0].text).not.toMatch(/BETWEEN/);
  });
});

describe("absent bounds default from the shop's day, not the UTC day", () => {
  it("revenue_range at 23:30 in New York reads today in New York (UTC has rolled to tomorrow)", async () => {
    const { db, calls } = invoiceDb([]);
    getDb.mockResolvedValue(db);
    // 23:30 EDT on Oct 8 = 03:30Z Oct 9.
    const out = await at("2026-10-09T03:30:00Z", () => revenueRange({}));
    expect(out.from).toBe("2026-10-08");
    expect(out.to).toBe("2026-10-08");
    expect(calls[0].params).toEqual(["2026-10-08", "2026-10-08"]);
  });

  it("revenue_range holds on standard time too (23:30 EST on Dec 1 = 04:30Z Dec 2)", async () => {
    const { db } = invoiceDb([]);
    getDb.mockResolvedValue(db);
    const out = await at("2026-12-02T04:30:00Z", () => revenueRange({}));
    expect([out.from, out.to]).toEqual(["2026-12-01", "2026-12-01"]);
  });

  it("revenue_range with only `from` runs through today in New York", async () => {
    const { db } = invoiceDb([]);
    getDb.mockResolvedValue(db);
    const out = await at("2026-10-09T03:30:00Z", () => revenueRange({ from: "2026-10-01" }));
    expect([out.from, out.to]).toEqual(["2026-10-01", "2026-10-08"]);
  });

  it("marketing_attribution defaults to the 30 shop days ending on the New York today", async () => {
    const { db, calls } = leadDb([]);
    getDb.mockResolvedValue(db);
    const out = await at("2026-10-09T03:30:00Z", () => attribution({}));
    // Sep 9 .. Oct 8 inclusive is 30 days (the old window was 30 UTC days without today).
    expect([out.from, out.to]).toEqual(["2026-09-09", "2026-10-08"]);
    expect(calls[0].params).toEqual(["2026-09-09", "2026-10-08"]);
  });

  it("a `to`-only call reads the default window ending on `to`, not one anchored on today", async () => {
    const rr = invoiceDb([]);
    getDb.mockResolvedValue(rr.db);
    const one = await at("2026-10-09T16:00:00Z", () => revenueRange({ to: "2026-10-01" }));
    expect([one.from, one.to]).toEqual(["2026-10-01", "2026-10-01"]);
    const ma = leadDb([]);
    getDb.mockResolvedValue(ma.db);
    const win = await at("2026-10-09T16:00:00Z", () => attribution({ to: "2026-08-31" }));
    expect([win.from, win.to]).toEqual(["2026-08-02", "2026-08-31"]);
  });

  it("a `from` after the defaulted today says the `to` was defaulted", async () => {
    const { db } = invoiceDb([]);
    getDb.mockResolvedValue(db);
    const out = (await at("2026-10-09T16:00:00Z", () => QUERY_HANDLERS.revenue_range({ from: "2026-10-12" }))) as { error: string };
    expect(out.error).toBe("from (2026-10-12) is after to (2026-10-09 (defaulted to the shop's today))");
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe("a malformed or reversed range is refused before any query", () => {
  const BAD: Array<[string, Record<string, unknown>]> = [
    ["a single-digit day", { from: "2026-10-1", to: "2026-10-08" }],
    ["a US-style date", { from: "10/01/2026", to: "2026-10-08" }],
    ["a calendar date that does not exist", { from: "2026-02-30", to: "2026-03-02" }],
    ["a timestamp, not a day", { from: "2026-10-01T00:00:00Z", to: "2026-10-08" }],
    ["a number", { from: "2026-10-01", to: 20261008 }],
    ["words", { from: "last month", to: "today" }],
    ["from after to", { from: "2026-10-08", to: "2026-10-01" }],
  ];

  for (const [name, filters] of BAD) {
    it(`revenue_range: ${name}`, async () => {
      const { db } = invoiceDb([{ invoiceDate: "2026-10-04 11:00:00", totalAmount: 30_000 }]);
      getDb.mockResolvedValue(db);
      const out = (await QUERY_HANDLERS.revenue_range(filters)) as Record<string, unknown>;
      expect(out).toEqual({ error: expect.any(String) });
      expect(db.execute).not.toHaveBeenCalled();
    });

    it(`marketing_attribution: ${name}`, async () => {
      const { db } = leadDb([{ createdAt: "2026-10-04 15:00:00", source: "web" }]);
      getDb.mockResolvedValue(db);
      const out = (await QUERY_HANDLERS.marketing_attribution(filters)) as Record<string, unknown>;
      expect(out).toEqual({ error: expect.any(String) });
      expect(db.execute).not.toHaveBeenCalled();
    });
  }

  it("an empty string still means 'not given' (the default), as before", async () => {
    const { db } = invoiceDb([]);
    getDb.mockResolvedValue(db);
    const out = await at("2026-10-08T16:00:00Z", () => revenueRange({ from: "", to: "" }));
    expect([out.from, out.to]).toEqual(["2026-10-08", "2026-10-08"]);
  });
});

describe("revenue_today reads the stored shop-local day", () => {
  // `invoiceDate` is the shop-local wall clock as stored; a date-only ALG ticket is that day's
  // 00:00:00. revenue_today converted it FROM UTC, which moved those tickets onto the day before.
  const INVOICES = [
    { invoiceDate: "2026-10-07 23:30:00", totalAmount: 9_000 }, // yesterday, late
    { invoiceDate: "2026-10-08 00:00:00", totalAmount: 40_000 }, // date-only ticket today
    { invoiceDate: "2026-10-08 14:30:00", totalAmount: 50_000 }, // timed ticket today
    { invoiceDate: "2026-10-09 00:00:00", totalAmount: 7_000 }, // tomorrow
  ];
  type Today = { totalCents: number; totalDollars: number; invoiceCount: number };
  const revenueToday = () => QUERY_HANDLERS.revenue_today({}) as Promise<Today>;

  it("counts today's date-only tickets, at 23:30 ET when UTC already says tomorrow", async () => {
    const { db, calls } = invoiceDb(INVOICES);
    getDb.mockResolvedValue(db);
    const out = await at("2026-10-09T03:30:00Z", revenueToday); // 23:30 EDT on Oct 8
    expect(out).toEqual({ totalCents: 90_000, totalDollars: 900, invoiceCount: 2 });
    expect(calls[0].params).toEqual(["2026-10-08", "2026-10-08"]);
    expect(calls[0].text).not.toMatch(/CONVERT_TZ\(invoiceDate/);
  });

  it("agrees with revenue_range(today, today)", async () => {
    const { db } = invoiceDb(INVOICES);
    getDb.mockResolvedValue(db);
    const today = await at("2026-10-08T16:00:00Z", revenueToday);
    const range = await at("2026-10-08T16:00:00Z", () => revenueRange({ from: "2026-10-08", to: "2026-10-08" }));
    expect(today.invoiceCount).toBe(range.invoiceCount);
    expect(today.totalDollars).toBe(range.totalDollars);
  });
});
