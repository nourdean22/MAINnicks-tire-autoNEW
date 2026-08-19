/**
 * tests/lib/services/sync-task-priorities-diff.test.ts · high-fix wave
 * 2026-07-16.
 *
 * Locks the diff-guard in syncTaskPriorities: rows whose autoPriority
 * score AND explanation are already current must NOT be rewritten.
 * The old unconditional rewrite ran one UPDATE per open task inside
 * every task/mission mutation's interactive transaction and stamped
 * @updatedAt on the whole open board per mutation.
 *
 * scoreTaskPriority/rankMissions are mocked to fixed outputs so the
 * test controls exactly which rows count as "changed".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: mocks.task,
    mission: mocks.mission,
    $transaction: vi.fn(async (fn) =>
      fn({ task: mocks.task, mission: mocks.mission }),
    ),
  },
}));

vi.mock("@/lib/scoring/task-priority", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scoring/task-priority")>()),
  scoreTaskPriority: vi.fn(() => ({ score: 42, explanation: "fixed-explanation" })),
}));

vi.mock("@/lib/scoring/mission-ranking", () => ({
  rankMissions: vi.fn(() => ({ rankedMissions: [] })),
}));

vi.mock("@/lib/runtime", () => ({
  isDemoMode: false,
}));

import { syncTaskPriorities } from "@/lib/services/tasks";

function openTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "t-changed",
    title: "task",
    missionId: "m1",
    status: "READY",
    roiScore: 50,
    frictionScore: 30,
    energyRequired: "MEDIUM",
    dueDate: null,
    manualPriorityOverride: null,
    lastTouchedAt: null,
    updatedAt: new Date("2026-07-16T15:00:00Z"),
    autoPriority: 10,
    autoPriorityExplanation: "stale",
    mission: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mission.findMany.mockResolvedValue([]);
  mocks.task.update.mockResolvedValue({});
});

describe("syncTaskPriorities · diff guard", () => {
  it("only writes rows whose score or explanation changed", async () => {
    mocks.task.findMany.mockResolvedValue([
      openTask({
        id: "t-unchanged",
        autoPriority: 42,
        autoPriorityExplanation: "fixed-explanation",
      }),
      openTask({ id: "t-changed", autoPriority: 10, autoPriorityExplanation: "stale" }),
    ]);

    await syncTaskPriorities();

    expect(mocks.task.update).toHaveBeenCalledTimes(1);
    expect(mocks.task.update.mock.calls[0][0]).toMatchObject({
      where: { id: "t-changed" },
      data: { autoPriority: 42, autoPriorityExplanation: "fixed-explanation" },
    });
  });

  it("writes nothing when every row is already current", async () => {
    mocks.task.findMany.mockResolvedValue([
      openTask({
        id: "a",
        autoPriority: 42,
        autoPriorityExplanation: "fixed-explanation",
      }),
      openTask({
        id: "b",
        autoPriority: 42,
        autoPriorityExplanation: "fixed-explanation",
      }),
    ]);

    await syncTaskPriorities();

    expect(mocks.task.update).not.toHaveBeenCalled();
  });

  it("still writes a row whose explanation drifted even when the score matches", async () => {
    mocks.task.findMany.mockResolvedValue([
      openTask({ id: "c", autoPriority: 42, autoPriorityExplanation: "outdated text" }),
    ]);

    await syncTaskPriorities();

    expect(mocks.task.update).toHaveBeenCalledTimes(1);
    expect(mocks.task.update.mock.calls[0][0].where).toEqual({ id: "c" });
  });
});
