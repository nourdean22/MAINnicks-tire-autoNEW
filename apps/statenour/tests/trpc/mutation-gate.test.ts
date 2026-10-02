import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "@/lib/trpc/root";
import { isMutationLockRelease } from "@/lib/trpc/trpc";
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
  // 2026-10-02 · the lock-release cases below reach setFeatureFlagOverride.
  FLAG_REGISTRY: [{ key: "NICK_MUTATION_LOCK" }, { key: "NICK_AUTONOMY" }],
  getAllFlags: () => [],
  loadFeatureFlagOverrides: vi.fn().mockResolvedValue(undefined),
}));

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    task: {
      delete: vi.fn(),
    },
    userPreference: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
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

  // 2026-10-02 · settings census: the lock used to block the one write that
  // lifts it. Exactly that write is exempt; every near-miss stays locked.
  describe("the lock can be lifted from the flags board, and only lifted", () => {
    it("locked · setting NICK_MUTATION_LOCK to \"false\" passes the gate and writes the override", async () => {
      mockMutationLock = true;
      await caller.operator.setFeatureFlagOverride({ key: "NICK_MUTATION_LOCK", value: "false" });
      expect(mockPrisma.userPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: "NICK_MUTATION_LOCK" }, update: { value: "false" } }),
      );
    });

    it("locked · clearing the override (null) passes the gate", async () => {
      mockMutationLock = true;
      await caller.operator.setFeatureFlagOverride({ key: "NICK_MUTATION_LOCK", value: null });
      expect(mockPrisma.userPreference.deleteMany).toHaveBeenCalledWith({
        where: { key: "NICK_MUTATION_LOCK", category: "feature_flags" },
      });
    });

    it("fail-closed · the release still passes the GATE when the flag store cannot be read (it is the way out)", async () => {
      mockFlagThrows = true;
      // The gate lets it through and the override is written; the procedure's
      // own read-back (getFlag, after the write) then hits the same broken
      // store and errors — reported, not hidden. What matters: not FORBIDDEN,
      // and the write landed.
      const err = await caller.operator
        .setFeatureFlagOverride({ key: "NICK_MUTATION_LOCK", value: "false" })
        .then(() => null, (e: unknown) => e);
      expect(err).not.toMatchObject({ code: "FORBIDDEN" });
      expect(mockPrisma.userPreference.upsert).toHaveBeenCalledOnce();
    });

    it.each([
      ["turning the lock ON", { key: "NICK_MUTATION_LOCK", value: "true" }],
      ["another flag set to false", { key: "NICK_AUTONOMY", value: "false" }],
      ["another flag cleared", { key: "NICK_AUTONOMY", value: null }],
    ])("locked · %s is still FORBIDDEN and writes nothing", async (_label, input) => {
      mockMutationLock = true;
      await expect(
        caller.operator.setFeatureFlagOverride(input as { key: string; value: "true" | "false" | null }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mockPrisma.userPreference.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.userPreference.deleteMany).not.toHaveBeenCalled();
    });

    it("locked · every other mutation is still FORBIDDEN", async () => {
      mockMutationLock = true;
      await expect(caller.task.delete({ id: "task-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("the predicate accepts only the exact release shape", () => {
      expect(isMutationLockRelease("operator.setFeatureFlagOverride", { key: "NICK_MUTATION_LOCK", value: "false" })).toBe(true);
      expect(isMutationLockRelease("operator.setFeatureFlagOverride", { key: "NICK_MUTATION_LOCK", value: null })).toBe(true);
      for (const [path, raw] of [
        ["operator.setFeatureFlagOverride", { key: "nick_mutation_lock", value: "false" }],
        ["operator.setFeatureFlagOverride", { key: "NICK_MUTATION_LOCK ", value: "false" }],
        ["operator.setFeatureFlagOverride", { key: "NICK_MUTATION_LOCK", value: "0" }],
        ["operator.setFeatureFlagOverride", { key: "NICK_MUTATION_LOCK", value: false }],
        ["operator.setFeatureFlagOverride", { key: "NICK_MUTATION_LOCK" }],
        ["operator.setFeatureFlagOverride", [{ key: "NICK_MUTATION_LOCK", value: "false" }]],
        ["operator.setFeatureFlagOverride", "NICK_MUTATION_LOCK"],
        ["operator.setFeatureFlagOverride", undefined],
        ["operator.updateAiConfig", { key: "NICK_MUTATION_LOCK", value: "false" }],
        ["task.delete", { key: "NICK_MUTATION_LOCK", value: "false" }],
      ] as Array<[string, unknown]>) {
        expect(isMutationLockRelease(path, raw)).toBe(false);
      }
    });
  });
});
