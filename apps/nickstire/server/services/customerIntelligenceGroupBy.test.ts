/**
 * The 90-day booking-pattern read groups on what it selects (2026-10-20).
 *
 * Prod TiDB runs ONLY_FULL_GROUP_BY. Drizzle renders `${bookings.createdAt}` unqualified in the select
 * list of a single-table query (`createdAt`) but qualified inside GROUP BY (`bookings`.`createdAt`), so
 * grouping by the same sql`` fragments sent TiDB two different expressions and it rejected the query
 * (ER_WRONG_FIELD_WITH_GROUP, 1055) on every run since the 2026-10-09 shop-clock change. The catch turned
 * that into bookingPatternsUnavailable, so every brief said "booking patterns unavailable".
 *
 * A stub of the drizzle chain hands back whatever the test chose and can never see this. The test drives
 * the REAL drizzle MySQL builder over a fake mysql2 client that records the SQL it is sent
 * (campaignStatsNumeric.test.ts precedent) and asserts the rendered GROUP BY resolves to the select list.
 * The same rule is run against the ribbon-photo query (Sentry NICKSTIRE-1, fixed 2026-09-08 another way).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// This file needs the REAL drizzle builder, schema and subject; another file's mock must not leak in (AGENTS.md section 3).
// Specifiers are the ones the subject and router resolve, relative to this file. ../lib/db-helper stays mocked below on purpose.
vi.unmock("drizzle-orm/mysql2");
vi.unmock("drizzle-orm");
vi.unmock("../../drizzle/schema");
vi.unmock("../lib/customer-segments");
vi.unmock("./customerIntelligence");
vi.unmock("../routers/admin/customerEvents");

import { drizzle } from "drizzle-orm/mysql2";

const h = vi.hoisted(() => ({ sent: [] as string[] }));

const fakeClient = {
  query: async (q: { sql: string } | string) => {
    const text = typeof q === "string" ? q : q.sql;
    h.sent.push(text);
    // mysql2 with rowsAsArray: positional values per row.
    if (/from `bookings`/i.test(text)) return [[[3, 10, 2], [5, 14, 1]], []]; // DAYOFWEEK (1=Sun), HOUR, COUNT(*)
    if (/from `customer_events`/i.test(text)) return [[["/img/a.jpg", 4]], []]; // photo src, COUNT(*)
    return [[], []];
  },
};
const realDrizzle = drizzle(fakeClient as never);

vi.mock("../lib/db-helper", () => ({
  db: async () => realDrizzle,
  dbTyped: async () => realDrizzle,
  requireDb: async () => realDrizzle,
}));

import { analyzeCustomers } from "./customerIntelligence";
import { customerEventsRouter } from "../routers/admin/customerEvents";
import type { TrpcContext } from "../_core/context";

afterEach(() => {
  h.sent.length = 0;
});

/** Split on commas outside parentheses. shortcut: no quote handling; this select's literals hold no commas or parens. */
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * What each GROUP BY item means to ONLY_FULL_GROUP_BY: an ordinal is the select item it points at, anything
 * else stands for its own text. The result must equal the select list's non-aggregate items.
 */
function groupedItems(text: string): { grouped: string[]; wanted: string[] } {
  const m = /^select\s+(.+?)\s+from\s+`\w+`\s.*\bgroup by\s+(.+?)(?:\s+(?:order by|having|limit)\b.*)?$/is.exec(text);
  if (!m) throw new Error(`not a grouped select: ${text}`);
  const select = splitTopLevel(m[1]);
  const grouped = splitTopLevel(m[2]).map((g) => (/^\d+$/.test(g) ? (select[Number(g) - 1] ?? `ordinal ${g} is out of range`) : g));
  return { grouped, wanted: select.filter((s) => !/^COUNT\(/i.test(s)) };
}

const CONVERT = "CONVERT_TZ(%, '+00:00', 'America/New_York')";
const expr = (fn: string, col: string) => `${fn}(${CONVERT.replace("%", col)})`;
const SELECT = `select ${expr("DAYOFWEEK", "`createdAt`")}, ${expr("HOUR", "`createdAt`")}, COUNT(*) from \`bookings\` where \`bookings\`.\`createdAt\` >= ?`;

describe("the checker itself: it fires on the logged prod failure and accepts both correct shapes", () => {
  it("flags unqualified SELECT columns grouped by qualified ones (the Railway-logged SQL)", () => {
    const bad = `${SELECT} group by ${expr("DAYOFWEEK", "`bookings`.`createdAt`")}, ${expr("HOUR", "`bookings`.`createdAt`")}`;
    const { grouped, wanted } = groupedItems(bad);
    expect(grouped).not.toEqual(wanted);
  });

  it("accepts GROUP BY ordinals", () => {
    const { grouped, wanted } = groupedItems(`${SELECT} group by 1, 2`);
    expect(grouped).toEqual(wanted);
  });

  it("accepts expressions that match the select list verbatim, and rejects an ordinal onto the aggregate", () => {
    const same = `${SELECT} group by ${expr("DAYOFWEEK", "`createdAt`")}, ${expr("HOUR", "`createdAt`")}`;
    expect(groupedItems(same).grouped).toEqual(groupedItems(same).wanted);
    const { grouped, wanted } = groupedItems(`${SELECT} group by 1, 3`);
    expect(grouped).not.toEqual(wanted);
  });
});

describe("analyzeCustomers · booking patterns on a ONLY_FULL_GROUP_BY database", () => {
  it("renders a GROUP BY that resolves to the day and hour it selects", async () => {
    const r = await analyzeCustomers();

    const bookingSql = h.sent.filter((s) => /from `bookings`/i.test(s));
    expect(bookingSql).toHaveLength(1);
    const { grouped, wanted } = groupedItems(bookingSql[0]);
    expect(wanted).toHaveLength(2);
    expect(grouped).toEqual(wanted);

    // The buckets still flow through to the brief's inputs: Tue 10:00 x2, Thu 14:00 x1.
    expect(r.bookingPatternsUnavailable).toBeUndefined();
    expect(r.dayOfWeekPattern).toEqual([0, 0, 2, 0, 1, 0, 0]);
    expect(r.peakHours[10]).toBe(2);
    expect(r.peakHours[14]).toBe(1);
  });
});

describe("customerEvents.topRibbonPhotosPublic · the same rule on the NICKSTIRE-1 query", () => {
  // market-and-ribbon-public.test.ts pins a replica of this query plus source regexes; this runs the shipped one.
  it("renders a GROUP BY that resolves to the photo src it selects", async () => {
    const ctx = { user: null, req: { protocol: "https", headers: {} }, res: {} } as unknown as TrpcContext;
    // days/limit values no other test uses: the router keeps a 5-minute in-process cache per (days, limit).
    const rows = await customerEventsRouter.createCaller(ctx).topRibbonPhotosPublic({ days: 29, limit: 17 });

    const ribbonSql = h.sent.filter((s) => /from `customer_events`/i.test(s));
    expect(ribbonSql).toHaveLength(1);
    const { grouped, wanted } = groupedItems(ribbonSql[0]);
    expect(wanted).toHaveLength(1);
    expect(grouped).toEqual(wanted);

    expect(rows).toEqual([{ src: "/img/a.jpg", count: 4 }]);
  });
});
