/**
 * A run's recorded duration is WORK time, not wall clock.
 *
 * Audit 2026-10-10 (14-live-crons item 4): operator-morning-brief recorded
 * 2,108,280 ms on /system/crons. 2,100,000 of that is a deliberate
 * `step.sleep` (the combine backstop window), so the real work was ~8.3 s.
 * A function that waits on purpose declares it as `waitedMs` in its output;
 * settleCronRun subtracts it. Anything that is not a sane non-negative number
 * is ignored, and the result never goes below zero.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ findFirst: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { cronJobLog: { findFirst: h.findFirst, update: h.update } },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { settleCronRun } from "@/lib/inngest/cron-lifecycle";

const NOW = new Date("2026-10-10T10:35:08.280Z");
const STARTED = new Date(NOW.getTime() - 2_108_280);
const fn = { opts: { id: "operator-morning-brief", triggers: [{ cron: "0 10 * * *" }] } };
const ctx = { runId: "run-1" };
const recorded = () => (h.update.mock.calls[0][0] as { data: { duration: number } }).data.duration;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  h.findFirst.mockReset().mockResolvedValue({ id: "row-1", createdAt: STARTED });
  h.update.mockReset().mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

describe("settleCronRun · declared wait is not work", () => {
  it("subtracts output.waitedMs from the wall-clock duration", async () => {
    await settleCronRun(fn, ctx, "success", undefined, { waitedMs: 2_100_000 });
    expect(recorded()).toBe(8_280);
  });

  it("control: no waitedMs keeps the wall clock", async () => {
    await settleCronRun(fn, ctx, "success", undefined, { sent: 1 });
    expect(recorded()).toBe(2_108_280);
  });

  it("ignores a waitedMs that is not a finite non-negative number", async () => {
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY, "2100000", null]) {
      h.update.mockClear();
      await settleCronRun(fn, ctx, "success", undefined, { waitedMs: bad });
      expect(recorded()).toBe(2_108_280);
    }
  });

  it("never records a negative duration when the declared wait exceeds the wall clock", async () => {
    await settleCronRun(fn, ctx, "success", undefined, { waitedMs: 9_999_999 });
    expect(recorded()).toBe(0);
  });
});
