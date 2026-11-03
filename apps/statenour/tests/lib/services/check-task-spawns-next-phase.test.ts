/**
 * Positive control for W8a item 1 (audit A1): milestones 2..N never spawned because the only
 * maybeSpawnNextPhase call sat in updateTask's UNREACHABLE branch. checkTask is the one completion
 * path every writer uses (UI checkbox, PATCH, Nick's completeTask), so the hook lives there now.
 * Also pins item 2 at write time: a spawned task inherits the mission's goal, and the lift reads it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  mission: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  brainMemory: { findMany: vi.fn(), upsert: vi.fn(), create: vi.fn() },
  lifeGoal: { findUnique: vi.fn(), update: vi.fn() },
  warn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: mocks.task,
    mission: mocks.mission,
    brainMemory: mocks.brainMemory,
    lifeGoal: mocks.lifeGoal,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ task: mocks.task, mission: mocks.mission, brainMemory: mocks.brainMemory }),
    ),
  },
}));
vi.mock("@/lib/db/entity-audit", () => ({ logCreate: vi.fn(), logUpdate: vi.fn(), stripNoise: vi.fn((x) => x) }));
vi.mock("@/lib/cache/dashboard-cache", () => ({ invalidateMutationCaches: vi.fn() }));
vi.mock("@/lib/brain/task-events", () => ({ emitTaskEventAsync: vi.fn(), emitTaskCompleted: vi.fn() }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitTaskCompleted: vi.fn() }));
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

const PLAN = {
  v: 1,
  phases: [
    { name: "Phase 1", steps: [{ title: "Step 1", taskId: "t-1" }] },
    {
      name: "Phase 2",
      steps: [{ title: "Step 2", nextAction: "Do step 2", effort: "M15" }, { title: "Step 3", isCheckpoint: true }],
    },
  ],
  updatedAt: "2026-11-01T12:00:00Z",
};

function lastTaskOfPhaseOne(goalId: string | null = null) {
  mocks.task.findUnique.mockResolvedValueOnce({
    id: "t-1",
    title: "Step 1",
    finishCondition: "done",
    missionId: "mission-1",
    phaseName: "Phase 1",
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
    goalId,
    mission: { title: "Mission 1", domain: "PERSONAL", lifeGoalId: "g-1" },
    goal: null,
  });
  mocks.task.update.mockResolvedValue({ id: "t-1", status: "DONE", loopKind: "ONCE", actualMinutes: 0, effort: "M30" });
  mocks.task.findMany.mockResolvedValue([]);
  mocks.task.count.mockResolvedValue(0); // no other open task in Phase 1
  mocks.mission.findUnique.mockResolvedValue({ id: "mission-1", planData: PLAN, lifeGoalId: "g-1" });
  mocks.task.create.mockResolvedValueOnce({ id: "t-2" }).mockResolvedValueOnce({ id: "t-3" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.brainMemory.findMany.mockResolvedValue([]);
  mocks.brainMemory.upsert.mockResolvedValue({});
  mocks.brainMemory.create.mockResolvedValue({});
  mocks.lifeGoal.findUnique.mockResolvedValue({ id: "g-1", status: "active", kind: "milestone", currentValue: 0, targetValue: 0 });
  mocks.lifeGoal.update.mockResolvedValue({ currentValue: 1, targetValue: 0, status: "active" });
});

type Exec = (a: unknown) => Promise<Record<string, unknown>>;

describe("checkTask · completing the last task of a phase spawns the next phase (A1)", () => {
  it("creates every Phase 2 step as a READY task carrying the mission's goal, and writes the ids back into planData", async () => {
    lastTaskOfPhaseOne();

    const r = (await (checkTask as unknown as Exec)({ id: "t-1", action: "complete" })) as Record<string, unknown>;

    expect(r.ok).toBe(true);
    expect(mocks.task.count).toHaveBeenCalledWith({
      where: { missionId: "mission-1", phaseName: "Phase 1", deletedAt: null, status: { in: ["INBOX", "READY", "DOING", "WAITING"] } },
    });
    expect(mocks.task.create).toHaveBeenCalledTimes(2);
    const created = mocks.task.create.mock.calls.map((c) => c[0].data);
    expect(created[0]).toMatchObject({ title: "Step 2", missionId: "mission-1", status: "READY", phaseName: "Phase 2", goalId: "g-1" });
    expect(created[1]).toMatchObject({ title: "Step 3", phaseName: "Phase 2", finishCondition: "Checkpoint reached", goalId: "g-1" });
    const plan = mocks.mission.update.mock.calls[0][0].data.planData;
    expect(plan.phases[1].steps.map((s: { taskId?: string }) => s.taskId)).toEqual(["t-2", "t-3"]);
    expect(r.nextPhaseSpawned).toBe(2);
  });

  it("does not spawn while another task of the phase is still open", async () => {
    lastTaskOfPhaseOne();
    mocks.task.count.mockResolvedValue(1);

    const r = (await (checkTask as unknown as Exec)({ id: "t-1", action: "complete" })) as Record<string, unknown>;

    expect(mocks.task.create).not.toHaveBeenCalled();
    expect(r.nextPhaseSpawned).toBe(0);
  });

  it("a spawn failure is logged and never fails the completion", async () => {
    lastTaskOfPhaseOne();
    mocks.mission.findUnique.mockRejectedValue(new Error("db down"));

    const r = (await (checkTask as unknown as Exec)({ id: "t-1", action: "complete" })) as Record<string, unknown>;

    expect(r.ok).toBe(true);
    expect(mocks.warn).toHaveBeenCalledWith(
      "services/task-actions",
      "phase_progression_failed",
      expect.objectContaining({ missionId: "mission-1", phaseName: "Phase 1" }),
    );
  });

  it("lifts the mission's goal when the task has none of its own (A2: the lift reads the inherited goal)", async () => {
    lastTaskOfPhaseOne(null);

    await (checkTask as unknown as Exec)({ id: "t-1", action: "complete" });

    expect(mocks.brainMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ key: "goal-lift:g-1:t-1" }) }),
    );
  });
});
