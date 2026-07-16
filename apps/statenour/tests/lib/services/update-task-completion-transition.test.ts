/**
 * tests/lib/services/update-task-completion-transition.test.ts ·
 * high-fix wave 2026-07-16.
 *
 * Locks the updateTask completion-branch contract:
 *
 *   1. A PATCH that transitions to DONE *and* carries other fields
 *      (title, dueDate, …) persists those fields — the old branch
 *      short-circuited into checkTask and silently dropped them
 *      (the edit sheet sends combined "edit + complete" payloads).
 *   2. A PATCH on an already-DONE task that re-sends status DONE
 *      (the edit sheet always includes the current status) takes the
 *      generic field-update path: edits persist and completion side
 *      effects (brain-bus emitTaskCompleted) do NOT re-fire.
 *
 * Mocks prisma + side-effect modules · no real DB.
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

import { updateTask } from "@/lib/services/tasks";
import { emitTaskCompleted } from "@/lib/db/brain-bus-emit";
import { emitTaskEventAsync } from "@/lib/brain/task-events";

const NOW_ISO = "2026-07-16T15:00:00Z";

/** Row shape for updateTask's own `existing` lookup + checkTask's select. */
function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "old title",
    finishCondition: "done",
    missionId: "mission-1",
    loopKind: "ONCE",
    status: "READY",
    lastCompletedAt: null,
    streakCount: 0,
    startedAt: null,
    actualMinutes: 0,
    context: "ANYWHERE",
    effort: "M30",
    autoPriority: 50,
    autoPriorityExplanation: "",
    roiScore: 50,
    frictionScore: 30,
    energyRequired: "MEDIUM",
    dueDate: null,
    manualPriorityOverride: null,
    lastTouchedAt: new Date(NOW_ISO),
    updatedAt: new Date(NOW_ISO),
    createdAt: new Date(NOW_ISO),
    deletedAt: null,
    goalId: null,
    mission: { id: "mission-1", title: "Mission 1", domain: "test", status: "ACTIVE" },
    goal: null,
    events: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brainMemory.findMany.mockResolvedValue([]);
  mocks.brainMemory.upsert.mockResolvedValue({});
  mocks.mission.findMany.mockResolvedValue([]);
  mocks.task.findMany.mockResolvedValue([]);
});

describe("updateTask · DONE transition with co-sent fields", () => {
  it("persists the non-completion fields before delegating to checkTask", async () => {
    mocks.task.findUnique
      .mockResolvedValueOnce(taskRow()) // updateTask `existing`
      .mockResolvedValueOnce(taskRow()) // checkTask's own select
      .mockResolvedValue(null); // post-check hydration — not asserted on
    mocks.task.update.mockResolvedValue({
      id: "t1",
      status: "DONE",
      loopKind: "ONCE",
      actualMinutes: 0,
      effort: "M30",
    });

    await updateTask("t1", { title: "new title", status: "DONE" });

    // First write is the rest-persist: the co-sent title, no status.
    const firstUpdate = mocks.task.update.mock.calls[0][0];
    expect(firstUpdate.where).toEqual({ id: "t1" });
    expect(firstUpdate.data.title).toBe("new title");
    expect(firstUpdate.data.status).toBeUndefined();

    // The completion itself still fired (checkTask's DONE write + brain-bus).
    const statusWrites = mocks.task.update.mock.calls.filter(
      (call) => call[0]?.data?.status === "DONE",
    );
    expect(statusWrites.length).toBe(1);
    expect(emitTaskCompleted).toHaveBeenCalledTimes(1);
  });

  it("skips the rest-persist write when the payload is completion-only", async () => {
    mocks.task.findUnique
      .mockResolvedValueOnce(taskRow())
      .mockResolvedValueOnce(taskRow())
      .mockResolvedValue(null);
    mocks.task.update.mockResolvedValue({
      id: "t1",
      status: "DONE",
      loopKind: "ONCE",
      actualMinutes: 0,
      effort: "M30",
    });

    await updateTask("t1", { status: "DONE" });

    // Only checkTask's own DONE write — no extra field-update round-trip.
    expect(mocks.task.update).toHaveBeenCalledTimes(1);
    expect(mocks.task.update.mock.calls[0][0].data.status).toBe("DONE");
  });
});

describe("updateTask · partial PATCH must not inject schema defaults", () => {
  it("taskUpdateSchema no longer applies field defaults to absent keys", async () => {
    const { taskUpdateSchema } = await import("@/lib/validators/tasks");
    const parsed = taskUpdateSchema.parse({ status: "DONE" });
    const definedKeys = Object.entries(parsed)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    // Pre-fix, zod v4 injected effort/roiScore/streakCount/loopKind/… via
    // the .default() wrappers surviving .partial().
    expect(definedKeys).toEqual(["status"]);
  });

  it("a 2-field snooze write carries no default resets (streak survives)", async () => {
    mocks.task.findUnique
      .mockResolvedValueOnce(taskRow({ loopKind: "DAILY", streakCount: 7 })) // `existing`
      .mockResolvedValue(taskRow({ loopKind: "DAILY", status: "WAITING", streakCount: 7 }));
    mocks.task.update.mockResolvedValue(
      taskRow({ loopKind: "DAILY", status: "WAITING", streakCount: 7 }),
    );

    await updateTask("t1", {
      status: "WAITING",
      snoozedUntil: "2026-07-17T04:00:00Z",
    });

    const txWrite = mocks.task.update.mock.calls[0][0];
    expect(txWrite.data.status).toBe("WAITING");
    expect(txWrite.data.snoozedUntil).toBeInstanceOf(Date);
    // The old defaulted-partial schema injected these on every PATCH,
    // zeroing streaks and resetting effort/loopKind on a plain snooze.
    expect(txWrite.data.streakCount).toBeUndefined();
    expect(txWrite.data.effort).toBeUndefined();
    expect(txWrite.data.loopKind).toBeUndefined();
    expect(txWrite.data.roiScore).toBeUndefined();
    expect(txWrite.data.actualMinutes).toBeUndefined();
  });
});

describe("updateTask · already-DONE task (no transition)", () => {
  it("applies field edits via the generic path without re-running completion side effects", async () => {
    mocks.task.findUnique
      .mockResolvedValueOnce(taskRow({ status: "DONE" })) // `existing`
      .mockResolvedValue(taskRow({ status: "DONE", title: "fix typo" })); // tx hydration
    mocks.task.update.mockResolvedValue(
      taskRow({ status: "DONE", title: "fix typo" }),
    );

    await updateTask("t1", { title: "fix typo", status: "DONE" });

    // Exactly one write — the generic tx update carrying the edit.
    expect(mocks.task.update).toHaveBeenCalledTimes(1);
    expect(mocks.task.update.mock.calls[0][0].data.title).toBe("fix typo");

    // Completion side effects must NOT re-fire on a DONE → DONE re-send.
    expect(emitTaskCompleted).not.toHaveBeenCalled();
    expect(emitTaskEventAsync).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "completed" }),
    );
    expect(mocks.task.updateMany).not.toHaveBeenCalled();
  });
});
