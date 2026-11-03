/**
 * W6 second reader (pr-test-analyzer P2): the brain hook's .catch must cover the dynamic import itself, not only a
 * rejecting afterGoalMoment. Here the goal-brain module fails to load (a throwing mock factory), so a .catch moved
 * inside .then would leave an unhandled rejection and this test would fail.
 */
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ idempotentCreate: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { goalEvent: {} } }));
vi.mock("@/lib/db/idempotency", () => ({
  idempotentCreate: h.idempotentCreate,
  idempotencyRecipe: { goalEvent: () => "key" },
}));
vi.mock("@/lib/brain/goal-brain", () => {
  throw new Error("module load failed");
});
vi.mock("@/lib/logger", async (orig) => {
  const m = await orig<typeof import("@/lib/logger")>();
  return { ...m, logger: { ...m.logger, withSurface: (s: string) => ({ ...m.logger.withSurface(s), warn: h.warn }) } };
});

import { emitGoalEvent } from "@/lib/brain/goal-events";

describe("emitGoalEvent with a goal-brain module that fails to load", () => {
  it("logs goal_brain_hook_failed and leaves no unhandled rejection", async () => {
    h.idempotentCreate.mockResolvedValue({ created: true, row: { id: "ge_1" } });
    await emitGoalEvent({ goalId: "goal_A", kind: "achieved" });
    await vi.waitFor(() =>
      expect(h.warn).toHaveBeenCalledWith("goal_brain_hook_failed", expect.objectContaining({ goalId: "goal_A", err: expect.stringContaining("error when mocking a module") })),
    );
  });
});
