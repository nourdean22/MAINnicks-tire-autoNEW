/**
 * The admin dashboard's shop-floor day, week and month start at Eastern midnight.
 *
 * - "today" was already built from clevelandDayStart(), so the day-start test below
 *   is a regression guard: green before and after the fix.
 * - the month start came from the Node process zone (new Date(y, m, 1)), not Eastern.
 *   Red before the fix, because the process zone is pinned to UTC here.
 * - the week started now minus 168 hours at the current time of day, 21 hours
 *   off statenour's week start. Red before the fix.
 *
 * Every assertion reads the instant that would be bound into the query. The process
 * zone is pinned to UTC, so the process-zone bugs show on any machine.
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

/** The string values bound into the dashboard's where-clauses: the shop's date keys for invoice and estimate dates. */
function boundStrings(): string[] {
  return h.state.wheres
    .flatMap((w) => new MySqlDialect().sqlToQuery(w as SQL).params)
    .filter((p): p is string => typeof p === "string");
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
  it("binds the shop's day as its date key, so the 21:00 ET invoice counts on Oct 12 and no UTC midnight appears", async () => {
    const { getDashboardStats } = await import("./admin-stats");
    await getDashboardStats();
    expect(boundStrings()).toContain("2026-10-12");
    expect(boundInstants()).not.toContain("2026-10-12T00:00:00.000Z");
  });

  it("uses the winter offset too: the week start of a January shop day is Eastern midnight, 05:00Z", async () => {
    vi.setSystemTime(new Date("2026-01-15T02:00:00Z")); // 21:00 EST on 2026-01-14
    const { getDashboardStats } = await import("./admin-stats");
    await getDashboardStats();
    // The leads and bookings week start is bound as UTC text: seven shop days back from Jan 14 is Jan 7.
    expect(rawSelectParams()).toContain("2026-01-07 05:00:00");
  });

  it("binds the shop's month as its date key on the 1st, so no process zone can move the invoice month", async () => {
    const { getDashboardStats } = await import("./admin-stats");
    await getDashboardStats();
    // invoices.invoiceDate and alg_estimates.estimateDate hold the shop's day as stored: a date key.
    expect(boundStrings()).toContain("2026-10-01");
    expect(boundInstants()).not.toContain("2026-10-01T00:00:00.000Z");
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

  it("binds the week's start as the seven-days-back date key for invoices, not now minus 168 hours", async () => {
    const { getDashboardStats } = await import("./admin-stats");
    await getDashboardStats();
    expect(boundStrings()).toContain("2026-10-05");
    expect(boundInstants()).not.toContain("2026-10-06T01:00:00.000Z");
  });

  it("binds the raw week start in the bookings and leads CASE WHEN aggregates as UTC text, not a Date", async () => {
    const { getDashboardStats } = await import("./admin-stats");
    await getDashboardStats();
    // The thisWeek aggregates are raw sql(): a bound Date is formatted by mysql2 in the
    // process zone, so the bind must be the UTC "YYYY-MM-DD HH:MM:SS" text of the instant.
    const rawParams = h.state.selectFields
      .flatMap((fields) => Object.values(fields as Record<string, unknown>))
      .filter((f): f is SQL => typeof f === "object" && f !== null && "queryChunks" in f)
      .flatMap((f) => new MySqlDialect().sqlToQuery(f).params);
    expect(rawParams.filter((p) => p instanceof Date)).toEqual([]);
    expect(rawParams.filter((p) => p === "2026-10-05 04:00:00")).toHaveLength(2);
  });
});
