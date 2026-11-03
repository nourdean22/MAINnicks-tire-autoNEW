/**
 * Map gap 3 (job 2026-11-02-nour-os-interconnect W2): a finished task added +1 to currentValue
 * whatever the unit, so a $15,000 goal moved $1 per task. A metric goal's value now comes only from a
 * check-in or an explicit edit; the completion is still on the goal's record as a GoalEvent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  memoryCreate: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: { findUnique: h.findUnique, update: h.update },
    brainMemory: { create: h.memoryCreate },
  },
}));
vi.mock("@/lib/brain/goal-events", () => ({ emitGoalEventAsync: h.emit }));

import { liftGoalOnTaskComplete } from "@/lib/services/tasks";

const goal = (kind: string, unit = "$") => ({ id: "g1", kind, unit, currentValue: 4000, targetValue: 15000, status: "active", achievedAt: null });

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.memoryCreate.mockResolvedValue({});
  h.update.mockResolvedValue({ currentValue: 4001, targetValue: 15000, status: "active" });
});

describe("liftGoalOnTaskComplete by goal kind", () => {
  it("a metric goal's value does not move; the completion is recorded as task_completed", async () => {
    h.findUnique.mockResolvedValue(goal("metric"));
    await liftGoalOnTaskComplete("g1", "t1");
    expect(h.update).not.toHaveBeenCalled();
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ goalId: "g1", kind: "task_completed", payload: expect.objectContaining({ taskId: "t1" }) }));
  });

  it("a unitless metric goal is still a metric: no +1 (its check-in carries the value)", async () => {
    h.findUnique.mockResolvedValue(goal("metric", ""));
    await liftGoalOnTaskComplete("g1", "t1");
    expect(h.update).not.toHaveBeenCalled();
  });

  it("a milestone goal keeps the +1 per finished task", async () => {
    h.findUnique.mockResolvedValue(goal("milestone", ""));
    await liftGoalOnTaskComplete("g1", "t1");
    expect(h.update.mock.calls[0][0].data).toEqual({ currentValue: { increment: 1 } });
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ kind: "progress_logged" }));
  });

  it("the metric record is claimed once: a second completion of the same task emits nothing", async () => {
    h.findUnique.mockResolvedValue(goal("metric"));
    h.memoryCreate.mockRejectedValue(new Error("P2002"));
    await liftGoalOnTaskComplete("g1", "t1");
    expect(h.emit).not.toHaveBeenCalled();
  });
});
