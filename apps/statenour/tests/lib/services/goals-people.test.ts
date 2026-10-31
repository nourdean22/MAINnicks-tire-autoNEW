/**
 * People W4 S3 (2026-10-30): the Goals tab lists the people on a goal, derived
 * from its tasks (Task.personId). No schema change: Task.person already exists.
 * One person on two tasks is listed once; a soft-deleted person is not listed;
 * a goal with no linked people has an empty list.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  goals: vi.fn(),
  tasks: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: { findMany: m.goals },
    task: { findMany: m.tasks },
    taskEvent: { findMany: vi.fn().mockResolvedValue([]) },
    brainDump: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { getGoals } from "@/lib/services/goals";
import { peopleOnGoal } from "@/lib/services/people/people-on-goal";

describe("peopleOnGoal", () => {
  it("lists each live person once, by name", () => {
    expect(
      peopleOnGoal([
        { person: { id: "p2", name: "Zed", deletedAt: null } },
        { person: { id: "p1", name: "Ana", deletedAt: null } },
        { person: { id: "p2", name: "Zed", deletedAt: null } },
        { person: { id: "p3", name: "Gone", deletedAt: new Date() } },
        { person: null },
      ]),
    ).toEqual([
      { id: "p1", name: "Ana" },
      { id: "p2", name: "Zed" },
    ]);
  });
});

describe("getGoals people", () => {
  beforeEach(() => vi.clearAllMocks());

  it("each goal carries the people on its tasks, read with the linked tasks", async () => {
    m.goals.mockResolvedValue([
      { id: "g1", title: "Demo goal", progress: 0, status: "achieved" },
      { id: "g2", title: "Lonely goal", progress: 0, status: "achieved" },
    ]);
    m.tasks.mockResolvedValue([
      { id: "t1", title: "Call", goalId: "g1", status: "DONE", actualMinutes: 0, person: { id: "p1", name: "Ana", deletedAt: null } },
      { id: "t2", title: "Plan", goalId: "g1", status: "READY", actualMinutes: 0, person: null },
    ]);
    const out = await getGoals();
    expect(out.find((g) => g.id === "g1")?.people).toEqual([{ id: "p1", name: "Ana" }]);
    expect(out.find((g) => g.id === "g2")?.people).toEqual([]);
    expect(m.tasks.mock.calls[0][0].select.person).toEqual({ select: { id: true, name: true, deletedAt: true } });
  });
});
