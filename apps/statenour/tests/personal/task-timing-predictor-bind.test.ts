/**
 * tests/personal/task-timing-predictor-bind.test.ts · 2026-10-02
 *
 * `predictBestHoursForTask` bound its 90-day window as an ISO string into a
 * raw query comparing `"updatedAt" >= $1`; Postgres has no `timestamp >= text`
 * operator (42883) and the swallowing `.catch(() => [])` made every call read
 * as "no completions yet". Same defect, same day, as system-data's error-rate
 * query. Pinned: the window is a Date, and a swallowed failure is still visible
 * as the insufficient-history shape rather than a crash.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRawUnsafe: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRawUnsafe: (...a: unknown[]) => mocks.queryRawUnsafe(...a) },
}));

import { predictBestHoursForTask } from "@/lib/personal/task-timing-predictor";

beforeEach(() => {
  mocks.queryRawUnsafe.mockReset();
});

describe("predictBestHoursForTask · the window bind", () => {
  it("binds the 90-day window as a Date, never as text", async () => {
    mocks.queryRawUnsafe.mockResolvedValue([]);
    await predictBestHoursForTask({ loopKind: null, context: null, effort: null });
    expect(mocks.queryRawUnsafe).toHaveBeenCalledTimes(1);
    const [sql, since] = mocks.queryRawUnsafe.mock.calls[0] as [string, unknown];
    expect(sql).toMatch(/"updatedAt" >= \$1/);
    expect(since).toBeInstanceOf(Date);
    const daysBack = (Date.now() - (since as Date).getTime()) / 86_400_000;
    expect(daysBack).toBeGreaterThan(89.99);
    expect(daysBack).toBeLessThan(90.01);
  });

  it("a failed read is the insufficient-history shape with sample size 0, not a throw", async () => {
    mocks.queryRawUnsafe.mockRejectedValue(new Error("operator does not exist"));
    const out = await predictBestHoursForTask({});
    expect(out).toMatchObject({ topHours: [], totalSampleSize: 0 });
  });
});
