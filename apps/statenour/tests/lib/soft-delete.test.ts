/**
 * Unit tests for lib/db/soft-delete.ts
 *
 * v7.9 · B4.4 · Apr 29 — covers the helper module's contract:
 *   · softDelete: idempotent, captures actor, preserves original ts
 *   · restore:    idempotent, clears deletedAt
 *   · activeOnly / deletedOnly: where-merging escape hatches
 *   · findManyActive / findFirstActive / countActive: auto-filter
 *   · softDeleteFor: curried per-model API parity
 *
 * The tests mock the prisma client at the module level so we don't
 * need a live Postgres. The real DB behavior (unique-partial indexes,
 * actor propagation across async boundaries) is exercised by the
 * integration paths in the wired call sites.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories run BEFORE the surrounding module body (Vitest
// hoists them above all imports), so any references inside have to be
// captured via vi.hoisted.
const mocks = vi.hoisted(() => ({
  task: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  mission: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  currentActor: vi.fn(() => "user"),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { task: mocks.task, mission: mocks.mission },
}));

vi.mock("@/lib/db/actor", () => ({
  currentActor: () => mocks.currentActor(),
}));

const mockTask = mocks.task;
const mockMission = mocks.mission;
const mockCurrentActor = mocks.currentActor;

import {
  SOFT_DELETE_MODELS,
  isSoftDeleteModel,
  softDelete,
  restore,
  softDeleteMany,
  restoreMany,
  activeOnly,
  deletedOnly,
  findManyActive,
  findFirstActive,
  countActive,
  softDeleteFor,
} from "@/lib/db/soft-delete";

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentActor.mockReturnValue("user");
});

// ─────────────────────────────────────────────────────────────────
// MODEL REGISTRY
// ─────────────────────────────────────────────────────────────────

describe("SOFT_DELETE_MODELS", () => {
  it("contains the v7.9 baseline 9 + later additions", () => {
    expect(SOFT_DELETE_MODELS).toEqual([
      // v7.9 baseline · Apr 29 2026
      "mission",
      "task",
      "masteryDecision",
      "commitment",
      "brainDump",
      "brainMemory",
      "reflection",
      "identitySnapshot",
      "lifeGoal",
      // v10.0.148 · May 03 2026 · policy registry retire path
      "automationPolicy",
    ]);
  });

  it("isSoftDeleteModel narrows correctly", () => {
    expect(isSoftDeleteModel("task")).toBe(true);
    expect(isSoftDeleteModel("brainMemory")).toBe(true);
    expect(isSoftDeleteModel("conversation")).toBe(false);
    expect(isSoftDeleteModel("notARealModel")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// SOFT DELETE
// ─────────────────────────────────────────────────────────────────

describe("softDelete", () => {
  it("marks alive row deleted and returns the updated row", async () => {
    mockTask.findUnique.mockResolvedValue({ id: "t1", deletedAt: null, name: "x" });
    mockTask.update.mockResolvedValue({ id: "t1", deletedAt: new Date("2026-04-29"), name: "x" });

    const result = await softDelete("task", { id: "t1" });

    expect(result.ok).toBe(true);
    expect(result.noop).toBe(false);
    expect(result.actor).toBe("user");
    expect(mockTask.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("is idempotent — already-deleted row is a no-op (preserves original ts)", async () => {
    const original = new Date("2026-04-01");
    mockTask.findUnique.mockResolvedValue({ id: "t1", deletedAt: original });

    const result = await softDelete("task", { id: "t1" });

    expect(result.ok).toBe(true);
    expect(result.noop).toBe(true);
    expect(mockTask.update).not.toHaveBeenCalled();
  });

  it("returns ok:false when row not found", async () => {
    mockTask.findUnique.mockResolvedValue(null);

    const result = await softDelete("task", { id: "missing" });

    expect(result.ok).toBe(false);
    expect(result.noop).toBe(false);
    expect(result.row).toBeNull();
    expect(mockTask.update).not.toHaveBeenCalled();
  });

  it("captures the active actor", async () => {
    mockCurrentActor.mockReturnValue("cron:weekly-review");
    mockTask.findUnique.mockResolvedValue({ id: "t1", deletedAt: null });
    mockTask.update.mockResolvedValue({ id: "t1", deletedAt: new Date() });

    const result = await softDelete("task", { id: "t1" });
    expect(result.actor).toBe("cron:weekly-review");
  });

  it("throws on unknown model", async () => {
    await expect(
      // @ts-expect-error — testing runtime guard
      softDelete("notARealModel", { id: "x" }),
    ).rejects.toThrow(/unknown model/);
  });
});

// ─────────────────────────────────────────────────────────────────
// RESTORE
// ─────────────────────────────────────────────────────────────────

describe("restore", () => {
  it("clears deletedAt on a soft-deleted row", async () => {
    mockTask.findUnique.mockResolvedValue({ id: "t1", deletedAt: new Date("2026-04-01") });
    mockTask.update.mockResolvedValue({ id: "t1", deletedAt: null });

    const result = await restore("task", { id: "t1" });

    expect(result.ok).toBe(true);
    expect(result.noop).toBe(false);
    expect(mockTask.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { deletedAt: null },
    });
  });

  it("no-ops on already-alive row", async () => {
    mockTask.findUnique.mockResolvedValue({ id: "t1", deletedAt: null });

    const result = await restore("task", { id: "t1" });

    expect(result.ok).toBe(true);
    expect(result.noop).toBe(true);
    expect(mockTask.update).not.toHaveBeenCalled();
  });

  it("returns ok:false when row not found", async () => {
    mockTask.findUnique.mockResolvedValue(null);
    const result = await restore("task", { id: "missing" });
    expect(result.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// BULK
// ─────────────────────────────────────────────────────────────────

describe("softDeleteMany", () => {
  it("only targets alive rows so re-runs don't bump timestamps", async () => {
    mockTask.updateMany.mockResolvedValue({ count: 5 });

    const result = await softDeleteMany("task", { missionId: "m1" });

    expect(result.count).toBe(5);
    expect(mockTask.updateMany).toHaveBeenCalledWith({
      where: { missionId: "m1", deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });
});

describe("restoreMany", () => {
  it("only targets soft-deleted rows", async () => {
    mockTask.updateMany.mockResolvedValue({ count: 3 });

    const result = await restoreMany("task", { missionId: "m1" });

    expect(result.count).toBe(3);
    expect(mockTask.updateMany).toHaveBeenCalledWith({
      where: { missionId: "m1", NOT: { deletedAt: null } },
      data: { deletedAt: null },
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// FILTER MERGE
// ─────────────────────────────────────────────────────────────────

describe("activeOnly", () => {
  it("returns {deletedAt:null} for empty input", () => {
    expect(activeOnly()).toEqual({ deletedAt: null });
    expect(activeOnly(undefined)).toEqual({ deletedAt: null });
  });

  it("merges deletedAt:null into existing where", () => {
    expect(activeOnly({ ownerId: "x" })).toEqual({ ownerId: "x", deletedAt: null });
  });

  it("respects caller's explicit deletedAt (escape hatch)", () => {
    expect(activeOnly({ ownerId: "x", deletedAt: { not: null } })).toEqual({
      ownerId: "x",
      deletedAt: { not: null },
    });
  });
});

describe("deletedOnly", () => {
  it("returns NOT:{deletedAt:null} for empty input", () => {
    expect(deletedOnly()).toEqual({ NOT: { deletedAt: null } });
  });

  it("merges into existing where", () => {
    expect(deletedOnly({ ownerId: "x" })).toEqual({ ownerId: "x", NOT: { deletedAt: null } });
  });
});

// ─────────────────────────────────────────────────────────────────
// READ HELPERS
// ─────────────────────────────────────────────────────────────────

describe("findManyActive", () => {
  it("auto-filters to alive rows", async () => {
    mockTask.findMany.mockResolvedValue([{ id: "t1" }]);

    await findManyActive("task", { where: { ownerId: "x" }, take: 10 });

    expect(mockTask.findMany).toHaveBeenCalledWith({
      where: { ownerId: "x", deletedAt: null },
      take: 10,
    });
  });

  it("works with no args", async () => {
    mockTask.findMany.mockResolvedValue([]);
    await findManyActive("task");
    expect(mockTask.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
    });
  });
});

describe("findFirstActive", () => {
  it("auto-filters", async () => {
    mockTask.findFirst.mockResolvedValue({ id: "t1" });

    await findFirstActive("task", { where: { name: "x" } });

    expect(mockTask.findFirst).toHaveBeenCalledWith({
      where: { name: "x", deletedAt: null },
    });
  });
});

describe("countActive", () => {
  it("counts only alive rows", async () => {
    mockTask.count.mockResolvedValue(7);

    const n = await countActive("task", { ownerId: "x" });

    expect(n).toBe(7);
    expect(mockTask.count).toHaveBeenCalledWith({
      where: { ownerId: "x", deletedAt: null },
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// CURRIED API
// ─────────────────────────────────────────────────────────────────

describe("softDeleteFor", () => {
  it("delegates delete to the bound model", async () => {
    mockMission.findUnique.mockResolvedValue({ id: "m1", deletedAt: null });
    mockMission.update.mockResolvedValue({ id: "m1", deletedAt: new Date() });

    const missions = softDeleteFor("mission");
    const result = await missions.delete({ id: "m1" });

    expect(result.ok).toBe(true);
    expect(mockMission.update).toHaveBeenCalled();
    expect(mockTask.update).not.toHaveBeenCalled();
  });

  it("delegates findManyActive with auto-filter", async () => {
    mockMission.findMany.mockResolvedValue([]);

    const missions = softDeleteFor("mission");
    await missions.findManyActive({ where: { status: "ACTIVE" } });

    expect(mockMission.findMany).toHaveBeenCalledWith({
      where: { status: "ACTIVE", deletedAt: null },
    });
  });

  it("delegates restore", async () => {
    mockMission.findUnique.mockResolvedValue({ id: "m1", deletedAt: new Date() });
    mockMission.update.mockResolvedValue({ id: "m1", deletedAt: null });

    const missions = softDeleteFor("mission");
    const result = await missions.restore({ id: "m1" });

    expect(result.ok).toBe(true);
    expect(result.noop).toBe(false);
  });
});
