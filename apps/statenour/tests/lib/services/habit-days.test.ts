/**
 * tests/lib/services/habit-days.test.ts · 2026-11-03
 *
 * habitDays is the per-day habit read: the event ledger first, the row's own
 * run only where the ledger says nothing. Before it, every reader derived
 * "done on day N" from streakCount + lastCompletedAt, so a day backfilled
 * BEFORE lastCompletedAt (Nour: "I journaled on Oct 30 and Nov 2, I just
 * didn't click it") never showed as done anywhere.
 *
 * Mocks prisma only. Days are passed explicitly; events sit at ET noon.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ taskEvent: { findMany: vi.fn() } }));

vi.mock("@/lib/prisma", () => ({ prisma: { taskEvent: mocks.taskEvent } }));
vi.mock("@/lib/mastery/goal-stats", () => ({ creditTaskStats: vi.fn() }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/services/tasks", () => ({ invalidateMutationCaches: vi.fn() }));

import { habitDays } from "@/lib/services/daily-backfill";

/** ET noon of a YYYY-MM-DD (EDT in these fixtures: UTC-4). */
const noon = (d: string) => new Date(`${d}T16:00:00.000Z`);
const done = (taskId: string, d: string) => ({ taskId, kind: "completed", createdAt: noon(d), payload: {} });
const undone = (taskId: string, forDay: string, at: string) => ({
  taskId,
  kind: "uncompleted",
  createdAt: noon(at),
  payload: { forDay },
});
const doneDays = (grid: Array<{ day: string; done: boolean }> | undefined) =>
  (grid ?? []).filter((d) => d.done).map((d) => d.day);

beforeEach(() => {
  mocks.taskEvent.findMany.mockReset();
});

describe("habitDays", () => {
  it("a day backfilled two days before lastCompletedAt renders done on that day", async () => {
    // Row: checked Nov 3 after a missed Nov 2, so the count reset to 1. Nov 1 was backfilled.
    mocks.taskEvent.findMany.mockResolvedValue([done("h1", "2026-11-01"), done("h1", "2026-11-03")]);
    const grid = await habitDays([{ id: "h1", loopKind: "DAILY", streakCount: 1, lastCompletedAt: noon("2026-11-03") }], 7, "2026-11-03");
    expect(doneDays(grid.get("h1"))).toEqual(["2026-11-03", "2026-11-01"]);
  });

  it("returns the window newest first, one entry per ET day, from ONE query bounded at the window start", async () => {
    mocks.taskEvent.findMany.mockResolvedValue([]);
    const grid = await habitDays(
      [
        { id: "h1", loopKind: "DAILY", streakCount: 0, lastCompletedAt: null },
        { id: "h2", loopKind: "DAILY", streakCount: 0, lastCompletedAt: null },
      ],
      7,
      "2026-11-03",
    );
    expect(grid.get("h1")?.map((d) => d.day)).toEqual([
      "2026-11-03", "2026-11-02", "2026-11-01", "2026-10-31", "2026-10-30", "2026-10-29", "2026-10-28",
    ]);
    expect(mocks.taskEvent.findMany).toHaveBeenCalledTimes(1);
    const where = mocks.taskEvent.findMany.mock.calls[0][0].where;
    expect(where.taskId).toEqual({ in: ["h1", "h2"] });
    // Oct 28 00:00 EDT = 04:00Z.
    expect(where.createdAt.gte.toISOString()).toBe("2026-10-28T04:00:00.000Z");
  });

  it("an unchecked day is not done, even inside the row's run", async () => {
    // Nov 2 checked, then taken back on Nov 3. A second habit's Nov 2 has only the
    // uncheck (its check predates the log): the row's run must not vouch for it.
    mocks.taskEvent.findMany.mockResolvedValue([
      done("h1", "2026-11-02"),
      undone("h1", "2026-11-02", "2026-11-03"),
      undone("h2", "2026-11-02", "2026-11-03"),
    ]);
    const grid = await habitDays(
      [
        { id: "h1", loopKind: "DAILY", streakCount: 1, lastCompletedAt: noon("2026-11-03") },
        { id: "h2", loopKind: "DAILY", streakCount: 3, lastCompletedAt: noon("2026-11-03") },
      ],
      7,
      "2026-11-03",
    );
    expect(doneDays(grid.get("h1"))).toEqual(["2026-11-03"]);
    expect(doneDays(grid.get("h2"))).toEqual(["2026-11-03", "2026-11-01"]);
  });

  it("tick, take back, tick again on one day is done (the two-tap correction of a mis-tap)", async () => {
    mocks.taskEvent.findMany.mockResolvedValue([
      done("h1", "2026-11-03"),
      undone("h1", "2026-11-03", "2026-11-03"),
      done("h1", "2026-11-03"),
    ]);
    const grid = await habitDays([{ id: "h1", loopKind: "DAILY", streakCount: 1, lastCompletedAt: noon("2026-11-03") }], 7, "2026-11-03");
    expect(grid.get("h1")?.[0]).toEqual({ day: "2026-11-03", done: true });
  });

  it("with no events the row's run vouches (a lost event write), and nothing before it", async () => {
    mocks.taskEvent.findMany.mockResolvedValue([]);
    const grid = await habitDays([{ id: "h1", loopKind: "DAILY", streakCount: 3, lastCompletedAt: noon("2026-11-02") }], 7, "2026-11-03");
    expect(doneDays(grid.get("h1"))).toEqual(["2026-11-02", "2026-11-01", "2026-10-31"]);
  });

  it("a WEEKLY row's count is a tally, not a run: only its last day vouches", async () => {
    mocks.taskEvent.findMany.mockResolvedValue([]);
    const grid = await habitDays([{ id: "w1", loopKind: "WEEKLY", streakCount: 5, lastCompletedAt: noon("2026-11-03") }], 7, "2026-11-03");
    expect(doneDays(grid.get("w1"))).toEqual(["2026-11-03"]);
  });

  it("a failed ledger read throws, so no caller can render a week of not-done", async () => {
    mocks.taskEvent.findMany.mockRejectedValue(new Error("db down"));
    await expect(
      habitDays([{ id: "h1", loopKind: "DAILY", streakCount: 2, lastCompletedAt: noon("2026-11-03") }], 7, "2026-11-03"),
    ).rejects.toThrow("db down");
  });

  it("takes a JSON-serialized lastCompletedAt (the /missions deck passes serialized rows)", async () => {
    mocks.taskEvent.findMany.mockResolvedValue([]);
    const grid = await habitDays(
      [{ id: "h1", loopKind: "DAILY", streakCount: 2, lastCompletedAt: noon("2026-11-03").toISOString() }],
      7,
      "2026-11-03",
    );
    expect(doneDays(grid.get("h1"))).toEqual(["2026-11-03", "2026-11-02"]);
  });

  it("no tasks reads nothing", async () => {
    const grid = await habitDays([], 7, "2026-11-03");
    expect(grid.size).toBe(0);
    expect(mocks.taskEvent.findMany).not.toHaveBeenCalled();
  });
});
