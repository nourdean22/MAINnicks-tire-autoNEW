/**
 * tests/ai/habit-streaks-grid.test.ts · 2026-11-03
 *
 * getHabitStreaks is what Nick reads when Nour asks "did I journal this week".
 * It used to answer min(7, streakCount) as the days done, so a day backfilled
 * before the latest check-off was invisible and a failed read was "no habits".
 * Driven through the real tool with Prisma mocked, clock at 2026-11-03 12:00 EST.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ task: { findMany: vi.fn() }, taskEvent: { findMany: vi.fn() } }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/nickstire/query", () => ({ readBridge: vi.fn(), queryNick: vi.fn() }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/mastery/goal-stats", () => ({ creditTaskStats: vi.fn() }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/services/tasks", () => ({ invalidateMutationCaches: vi.fn() }));

import { habitsTools } from "@/lib/ai/tools/habits";

type Executable = { execute: (args: unknown, opts?: unknown) => Promise<unknown> };
const run = () => (habitsTools.getHabitStreaks as unknown as Executable).execute({}, {}) as Promise<Record<string, any>>;
const noonEst = (d: string) => new Date(`${d}T17:00:00.000Z`);

beforeEach(() => {
  db.task.findMany.mockReset();
  db.taskEvent.findMany.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(noonEst("2026-11-03"));
});
afterEach(() => vi.useRealTimers());

describe("getHabitStreaks · the last 7 ET days off the event ledger", () => {
  it("a day backfilled two days before lastCompletedAt counts as done on that day", async () => {
    db.task.findMany.mockResolvedValue([
      { id: "h1", title: "Journal", loopKind: "DAILY", streakCount: 1, lastCompletedAt: noonEst("2026-11-03") },
    ]);
    db.taskEvent.findMany.mockResolvedValue([
      { taskId: "h1", kind: "completed", createdAt: noonEst("2026-11-01"), payload: { backfilled: true } },
      { taskId: "h1", kind: "completed", createdAt: noonEst("2026-11-03"), payload: {} },
    ]);
    const out = await run();
    expect(out.Journal.completed).toBe(2);
    expect(out.Journal.total).toBe(7);
    expect(out.Journal.streak).toBe(1);
    expect(out.Journal.last7.filter((d: { done: boolean }) => d.done).map((d: { day: string }) => d.day)).toEqual([
      "2026-11-03",
      "2026-11-01",
    ]);
  });

  it("a failed ledger read says unknown, never a week of not-done", async () => {
    db.task.findMany.mockResolvedValue([
      { id: "h1", title: "Journal", loopKind: "DAILY", streakCount: 4, lastCompletedAt: noonEst("2026-11-03") },
    ]);
    db.taskEvent.findMany.mockRejectedValue(new Error("db down"));
    const out = await run();
    expect(out.Journal.last7).toMatch(/unknown/);
    expect(out.Journal.completed).toBeUndefined();
    expect(out.Journal.streak).toBe(4);
  });

  it("a failed habit read says unknown, never an empty habit list", async () => {
    db.task.findMany.mockRejectedValue(new Error("db down"));
    const out = await run();
    expect(out.error).toMatch(/unknown/);
  });
});
