/**
 * customerStatsRead -- the `customer_stats` bridge action. StateNour's dashboard summary called
 * it for months and nickstire never registered it (400 on every call). Pins what the consumer
 * depends on: the counts arrive as numbers, "new this month" is the shop's calendar month in
 * New York (not UTC, not record age), an unreadable database THROWS so the bridge answers 500
 * (never a 200 of zeros), and the action is registered where StateNour's contract test looks.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const getDb = vi.fn();
vi.mock("../db", () => ({ getDb: () => getDb() }));

import { readCustomerStats } from "./customerStatsRead";
import { QUERY_HANDLERS } from "../routes/nour-os-query";

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

function fakeDb(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const execute = vi.fn(async (q: { queryChunks: unknown[] }) => {
    calls.push(flat(q));
    return [rows];
  });
  return { db: { execute }, calls };
}

afterEach(() => {
  vi.clearAllMocks();
});

/** The month window the read actually sends, and the monthStart it reports, at `now`. */
async function monthWindowAt(now: Date): Promise<{ params: unknown[]; monthStart: string }> {
  const { db, calls } = fakeDb([{ total: 1, newThisMonth: 0 }]);
  const out = await readCustomerStats(db as never, now);
  return { params: calls[0].params, monthStart: out.monthStart };
}

describe("the shop month counted", () => {
  it("is the calendar month in New York", async () => {
    expect(await monthWindowAt(new Date("2026-10-15T16:00:00Z"))).toEqual({
      params: ["2026-10-01", "2026-11-01"],
      monthStart: "2026-10-01",
    });
  });
  it("late on the last evening of a month is still THAT month in New York, though UTC has rolled over", async () => {
    // 23:30 EDT on Oct 31 = 03:30Z Nov 1.
    expect((await monthWindowAt(new Date("2026-11-01T03:30:00Z"))).params).toEqual(["2026-10-01", "2026-11-01"]);
  });
  it("rolls December into January of the next year", async () => {
    expect((await monthWindowAt(new Date("2026-12-20T15:00:00Z"))).params).toEqual(["2026-12-01", "2027-01-01"]);
  });
  it("holds across the standard-time boundary (23:30 EST on Feb 28 = 04:30Z Mar 1)", async () => {
    expect((await monthWindowAt(new Date("2027-03-01T04:30:00Z"))).params).toEqual(["2027-02-01", "2027-03-01"]);
  });
});

describe("readCustomerStats", () => {
  const NOW = new Date("2026-10-08T19:00:00Z");

  it("counts customers on file and FIRST visits inside the shop month", async () => {
    const { db, calls } = fakeDb([{ total: "1843", newThisMonth: "17" }]);
    const out = await readCustomerStats(db as never, NOW);
    expect(out).toEqual({
      total: 1843,
      newThisMonth: 17,
      monthStart: "2026-10-01",
      newThisMonthMeans: expect.stringMatching(/first invoice.*America\/New_York/),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("FROM customers");
    expect(calls[0].text).toContain("firstVisitDate >= ? AND firstVisitDate < ?");
    expect(calls[0].text).not.toMatch(/createdAt/);
    expect(calls[0].params).toEqual(["2026-10-01", "2026-11-01"]);
  });

  it("reads zero first visits as zero, not as missing", async () => {
    const { db } = fakeDb([{ total: 5, newThisMonth: 0 }]);
    expect((await readCustomerStats(db as never, NOW)).newThisMonth).toBe(0);
  });

  it("THROWS when the database is unavailable: a 200 of zeros would read as an empty shop", async () => {
    await expect(readCustomerStats(null, NOW)).rejects.toThrow(/unavailable/);
  });

  it("throws on an empty result and on a non-numeric count", async () => {
    await expect(readCustomerStats(fakeDb([]).db as never, NOW)).rejects.toThrow(/no row/);
    await expect(readCustomerStats(fakeDb([{ total: "x", newThisMonth: 1 }]).db as never, NOW)).rejects.toThrow(/not a number/);
  });
});

describe("the customer_stats bridge action", () => {
  it("is registered in the handler map StateNour's contract test reads", () => {
    expect(typeof QUERY_HANDLERS.customer_stats).toBe("function");
  });

  it("answers with the counts through the real handler", async () => {
    const { db } = fakeDb([{ total: 3, newThisMonth: 1 }]);
    getDb.mockResolvedValue(db);
    const out = (await QUERY_HANDLERS.customer_stats({})) as { total: number; newThisMonth: number };
    expect(out.total).toBe(3);
    expect(out.newThisMonth).toBe(1);
  });

  it("rejects when the database is down, so the route answers 500 instead of zeros", async () => {
    getDb.mockResolvedValue(null);
    await expect(QUERY_HANDLERS.customer_stats({})).rejects.toThrow(/unavailable/);
  });
});
