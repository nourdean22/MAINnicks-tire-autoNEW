/**
 * W8c GUARD · linking an existing mission to a goal (the drawer's goal select and the one-tap "Use") writes
 * Mission.lifeGoalId through services/missions.updateMission. The goal is matched by id against the server's own
 * active goals, never trusted from the client: a goal title, a paused goal or a deleted goal is refused (400). An
 * unchanged id passes (a mission still under a paused goal can be saved), and null unlinks.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  mission: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  lifeGoal: { findFirst: vi.fn() },
  task: { findMany: vi.fn(), updateMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mission: m.mission,
    lifeGoal: m.lifeGoal,
    task: m.task,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ mission: m.mission, task: m.task, lifeGoal: m.lifeGoal })),
  },
}));
vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));

import { updateMission } from "@/lib/services/missions";

beforeEach(() => {
  vi.clearAllMocks();
  m.mission.findUnique.mockResolvedValue({ id: "m1", title: "Hit 15K revenue this month", status: "PAUSED", lifeGoalId: null });
  m.mission.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "m1", ...data }));
  m.mission.count.mockResolvedValue(0);
  m.mission.findMany.mockResolvedValue([]);
  m.task.findMany.mockResolvedValue([]);
});

describe("updateMission · lifeGoalId is an active goal's id or nothing", () => {
  it("links to an active goal found by id", async () => {
    m.lifeGoal.findFirst.mockResolvedValue({ id: "g1" });
    await updateMission("m1", { lifeGoalId: "g1" });
    expect(m.lifeGoal.findFirst).toHaveBeenCalledWith({ where: { id: "g1", status: "active", deletedAt: null }, select: { id: true } });
    expect(m.mission.update.mock.calls[0][0].data.lifeGoalId).toBe("g1");
  });

  it("GUARD: a goal TITLE (even one inside the mission title) is refused, never written as the key", async () => {
    m.lifeGoal.findFirst.mockResolvedValue(null);
    await expect(updateMission("m1", { lifeGoalId: "Hit 15K revenue this month" })).rejects.toMatchObject({ status: 400 });
    expect(m.mission.update).not.toHaveBeenCalled();
  });

  it("a paused or deleted goal is refused (the active-list lookup finds nothing)", async () => {
    m.lifeGoal.findFirst.mockResolvedValue(null);
    await expect(updateMission("m1", { lifeGoalId: "g_paused" })).rejects.toMatchObject({ status: 400 });
    expect(m.mission.update).not.toHaveBeenCalled();
  });

  it("an unchanged goal id saves without a lookup (a mission under a now-paused goal stays editable)", async () => {
    m.mission.findUnique.mockResolvedValue({ id: "m1", title: "t", status: "PAUSED", lifeGoalId: "g_paused" });
    await updateMission("m1", { title: "renamed", lifeGoalId: "g_paused" });
    expect(m.lifeGoal.findFirst).not.toHaveBeenCalled();
    expect(m.mission.update).toHaveBeenCalledTimes(1);
  });

  it("null unlinks without a lookup; an absent key does not touch the link", async () => {
    await updateMission("m1", { lifeGoalId: null });
    expect(m.mission.update.mock.calls[0][0].data.lifeGoalId).toBeNull();
    await updateMission("m1", { title: "x" });
    expect("lifeGoalId" in m.mission.update.mock.calls[1][0].data).toBe(false);
    expect(m.lifeGoal.findFirst).not.toHaveBeenCalled();
  });

  it("matches the mission by id: the update's where is the id alone", async () => {
    m.lifeGoal.findFirst.mockResolvedValue({ id: "g1" });
    await updateMission("m1", { lifeGoalId: "g1" });
    expect(m.mission.update.mock.calls[0][0].where).toEqual({ id: "m1" });
  });
});
