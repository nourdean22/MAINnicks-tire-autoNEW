/**
 * A task write transaction must NOT scale with the open-task count.
 *
 * WHY THIS FILE EXISTS — measured in production 2026-09-17.
 *
 * `createTask`/`updateTask`/`createMission`/`updateMission` each ran
 * `syncTaskPriorities` INSIDE their interactive transaction. That helper
 * re-scores EVERY open task, so transaction duration grew with the table:
 * 408 rows / 212 non-terminal, ~212 UPDATEs at ~24ms per Neon round trip is
 * ~5.1s against Prisma's 5000ms default. Production failed exactly there —
 * `Transaction already closed ... however 5115 ms passed` — three times on
 * `/api/sync/nour-os`, on `prisma.task.update` and `task.findUnique`.
 *
 * ★★★ THE CONSEQUENCE WAS NOT SLOWNESS, IT WAS A LOST WRITE. `autoPriority`
 *   is derived ranking data, and coupling it to the write meant a best-effort
 *   DENORMALISATION COULD VETO A USER'S TASK CREATION.
 *
 * The fix scores only the row just written (constant time) and defers the
 * global refresh past the commit. The load-bearing, testable consequence is
 * below: the transaction must never do a whole-table task read.
 *
 * ⚠ Raising `TASK_TX_OPTS.timeout` alone would NOT satisfy this file — that
 * moves the cliff, it does not remove it. `tests/services/task-tx-budget.test.ts`
 * covers the budget; this covers the shape.
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

import { createTask } from "@/lib/services/tasks";

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

describe("createTask · transaction shape", () => {
  // POSITIVE CONTROL — if createTask stopped opening a transaction at all, or
  // threw before doing any work, every assertion below would pass vacuously.
  it("actually creates the task inside a transaction", async () => {
    await createTask({ title: "ship the thing", missionId: "mission-1" });
    expect(mocks.task.create).toHaveBeenCalledTimes(1);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // THE LOAD-BEARING ASSERTION. syncTaskPriorities begins with a
  // `task.findMany` over every open task. If that reappears inside the
  // transaction, the write is O(open tasks) again and the production failure
  // returns — regardless of how generous TASK_TX_OPTS.timeout is.
  it("CANARY — never reads the whole task table inside the transaction", async () => {
    await createTask({ title: "ship the thing", missionId: "mission-1" });
    expect(mocks.txTaskFindManyCalls.n).toBe(0);
  });

  // The transaction's cost must be a small fixed number of statements, not a
  // function of the table. Create + score-update + hydrate = 3 task statements.
  it("issues a bounded number of task statements", async () => {
    await createTask({ title: "ship the thing", missionId: "mission-1" });
    const taskStatements =
      mocks.task.create.mock.calls.length +
      mocks.task.update.mock.calls.length +
      mocks.task.findUnique.mock.calls.length;
    expect(taskStatements).toBeLessThanOrEqual(4);
  });

  // The new row must still come back SCORED — that is what the caller's view
  // model reads, and it is the only part of the old global sync the
  // transaction ever actually needed.
  it("still scores the row it just created", async () => {
    await createTask({ title: "ship the thing", missionId: "mission-1" });
    const scoreWrite = mocks.task.update.mock.calls.find(
      (c) => c[0]?.data && "autoPriority" in c[0].data,
    );
    expect(scoreWrite).toBeDefined();
    expect(typeof scoreWrite![0].data.autoPriority).toBe("number");
  });
});
