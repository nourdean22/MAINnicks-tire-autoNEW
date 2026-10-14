/**
 * The admin dashboard's shop-floor day, week and month start at Eastern midnight.
 *
 * - "today" was already built from clevelandDayStart(), so the day-start test below
 *   is a regression guard: green before and after the fix.
 * - the month start came from the Node process zone (new Date(y, m, 1)), not Eastern.
 *   Red before the fix, because the process zone is pinned to UTC here.
 * - the week started now minus 168 hours at the current time of day, about 18 hours
 *   off statenour's week start. Red before the fix.
 *
 * Every assertion reads the instant that would be bound into the query. The process
 * zone is pinned to UTC, so the process-zone bugs show on any machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

const h = vi.hoisted(() => {
  const state = { wheres: [] as unknown[], executed: [] as unknown[] };
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
    select: () => chain(),
    execute: async (q: unknown) => {
      state.executed.push(q);
      return [[]];
    },
    update: () => ({ set: () => ({ where: async () => ({ affectedRows: 0 }) }) }),
    insert: () => ({ values: async () => ({ insertId: 0 }) }),
  };
  return { state, db };
});

vi.mock("./db", () => ({ getDb: async () => h.db }));
vi.mock("./services/telegram", () => ({
  sendTelegram: async () => undefined,
  sendTelegramMessage: async () => undefined,
}));

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

/** The instants bound into the dashboard's where-clauses, as ISO strings. */
function boundInstants(): string[] {
  return h.state.wheres
    .flatMap((w) => new MySqlDialect().sqlToQuery(w as SQL).params)
    .map(asInstant)
    .filter((d): d is Date => d !== null)
    .map((d) => d.toISOString());
}

describe("getDashboardStats · the shop's day, week and month", () => {
  it("starts the shop's day at Eastern midnight (04:00Z in October), not 20:00 ET the day before", async () => {
    const { getDashboardStats } = await import("./admin-stats");
    await getDashboardStats();
    expect(boundInstants()).toContain("2026-10-12T04:00:00.000Z");
    expect(boundInstants()).not.toContain("2026-10-12T00:00:00.000Z");
  });

  it("uses the winter offset too: Eastern midnight is 05:00Z in January", async () => {
    vi.setSystemTime(new Date("2026-01-15T02:00:00Z")); // 21:00 EST on 2026-01-14
    const { getDashboardStats } = await import("./admin-stats");
    await getDashboardStats();
    expect(boundInstants()).toContain("2026-01-14T05:00:00.000Z");
  });

  it("starts the shop's month at Eastern midnight on the 1st, not the process zone's midnight", async () => {
    const { getDashboardStats } = await import("./admin-stats");
    await getDashboardStats();
    expect(boundInstants()).toContain("2026-10-01T04:00:00.000Z");
    expect(boundInstants()).not.toContain("2026-10-01T00:00:00.000Z");
  });

  it("binds the same month start into the raw payment-method query as UTC text, not a date string or a Date", async () => {
    const { getDashboardStats } = await import("./admin-stats");
    await getDashboardStats();
    const raw = h.state.executed
      .map((q) => new MySqlDialect().sqlToQuery(q as SQL))
      .find((r) => /GROUP BY paymentMethod/.test(r.sql));
    // Raw sql() formats a Date in the process zone, so the bind is the UTC text of the instant.
    expect(raw?.params).toEqual(["2026-10-01 04:00:00"]);
  });

  it("starts the week at Eastern midnight seven days back, not now minus 168 hours", async () => {
    const { getDashboardStats } = await import("./admin-stats");
    await getDashboardStats();
    expect(boundInstants()).toContain("2026-10-05T04:00:00.000Z");
    expect(boundInstants()).not.toContain("2026-10-06T01:00:00.000Z");
  });
});
