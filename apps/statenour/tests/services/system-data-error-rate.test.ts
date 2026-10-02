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

describe("buildErrorRateByRoute · attribution (bug-hunt 2026-10-02)", () => {
  it("errors land on their own method row, not on every method of the path; totals count each error once", async () => {
    mocks.queryRawUnsafe
      .mockResolvedValueOnce([
        { path: "/api/x", method: "GET", requests: 100, errors: 0, p50_ms: 1, p95_ms: 2, max_ms: 3 },
        { path: "/api/x", method: "POST", requests: 10, errors: 0, p50_ms: 1, p95_ms: 2, max_ms: 3 },
      ])
      .mockResolvedValueOnce([
        { path: "/api/x", method: "POST", errors: 4 },
        { path: "/api/x", method: null, errors: 1 },
        { path: "/api/quiet", method: "GET", errors: 2 },
      ]);
    const out = await buildErrorRateByRoute("24h");
    const get = out.worstByScore.find((r) => r.method === "GET")!;
    const post = out.worstByScore.find((r) => r.method === "POST")!;
    expect(post.errors).toBe(4);
    expect(get.errors).toBe(1); // the method-less error goes to the busiest row, once
    expect(out.summary.totalErrors).toBe(7); // includes the low-traffic route
    expect(out.summary.attributedErrors).toBe(5);
    expect(out.summary.overallErrorRate).toBe(Math.round((5 / 110) * 10000) / 100);
  });
});

