import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  lifeGoal: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  task: {
    findMany: vi.fn(),
  },
  brainDump: {
    findMany: vi.fn(),
  },
  taskEvent: {
    findMany: vi.fn(),
  },
  // 2026-11-02: a goal lists the missions planned from it (Mission.lifeGoalId).
  mission: {
    findMany: vi.fn(),
  },
  // W2 2026-11-02: health is the newest check_in GoalEvent.
  goalEvent: {
    findMany: vi.fn(),
  },
  // W5 2026-11-03: the maxims Nour skipped on Home (lib/services/home-maxim.ts skippedIds).
  brainMemory: {
    findMany: vi.fn(),
  },
  emitGoalEventAsync: vi.fn(),
  emitGoalTransition: vi.fn(),
  softDelete: vi.fn(),
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: mocks.lifeGoal,
    task: mocks.task,
    taskEvent: mocks.taskEvent,
    brainDump: mocks.brainDump,
    mission: mocks.mission,
    goalEvent: mocks.goalEvent,
    brainMemory: mocks.brainMemory,
  },
}));

vi.mock("@/lib/brain/goal-events", () => ({
  emitGoalEventAsync: mocks.emitGoalEventAsync,
}));

vi.mock("@/lib/db/brain-bus-emit", () => ({
  emitGoalTransition: mocks.emitGoalTransition,
}));

vi.mock("@/lib/db/soft-delete", () => ({
  softDelete: mocks.softDelete,
  // v10.0.529.106 wave-74 · faithful stub for the activeOnly() helper.
  activeOnly: (where?: object) =>
    where ? { ...where, deletedAt: null } : { deletedAt: null },
}));

vi.mock("@/lib/db/entity-audit", () => ({
  logCreate: mocks.logCreate,
  logUpdate: mocks.logUpdate,
  stripNoise: vi.fn((x) => x),
}));

import { createGoal, getGoals, updateGoal, removeGoal } from "@/lib/services/goals";

describe("Goals Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // createGoal dedups via lifeGoal.findFirst (ghost-goal fix, task #91) —
    // default to "no existing goal" so the create path runs. Dedup-specific
    // tests can override this per-test.
    mocks.lifeGoal.findFirst.mockResolvedValue(null);
  });

  describe("getGoals", () => {
    it("returns goals enriched with tasks and progress", async () => {
      mocks.lifeGoal.findMany.mockResolvedValue([
        { id: "g1", title: "Test Goal", progress: 0, status: "active" },
      ]);
      mocks.task.findMany.mockResolvedValue([
        { id: "t1", title: "Test Task 1", goalId: "g1", status: "DONE", actualMinutes: 30 },
        { id: "t2", title: "Test Task 2", goalId: "g1", status: "DOING", actualMinutes: 10 },
      ]);
      mocks.taskEvent.findMany.mockResolvedValue([]);

      const result = await getGoals();

      expect(result).toHaveLength(1);
      expect(result[0].progress).toBe(50); // 1 out of 2 tasks done
      expect(result[0].minutesInvested).toBe(40);
      expect(result[0].linkedActiveCount).toBe(1);
      expect(result[0].nextMove?.id).toBe("t2");
    });

    it("surfaces the highest-priority active task when no task is doing", async () => {
      mocks.lifeGoal.findMany.mockResolvedValue([
        { id: "g1", title: "Priority Goal", progress: 0, status: "active" },
      ]);
      mocks.task.findMany.mockResolvedValue([
        { id: "low", title: "Low", goalId: "g1", status: "READY", actualMinutes: 0, autoPriority: 30, manualPriorityOverride: null, dueDate: null },
        { id: "critical", title: "Critical", goalId: "g1", status: "READY", actualMinutes: 0, autoPriority: 90, manualPriorityOverride: null, dueDate: null },
        { id: "unscored", title: "Unscored", goalId: "g1", status: "READY", actualMinutes: 0, autoPriority: null, manualPriorityOverride: null, dueDate: null },
      ]);
      mocks.taskEvent.findMany.mockResolvedValue([]);

      const result = await getGoals();

      expect(result[0].nextMove?.id).toBe("critical");
    });

    it("lists the missions planned from the goal with phase and task counts", async () => {
      mocks.lifeGoal.findMany.mockResolvedValue([
        { id: "g1", title: "Goal", progress: 0, status: "active" },
        { id: "g2", title: "Other", progress: 0, status: "active" },
      ]);
      mocks.task.findMany.mockResolvedValue([]);
      mocks.taskEvent.findMany.mockResolvedValue([]);
      mocks.mission.findMany.mockResolvedValueOnce([
        {
          id: "m1",
          title: "Goal",
          status: "ACTIVE",
          lifeGoalId: "g1",
          planData: { v: 1, phases: [{ name: "a", steps: [] }, { name: "b", steps: [] }, { name: "c", steps: [] }] },
          tasks: [{ status: "DONE", phaseName: "a" }, { status: "READY", phaseName: "b" }, { status: "DOING", phaseName: "b" }],
        },
      ]);

      const result = await getGoals();

      expect(mocks.mission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ lifeGoalId: { in: ["g1", "g2"] }, deletedAt: null }) }),
      );
      // W5: the card's milestone ladder needs each task's phase.
      expect(mocks.mission.findMany.mock.calls[0]![0].select.tasks.select).toEqual({ status: true, phaseName: true });
      expect(result[0].missions).toEqual([
        {
          id: "m1",
          title: "Goal",
          status: "ACTIVE",
          phaseCount: 3,
          tasksDone: 1,
          tasksTotal: 3,
          phases: [
            { name: "a", done: true, current: false },
            { name: "b", done: false, current: true },
            { name: "c", done: false, current: false },
          ],
        },
      ]);
      expect(result[1].missions).toEqual([]);
    });

    it("W5: each goal row carries the maxim ids Nour skipped on Home", async () => {
      mocks.lifeGoal.findMany.mockResolvedValue([{ id: "g1", title: "Goal", progress: 0, status: "active" }]);
      mocks.task.findMany.mockResolvedValue([]);
      mocks.taskEvent.findMany.mockResolvedValue([]);
      mocks.mission.findMany.mockResolvedValueOnce([]);
      mocks.brainMemory.findMany.mockResolvedValueOnce([{ key: "naval:12" }, { key: "greene:3" }]);

      const result = await getGoals();

      expect(mocks.brainMemory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ category: "maxim_skip", deletedAt: null }) }),
      );
      expect(result[0].skippedMaximIds).toEqual(["naval:12", "greene:3"]);
    });

    it("W5: a failed skip read is null (unknown), never an empty list", async () => {
      mocks.lifeGoal.findMany.mockResolvedValue([{ id: "g1", title: "Goal", progress: 0, status: "active" }]);
      mocks.task.findMany.mockResolvedValue([]);
      mocks.taskEvent.findMany.mockResolvedValue([]);
      mocks.mission.findMany.mockResolvedValueOnce([]);
      mocks.brainMemory.findMany.mockRejectedValueOnce(new Error("db down"));

      const result = await getGoals();

      expect(result).toHaveLength(1);
      expect(result[0].skippedMaximIds).toBeNull();
    });

    it("phaseCount counts the ladder's named phases (an unnamed phase is not a milestone)", async () => {
      mocks.lifeGoal.findMany.mockResolvedValue([{ id: "g1", title: "Goal", progress: 0, status: "active" }]);
      mocks.task.findMany.mockResolvedValue([]);
      mocks.taskEvent.findMany.mockResolvedValue([]);
      mocks.mission.findMany.mockResolvedValueOnce([
        { id: "m1", title: "Goal", status: "ACTIVE", lifeGoalId: "g1", planData: { phases: [{ name: "a" }, { name: "" }, {}] }, tasks: [] },
      ]);
      const result = await getGoals();
      expect(result[0].missions?.[0]).toMatchObject({ phaseCount: 1, phases: [{ name: "a", done: false, current: true }] });
    });

    it("the payload no longer carries coachLog (no reader left; W5 removed the panel)", async () => {
      mocks.lifeGoal.findMany.mockResolvedValue([{ id: "g1", title: "Goal", progress: 0, status: "active", coachLog: [{ read: "x" }] }]);
      mocks.task.findMany.mockResolvedValue([]);
      mocks.taskEvent.findMany.mockResolvedValue([]);
      mocks.mission.findMany.mockResolvedValueOnce([]);
      const result = await getGoals();
      expect(result[0]).not.toHaveProperty("coachLog");
    });

    it("a failed missions read lists none and does not break the goals", async () => {
      mocks.lifeGoal.findMany.mockResolvedValue([{ id: "g1", title: "Goal", progress: 0, status: "active" }]);
      mocks.task.findMany.mockResolvedValue([]);
      mocks.taskEvent.findMany.mockResolvedValue([]);
      mocks.mission.findMany.mockRejectedValueOnce(new Error("db down"));

      const result = await getGoals();

      expect(result).toHaveLength(1);
      // W5: null = unread, so the card says the milestones couldn't load instead of "never planned".
      expect(result[0].missions).toBeNull();
    });
  });

  describe("createGoal", () => {
    it("creates a goal and emits events/logs", async () => {
      mocks.lifeGoal.create.mockResolvedValue({ id: "g_new", title: "New Goal" });

      const goal = await createGoal({
        domain: "PERSONAL",
        title: "New Goal",
        horizon: "WEEK",
      });

      expect(goal.id).toBe("g_new");
      expect(mocks.emitGoalEventAsync).toHaveBeenCalledWith({
        goalId: "g_new",
        kind: "created",
        source: "api:goals.POST",
      });
      expect(mocks.logCreate).toHaveBeenCalledWith(
        "lifeGoal",
        "g_new",
        expect.any(Object),
        { source: "api:goals.POST" }
      );
    });
  });

  describe("updateGoal", () => {
    it("updates progress and emits transition if status changes", async () => {
      mocks.lifeGoal.findUnique.mockResolvedValue({ id: "g1", title: "Old", status: "active", currentValue: 0, targetValue: 100 });
      mocks.lifeGoal.update.mockResolvedValue({ id: "g1", title: "Old", status: "achieved", currentValue: 100, targetValue: 100 });

      await updateGoal({
        id: "g1",
        currentValue: 100,
      });

      expect(mocks.lifeGoal.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: "g1" },
        data: expect.objectContaining({ currentValue: 100, status: "achieved", progress: 100 }),
      }));

      expect(mocks.emitGoalTransition).toHaveBeenCalledWith(expect.objectContaining({
        goalId: "g1",
        oldStatus: "active",
        newStatus: "achieved",
      }));
    });
  });

  describe("updateGoal · missed (W6 second reader)", () => {
    it("a goal moving to missed emits a missed GoalEvent once; staying missed emits none", async () => {
      mocks.lifeGoal.findUnique.mockResolvedValue({ id: "g1", title: "Old", status: "active", currentValue: 0, targetValue: 100 });
      mocks.lifeGoal.update.mockResolvedValue({ id: "g1", title: "Old", status: "missed", currentValue: 0, targetValue: 100 });
      await updateGoal({ id: "g1", status: "missed" });
      expect(mocks.emitGoalEventAsync).toHaveBeenCalledWith({ goalId: "g1", kind: "missed", source: "api:goals.PATCH" });
      mocks.emitGoalEventAsync.mockClear();
      mocks.lifeGoal.findUnique.mockResolvedValue({ id: "g1", title: "Old", status: "missed", currentValue: 0, targetValue: 100 });
      await updateGoal({ id: "g1", status: "missed" });
      expect(mocks.emitGoalEventAsync).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "missed" }));
    });
  });

  describe("getGoals · suggestedStep from the journal (2026-10-30 goals-system W3)", () => {
    it("offers a journal action item only to a goal with no open task, never one already a task", async () => {
      mocks.lifeGoal.findMany.mockResolvedValue([
        { id: "g1", title: "T", domain: "business", status: "active", currentValue: 0, targetValue: 0, progress: 0, events: [] },
        { id: "g2", title: "U", domain: "business", status: "active", currentValue: 0, targetValue: 0, progress: 0, events: [] },
      ]);
      // g2 has an open task, so it gets no suggestion and its journal is not read
      mocks.task.findMany
        .mockResolvedValueOnce([{ id: "t1", title: "Open one", goalId: "g2", status: "READY", loopKind: null, actualMinutes: 0, priority: null, dueDate: null }])
        .mockResolvedValueOnce([{ title: "Book the dyno slot" }]);
      mocks.taskEvent.findMany.mockResolvedValue([]);
      mocks.brainDump.findMany.mockResolvedValue([
        { id: "d1", goalId: "g1", createdAt: new Date("2026-10-29T12:00:00Z"), extractedItems: JSON.stringify({ actionItems: [{ title: "Book the dyno slot" }, { title: "Call the supplier" }] }) },
      ]);
      const result = await getGoals();
      expect(result.find((g) => g.id === "g1")?.suggestedStep).toEqual({ title: "Call the supplier", dumpId: "d1" });
      expect(result.find((g) => g.id === "g2")?.suggestedStep).toBeNull();
      const where = mocks.brainDump.findMany.mock.calls[0][0].where;
      expect(where.goalId).toEqual({ in: ["g1"] });
      expect(where.linkStatus).toEqual({ in: ["auto", "confirmed"] });
      // a task Nour threw away still counts as "already a task": no deletedAt filter (W3 review P2)
      expect(mocks.task.findMany.mock.calls[1][0].where).not.toHaveProperty("deletedAt");
    });

    it("a WAITING task is a next step (GTD waiting-for): no 'no next step', no suggestion", async () => {
      mocks.lifeGoal.findMany.mockResolvedValue([
        { id: "g1", title: "T", domain: "business", status: "active", currentValue: 0, targetValue: 0, progress: 0, events: [] },
      ]);
      mocks.task.findMany.mockResolvedValueOnce([{ id: "t1", title: "Waiting on the quote", goalId: "g1", status: "WAITING", loopKind: null, actualMinutes: 0, priority: null, dueDate: null }]);
      mocks.taskEvent.findMany.mockResolvedValue([]);
      mocks.brainDump.findMany.mockResolvedValue([]);
      const result = await getGoals();
      expect(result[0].linkedNextStepCount).toBe(1);
      expect(result[0].suggestedStep).toBeNull();
      expect(mocks.brainDump.findMany).not.toHaveBeenCalled();
    });

    it("a failed journal read offers nothing and never breaks the goals list", async () => {
      mocks.lifeGoal.findMany.mockResolvedValue([
        { id: "g1", title: "T", domain: "business", status: "active", currentValue: 0, targetValue: 0, progress: 0, events: [] },
      ]);
      mocks.task.findMany.mockResolvedValue([]);
      mocks.taskEvent.findMany.mockResolvedValue([]);
      mocks.brainDump.findMany.mockRejectedValue(new Error("neon down"));
      const result = await getGoals();
      expect(result[0].suggestedStep).toBeNull();
    });
  });

  describe("getGoals · horizonSetAt (2026-10-30 goals-system W1)", () => {
    it("passes the latest horizon_set time through, and asks Prisma for it", async () => {
      mocks.lifeGoal.findMany.mockResolvedValue([
        { id: "g1", title: "T", domain: "business", status: "active", currentValue: 0, targetValue: 0, progress: 0, events: [{ createdAt: new Date("2026-10-30T15:00:00.000Z") }] },
        { id: "g2", title: "U", domain: "business", status: "active", currentValue: 0, targetValue: 0, progress: 0, events: [] },
      ]);
      mocks.task.findMany.mockResolvedValue([]);
      mocks.taskEvent.findMany.mockResolvedValue([]);
      const result = await getGoals();
      expect(result.map((g) => g.horizonSetAt)).toEqual(["2026-10-30T15:00:00.000Z", null]);
      expect(result[0]).not.toHaveProperty("events");
      expect(mocks.lifeGoal.findMany.mock.calls[0][0].include.events).toMatchObject({ where: { kind: "horizon_set" }, take: 1 });
    });
  });

  describe("updateGoal · horizon_set (2026-10-30 goals-system W1)", () => {
    it("emits horizon_set when the horizon actually changes", async () => {
      mocks.lifeGoal.findUnique.mockResolvedValue({ id: "g1", title: "T", status: "active", currentValue: 0, targetValue: 0, horizon: "YEAR" });
      mocks.lifeGoal.update.mockResolvedValue({ id: "g1", title: "T", status: "active", currentValue: 0, targetValue: 0, horizon: "WEEK" });
      await updateGoal({ id: "g1", horizon: "WEEK" });
      expect(mocks.emitGoalEventAsync).toHaveBeenCalledWith(
        expect.objectContaining({ goalId: "g1", kind: "horizon_set", payload: { from: "YEAR", to: "WEEK" } }),
      );
    });

    it("the edit form re-sending the same horizon is not a change", async () => {
      mocks.lifeGoal.findUnique.mockResolvedValue({ id: "g1", title: "T", status: "active", currentValue: 0, targetValue: 0, horizon: "WEEK" });
      mocks.lifeGoal.update.mockResolvedValue({ id: "g1", title: "T", status: "active", currentValue: 0, targetValue: 0, horizon: "WEEK" });
      await updateGoal({ id: "g1", horizon: "WEEK", title: "T2" });
      expect(mocks.emitGoalEventAsync).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "horizon_set" }));
    });
  });

  describe("removeGoal", () => {
    it("soft deletes a goal", async () => {
      mocks.softDelete.mockResolvedValue({ ok: true, noop: false });

      const result = await removeGoal("g1");

      expect(result.ok).toBe(true);
      expect(result.soft).toBe(true);
      expect(mocks.softDelete).toHaveBeenCalledWith("lifeGoal", { id: "g1" });
    });
  });
});

describe("getGoals health (W2 2026-11-02, Linear L2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.task.findMany.mockResolvedValue([]);
    mocks.taskEvent.findMany.mockResolvedValue([]);
    mocks.mission.findMany.mockResolvedValue([]);
    mocks.brainDump.findMany.mockResolvedValue([]);
  });
  const recent = new Date(Date.now() - 2 * 86_400_000);
  const goalRow = (id: string) => ({ id, title: id, progress: 0, status: "active", horizon: "WEEK", createdAt: new Date(Date.now() - 60 * 86_400_000) });

  it("carries the newest check-in's health, date and note per goal", async () => {
    mocks.lifeGoal.findMany.mockResolvedValue([goalRow("g1"), goalRow("g2")]);
    mocks.goalEvent.findMany.mockResolvedValue([
      { goalId: "g1", payload: { health: "at_risk", note: "bank call slipped" }, createdAt: recent },
    ]);
    const [g1, g2] = await getGoals();
    expect(g1.health).toEqual({ state: "at_risk", at: recent.toISOString(), note: "bank call slipped" });
    expect(g2.health).toEqual({ state: "no_check_in", at: null, note: null });
    const where = mocks.goalEvent.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ goalId: { in: ["g1", "g2"] }, kind: "check_in" });
  });

  it("a failed check-in read is unknown, never no_check_in", async () => {
    mocks.lifeGoal.findMany.mockResolvedValue([goalRow("g1")]);
    mocks.goalEvent.findMany.mockRejectedValue(new Error("relation does not exist"));
    const [g1] = await getGoals();
    expect(g1.health).toEqual({ state: "unknown", at: null, note: null });
  });
});
