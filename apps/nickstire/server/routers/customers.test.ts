/**
 * customers.stats (contract v2, 2026-10-25).
 *
 * 1. A dead database handle returned ALL ZEROS, which the Customers tab
 *    rendered as "0 customers". It is now SERVICE_UNAVAILABLE.
 * 2. lapsedRegulars: the same people the Customers insight banner counts
 *    (3+ visits, last visit 90 to 365 days ago) and how many of them can be
 *    texted, so every audience shows its contactable count beside it.
 * 3. Every count is a number: mysql2 returns COUNT/SUM as strings.
 *
 * The real drizzle builder runs over a fake mysql2 client.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";

const h = vi.hoisted(() => ({ queries: [] as string[], db: null as unknown }));

const fakeClient = {
  query: vi.fn(async (q: { sql: string } | string) => {
    const text = typeof q === "string" ? q : q.sql;
    h.queries.push(text);
    if (/sms_preferences/.test(text)) return [[["9"]], []];
    if (/COALESCE\(SUM/.test(text)) return [[["120000", "4500", "2119", "169"]], []];
    if (/`totalVisits` >= 3/.test(text) && /INTERVAL 90 DAY/.test(text)) return [[["12"]], []];
    return [[["5"]], []];
  }),
};
const realDrizzle = drizzle(fakeClient as never);

vi.mock("../db", () => ({ getDb: async () => null, getDbTyped: async () => h.db }));

import { customersRouter } from "./customers";

function ctx(role: "admin" | "user" = "admin") {
  return {
    user: {
      id: 1, openId: `${role}-user`, email: `${role}@nickstire.com`, name: role, loginMethod: "manus",
      role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never;
}
const stats = (role: "admin" | "user" = "admin") => customersRouter.createCaller(ctx(role)).stats();

beforeEach(() => {
  h.queries = [];
  h.db = realDrizzle;
});

describe("customers.stats", () => {
  it("returns lapsedRegulars with the qualifying and the textable count", async () => {
    const out = await stats();
    expect(out.lapsedRegulars).toEqual({ qualifying: 12, contactable: 9 });
  });

  it("keeps every existing field, each a number (mysql2 hands counts back as strings)", async () => {
    const out = await stats();
    expect(out).toMatchObject({
      total: 5, recent: 5, lapsed: 5, unknown: 5, withEmail: 5, commercial: 5,
      totalRevenue: 120000, avgSpend: 4500, withVisits: 2119, vipCount: 169,
    });
  });

  it("vipCount uses the shared 3+ visit rule", async () => {
    await stats();
    const revenue = h.queries.find((q) => /COALESCE\(SUM/.test(q));
    expect(revenue).toContain("`customers`.`totalVisits` >= 3");
  });

  it("a dead database handle is SERVICE_UNAVAILABLE, never a page of zeros", async () => {
    h.db = null;
    await expect(stats()).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("is admin only", async () => {
    await expect(stats("user")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
