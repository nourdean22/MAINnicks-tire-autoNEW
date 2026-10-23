/**
 * task.acceptTaskClassification maps the service refusal to CONFLICT with the
 * service message (Codex P2, PR 3257): an unmapped ServiceError surfaced as
 * INTERNAL_SERVER_ERROR and the formatter replaced the message the chip toasts.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "@/lib/trpc/root";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { task: { findUnique: vi.fn(), update: vi.fn() }, mission: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

describe("tRPC task.acceptTaskClassification", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;
  beforeEach(() => {
    vi.clearAllMocks();
    caller = appRouter.createCaller({ session: { id: "operator-1", email: "operator@statenour.local", role: "operator" }, db: mockPrisma as never });
  });

  it("a suggestion aimed at a closed mission rejects with CONFLICT and the service message", async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ goalId: null, statHints: [], pendingClassification: { missionId: "m-done" } });
    mockPrisma.mission.findFirst.mockResolvedValue(null);
    await expect(caller.task.acceptTaskClassification({ taskId: "t1" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/not active/i),
    });
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it("a missing task rejects with NOT_FOUND", async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);
    await expect(caller.task.acceptTaskClassification({ taskId: "t1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
