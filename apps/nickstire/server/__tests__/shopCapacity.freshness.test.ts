/**
 * conversion.shopCapacity "cars in shop right now" must mean today.
 *
 * Upgrade scout 2026-10-22: the count read work_orders touched in the last
 * 7 DAYS, so a job left in_progress last Thursday rendered on the public
 * UrgencyWidget as a car in the shop right now. The count is bounded to the
 * shop day in SQL (driver-parsed timestamps shift on ET), the same window
 * the todayBookings read beside it already used.
 */
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const h = vi.hoisted(() => ({ queries: [] as unknown[] }));

vi.mock("../lib/cache", () => ({ cached: async (_k: string, _t: number, fn: () => Promise<unknown>) => fn() }));
vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const fake = {
    execute: async (q: unknown) => {
      h.queries.push(q);
      return [[{ cnt: 0 }], []];
    },
  };
  return { ...actual, getDb: async () => fake };
});

import { conversionRouter } from "../routers/conversion";
import { minutesSinceShopMidnight } from "../lib/timezoneAssert";

const ctx = { user: null, req: { headers: {}, ip: "127.0.0.1" }, res: {} } as unknown as TrpcContext;
const NOW = new Date("2026-10-20T15:00:00Z"); // Tuesday 11:00 ET

describe("conversion.shopCapacity live counts are today-only", () => {
  beforeEach(() => {
    h.queries.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("bounds the active work_orders count to the shop day, not 7 days", async () => {
    await conversionRouter.createCaller(ctx).shopCapacity();
    const wo = h.queries
      .map((q) => new MySqlDialect().sqlToQuery(q as SQL))
      .find((q) => /FROM work_orders/.test(q.sql));
    expect(wo, "the work_orders read ran").toBeDefined();
    expect(wo!.sql).not.toMatch(/INTERVAL 7 DAY/);
    expect(wo!.sql).toMatch(/>= NOW\(\) - INTERVAL \? MINUTE/);
    expect(wo!.params).toContain(minutesSinceShopMidnight(NOW));
  });
});
