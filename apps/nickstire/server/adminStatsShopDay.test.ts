/**
 * The admin dashboard's shop day, week and month.
 *
 * - invoices.invoiceDate and alg_estimates.estimateDate hold the shop's day as stored, so the
 *   dashboard binds the shop's date keys for them. Each query is checked against its own position
 *   in the query order, so reverting any one bind fails its own assertion.
 * - the leads and bookings week starts are real instants, bound as UTC text in raw sql() select
 *   fields. Those are checked as the UTC text of Eastern midnight.
 *
 * The process zone is pinned to UTC, so a process-zone bug shows on any machine.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

const h = vi.hoisted(() => {
  const state = { wheres: [] as unknown[], executed: [] as unknown[], selectFields: [] as unknown[] };
  const chain = (rows: unknown[] = []) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "orderBy", "limit", "groupBy", "leftJoin", "innerJoin", "having"]) {
      c[m] = () => c;
    }
    c.where = (w: unknown) => {
      state.wheres.push(w);
      return c;
    };
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej);
    return c;
  };
  const db = {
    select: (fields?: unknown) => {
      if (fields) state.selectFields.push(fields);
      return chain();
    },
    execute: async (q: unknown) => {
      state.executed.push(q);
      return [[]];
    },
    update: () => ({ set: () => ({ where: async () => ({ affectedRows: 0 }) }) }),
    insert: () => ({ values: async () => ({ insertId: 0 }) }),
  };
  return { state, db };
});

// Installed for this file only: beforeAll adds the mocks and afterAll removes them, so under singleFork
// they cannot stay in the shared process for later files (the same pattern as shopDayWindows.test.ts).
const MOCKS: Array<[string, () => unknown]> = [
  ["./db", () => ({ getDb: async () => h.db })],
  ["./services/telegram", () => ({
    sendTelegram: async () => undefined,
    sendTelegramMessage: async () => undefined,
  })],
];

beforeAll(() => {
  for (const [modulePath, factory] of MOCKS) vi.doMock(modulePath, factory);
});

afterAll(() => {
  for (const [modulePath] of MOCKS) vi.doUnmock(modulePath);
  vi.resetModules();
});

/** A bound value as an instant. The driver may hand back a Date or a UTC "YYYY-MM-DD HH:MM:SS" string. */
function asInstant(p: unknown): Date | null {
  if (p instanceof Date) return p;
  if (typeof p === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(p)) {
    return new Date(`${p.replace(" ", "T")}Z`);
  }
  return null;
}

let savedTz: string | undefined;

beforeEach(() => {
  h.state.wheres = [];
  h.state.executed = [];
  h.state.selectFields = [];
  vi.resetModules();
  savedTz = process.env.TZ;
  process.env.TZ = "UTC"; // the process zone is not the shop's; pin it so the bugs show
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T01:00:00Z")); // 21:00 ET on 2026-10-12
});

afterEach(() => {
  vi.useRealTimers();
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

/** Each where-clause in query order, rendered with the values it binds. */
function renderedWheres(): Array<{ sql: string; params: unknown[] }> {
  return h.state.wheres.map((w) => new MySqlDialect().sqlToQuery(w as SQL));
}

/** The shop-day date keys bound by each where-clause that matches the column comparison, in query order. */
function dateKeysBy(columnPattern: RegExp): string[][] {
  return renderedWheres()
    .filter((w) => columnPattern.test(w.sql))
    .map((w) => w.params.filter((p): p is string => typeof p === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p)));
}

/** The values bound into the raw sql() select fields (the CASE WHEN week aggregates), as UTC text. */
function rawSelectParams(): unknown[] {
  return h.state.selectFields
    .flatMap((fields) => Object.values(fields as Record<string, unknown>))
    .filter((f): f is SQL => typeof f === "object" && f !== null && "queryChunks" in f)
    .flatMap((f) => new MySqlDialect().sqlToQuery(f).params);
}

/** The instants bound into the dashboard's where-clauses, as ISO strings. */
function boundInstants(): string[] {
  return h.state.wheres
    .flatMap((w) => new MySqlDialect().sqlToQuery(w as SQL).params)
    .map(asInstant)
    .filter((d): d is Date => d !== null)
    .map((d) => d.toISOString());
}

describe("getDashboardStats · the shop's day, week and month", () => {
  // The invoice counts and revenue run in this order: today, week, month, then the same three for revenue.
  it("binds each invoice query its own shop-day key, so the 21:00 ET invoice counts on Oct 12", async () => {
    const { getDashboardStats } = await import("./admin-stats");
    await getDashboardStats();
    expect(dateKeysBy(/invoiceDate`\s*>=\s*\?/)).toEqual([
      ["2026-10-12"], ["2026-10-05"], ["2026-10-01"],
      ["2026-10-12"], ["2026-10-05"], ["2026-10-01"],
    ]);
    expect(boundInstants()).not.toContain("2026-10-12T00:00:00.000Z");
  });

  // Order: today, week, month, matched month, unmatched month, unmatched value.
  it("binds each estimate query its own shop-day key, so an estimate date never becomes an instant", async () => {
    const { getDashboardStats } = await import("./admin-stats");
    await getDashboardStats();
    expect(dateKeysBy(/estimate_date`\s*>=\s*\?/)).toEqual([
      ["2026-10-12"], ["2026-10-05"], ["2026-10-01"], ["2026-10-01"], ["2026-10-01"], ["2026-10-01"],
    ]);
  });

  it("binds the shop's month key into the raw payment-method query, the same population as revenue", async () => {
    const { getDashboardStats } = await import("./admin-stats");
    await getDashboardStats();
    const raw = h.state.executed
      .map((q) => new MySqlDialect().sqlToQuery(q as SQL))
      .find((r) => /GROUP BY paymentMethod/.test(r.sql));
    // invoiceDate is the shop's day as stored, so the raw bind is the date key, never a Date.
    expect(raw?.params).toEqual(["2026-10-01"]);
  });

  it("uses the winter offset for the createdAt week start: seven shop days back from Jan 14 is Jan 7, 05:00Z", async () => {
    vi.setSystemTime(new Date("2026-01-15T02:00:00Z")); // 21:00 EST on 2026-01-14
    const { getDashboardStats } = await import("./admin-stats");
    await getDashboardStats();
    // The leads and bookings week start is bound as UTC text in the raw CASE WHEN aggregates.
    expect(rawSelectParams()).toContain("2026-01-07 05:00:00");
  });

  it("binds the raw week start in the bookings and leads CASE WHEN aggregates as UTC text, not a Date", async () => {
    const { getDashboardStats } = await import("./admin-stats");
    await getDashboardStats();
    // The thisWeek aggregates are raw sql(): a bound Date is formatted by mysql2 in the
    // process zone, so the bind must be the UTC "YYYY-MM-DD HH:MM:SS" text of the instant.
    const rawParams = rawSelectParams();
    expect(rawParams.filter((p) => p instanceof Date)).toEqual([]);
    expect(rawParams.filter((p) => p === "2026-10-05 04:00:00")).toHaveLength(2);
  });
});
