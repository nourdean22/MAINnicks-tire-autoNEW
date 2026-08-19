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
  taskEvent: {
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
