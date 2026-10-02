/**
 * tests/services/system-data-error-rate.test.ts · 2026-10-02 · full-circle wave 2
 *
 * `buildErrorRateByRoute` bound its window as an ISO STRING into two
 * `$queryRawUnsafe` calls comparing `created_at >= $1`. Postgres has no
 * `timestamp >= text` operator (SQLSTATE 42883), so every call failed and the
 * card rendered "unmeasured — the read failed" for its whole life under
 * Settings > Diagnostics. Found on the hermetic e2e stack when the card moved to
 * /system/health. Pinned: both queries receive a Date, and the result shape
 * survives an empty window.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRawUnsafe: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRawUnsafe: (...a: unknown[]) => mocks.queryRawUnsafe(...a) },
}));

import { buildErrorRateByRoute } from "@/lib/services/system-data";

beforeEach(() => {
  mocks.queryRawUnsafe.mockReset();
  mocks.queryRawUnsafe.mockResolvedValue([]);
});

describe("buildErrorRateByRoute", () => {
  it("binds the window as a Date in BOTH raw queries — a string here is the 42883 that hid the card", async () => {
    await buildErrorRateByRoute("24h", 5);
    expect(mocks.queryRawUnsafe).toHaveBeenCalledTimes(2);
    for (const call of mocks.queryRawUnsafe.mock.calls) {
      const [sql, since] = call as [string, unknown, ...unknown[]];
      expect(sql).toMatch(/created_at >= \$1/);
      expect(since).toBeInstanceOf(Date);
    }
    const [, , minReq] = mocks.queryRawUnsafe.mock.calls[0] as [string, Date, number];
    expect(minReq).toBe(5);
  });

  it("an empty window is a measured zero, not a failure", async () => {
    const out = await buildErrorRateByRoute("24h");
    expect(out.summary.totalErrors).toBe(0);
    expect(out.worstByScore).toEqual([]);
  });

  it("MUTATION — the window actually moves with the range", async () => {
    const before = Date.now();
    await buildErrorRateByRoute("7d");
    const [, since] = mocks.queryRawUnsafe.mock.calls[0] as [string, Date];
    const hoursBack = (before - since.getTime()) / 3_600_000;
    expect(hoursBack).toBeGreaterThan(24 * 7 - 0.01);
    expect(hoursBack).toBeLessThan(24 * 7 + 0.1);
  });
});
