/**
 * Goal ids reach Nick (job 2026-11-02-nour-os-interconnect W1). The Active Goals block and the goals
 * page data carried titles only, so createTask.goalId (an id) could not be filled; createMissionPlan
 * had no lifeGoalId, so a mission Nick created never reached its goal.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  goalFindMany: vi.fn(),
  goalFindFirst: vi.fn(),
  scoreFindMany: vi.fn(),
  missionCreate: vi.fn(),
  createTaskAndEnrich: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: { findMany: h.goalFindMany, findFirst: h.goalFindFirst },
    masteryScore: { findMany: h.scoreFindMany },
    // W8a: the goals grounding reads activeGoalsWithHealth (check-ins + tasks through goalTaskWhere).
    goalEvent: { findMany: vi.fn(async () => []) },
    task: { findMany: vi.fn(async () => []) },
    mission: { create: h.missionCreate },
  },
}));
vi.mock("@/lib/services/tasks", () => ({ createTaskAndEnrich: h.createTaskAndEnrich, liftGoalOnTaskComplete: vi.fn() }));

import { renderWhyBlock } from "@/lib/ai/prompt/v2/renderer";
import { buildPageData } from "@/lib/ai/page-data";
import { missionsTools } from "@/lib/ai/tools/missions";
import type { NickPrimeContext } from "@/lib/ai/context/nick-prime-context";

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.scoreFindMany.mockResolvedValue([]);
  h.missionCreate.mockImplementation(async ({ data }) => ({ id: "m1", ...data }));
  h.createTaskAndEnrich.mockImplementation(async (t) => ({ id: "t1", title: t.title, nextPhysicalAction: t.nextPhysicalAction }));
});

describe("Active Goals block carries each goal's id", () => {
  it("ends the goal's line with [id:<id>]", () => {
    const ctx = {
      activeMissions: [],
      activeGoals: [
        { id: "cgoal123", title: "Revenue", domain: "business", metric: "", targetValue: 10, currentValue: 2, unit: "", progress: 20, horizon: "MONTH", daysToDeadline: null, openTasks: 1 },
      ],
    } as unknown as NickPrimeContext;
    const line = renderWhyBlock(ctx).split("\n").find((l) => l.includes("Revenue")) ?? "";
    expect(line.endsWith(" [id:cgoal123]")).toBe(true);
  });
});

describe("goals page data carries ids", () => {
  it("names each goal with its id", async () => {
    h.goalFindMany.mockResolvedValue([
      { id: "cgoal123", title: "Revenue", kind: "metric", domain: "business", metric: "", unit: "$", currentValue: 3000, targetValue: 15000, progress: 99, horizon: "MONTH", status: "active", deadline: null, createdAt: new Date("2026-11-01T05:00:00.000Z") },
    ]);
    const out = await buildPageData("goals");
    expect(h.goalFindMany.mock.calls[0][0].select.id).toBe(true);
    // W8a: the one computed number (20 = 3000/15000), never the stored column (99).
    expect(out).toContain('"Revenue" [id:cgoal123] 20%');
  });
});

describe("createMissionPlan · lifeGoalId", () => {
  type Exec = (i: Record<string, unknown>) => Promise<Record<string, unknown>>;
  const exec = (missionsTools.createMissionPlan as unknown as { execute: Exec }).execute;
  const plan = { title: "Second tech", domain: "BUSINESS", priority: 50, tasks: [{ title: "Post the job", nextPhysicalAction: "Open Indeed" }] };

  it("links the mission to a live goal", async () => {
    h.goalFindFirst.mockResolvedValue({ id: "cgoal123" });
    const r = await exec({ ...plan, lifeGoalId: "cgoal123" });
    expect(h.goalFindFirst.mock.calls[0][0].where).toEqual({ id: "cgoal123", deletedAt: null });
    expect(h.missionCreate.mock.calls[0][0].data.lifeGoalId).toBe("cgoal123");
    expect(r).toMatchObject({ created: true, lifeGoalId: "cgoal123" });
  });

  it("an unknown goal id is dropped and said, never written (no FK throw)", async () => {
    h.goalFindFirst.mockResolvedValue(null);
    const r = await exec({ ...plan, lifeGoalId: "made-up" });
    expect(h.missionCreate.mock.calls[0][0].data.lifeGoalId).toBeUndefined();
    expect(r).toMatchObject({ created: true, lifeGoalId: null });
    expect(String(r.goalLinkNote)).toMatch(/not found/);
  });

  it("without lifeGoalId nothing is looked up", async () => {
    await exec(plan);
    expect(h.goalFindFirst).not.toHaveBeenCalled();
    expect(h.missionCreate.mock.calls[0][0].data.lifeGoalId).toBeUndefined();
  });
});
