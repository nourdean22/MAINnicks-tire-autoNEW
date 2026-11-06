/**
 * Shop pulse's "this week" is the last 7 shop days, the same window revenue_range reads.
 *
 * 2026-11-06 audit: shop_pulse said $12,356.46 and revenue_range said $12,148.84 "for the same
 * week". Prod read: shop_pulse compared invoiceDate (the shop's day as stored) with a rolling
 * NOW() - 7 days UTC instant, so it pulled in $279.35 of the eighth day back; its paid filter
 * dropped a $71.73 pending manual invoice. The window is the defect; the paid filter is the
 * card's meaning (paid sales) and stays.
 *
 * The db records each select's WHERE; the assertion is on the bound values, rendered with the
 * MySQL dialect, at 2026-11-06 23:32Z (18:32 ET).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

const h = vi.hoisted(() => {
  const wheres: unknown[] = [];
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = (w: unknown) => { wheres.push(w); return c; };
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve([]).then(res, rej);
    return c;
  };
  return { wheres, db: { select: () => chain() } };
});

vi.mock("./lib/db-helper", () => ({ db: async () => h.db }));

function invoiceParams(): unknown[][] {
  return h.wheres
    .map((w) => new MySqlDialect().sqlToQuery(w as SQL))
    .filter((r) => /invoiceDate/.test(r.sql))
    .map((r) => r.params);
}

beforeEach(() => {
  h.wheres.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T23:32:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("getShopPulse week window", () => {
  it("this week starts at the shop day six days before today, as a date key", async () => {
    const { getShopPulse } = await import("./services/nickIntelligence");
    await getShopPulse();
    const params = invoiceParams();
    // CONTROL: the instrument saw both invoice reads (today and the week).
    expect(params).toHaveLength(2);
    expect(params[0]).toContain("2026-11-06");
    expect(params[1]).toContain("2026-10-31");
    expect(params[1].some((p) => p instanceof Date || /\d{2}:\d{2}:\d{2}/.test(String(p)))).toBe(false);
  });

  it("the week's estimate leads start at the same shop day, Eastern midnight as an instant (Codex P2, PR 3562)", async () => {
    const { getShopPulse } = await import("./services/nickIntelligence");
    await getShopPulse();
    const leadReads = h.wheres
      .map((w) => new MySqlDialect().sqlToQuery(w as SQL))
      .filter((r) => /recommendedService/.test(r.sql));
    // CONTROL: today's and the week's estimate reads were both seen.
    expect(leadReads).toHaveLength(2);
    // createdAt is a real instant: Oct 31 2026 00:00 EDT = 04:00Z. walkRate divides the week's jobs by these leads.
    const weekBound = leadReads[1].params.find((p) => p instanceof Date) as Date | undefined;
    expect(weekBound?.toISOString()).toBe("2026-10-31T04:00:00.000Z");
  });
});
