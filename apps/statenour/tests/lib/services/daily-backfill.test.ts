/**
 * tests/lib/services/daily-backfill.test.ts · 2026-11-03
 *
 * A DAILY habit checked off for a PAST ET day (Nour: "I journaled on Oct 30,
 * I just didn't click it"), and the mirror: taking a check-off back.
 *
 *   1. backfill writes one dated `completed` event and extends the streak
 *      when the day follows lastCompletedAt
 *   2. a backfilled hole between two event days joins the runs (the event
 *      run ending at the row's day beats the row's count)
 *   2b. THE MOTIVATING CASE (second reader, blocker): Oct 31 + Nov 1 done,
 *      Nov 2 missed, Nov 3 done (row reset to 1); backfilling Nov 2 gives 4
 *   3. a non-adjacent backfill before lastCompletedAt leaves the row's streak alone
 *   4. the same day twice is idempotent (no second event, no XP); a racing
 *      second write (P2002) reads as idempotent too
 *   5. future / too old / not-DAILY / not-a-date are refused with ServiceError
 *   6. today delegates to checkTask
 *   6b. a failed XP credit is recorded and reported as null, never 0
 *   7. uncheck of the latest day appends an `uncompleted` event (never a
 *      delete), rewinds lastCompletedAt and the streak
 *   8. uncheck of a day inside the run caps the streak at the days after the hole
 *   9. uncheck of a day that was never checked writes nothing
 *   10. a re-backfill after an uncheck is a new completion (net count rule)
 *
 * Mocks prisma + XP credit + checkTask + cache + error log · no real DB.
 * Dates are pinned to ET noon so the ET day boundary is never near.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), update: vi.fn() },
  taskEvent: { findMany: vi.fn(), create: vi.fn() },
  creditTaskStats: vi.fn(async () => ({ statsCredited: 1, xpCredited: 5 })),
  checkTask: vi.fn(),
  recordError: vi.fn(async () => undefined),
  invalidateMutationCaches: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: mocks.task,
    taskEvent: mocks.taskEvent,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ task: mocks.task, taskEvent: mocks.taskEvent })),
  },
}));
vi.mock("@/lib/mastery/goal-stats", () => ({ creditTaskStats: mocks.creditTaskStats }));
vi.mock("@/lib/services/task-actions", () => ({ checkTask: mocks.checkTask }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: mocks.recordError }));
vi.mock("@/lib/services/tasks", () => ({ invalidateMutationCaches: mocks.invalidateMutationCaches }));

import { Prisma } from "@prisma/client";
import { backfillDailyCompletion, uncheckDailyCompletion, streakEndingAt } from "@/lib/services/daily-backfill";
import { ServiceError } from "@/lib/utils/service-error";

/** ET noon of a YYYY-MM-DD (EDT in these fixtures: UTC-4). */
const noon = (d: string) => new Date(`${d}T16:00:00.000Z`);
const NOW = noon("2026-11-03");

function habit(over: Partial<{ streakCount: number; lastCompletedAt: Date | null; loopKind: string }> = {}) {
  mocks.task.findUnique.mockResolvedValue({
    id: "h1",
    title: "Journal",
    loopKind: "DAILY",
    goalId: null,
    deletedAt: null,
    streakCount: 2,
    lastCompletedAt: noon("2026-10-29"),
    ...over,
  });
}
/** Event rows: "2026-10-30" = completed that day; "-2026-10-30" = uncompleted for that day. */
const events = (...days: string[]) =>
  mocks.taskEvent.findMany.mockResolvedValue(
    days.map((d) =>
      d.startsWith("-")
        ? { kind: "uncompleted", createdAt: NOW, payload: { forDay: d.slice(1) } }
        : { kind: "completed", createdAt: noon(d), payload: null },
    ),
  );
const updated = () => mocks.task.update.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.taskEvent.create.mockResolvedValue({ id: "e" });
  mocks.task.update.mockResolvedValue({});
  events();
});
afterEach(() => vi.useRealTimers());

describe("streakEndingAt", () => {
  it("counts event days back to the row's day, then adds the row's count", () => {
    const days = new Set(["2026-10-30", "2026-10-31"]);
    expect(streakEndingAt("2026-10-31", days, { lastDay: "2026-10-29", streakCount: 7 })).toBe(9);
  });
  it("stops at the first hole", () => {
    const days = new Set(["2026-10-31"]);
    expect(streakEndingAt("2026-10-31", days, { lastDay: "2026-10-29", streakCount: 7 })).toBe(1);
  });
  it("the event run ending at the row's day beats a reset row count", () => {
    const days = new Set(["2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(streakEndingAt("2026-11-03", days, { lastDay: "2026-11-03", streakCount: 1 })).toBe(4);
  });
});

describe("backfillDailyCompletion", () => {
  it("1 · writes a dated event and extends the streak on the next day", async () => {
    habit(); // last Oct 29, streak 2
    const r = await backfillDailyCompletion({ id: "h1", completedOn: "2026-10-30", source: "chat" });

    expect(mocks.taskEvent.create).toHaveBeenCalledTimes(1);
    const data = mocks.taskEvent.create.mock.calls[0][0].data;
    expect(data.kind).toBe("completed");
    expect(data.createdAt.toISOString()).toBe(noon("2026-10-30").toISOString());
    expect(data.payload.backfilled).toBe(true);
    expect(data.idempotencyKey).toBe("backfill:h1:2026-10-30:0");

    expect(updated()).toMatchObject({ streakCount: 3, lastCompletedAt: noon("2026-10-30") });
    expect(mocks.creditTaskStats).toHaveBeenCalledWith("h1", { perDay: true, dayKey: "2026-10-30" });
    expect(mocks.invalidateMutationCaches).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ idempotent: false, streakCount: 3, reward: { xpCredited: 5 } });
  });

  it("2 · a hole between the row's day and earlier events joins the runs", async () => {
    habit({ streakCount: 2, lastCompletedAt: noon("2026-10-31") }); // Oct 30 unchecked, Oct 31 checked
    events("2026-10-31", "2026-10-29");
    const r = await backfillDailyCompletion({ id: "h1", completedOn: "2026-10-30" });
    // lastCompletedAt stays Oct 31 (later than the backfill); the run ending there is
    // Oct 29, 30, 31 by events, longer than the row's 2.
    expect(updated()).toMatchObject({ streakCount: 3, lastCompletedAt: noon("2026-10-31") });
    expect(r.lastCompletedAt).toEqual(noon("2026-10-31"));
  });

  it("2b · the motivating case: Oct 31, Nov 1 done, Nov 2 missed, Nov 3 reset the row to 1; backfilling Nov 2 gives 4", async () => {
    habit({ streakCount: 1, lastCompletedAt: noon("2026-11-03") });
    events("2026-11-03", "2026-11-01", "2026-10-31");
    const r = await backfillDailyCompletion({ id: "h1", completedOn: "2026-11-02" });
    expect(r.streakCount).toBe(4);
    expect(r.lastCompletedAt).toEqual(noon("2026-11-03"));
  });

  it("3 · a non-adjacent day before lastCompletedAt leaves the row's streak alone", async () => {
    habit({ streakCount: 4, lastCompletedAt: noon("2026-11-02") });
    const r = await backfillDailyCompletion({ id: "h1", completedOn: "2026-10-20" });
    expect(r.streakCount).toBe(4);
    expect(r.lastCompletedAt).toEqual(noon("2026-11-02"));
  });

  it("4 · the same day twice is idempotent", async () => {
    habit();
    events("2026-10-30");
    const r = await backfillDailyCompletion({ id: "h1", completedOn: "2026-10-30" });
    expect(r.idempotent).toBe(true);
    expect(mocks.taskEvent.create).not.toHaveBeenCalled();
    expect(mocks.task.update).not.toHaveBeenCalled();
    expect(mocks.creditTaskStats).not.toHaveBeenCalled();
  });

  it("4b · the row's own lastCompletedAt day is idempotent even with no event row", async () => {
    habit({ lastCompletedAt: noon("2026-10-29") });
    const r = await backfillDailyCompletion({ id: "h1", completedOn: "2026-10-29" });
    expect(r.idempotent).toBe(true);
    expect(mocks.taskEvent.create).not.toHaveBeenCalled();
  });

  it("4c · a racing second write (P2002 on the idempotency key) reads as idempotent", async () => {
    habit();
    mocks.taskEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }),
    );
    const r = await backfillDailyCompletion({ id: "h1", completedOn: "2026-10-30" });
    expect(r.idempotent).toBe(true);
    expect(mocks.task.update).not.toHaveBeenCalled();
    expect(mocks.creditTaskStats).not.toHaveBeenCalled();
  });

  it("5 · refuses the future, the far past, a non-habit and a non-date", async () => {
    habit();
    await expect(backfillDailyCompletion({ id: "h1", completedOn: "2026-11-04" })).rejects.toThrow(ServiceError);
    await expect(backfillDailyCompletion({ id: "h1", completedOn: "2026-07-01" })).rejects.toThrow(/90 days/);
    await expect(backfillDailyCompletion({ id: "h1", completedOn: "2026-02-30" })).rejects.toThrow(/real calendar day/);
    await expect(backfillDailyCompletion({ id: "h1", completedOn: "yesterday" })).rejects.toThrow(/YYYY-MM-DD/);
    habit({ loopKind: "ONCE" });
    await expect(backfillDailyCompletion({ id: "h1", completedOn: "2026-10-30" })).rejects.toThrow(/not a DAILY habit/);
    expect(mocks.taskEvent.create).not.toHaveBeenCalled();
  });

  it("5b · a missing or deleted task is 404", async () => {
    mocks.task.findUnique.mockResolvedValue(null);
    await expect(backfillDailyCompletion({ id: "nope", completedOn: "2026-10-30" })).rejects.toMatchObject({ status: 404 });
  });

  it("6 · today delegates to checkTask", async () => {
    mocks.checkTask.mockResolvedValue({
      ok: true,
      task: { streakCount: 5, lastCompletedAt: NOW },
      reward: { xpCredited: 3, statsCredited: 1, goalLifted: false, streak: 5 },
    });
    const r = await backfillDailyCompletion({ id: "h1", completedOn: "2026-11-03", source: "chat" });
    expect(mocks.checkTask).toHaveBeenCalledWith({ id: "h1", action: "complete", eventSource: "chat" });
    expect(r).toMatchObject({ idempotent: false, streakCount: 5, reward: { xpCredited: 3 } });
    expect(mocks.taskEvent.create).not.toHaveBeenCalled();
  });

  it("6b · a failed XP credit is recorded and reported as null, never 0", async () => {
    habit();
    mocks.creditTaskStats.mockRejectedValueOnce(new Error("db down"));
    const r = await backfillDailyCompletion({ id: "h1", completedOn: "2026-10-30" });
    expect(r.reward).toBeNull();
    expect(mocks.recordError).toHaveBeenCalledWith("ai:tool-exec", expect.any(Error), expect.objectContaining({ taskId: "h1", dayKey: "2026-10-30" }));
    expect(r.streakCount).toBe(3); // the completion itself still landed
  });

  it("10 · a re-backfill after an uncheck is a new completion with its own key", async () => {
    habit({ streakCount: 0, lastCompletedAt: null });
    events("-2026-10-30", "2026-10-30"); // checked, then unchecked: net 0
    const r = await backfillDailyCompletion({ id: "h1", completedOn: "2026-10-30" });
    expect(r.idempotent).toBe(false);
    expect(mocks.taskEvent.create.mock.calls[0][0].data.idempotencyKey).toBe("backfill:h1:2026-10-30:1");
    expect(r.streakCount).toBe(1);
  });
});

describe("uncheckDailyCompletion", () => {
  it("7 · the latest day appends an uncompleted event, rewinds lastCompletedAt to the previous event day and the streak by one", async () => {
    habit({ streakCount: 3, lastCompletedAt: noon("2026-10-31") });
    events("2026-10-31", "2026-10-30", "2026-10-29");
    const r = await uncheckDailyCompletion({ id: "h1", date: "2026-10-31", source: "chat" });
    expect(mocks.taskEvent.create).toHaveBeenCalledTimes(1);
    const data = mocks.taskEvent.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: "uncompleted", payload: { forDay: "2026-10-31" }, source: "chat" });
    expect(r).toMatchObject({ changed: true, streakCount: 2 });
    expect(r.lastCompletedAt).toEqual(noon("2026-10-30"));
    expect(mocks.invalidateMutationCaches).toHaveBeenCalledTimes(1);
  });

  it("7b · the latest day with no event history left zeroes the row", async () => {
    habit({ streakCount: 1, lastCompletedAt: noon("2026-11-03") });
    const r = await uncheckDailyCompletion({ id: "h1" }); // date defaults to today
    expect(r).toMatchObject({ date: "2026-11-03", changed: true, streakCount: 0, lastCompletedAt: null });
  });

  it("8 · a day inside the run caps the streak at the days after the hole", async () => {
    habit({ streakCount: 10, lastCompletedAt: noon("2026-11-02") });
    events("2026-10-30");
    const r = await uncheckDailyCompletion({ id: "h1", date: "2026-10-30" });
    expect(r.streakCount).toBe(3); // Oct 31, Nov 1, Nov 2
    expect(r.lastCompletedAt).toEqual(noon("2026-11-02"));
  });

  it("9 · a day that was never checked writes nothing", async () => {
    habit({ streakCount: 2, lastCompletedAt: noon("2026-10-29") });
    const r = await uncheckDailyCompletion({ id: "h1", date: "2026-11-01" });
    expect(r).toMatchObject({ changed: false, streakCount: 2 });
    expect(mocks.taskEvent.create).not.toHaveBeenCalled();
    expect(mocks.task.update).not.toHaveBeenCalled();
  });

  it("9b · a day already unchecked (net 0) outside the row's run writes nothing", async () => {
    habit({ streakCount: 1, lastCompletedAt: noon("2026-11-03") });
    events("-2026-10-30", "2026-10-30");
    const r = await uncheckDailyCompletion({ id: "h1", date: "2026-10-30" });
    expect(r.changed).toBe(false);
    expect(mocks.taskEvent.create).not.toHaveBeenCalled();
  });
});
