/**
 * The bridge reads StateNour's autonomous engine was calling with no handler (2026-10-10):
 *
 *   quotes_pending          suggest_pricing_adjustment {sinceHours:168} and quote_conversion_insight
 *                           {sinceHours:720} read { count, bookedCount }; the latter's detail read
 *                           {sinceHours:720, withDetail:true, limit:200} reads quotes[{grandTotal,status}].
 *                           The name had no handler, so every call was a 400 "Unknown query".
 *   bookings_pending_stale  auto_remind_pending_appointment {status:"pending", staleHours:4} reads
 *                           bookings[{id, customerName, customerPhone, serviceType, preferredDay,
 *                           preferredTime, createdAt}]. It called bookings_status, which ignores its
 *                           filters and answers { statusBreakdown }, so the rule never had a row.
 *
 * Quotes come from alg_estimates (ShopDriver counter quotes), not estimates_log: estimates_log has
 * no writer (routers/controlCenter.ts:119), so a read of it would be a permanent, confident zero.
 * A failed or refused read must come back as { error }, which StateNour's readBridge treats as
 * UNKNOWN, never as a count of 0.
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

/** A database that answers each execute() with the next canned result set, as mysql2 shapes it. */
function cannedDb(...results: Array<Record<string, unknown>[]>) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const execute = vi.fn(async (q: { queryChunks: unknown[] }) => {
    calls.push(flat(q));
    return [results.shift() ?? [], []];
  });
  return { db: { execute }, calls };
}

const quotesPending = (filters: Record<string, unknown>) => QUERY_HANDLERS.quotes_pending(filters) as Promise<Record<string, unknown>>;
const bookingsStale = (filters: Record<string, unknown>) => QUERY_HANDLERS.bookings_pending_stale(filters) as Promise<Record<string, unknown>>;

afterEach(() => {
  vi.clearAllMocks();
});

describe("quotes_pending", () => {
  it("counts the window's ALG quotes and the ones matched to an invoice, as numbers (TiDB sends SUM as a string)", async () => {
    const { db, calls } = cannedDb([{ count: 12, bookedCount: "3" }]);
    getDb.mockResolvedValue(db);
    const out = await quotesPending({ sinceHours: 168 });
    expect(out).toEqual({ sinceHours: 168, count: 12, bookedCount: 3, bookedCountIsLowerBound: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("FROM alg_estimates");
    expect(calls[0].text).not.toMatch(/estimates_log/);
    expect(calls[0].text).toContain("matched_invoice_id IS NOT NULL");
    expect(calls[0].text).toContain("estimate_date >= DATE_SUB(NOW(), INTERVAL ? HOUR)");
    expect(calls[0].params).toEqual([168]);
  });

  it("withDetail adds each quote's total in dollars and booked/pending status, newest first, capped at limit", async () => {
    const { db, calls } = cannedDb(
      [{ count: 3, bookedCount: 1 }],
      [
        { amountCents: 45_000, booked: 1 },
        { amountCents: "120000", booked: 0 },
        { amountCents: 9_950, booked: "0" },
      ],
    );
    getDb.mockResolvedValue(db);
    const out = await quotesPending({ sinceHours: 720, withDetail: true, limit: 200 });
    expect(out).toEqual({
      sinceHours: 720,
      count: 3,
      bookedCount: 1,
      bookedCountIsLowerBound: true,
      quotes: [
        { grandTotal: 450, status: "booked" },
        { grandTotal: 1200, status: "pending" },
        { grandTotal: 99.5, status: "pending" },
      ],
    });
    expect(calls[1].text).toContain("FROM alg_estimates");
    expect(calls[1].text).toContain("ORDER BY estimate_date DESC LIMIT ?");
    expect(calls[1].params).toEqual([720, 200]);
  });

  it("a measured empty window is a real zero", async () => {
    const { db } = cannedDb([{ count: 0, bookedCount: 0 }]);
    getDb.mockResolvedValue(db);
    expect(await quotesPending({ sinceHours: 168 })).toEqual({ sinceHours: 168, count: 0, bookedCount: 0, bookedCountIsLowerBound: true });
  });

  // alg_estimates has no booked/status column: "booked" is only matched_invoice_id, set by the
  // matcher in services/shopDriverEstimateSync.ts. It leaves a paid quote unmatched when the phone
  // differs or has under 10 digits, the invoice is outside +/-25% or 45 days, two invoices tie, or
  // the invoice never mirrored. So bookedCount can only under-read, and the answer must say so.
  it("flags bookedCount as a lower bound, in the summary and in the detail read", async () => {
    const { db } = cannedDb([{ count: 10, bookedCount: 2 }], [{ count: 10, bookedCount: 2 }], []);
    getDb.mockResolvedValue(db);
    expect((await quotesPending({ sinceHours: 168 })).bookedCountIsLowerBound).toBe(true);
    expect((await quotesPending({ sinceHours: 720, withDetail: true })).bookedCountIsLowerBound).toBe(true);
  });

  it("no DB, or a count read that returns no row, is an error, never a zero", async () => {
    getDb.mockResolvedValue(null);
    expect(await quotesPending({ sinceHours: 168 })).toEqual({ error: expect.any(String) });
    const { db } = cannedDb([]);
    getDb.mockResolvedValue(db);
    expect(await quotesPending({ sinceHours: 168 })).toEqual({ error: expect.any(String) });
  });

  it("refuses the customer follow-up feed (ageDays / hasEmail) before any query", async () => {
    const { db } = cannedDb([{ count: 5, bookedCount: 1 }]);
    getDb.mockResolvedValue(db);
    expect(await quotesPending({ ageDays: 3, hasEmail: true })).toEqual({ error: expect.stringMatching(/recovery/) });
    expect(await quotesPending({ hasEmail: true })).toEqual({ error: expect.any(String) });
    expect(await quotesPending({ ageDays: 3 })).toEqual({ error: expect.any(String) });
    expect(db.execute).not.toHaveBeenCalled();
  });

  for (const [name, filters] of [
    ["a fractional window", { sinceHours: 1.5 }],
    ["a window as a string", { sinceHours: "168" }],
    ["a zero window", { sinceHours: 0 }],
    ["a window past two years", { sinceHours: 17_521 }],
    ["a limit over 500", { sinceHours: 720, withDetail: true, limit: 501 }],
  ] as Array<[string, Record<string, unknown>]>) {
    it(`refuses ${name} before any query`, async () => {
      const { db } = cannedDb([{ count: 5, bookedCount: 1 }]);
      getDb.mockResolvedValue(db);
      expect(await quotesPending(filters)).toEqual({ error: expect.any(String) });
      expect(db.execute).not.toHaveBeenCalled();
    });
  }
});

describe("bookings_pending_stale", () => {
  it("returns unconfirmed (status new) requests older than staleHours, in the shape the reminder rule reads", async () => {
    const { db, calls } = cannedDb([
      {
        id: 41, name: "Pat Example", phone: "2165550100", service: "Brakes",
        preferredDate: "2026-10-11", preferredTime: "morning", createdAtMs: "1791626400000",
      },
      {
        id: 42, name: "Sam Example", phone: "2165550101", service: "Tires",
        preferredDate: null, preferredTime: "no-preference", createdAtMs: 1791633600000,
      },
    ]);
    getDb.mockResolvedValue(db);
    const out = await bookingsStale({ status: "pending", staleHours: 4 });
    expect(out).toEqual({
      staleHours: 4,
      count: 2,
      bookings: [
        {
          id: "41", customerName: "Pat Example", customerPhone: "2165550100", serviceType: "Brakes",
          preferredDay: "2026-10-11", preferredTime: "morning", createdAt: "2026-10-10T10:00:00.000Z",
        },
        {
          id: "42", customerName: "Sam Example", customerPhone: "2165550101", serviceType: "Tires",
          preferredDay: null, preferredTime: "no-preference", createdAt: "2026-10-10T12:00:00.000Z",
        },
      ],
    });
    // The enum has no 'pending': an unconfirmed request is `new`. Age is SQL-side, and createdAt
    // comes back as epoch ms so no driver time-zone shift reaches the rule's hours-waiting math.
    expect(calls[0].text).toContain("FROM bookings");
    expect(calls[0].text).toContain("status = 'new'");
    expect(calls[0].text).not.toMatch(/'pending'/);
    expect(calls[0].text).toContain("createdAt < DATE_SUB(NOW(), INTERVAL ? HOUR)");
    expect(calls[0].text).toContain("createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
    expect(calls[0].text).toContain("UNIX_TIMESTAMP(createdAt) * 1000 AS createdAtMs");
    expect(calls[0].params).toEqual([4]);
  });

  it("caps the list at 50 rows, oldest first, like the other list handlers", async () => {
    const { db, calls } = cannedDb([]);
    getDb.mockResolvedValue(db);
    await bookingsStale({ staleHours: 4 });
    expect(calls[0].text).toMatch(/ORDER BY createdAt ASC LIMIT 50$/);
  });

  it("a measured empty list is a real zero; no DB is an error", async () => {
    const { db } = cannedDb([]);
    getDb.mockResolvedValue(db);
    expect(await bookingsStale({ staleHours: 4 })).toEqual({ staleHours: 4, count: 0, bookings: [] });
    getDb.mockResolvedValue(null);
    expect(await bookingsStale({ staleHours: 4 })).toEqual({ error: expect.any(String) });
  });

  for (const [name, filters] of [
    ["a missing staleHours", { status: "pending" }],
    ["a fractional staleHours", { staleHours: 2.5 }],
    ["a staleHours the 7-day window cannot hold", { staleHours: 168 }],
    ["a status other than pending", { status: "confirmed", staleHours: 4 }],
  ] as Array<[string, Record<string, unknown>]>) {
    it(`refuses ${name} before any query`, async () => {
      const { db } = cannedDb([]);
      getDb.mockResolvedValue(db);
      expect(await bookingsStale(filters)).toEqual({ error: expect.any(String) });
      expect(db.execute).not.toHaveBeenCalled();
    });
  }
});
