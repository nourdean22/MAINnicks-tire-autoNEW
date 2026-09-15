/**
 * getTaskById reads LIVE rows only (2026-09-15).
 *
 * Review finding: the by-id read was `findUnique({ where: { id } })` with no
 * `deletedAt` filter while its only callers (task.byId → the task inspector,
 * GET /api/tasks/[id]) present the result as a live task — so a workset chip
 * or a chat receipt pinned before a delete rendered status, next action and
 * "why this priority" for a task that no longer exists. Memory's by-id read
 * guards exactly this (tests/services/memory-detail.test.ts); this pins the
 * task path to the same rule.
 *
 * Positive control (run before the fix): with `findUnique({ where: { id } })`
 * the first test fails — `findFirst` is never called.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  task: { findFirst: vi.fn(), findUnique: vi.fn() },
  mission: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: { task: mocks.task, mission: mocks.mission } }));
vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));
vi.mock("@/lib/scoring/mission-ranking", () => ({ rankMissions: vi.fn(() => ({ rankedMissions: [] })) }));

import { getTaskById } from "@/lib/services/tasks";

const TASK = {
  id: "t1",
  title: "Call Eddy about the lift",
  missionId: "m1",
  status: "READY",
  roiScore: 50,
  frictionScore: 30,
  energyRequired: "MEDIUM",
  dueDate: null,
  lastTouchedAt: null,
  updatedAt: new Date("2026-09-10T10:00:00Z"),
  createdAt: new Date("2026-09-01T10:00:00Z"),
  manualPriorityOverride: null,
  deletedAt: null,
  mission: { id: "m1", title: "Shop", domain: "BUSINESS" },
};

beforeEach(() => {
  mocks.task.findFirst.mockReset();
  mocks.task.findUnique.mockReset();
  mocks.mission.findMany.mockReset().mockResolvedValue([]);
});

describe("getTaskById · soft-delete", () => {
  it("filters on deletedAt: null alongside the id, via findFirst (findUnique cannot carry the filter)", async () => {
    mocks.task.findFirst.mockResolvedValue(TASK);
    const t = await getTaskById("t1");
    expect(t?.id).toBe("t1");
    expect(mocks.task.findUnique).not.toHaveBeenCalled();
    expect(mocks.task.findFirst).toHaveBeenCalledTimes(1);
    const args = mocks.task.findFirst.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ id: "t1", deletedAt: null });
  });

  it("a row the filter excludes is null to the caller — the inspector shows not-found, never a live task", async () => {
    mocks.task.findFirst.mockResolvedValue(null);
    expect(await getTaskById("t-deleted")).toBeNull();
  });
});
