/**
 * tests/lib/services/task-actions-cascade.test.ts · task #22 step 5.1.
 *
 * Cascade-on-complete contract test (ADR-0017 Rule 1 Option A). Locks
 * the subtask cascade behavior in `checkTask`:
 *
 *   1. cascadeChildren=true + N open children → all OPEN children
 *      flipped to DONE in one updateMany · childrenCascaded === N
 *   2. cascadeChildren=true + 0 open children (all already DONE) →
 *      updateMany still runs (with WHERE that matches 0 rows) ·
 *      childrenCascaded === 0 · no false positives
 *   3. cascadeChildren=false → no updateMany call at all
 *   4. cascadeChildren=undefined → no updateMany call (default = off)
 *   5. cascadeChildren=true on a DAILY parent → DAILY branch returns
 *      early without cascading · streak math wins · cascade skipped
 *   6. Cascade failure logged + degraded · doesn't fail the parent
 *      completion (parent is the primary user action)
 *
 * Mocks prisma + auto-learn + brain bus + audit · no real DB.
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

vi.mock("@/lib/services/auto-learn", () => ({
  runAutoLearn: vi.fn(async () => null),
}));

vi.mock("@/lib/services/skill-reinforce", () => ({
  reinforceSkill: vi.fn(async () => undefined),
  matchSkillKeys: vi.fn(() => []),
}));

vi.mock("@/lib/runtime", () => ({
  isDemoMode: false,
}));

import { checkTask } from "@/lib/services/task-actions";

function setupOnceParent(opts: { id?: string; loopKind?: string } = {}) {
  const id = opts.id ?? "parent-1";
  // Parent task lookup · ONCE by default.
  mocks.task.findUnique.mockResolvedValueOnce({
    id,
    title: "parent task",
    finishCondition: "done",
    missionId: "mission-1",
    loopKind: opts.loopKind ?? "ONCE",
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
    mission: { title: "Mission 1", domain: "test" },
    goal: null,
  });
  // task.update returns the updated row (success path).
  mocks.task.update.mockResolvedValue({
    id,
    status: "DONE",
    loopKind: opts.loopKind ?? "ONCE",
    actualMinutes: 0,
    effort: "M30",
  });
  // syncTaskPriorities sweep — return empty so it no-ops.
  mocks.task.findMany.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brainMemory.findMany.mockResolvedValue([]);
  mocks.brainMemory.upsert.mockResolvedValue({});
});

// ── Happy path · cascade with open children ──

describe("checkTask · cascade · happy path", () => {
  it("cascades all open children when cascadeChildren=true", async () => {
    setupOnceParent();
    // updateMany returns the affected count (N children flipped).
    mocks.task.updateMany.mockResolvedValueOnce({ count: 3 });

    const result = await checkTask({
      id: "parent-1",
      action: "complete",
      cascadeChildren: true,
    });

    expect(mocks.task.updateMany).toHaveBeenCalledTimes(1);
    const cascadeArgs = mocks.task.updateMany.mock.calls[0][0];
    expect(cascadeArgs.where).toMatchObject({
      parentTaskId: "parent-1",
      status: { notIn: ["DONE", "ARCHIVED"] },
      deletedAt: null,
    });
    expect(cascadeArgs.data.status).toBe("DONE");
    expect(cascadeArgs.data.lastTouchedAt).toBeInstanceOf(Date);
    expect(cascadeArgs.data.lastCompletedAt).toBeInstanceOf(Date);
    expect(result.childrenCascaded).toBe(3);
  });

  it("returns childrenCascaded=0 when no open children match", async () => {
    setupOnceParent();
    mocks.task.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await checkTask({
      id: "parent-1",
      action: "complete",
      cascadeChildren: true,
    });

    // updateMany still called · WHERE filter just matches zero rows.
    expect(mocks.task.updateMany).toHaveBeenCalledTimes(1);
    expect(result.childrenCascaded).toBe(0);
  });
});

// ── Opt-out · no cascade when flag absent or false ──

describe("checkTask · cascade · opt-out", () => {
  it("skips cascade entirely when cascadeChildren=false", async () => {
    setupOnceParent();

    const result = await checkTask({
      id: "parent-1",
      action: "complete",
      cascadeChildren: false,
    });

    expect(mocks.task.updateMany).not.toHaveBeenCalled();
    expect(result.childrenCascaded).toBe(0);
  });

  it("skips cascade entirely when cascadeChildren is undefined (default)", async () => {
    setupOnceParent();

    const result = await checkTask({
      id: "parent-1",
      action: "complete",
    });

    expect(mocks.task.updateMany).not.toHaveBeenCalled();
    expect(result.childrenCascaded).toBe(0);
  });
});

// ── DAILY carve-out · streak math wins ──

describe("checkTask · cascade · DAILY carve-out (Rule 1 exception)", () => {
  it("does NOT cascade on a DAILY parent even when cascadeChildren=true", async () => {
    setupOnceParent({ loopKind: "DAILY" });

    const result = await checkTask({
      id: "parent-1",
      action: "complete",
      cascadeChildren: true,
    });

    // DAILY branch returns early without ever reaching the ONCE/PROMISE
    // cascade block. updateMany must not fire.
    expect(mocks.task.updateMany).not.toHaveBeenCalled();
    // The DAILY result shape doesn't carry childrenCascaded (it's
    // optional · undefined is the expected legacy shape).
    expect(result.childrenCascaded).toBeUndefined();
  });
});

// ── Failure mode · cascade error is degraded ──

describe("checkTask · cascade · graceful degradation", () => {
  it("logs + degrades when updateMany throws · parent completion still succeeds", async () => {
    setupOnceParent();
    mocks.task.updateMany.mockRejectedValueOnce(
      new Error("network blip"),
    );

    const result = await checkTask({
      id: "parent-1",
      action: "complete",
      cascadeChildren: true,
    });

    // Parent still marked DONE · the cascade failure is bonus-work
    // that lost · not a primary-action failure.
    expect(result.ok).toBe(true);
    expect(result.task?.status).toBe("DONE");
    expect(result.childrenCascaded).toBe(0);
  });
});

describe("checkTask · outcomes", () => {
  it("saves completionNote and outcomeScore for ONCE loops", async () => {
    setupOnceParent();
    
    await checkTask({
      id: "parent-1",
      action: "complete",
      completionNote: "Excellent outcome note",
      outcomeScore: 92,
    });

    expect(mocks.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "parent-1" },
        data: expect.objectContaining({
          completionNote: "Excellent outcome note",
          outcomeScore: 92,
        }),
      }),
    );
  });

  it("saves completionNote and outcomeScore for DAILY loops", async () => {
    setupOnceParent({ loopKind: "DAILY" });

    await checkTask({
      id: "parent-1",
      action: "complete",
      completionNote: "Daily loop note",
      outcomeScore: 75,
    });

    expect(mocks.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "parent-1" },
        data: expect.objectContaining({
          completionNote: "Daily loop note",
          outcomeScore: 75,
        }),
      }),
    );
  });
});
