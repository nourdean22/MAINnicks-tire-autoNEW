/**
 * W8a item 8 (audit A8, C9): Nick's createTask drops an unknown goalId and says so (a hallucinated id used to
 * FK-throw a red "TOOL FAILED" card), and getMissions carries each mission's goal so Nick can attach work.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createTaskAndEnrich: vi.fn(),
  goalFindFirst: vi.fn(),
  taskFindFirst: vi.fn(),
  missionFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: { findFirst: h.goalFindFirst },
    task: { findFirst: h.taskFindFirst },
    mission: { findMany: h.missionFindMany },
  },
}));
vi.mock("@/lib/services/tasks", () => ({ createTaskAndEnrich: h.createTaskAndEnrich }));
vi.mock("@/lib/services/task-actions", () => ({ checkTask: vi.fn() }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { tasksTools } from "@/lib/ai/tools/tasks";
import { missionsTools } from "@/lib/ai/tools/missions";

type Exec = (a: Record<string, unknown>, o: unknown) => Promise<Record<string, unknown>>;
const create = (a: Record<string, unknown>) => (tasksTools.createTask.execute as unknown as Exec)(a, {});
const base = { title: "Call the bank", nextPhysicalAction: "dial", effort: "M15", context: "PHONE", loopKind: "ONCE" };

beforeEach(() => {
  h.createTaskAndEnrich.mockReset().mockImplementation(async (d: { goalId: string | null }) => ({ id: "t1", parentTaskId: null, goalId: d.goalId }));
  h.goalFindFirst.mockReset().mockResolvedValue(null);
  h.taskFindFirst.mockReset().mockResolvedValue(null);
  h.missionFindMany.mockReset();
});

describe("createTask · goalId", () => {
  it("keeps a live goal id and says the task is goal-linked", async () => {
    h.goalFindFirst.mockResolvedValue({ id: "g1" });
    const r = await create({ ...base, goalId: "g1" });
    expect(h.goalFindFirst.mock.calls[0][0].where).toEqual({ id: "g1", deletedAt: null });
    expect(h.createTaskAndEnrich.mock.calls[0][0].goalId).toBe("g1");
    expect(r).toMatchObject({ created: true, goalLinked: true });
  });

  it("round 1 P2-13: goalLinked reads the SAVED row (a deduped existing task without the goal is not linked)", async () => {
    h.goalFindFirst.mockResolvedValue({ id: "g1" });
    h.createTaskAndEnrich.mockResolvedValue({ id: "t-old", parentTaskId: null, goalId: null });
    const r = await create({ ...base, goalId: "g1" });
    expect(r).toMatchObject({ created: true, goalLinked: false });
  });

  it("drops an unknown goal id and says so, the way parentTaskId already did", async () => {
    const r = await create({ ...base, goalId: "nope" });
    expect(h.createTaskAndEnrich.mock.calls[0][0].goalId).toBeNull();
    expect(r).toMatchObject({ created: true, goalLinked: false });
    expect(String(r.goalNote)).toMatch(/not found/i);
  });

  it("the description says what a completion does per goal kind, and no longer promises a lift for every goal", () => {
    const d = tasksTools.createTask.description ?? "";
    expect(d).toMatch(/metric/i);
    expect(d).toMatch(/milestone|narrative|task/i);
    expect(d).not.toMatch(/auto-lifts the goal\./);
  });
});

describe("getMissions · carries the mission's goal (C9)", () => {
  it("returns lifeGoalId and the goal title, null for a deleted goal", async () => {
    h.missionFindMany.mockResolvedValue([
      { id: "m1", title: "Second tech", domain: "BUSINESS", priority: 7, status: "ACTIVE", systemKind: null, lifeGoalId: "g1", lifeGoal: { id: "g1", title: "Grow revenue", deletedAt: null } },
      { id: "m2", title: "Old push", domain: "BUSINESS", priority: 5, status: "ACTIVE", systemKind: null, lifeGoalId: "g9", lifeGoal: { id: "g9", title: "Archived", deletedAt: new Date() } },
    ]);
    const r = (await (missionsTools.getMissions.execute as unknown as Exec)({}, {})) as unknown as Array<Record<string, unknown>>;
    expect(r[0]).toMatchObject({ id: "m1", lifeGoalId: "g1", goal: { id: "g1", title: "Grow revenue" } });
    expect(r[1]).toMatchObject({ id: "m2", lifeGoalId: null, goal: null });
    expect(h.missionFindMany.mock.calls[0][0].select).toMatchObject({ lifeGoalId: true, lifeGoal: { select: { id: true, title: true, deletedAt: true } } });
  });
});
