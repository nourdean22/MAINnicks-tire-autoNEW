/**
 * R3 round 1 (auto-close): a task made from a promise (Promises on /missions sets the promise's
 * executionRef to task:<id>) keeps the promise when it is completed. checkTask is the one completion
 * path every writer uses, so the close runs there, after W8a's goal lift, awaited, and a failure is
 * logged and never fails the completion. The real closePromisesForTask runs against the mocked store.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  mission: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  brainMemory: { findMany: vi.fn(), upsert: vi.fn(), create: vi.fn() },
  lifeGoal: { findUnique: vi.fn(), update: vi.fn() },
  commitment: { findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  warn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: mocks.task,
    mission: mocks.mission,
    brainMemory: mocks.brainMemory,
    lifeGoal: mocks.lifeGoal,
    commitment: mocks.commitment,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ task: mocks.task, mission: mocks.mission, brainMemory: mocks.brainMemory, lifeGoal: mocks.lifeGoal }),
    ),
  },
}));
vi.mock("@/lib/db/entity-audit", () => ({ logCreate: vi.fn(), logUpdate: vi.fn(), stripNoise: vi.fn((x) => x) }));
vi.mock("@/lib/cache/dashboard-cache", () => ({ invalidateMutationCaches: vi.fn() }));
vi.mock("@/lib/brain/task-events", () => ({ emitTaskEventAsync: vi.fn(), emitTaskCompleted: vi.fn() }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitTaskCompleted: vi.fn(), emitCommitmentTransition: vi.fn(async () => {}) }));
vi.mock("@/lib/services/commitment-conditions", () => ({ captureCommitmentConditions: vi.fn(async () => {}) }));
vi.mock("@/lib/services/auto-learn", () => ({ runAutoLearn: vi.fn(async () => null) }));
vi.mock("@/lib/mastery/goal-stats", () => ({ creditTaskStats: vi.fn(async () => ({ statsCredited: 0, xpCredited: 0 })) }));
vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));
vi.mock("@/lib/services/outcome-ledger", () => ({
  recordOutcomeByContent: vi.fn(async () => true),
  recordOutcomeByResultRef: vi.fn(async () => true),
}));
vi.mock("@/lib/logger", async (orig) => {
  const actual = await orig<typeof import("@/lib/logger")>();
  return {
    ...actual,
    logger: {
      ...actual.logger,
      withSurface: (s: string) => ({ ...actual.logger.withSurface(s), warn: (...a: unknown[]) => mocks.warn(s, ...a) }),
    },
  };
});

import { checkTask } from "@/lib/services/task-actions";

type Exec = (a: unknown) => Promise<Record<string, unknown>>;

function onceTask() {
  mocks.task.findUnique.mockResolvedValueOnce({
    id: "t-9",
    title: "Send Mash the alignment quote",
    finishCondition: "done",
    missionId: "m-inbox",
    phaseName: null,
    loopKind: "ONCE",
    status: "READY",
    lastCompletedAt: null,
    streakCount: 0,
    startedAt: null,
    actualMinutes: 0,
    context: "ANYWHERE",
    effort: "M30",
    autoPriority: 50,
    roiScore: 50,
    goalId: null,
    mission: { title: "Inbox", domain: "PERSONAL", lifeGoalId: null, lifeGoal: null },
    goal: null,
  });
  mocks.task.update.mockResolvedValue({ id: "t-9", status: "DONE", loopKind: "ONCE", actualMinutes: 0, effort: "M30" });
  mocks.task.updateMany.mockResolvedValue({ count: 1 });
  mocks.task.findMany.mockResolvedValue([]);
  mocks.task.count.mockResolvedValue(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brainMemory.findMany.mockResolvedValue([]);
  mocks.brainMemory.upsert.mockResolvedValue({});
  mocks.brainMemory.create.mockResolvedValue({});
  mocks.commitment.findUnique.mockResolvedValue(null);
});

describe("checkTask closes the promise its task was made from", () => {
  it("completing the task completes the linked active promise, stamped system:task-done", async () => {
    onceTask();
    mocks.commitment.findMany.mockResolvedValueOnce([{ id: 4 }]);
    mocks.commitment.updateMany.mockResolvedValueOnce({ count: 1 });

    const r = await (checkTask as unknown as Exec)({ id: "t-9", action: "complete" });

    expect(r.ok).toBe(true);
    expect(mocks.commitment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { executionRef: "task:t-9", status: "active", deletedAt: null } }),
    );
    expect(mocks.commitment.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.commitment.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 4, executionRef: "task:t-9", status: "active", deletedAt: null },
      data: { status: "completed", updatedBy: "system:task-done" },
    });
  });

  it("a task no promise points at closes nothing", async () => {
    onceTask();
    mocks.commitment.findMany.mockResolvedValueOnce([]);
    const r = await (checkTask as unknown as Exec)({ id: "t-9", action: "complete" });
    expect(r.ok).toBe(true);
    expect(mocks.commitment.updateMany).not.toHaveBeenCalled();
  });

  it("a failed close is logged and never fails the completion", async () => {
    onceTask();
    mocks.commitment.findMany.mockRejectedValueOnce(new Error("db down"));
    const r = await (checkTask as unknown as Exec)({ id: "t-9", action: "complete" });
    expect(r.ok).toBe(true);
    expect(mocks.warn.mock.calls.some((c) => c[1] === "promise_close_failed")).toBe(true);
  });
});
