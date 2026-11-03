/**
 * W6 (job 2026-11-02-nour-os-interconnect): emitGoalEvent hands an achieved or missed goal to the brain writer,
 * with the id of the GoalEvent it just created. A replayed emit (idempotency hit) and other kinds hand nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ idempotentCreate: vi.fn(), afterGoalMoment: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/logger", async (orig) => {
  const m = await orig<typeof import("@/lib/logger")>();
  return { ...m, logger: { ...m.logger, withSurface: (s: string) => ({ ...m.logger.withSurface(s), warn: h.warn }) } };
});
vi.mock("@/lib/prisma", () => ({ prisma: { goalEvent: {} } }));
vi.mock("@/lib/db/idempotency", () => ({
  idempotentCreate: h.idempotentCreate,
  idempotencyRecipe: { goalEvent: () => "key" },
}));
vi.mock("@/lib/brain/goal-brain", () => ({ afterGoalMoment: h.afterGoalMoment }));

import { emitGoalEvent } from "@/lib/brain/goal-events";

const settle = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  h.idempotentCreate.mockReset().mockResolvedValue({ created: true, row: { id: "ge_9" } });
  h.afterGoalMoment.mockReset();
  h.warn.mockReset();
});

describe("emitGoalEvent -> brain", () => {
  it("achieved and missed reach the brain writer with the new event id", async () => {
    await emitGoalEvent({ goalId: "goal_B", kind: "missed", source: "test" });
    await vi.waitFor(() => expect(h.afterGoalMoment).toHaveBeenCalledTimes(1));
    await emitGoalEvent({ goalId: "goal_A", kind: "achieved", source: "test" });
    await vi.waitFor(() => expect(h.afterGoalMoment).toHaveBeenCalledTimes(2));
    expect(h.afterGoalMoment).toHaveBeenCalledWith({ goalEventId: "ge_9", goalId: "goal_B", kind: "missed" });
    expect(h.afterGoalMoment).toHaveBeenCalledWith({ goalEventId: "ge_9", goalId: "goal_A", kind: "achieved" });
  });

  it("a replayed emit and any other kind write nothing", async () => {
    h.idempotentCreate.mockResolvedValueOnce({ created: false, row: { id: "ge_old" } });
    await emitGoalEvent({ goalId: "goal_A", kind: "achieved" });
    await emitGoalEvent({ goalId: "goal_A", kind: "progress_logged", payload: { delta: 1 } });
    await emitGoalEvent({ goalId: "goal_A", kind: "task_completed", payload: { taskId: "t1" } });
    await settle();
    expect(h.afterGoalMoment).not.toHaveBeenCalled();
  });

  it("a failed brain hook is caught and logged, never an unhandled rejection", async () => {
    h.afterGoalMoment.mockRejectedValueOnce(new Error("module load failed"));
    await emitGoalEvent({ goalId: "goal_A", kind: "achieved" });
    await vi.waitFor(() => expect(h.warn).toHaveBeenCalledWith("goal_brain_hook_failed", expect.objectContaining({ err: "module load failed" })));
  });
});
