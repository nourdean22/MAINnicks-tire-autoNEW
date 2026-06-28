import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "@/lib/trpc/root";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    task: {
      count: vi.fn(),
    },
    captureInboxItem: {
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

describe("tRPC task.inboxCount & task.captureInboxCount", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    caller = appRouter.createCaller({
      session: {
        id: "operator-1",
        email: "operator@statenour.local",
        role: "operator",
      },
      db: mockPrisma as any,
    });
  });

  it("returns task count when calling task.inboxCount", async () => {
    mockPrisma.task.count.mockResolvedValue(5);

    const result = await caller.task.inboxCount();

    expect(result).toBe(5);
    expect(mockPrisma.task.count).toHaveBeenCalledWith({
      where: {
        status: "INBOX",
        deletedAt: null,
      },
    });
  });

  it("returns capture count when calling task.captureInboxCount", async () => {
    mockPrisma.captureInboxItem.count.mockResolvedValue(12);

    const result = await caller.task.captureInboxCount();

    expect(result).toBe(12);
    expect(mockPrisma.captureInboxItem.count).toHaveBeenCalledWith({
      where: {
        status: "active",
        triageStatus: "NEW",
      },
    });
  });
});
