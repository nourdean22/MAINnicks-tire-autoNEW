/**
 * tests/lib/services/task-actions-daily-streak.test.ts · high-fix wave
 * 2026-07-16.
 *
 * Locks the DAILY streak day-math in `checkTask` to ET calendar days.
 * The server runs UTC (Railway), where the day flips at 8pm EDT — the
 * old server-zone floor produced two live bugs:
 *
 *   · same-ET-evening re-check across UTC midnight read as "next day"
 *     → idempotency guard missed → streak double-bumped
 *   · next-ET-evening check read as a 2-day gap → streak falsely reset
 *
 * All timestamps below are mid-July (EDT, UTC-4). Mocks prisma +
 * side-effect modules · no real DB.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  task: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
  mission: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  brainMemory: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: mocks.task,
    mission: mocks.mission,
    brainMemory: mocks.brainMemory,
    $transaction: vi.fn(async (fn) =>
      fn({
        task: mocks.task,
        mission: mocks.mission,
        brainMemory: mocks.brainMemory,
      }),
    ),
  },
}));

vi.mock("@/lib/db/entity-audit", () => ({
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  stripNoise: vi.fn((x) => x),
}));

vi.mock("@/lib/cache/dashboard-cache", () => ({
  invalidateMutationCaches: vi.fn(),
}));

vi.mock("@/lib/brain/task-events", () => ({
  emitTaskEventAsync: vi.fn(),
  emitTaskCompleted: vi.fn(),
}));

vi.mock("@/lib/db/brain-bus-emit", () => ({
  emitTaskCompleted: vi.fn(async () => undefined),
}));

vi.mock("@/lib/services/auto-learn", () => ({
  runAutoLearn: vi.fn(async () => null),
}));

vi.mock("@/lib/mastery/goal-stats", () => ({
  creditTaskStats: vi.fn(async () => ({ statsCredited: 0, xpCredited: 0 })),
}));

vi.mock("@/lib/runtime", () => ({
  isDemoMode: false,
}));

import { checkTask } from "@/lib/services/task-actions";

function setupDaily(opts: { lastCompletedAt: string | null; streakCount?: number }) {
  const streakCount = opts.streakCount ?? 5;
  mocks.task.findUnique.mockResolvedValueOnce({
    id: "daily-1",
    title: "daily habit",
    finishCondition: "done",
    missionId: "mission-1",
    loopKind: "DAILY",
    status: "READY",
    lastCompletedAt: opts.lastCompletedAt ? new Date(opts.lastCompletedAt) : null,
    streakCount,
    startedAt: null,
    actualMinutes: 0,
    context: "ANYWHERE",
    effort: "M15",
    autoPriority: 50,
    roiScore: 50,
    goalId: null,
    mission: { title: "Mission 1", domain: "test" },
    goal: null,
  });
  mocks.task.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: "daily-1",
    streakCount: args.data.streakCount,
    lastCompletedAt: args.data.lastCompletedAt,
    loopKind: "DAILY",
    title: "daily habit",
  }));
  mocks.task.findMany.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.brainMemory.findMany.mockResolvedValue([]);
  mocks.brainMemory.upsert.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkTask · DAILY streak · ET day boundaries", () => {
  it("is idempotent for a same-ET-evening re-check across UTC midnight (no double bump)", async () => {
    // last check 7:30pm ET Jul 15 (23:30Z) · re-check 9:00pm ET Jul 15
    // (01:00Z Jul 16 — a NEW UTC day, the exact old-bug window).
    setupDaily({ lastCompletedAt: "2026-07-15T23:30:00Z" });
    vi.setSystemTime(new Date("2026-07-16T01:00:00Z"));

    const result = await checkTask({ id: "daily-1", action: "complete" });

    expect(result.idempotent).toBe(true);
    expect(result.streakCount).toBe(5);
    expect(mocks.task.update).not.toHaveBeenCalled();
  });

  it("bumps the streak on consecutive ET days", async () => {
    // 11am ET Jul 15 → 11am ET Jul 16 · gap of exactly one ET day.
    setupDaily({ lastCompletedAt: "2026-07-15T15:00:00Z" });
    vi.setSystemTime(new Date("2026-07-16T15:00:00Z"));

    await checkTask({ id: "daily-1", action: "complete" });

    expect(mocks.task.update).toHaveBeenCalledTimes(1);
    expect(mocks.task.update.mock.calls[0][0].data.streakCount).toBe(6);
  });

  it("does NOT falsely reset when consecutive ET days span two UTC day flips", async () => {
    // last check 10am ET Jul 15 (14:00Z, UTC day 15) · next check 9pm ET
    // Jul 16 (01:00Z Jul 17, UTC day 17). UTC math read gap=2 → reset;
    // ET math reads gap=1 → streak continues.
    setupDaily({ lastCompletedAt: "2026-07-15T14:00:00Z" });
    vi.setSystemTime(new Date("2026-07-17T01:00:00Z"));

    await checkTask({ id: "daily-1", action: "complete" });

    expect(mocks.task.update).toHaveBeenCalledTimes(1);
    expect(mocks.task.update.mock.calls[0][0].data.streakCount).toBe(6);
  });

  it("resets the streak to 1 after a genuine missed ET day", async () => {
    // 11am ET Jul 14 → 11am ET Jul 16 · Jul 15 was skipped.
    setupDaily({ lastCompletedAt: "2026-07-14T15:00:00Z" });
    vi.setSystemTime(new Date("2026-07-16T15:00:00Z"));

    await checkTask({ id: "daily-1", action: "complete" });

    expect(mocks.task.update).toHaveBeenCalledTimes(1);
    expect(mocks.task.update.mock.calls[0][0].data.streakCount).toBe(1);
  });

  it("starts at streak 1 on the first-ever completion", async () => {
    setupDaily({ lastCompletedAt: null, streakCount: 0 });
    vi.setSystemTime(new Date("2026-07-16T15:00:00Z"));

    await checkTask({ id: "daily-1", action: "complete" });

    expect(mocks.task.update).toHaveBeenCalledTimes(1);
    expect(mocks.task.update.mock.calls[0][0].data.streakCount).toBe(1);
  });
});
