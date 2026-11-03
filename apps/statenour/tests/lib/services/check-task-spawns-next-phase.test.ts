/**
 * Positive control for W8a item 1 (audit A1): milestones 2..N never spawned because the only
 * maybeSpawnNextPhase call sat in updateTask's UNREACHABLE branch. checkTask is the one completion
 * path every writer uses (UI checkbox, PATCH, Nick's completeTask), so the hook lives there now.
 * Also pins item 2 at write time: a spawned task inherits the mission's goal, and the lift reads it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  mission: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
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
      fn({ task: mocks.task, mission: mocks.mission, brainMemory: mocks.brainMemory, lifeGoal: mocks.lifeGoal }),
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

import { prisma } from "@/lib/prisma";
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

function lastTaskOfPhaseOne(goalId: string | null = null, ownGoalArchived = false) {
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
    mission: { title: "Mission 1", domain: "PERSONAL", lifeGoalId: "g-1", lifeGoal: { id: "g-1", title: "Mission goal", deletedAt: null } },
    goal: goalId ? { id: goalId, title: "Own goal", domain: "PERSONAL", deletedAt: ownGoalArchived ? new Date("2026-11-02T00:00:00Z") : null } : null,
  });
  mocks.task.update.mockResolvedValue({ id: "t-1", status: "DONE", loopKind: "ONCE", actualMinutes: 0, effort: "M30" });
  mocks.task.findMany.mockResolvedValue([]);
  mocks.task.count.mockResolvedValue(0); // no other open task in Phase 1
  mocks.mission.findUnique.mockResolvedValue({ id: "mission-1", planData: PLAN, lifeGoalId: "g-1", updatedAt: new Date("2026-11-03T12:00:00Z") });
  mocks.mission.updateMany.mockResolvedValue({ count: 1 });
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
  it("creates every Phase 2 step as a READY task (the goal comes through the mission, never copied), and writes the ids back", async () => {
    lastTaskOfPhaseOne();

    const r = (await (checkTask as unknown as Exec)({ id: "t-1", action: "complete" })) as Record<string, unknown>;

    expect(r.ok).toBe(true);
    expect(mocks.task.count).toHaveBeenCalledWith({
      where: { missionId: "mission-1", phaseName: "Phase 1", deletedAt: null, status: { in: ["INBOX", "READY", "DOING", "WAITING"] } },
    });
    expect(mocks.task.create).toHaveBeenCalledTimes(2);
    const created = mocks.task.create.mock.calls.map((c) => c[0].data);
    expect(created[0]).toMatchObject({ title: "Step 2", missionId: "mission-1", status: "READY", phaseName: "Phase 2" });
    expect(created[1]).toMatchObject({ title: "Step 3", phaseName: "Phase 2", finishCondition: "Checkpoint reached" });
    // Round 1 P1-10: the override slot stays empty; goalTaskWhere / taskGoalServer / the lift resolve the mission's goal.
    expect(created.every((d) => !("goalId" in d))).toBe(true);
    const plan = mocks.mission.updateMany.mock.calls[0][0].data.planData;
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

  it("a spawn failure is logged, named on the result (round 1 P1-4) and never fails the completion", async () => {
    lastTaskOfPhaseOne();
    mocks.mission.findUnique.mockRejectedValue(new Error("db down"));

    const r = (await (checkTask as unknown as Exec)({ id: "t-1", action: "complete" })) as Record<string, unknown>;

    expect(r.ok).toBe(true);
    expect(r.nextPhaseSpawned).toBe(0);
    expect(String(r.nextPhaseSpawnFailed)).toContain("db down");
    expect(mocks.warn).toHaveBeenCalledWith(
      "services/task-actions",
      "phase_progression_failed",
      expect.objectContaining({ missionId: "mission-1", phaseName: "Phase 1" }),
    );
  });

  it("goalLifted is true only when the goal's value actually moved (round 1 P1-9)", async () => {
    lastTaskOfPhaseOne(null);
    mocks.lifeGoal.findUnique.mockResolvedValue({ id: "g-1", status: "active", kind: "metric", currentValue: 0, targetValue: 15000 });

    const r = (await (checkTask as unknown as Exec)({ id: "t-1", action: "complete" })) as { reward?: { goalLifted: boolean } };

    expect(r.reward?.goalLifted).toBe(false); // a metric goal's number moves only through a check-in
  });

  it("goalLifted is false when the lift is a repeat (P2002) or fails, and the completion still succeeds (round 1 part 2)", async () => {
    lastTaskOfPhaseOne(null);
    mocks.brainMemory.create.mockRejectedValueOnce(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
    const repeat = (await (checkTask as unknown as Exec)({ id: "t-1", action: "complete" })) as { reward?: { goalLifted: boolean } };
    expect(repeat.reward?.goalLifted).toBe(false);

    lastTaskOfPhaseOne(null);
    mocks.brainMemory.create.mockRejectedValueOnce(new Error("connection reset"));
    const failed = (await (checkTask as unknown as Exec)({ id: "t-1", action: "complete" })) as { reward?: { goalLifted: boolean }; task?: unknown };
    expect(failed.reward?.goalLifted).toBe(false);
    expect(mocks.warn).toHaveBeenCalledWith(expect.any(String), "goal_lift_failed", expect.objectContaining({ taskId: "t-1", goalId: "g-1" }));
  });

  it("lifts the mission's goal when the task has none of its own (A2: the lift reads the inherited goal)", async () => {
    lastTaskOfPhaseOne(null);

    await (checkTask as unknown as Exec)({ id: "t-1", action: "complete" });

    expect(mocks.brainMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ key: "goal-lift:g-1:t-1" }) }),
    );
  });

  it("own goal first: a task with its own live goal lifts that goal, not the mission's (round 1 part 2)", async () => {
    lastTaskOfPhaseOne("g-2");
    mocks.lifeGoal.findUnique.mockResolvedValue({ id: "g-2", status: "active", kind: "milestone", currentValue: 0, targetValue: 0 });

    await (checkTask as unknown as Exec)({ id: "t-1", action: "complete" });

    const keys = mocks.brainMemory.create.mock.calls.map((c) => (c[0] as { data: { key?: string } }).data.key);
    expect(keys).toContain("goal-lift:g-2:t-1");
    expect(keys).not.toContain("goal-lift:g-1:t-1");
  });

  it("an ARCHIVED own goal is never lifted: the lift falls back to the mission's live goal (round 1 part 2)", async () => {
    lastTaskOfPhaseOne("g-2", true);

    await (checkTask as unknown as Exec)({ id: "t-1", action: "complete" });

    const keys = mocks.brainMemory.create.mock.calls.map((c) => (c[0] as { data: { key?: string } }).data.key);
    expect(keys).toContain("goal-lift:g-1:t-1");
    expect(keys).not.toContain("goal-lift:g-2:t-1");
  });

  it("two concurrent completions of Phase 1 spawn Phase 2 once: the loser rolls back and spawns 0 (round 1 part 2)", async () => {
    // A rollback-aware store: creates are pending until the transaction returns, the mission swap is a real
    // compare on updatedAt, and both transactions read the plan before either writes (the race window).
    const store = { planData: JSON.parse(JSON.stringify(PLAN)) as typeof PLAN, updatedAt: new Date("2026-11-03T12:00:00Z") };
    const committed: string[] = [];
    let reads = 0;
    let openBarrier!: () => void;
    const barrier = new Promise<void>((r) => (openBarrier = r));
    let seq = 0;
    const defaultTx = vi.mocked(prisma.$transaction).getMockImplementation();
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => {
      const pending: string[] = [];
      const tx = {
        brainMemory: mocks.brainMemory, // the lift's marker + increment transaction (no rollback needed here)
        lifeGoal: mocks.lifeGoal,
        task: {
          ...mocks.task,
          create: vi.fn(async () => {
            const id = `t-new-${++seq}`;
            pending.push(id);
            return { id };
          }),
        },
        mission: {
          findUnique: vi.fn(async () => {
            const snap = { planData: JSON.parse(JSON.stringify(store.planData)), updatedAt: store.updatedAt };
            if (++reads === 2) openBarrier();
            if (reads <= 2) await barrier;
            return snap;
          }),
          updateMany: vi.fn(async ({ where, data }: { where: { updatedAt: Date }; data: { planData: typeof PLAN } }) => {
            if (where.updatedAt.getTime() !== store.updatedAt.getTime()) return { count: 0 };
            store.planData = data.planData;
            store.updatedAt = new Date(store.updatedAt.getTime() + 1000);
            return { count: 1 };
          }),
        },
      };
      const out = await fn(tx); // a throw discards `pending`: the rollback
      committed.push(...pending);
      return out;
    }) as never);
    lastTaskOfPhaseOne(null);
    lastTaskOfPhaseOne(null);

    const results = (await Promise.all([
      (checkTask as unknown as Exec)({ id: "t-1", action: "complete" }),
      (checkTask as unknown as Exec)({ id: "t-1", action: "complete" }),
    ])) as Array<{ nextPhaseSpawned?: number; nextPhaseSpawnFailed?: boolean }>;
    vi.mocked(prisma.$transaction).mockImplementation(defaultTx as never);

    expect(results.map((r) => r.nextPhaseSpawned).sort()).toEqual([0, 2]);
    expect(results.some((r) => r.nextPhaseSpawnFailed)).toBe(false);
    expect(committed).toHaveLength(2);
    expect(store.planData.phases[1].steps.map((st) => (st as { taskId?: string }).taskId)).toEqual(committed);
  });
});
