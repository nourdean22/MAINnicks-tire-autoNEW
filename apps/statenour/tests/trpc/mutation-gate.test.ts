import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "@/lib/trpc/root";
import { TRPCError } from "@trpc/server";

let mockMutationLock = false;
/** N-1 (2026-09-01 audit) · simulate the flag store being unreachable. */
let mockFlagThrows = false;

vi.mock("@/lib/feature-flags", () => ({
  getFlag: (key: string) => {
    if (mockFlagThrows) throw new Error("flag store unreachable");
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
  listMissions: vi.fn().mockResolvedValue([]),
}));

describe("tRPC mutation lock gate", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMutationLock = false;
    mockFlagThrows = false;
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

  // N-1 (2026-09-01 audit) · the third case the pair above never covered.
  // Both enforcement points used to `catch {}` and PROCEED when the flag
  // lookup threw — a kill switch that fails open under exactly the
  // conditions (flag store down, import failure) that correlate with
  // wanting Nick frozen. middleware.ts in this same repo fails CLOSED on
  // missing auth config, with the incident recorded; the lock now agrees.
  it("fails CLOSED · throws FORBIDDEN when the flag lookup itself throws", async () => {
    mockFlagThrows = true;
    await expect(caller.task.delete({ id: "task-1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("could not be resolved"),
    });
  });

  it("control · a query still runs when the flag lookup throws (the gate is mutation-only)", async () => {
    mockFlagThrows = true;
    // `task.missions` is a query; the mutation gate returns next() before
    // the flag is consulted, so an unreachable flag store cannot brick reads.
    await expect(caller.task.missions()).resolves.toBeDefined();
  });
});
