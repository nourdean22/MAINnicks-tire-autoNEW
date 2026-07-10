import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "@/lib/trpc/root";
import { TRPCError } from "@trpc/server";

let mockMutationLock = false;

vi.mock("@/lib/feature-flags", () => ({
  getFlag: (key: string) => {
    if (key === "NICK_MUTATION_LOCK") {
      return { key: "NICK_MUTATION_LOCK", isOn: mockMutationLock };
    }
    return null;
  },
}));

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    task: {
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

// Mock the actual deleteTask helper so we don't hit import issues
vi.mock("@/lib/services/tasks", () => ({
  deleteTask: vi.fn().mockResolvedValue({ id: "task-1" }),
}));

describe("tRPC mutation lock gate", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMutationLock = false;
    caller = appRouter.createCaller({
      session: {
        id: "operator-1",
        email: "operator@statenour.local",
        role: "operator",
      },
      db: mockPrisma as any,
    });
  });

  it("allows mutations to proceed when NICK_MUTATION_LOCK is false", async () => {
    mockMutationLock = false;
    const result = await caller.task.delete({ id: "task-1" });
    expect(result).toEqual({ id: "task-1" });
  });

  it("throws FORBIDDEN TRPCError when NICK_MUTATION_LOCK is true", async () => {
    mockMutationLock = true;
    await expect(caller.task.delete({ id: "task-1" })).rejects.toThrowError(
      new TRPCError({
        code: "FORBIDDEN",
        message: "Mutations are currently locked by NICK_MUTATION_LOCK.",
      })
    );
  });
});
