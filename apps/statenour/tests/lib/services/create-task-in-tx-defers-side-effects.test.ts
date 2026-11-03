/**
 * W8a round 2 (verification reader): createTask called inside someone else's transaction (spawnProjectTasks) fired
 * its side effects on the GLOBAL client before that transaction committed: enrichTaskLinkage read the task, found
 * nothing (not committed yet) and gave up, so phase-0 plan tasks never got statHints; the "created" TaskEvent raced
 * the commit (FK). With a tx, createTask now queues the side effects on `afterCommit`; the caller runs them after
 * its commit (spawn-tasks.ts), the way maybeSpawnNextPhase already did.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  task: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  },
  mission: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  /** Tracks whether a client handed to $transaction was used for a table scan. */
  txTaskFindManyCalls: { n: 0 },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: mocks.task,
    mission: mocks.mission,
    // The transaction client is DISTINCT from the module-level one, so a
    // whole-table read inside the transaction is attributable to the
    // transaction rather than to the deferred sync that runs after it.
    $transaction: vi.fn(async (fn: (c: unknown) => Promise<unknown>) =>
      fn({
        task: {
          ...mocks.task,
          findMany: vi.fn(async (...args: unknown[]) => {
            mocks.txTaskFindManyCalls.n += 1;
            return mocks.task.findMany(...(args as []));
          }),
        },
        mission: mocks.mission,
      }),
    ),
  },
}));

vi.mock("@/lib/db/entity-audit", () => ({
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  stripNoise: vi.fn((x: unknown) => x),
}));
vi.mock("@/lib/cache/dashboard-cache", () => ({ invalidateMutationCaches: vi.fn() }));
vi.mock("@/lib/utils/cache", () => ({ invalidate: vi.fn() }));
vi.mock("@/lib/brain/task-events", () => ({
  emitTaskEventAsync: vi.fn(),
  emitTaskCompleted: vi.fn(),
}));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitTaskCompleted: vi.fn(async () => undefined) }));
vi.mock("@/lib/brain/goal-events", () => ({ emitGoalEventAsync: vi.fn() }));
vi.mock("@/lib/services/auto-learn", () => ({ runAutoLearn: vi.fn(async () => null) }));
vi.mock("@/lib/ai/classify-task-linkage", () => ({ classifyTaskLinkage: vi.fn(async () => null) }));
vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));
vi.mock("@/lib/services/people/link-promise", () => ({ linkPromiseToPerson: vi.fn(async () => undefined) }));

import { createTask } from "@/lib/services/tasks";
import { emitTaskEventAsync } from "@/lib/brain/task-events";
import { logCreate } from "@/lib/db/entity-audit";
import { linkPromiseToPerson } from "@/lib/services/people/link-promise";
import { prisma } from "@/lib/prisma";

const NOW = new Date("2026-09-17T12:00:00Z");

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "ship the thing",
    missionId: "mission-1",
    status: "INBOX",
    autoPriority: null,
    autoPriorityExplanation: null,
    roiScore: 50,
    frictionScore: 30,
    energyRequired: "MEDIUM",
    dueDate: null,
    manualPriorityOverride: null,
    startedAt: null,
    lastTouchedAt: NOW,
    updatedAt: NOW,
    createdAt: NOW,
    deletedAt: null,
    goalId: null,
    mission: { id: "mission-1", title: "Mission 1", domain: "test", status: "ACTIVE" },
    ...overrides,
  };
}

const MISSIONS = [
  { id: "mission-1", title: "Mission 1", domain: "test", status: "ACTIVE", priority: 1, deletedAt: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.txTaskFindManyCalls.n = 0;
  mocks.task.create.mockResolvedValue(taskRow());
  mocks.task.update.mockResolvedValue(taskRow({ autoPriority: 42 }));
  mocks.task.findUnique.mockResolvedValue(taskRow({ autoPriority: 42 }));
  mocks.task.findMany.mockResolvedValue([]);
  mocks.mission.findMany.mockResolvedValue(MISSIONS);
  mocks.mission.findUnique.mockResolvedValue(MISSIONS[0]);
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const SIDE_EFFECTS = () => [emitTaskEventAsync, logCreate, linkPromiseToPerson].map((f) => vi.mocked(f).mock.calls.length);

describe("createTask inside a caller's transaction", () => {
  it("POSITIVE CONTROL: without a tx the side effects fire after its own commit (event, audit, enrich)", async () => {
    await createTask({ title: "ship the thing", missionId: "mission-1" });
    await flush();
    expect(SIDE_EFFECTS().every((n) => n > 0)).toBe(true);
  });

  it("with a tx, nothing fires before the caller commits; afterCommit runs them, enrich reads the committed id", async () => {
    const afterCommit: Array<() => void> = [];
    const tx = { task: mocks.task, mission: mocks.mission } as never;

    await createTask({ title: "ship the thing", missionId: "mission-1" }, tx, afterCommit);
    await flush();

    expect(SIDE_EFFECTS()).toEqual([0, 0, 0]);
    expect(vi.mocked(prisma.$transaction)).not.toHaveBeenCalled(); // it joined the caller's transaction

    for (const run of afterCommit) run();
    await flush();
    expect(vi.mocked(emitTaskEventAsync)).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", kind: "created" }));
    expect(vi.mocked(linkPromiseToPerson)).toHaveBeenCalledWith("t1"); // enrichTaskLinkage ran, after the commit
    expect(vi.mocked(logCreate)).toHaveBeenCalledWith("task", "t1", expect.anything(), expect.anything());
  });
});
