/**
 * The admin dashboard's shop-floor "today" starts at Eastern midnight.
 *
 * It was built from new Date("YYYY-MM-DD"), which is UTC midnight of the Eastern
 * date: 20:00 ET the day before. Every "today" total on the Shop Floor card was
 * therefore four hours of yesterday too wide, and five hours in winter. The
 * assertion below reads the instant that would be bound into the invoice filter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

const h = vi.hoisted(() => {
  const state = { wheres: [] as unknown[] };
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
    execute: async () => [[]],
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

beforeEach(() => {
  h.state.wheres = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T01:00:00Z")); // 21:00 ET on 2026-10-12
});

afterEach(() => {
  vi.useRealTimers();
});

/** The instants bound into the dashboard's queries, as ISO strings. */
function boundInstants(): string[] {
  return h.state.wheres
    .flatMap((w) => new MySqlDialect().sqlToQuery(w as SQL).params)
    .map(asInstant)
    .filter((d): d is Date => d !== null)
    .map((d) => d.toISOString());
}

describe("getDashboardStats · shop-floor today", () => {
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
});
