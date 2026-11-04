/**
 * W8a item 4 (audit A4, A9, A10): Plan it cannot lose work. The phase-0 spawn runs on the SERVER right after the
 * plan is saved (a backgrounded PWA used to skip it and a retry made a second mission); a plan with fewer phases
 * than confirmed milestones is filled from the skeleton and its phase names ARE the milestones; a budget stop is
 * the skeleton path, not a throw; the dead 15-30-step prompt is gone, so plan mode needs the milestones.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({ tracedAiChat: (...a: unknown[]) => mockChat(...a) }));
vi.mock("@/lib/ai/strategic-frameworks", () => ({ pickFrameworks: () => [], composeStrategicLensBlock: () => "" }));
vi.mock("@/lib/ai/strategic-frameworks/record-lens-fire", () => ({ recordLensFire: vi.fn() }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
const db = vi.hoisted(() => ({ missionFind: vi.fn(), missionUpdate: vi.fn(), spawn: vi.fn() }));
const READ_AT = new Date("2026-11-03T12:00:00Z");
vi.mock("@/lib/prisma", () => ({
  prisma: {
    // Round 1 P0-2: the plan write is a compare-and-swap (updateMany on the updatedAt read first).
    mission: { findUnique: db.missionFind, updateMany: db.missionUpdate },
    brainMemory: { findMany: vi.fn().mockResolvedValue([]) },
    masteryDecision: { findMany: vi.fn().mockResolvedValue([]) },
    task: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/services/spawn-tasks", () => ({ spawnProjectTasks: (...a: unknown[]) => db.spawn(...a) }));

import { runPlanProject, PlanProjectError } from "@/lib/services/ai-plan-project";

const MILESTONES = ["Prepare three openers", "First approach done", "Third approach done"];
const okPlan = (phases: Array<{ name: string; steps: Array<{ title: string }> }>) => ({
  content: JSON.stringify({ summary: "s", phases }),
  provider: "ollama",
  model: "m",
});

beforeEach(() => {
  mockChat.mockReset();
  db.missionFind.mockReset().mockResolvedValue({ id: "m1", title: "approach 3 people", planData: null, updatedAt: READ_AT });
  db.missionUpdate.mockReset().mockResolvedValue({ count: 1 });
  db.spawn.mockReset().mockResolvedValue({ spawned: 2, alreadyExisted: 0, phase: MILESTONES[0], taskIds: ["t1", "t2"] });
});

describe("plan mode · the server spawns phase 0 after saving the plan", () => {
  it("spawns phase 0 once the plan is saved and reports the real count", async () => {
    mockChat.mockResolvedValue(okPlan(MILESTONES.map((m) => ({ name: m, steps: [{ title: `do ${m}` }, { title: `check ${m}` }] }))));

    const res = await runPlanProject({ mode: "plan", title: "approach 3 people", missionId: "m1", milestones: MILESTONES });

    if (res.mode !== "plan") throw new Error("unreachable");
    expect(db.spawn).toHaveBeenCalledWith({ missionId: "m1", phaseIndex: 0 });
    expect(db.missionUpdate.mock.invocationCallOrder[0]).toBeLessThan(db.spawn.mock.invocationCallOrder[0]);
    expect(res.spawned).toBe(2);
    expect(res.spawnFailed).toBeUndefined();
  });

  it("a failed spawn is named on the result, never a silent zero, and the saved plan stands", async () => {
    mockChat.mockResolvedValue(okPlan(MILESTONES.map((m) => ({ name: m, steps: [{ title: `do ${m}` }] }))));
    db.spawn.mockRejectedValue(new Error("db down"));

    const res = await runPlanProject({ mode: "plan", title: "approach 3 people", missionId: "m1", milestones: MILESTONES });

    if (res.mode !== "plan") throw new Error("unreachable");
    expect(db.missionUpdate).toHaveBeenCalledTimes(1);
    expect(res.spawned).toBe(0);
    expect(res.spawnFailed).toContain("db down");
  });

  it("does not spawn without a mission to spawn into", async () => {
    mockChat.mockResolvedValue(okPlan(MILESTONES.map((m) => ({ name: m, steps: [{ title: `do ${m}` }] }))));
    await runPlanProject({ mode: "plan", title: "approach 3 people", milestones: MILESTONES });
    expect(db.spawn).not.toHaveBeenCalled();
  });
});

describe("plan mode · every confirmed milestone is a phase, named by the milestone (A9)", () => {
  it("fills missing phases from the skeleton and renames the model's phases to the milestones", async () => {
    mockChat.mockResolvedValue(okPlan([{ name: "Openers", steps: [{ title: "write them" }] }, { name: "Approach one", steps: [{ title: "go" }] }]));

    const res = await runPlanProject({ mode: "plan", title: "approach 3 people", missionId: "m1", milestones: MILESTONES });

    if (res.mode !== "plan") throw new Error("unreachable");
    expect(res.plan.phases.map((p) => p.name)).toEqual(MILESTONES);
    expect(res.plan.phases[0].steps.map((s) => s.title)).toEqual(["write them"]);
    expect(res.plan.phases[2].steps).toHaveLength(1);
    expect(res.plan.phases[2].steps[0].isCheckpoint).toBe(true);
    expect(res.fallback).toBeUndefined();
    const saved = db.missionUpdate.mock.calls[0][0].data.planData as { phases: Array<{ name: string }> };
    expect(saved.phases.map((p) => p.name)).toEqual(MILESTONES);
  });

  it("a plan with more phases than milestones keeps every step: the extra phases' steps join the last milestone", async () => {
    mockChat.mockResolvedValue(okPlan([...MILESTONES, "Celebrate"].map((m) => ({ name: m, steps: [{ title: `do ${m}` }] }))));

    const res = await runPlanProject({ mode: "plan", title: "approach 3 people", missionId: "m1", milestones: MILESTONES });

    if (res.mode !== "plan") throw new Error("unreachable");
    expect(res.plan.phases.map((p) => p.name)).toEqual(MILESTONES);
    expect(res.plan.phases[2].steps.map((s) => s.title)).toEqual(["do Third approach done", "do Celebrate"]);
  });
});

describe("plan mode · a retried Plan it cannot duplicate (round 1 P0-2)", () => {
  const SPAWNED = {
    v: 1,
    createdAt: "2026-11-03T12:00:00Z",
    updatedAt: "2026-11-03T12:00:00Z",
    title: "approach 3 people",
    phases: MILESTONES.map((m, i) => ({ name: m, milestone: m, steps: [{ title: `do ${m}`, ...(i === 0 ? { taskId: "t-existing" } : {}) }] })),
  };

  it("a mission whose phase 0 already has tasks returns the existing plan: no model call, no write, no spawn", async () => {
    db.missionFind.mockResolvedValue({ id: "m1", title: "approach 3 people", planData: SPAWNED, updatedAt: READ_AT });

    const res = await runPlanProject({ mode: "plan", title: "approach 3 people", missionId: "m1", milestones: MILESTONES });

    if (res.mode !== "plan") throw new Error("unreachable");
    expect(mockChat).not.toHaveBeenCalled();
    expect(db.missionUpdate).not.toHaveBeenCalled();
    expect(db.spawn).not.toHaveBeenCalled();
    expect(res).toMatchObject({ alreadyPlanned: true, spawned: 0 });
    expect(res.plan.phases[0].steps[0].taskId).toBe("t-existing");
  });

  it("the plan write is a swap on the updatedAt read first; a lost swap re-reads and returns the winner's plan, no spawn", async () => {
    mockChat.mockResolvedValue(okPlan(MILESTONES.map((m) => ({ name: m, steps: [{ title: `do ${m}` }] }))));
    db.missionFind
      .mockResolvedValueOnce({ id: "m1", title: "approach 3 people", planData: null, updatedAt: READ_AT })
      .mockResolvedValueOnce({ id: "m1", title: "approach 3 people", planData: SPAWNED, updatedAt: new Date("2026-11-03T12:01:00Z") });
    db.missionUpdate.mockResolvedValue({ count: 0 });

    const res = await runPlanProject({ mode: "plan", title: "approach 3 people", missionId: "m1", milestones: MILESTONES });

    expect(db.missionUpdate.mock.calls[0][0].where).toEqual({ id: "m1", updatedAt: READ_AT });
    expect(db.spawn).not.toHaveBeenCalled();
    if (res.mode !== "plan") throw new Error("unreachable");
    expect(res).toMatchObject({ alreadyPlanned: true, spawned: 0 });
  });

  it("an unknown mission is a 404, not a plan written nowhere", async () => {
    db.missionFind.mockResolvedValue(null);
    await expect(runPlanProject({ mode: "plan", title: "x", missionId: "nope", milestones: MILESTONES })).rejects.toBeInstanceOf(PlanProjectError);
    expect(mockChat).not.toHaveBeenCalled();
  });
});

describe("plan mode · failure shapes", () => {
  it("a budget stop (BudgetExceededError) is the skeleton path, not a throw (A10)", async () => {
    const err = new Error("daily budget reached");
    err.name = "BudgetExceededError";
    mockChat.mockRejectedValue(err);

    const res = await runPlanProject({ mode: "plan", title: "approach 3 people", missionId: "m1", milestones: MILESTONES });

    if (res.mode !== "plan") throw new Error("unreachable");
    expect(res.fallback).toBe("skeleton");
    // Round 1 P2-16: the real cause rides back; the toast says "budget", not "the planner did not answer".
    expect(res.fallbackReason).toBe("budget");
    expect(res.plan.summary).toMatch(/budget/i);
    expect(res.plan.phases.map((p) => p.name)).toEqual(MILESTONES);
    expect(db.missionUpdate).toHaveBeenCalledTimes(1);
    expect(db.spawn).toHaveBeenCalledWith({ missionId: "m1", phaseIndex: 0 });
  });

  it("any other provider error still throws (a real failure is not quietly a skeleton)", async () => {
    mockChat.mockRejectedValue(new Error("ECONNRESET"));
    await expect(runPlanProject({ mode: "plan", title: "approach 3 people", missionId: "m1", milestones: MILESTONES })).rejects.toThrow("ECONNRESET");
    expect(db.missionUpdate).not.toHaveBeenCalled();
  });

  it("plan mode without confirmed milestones is a 400: the 15-30-step prompt had no caller and is gone", async () => {
    await expect(runPlanProject({ mode: "plan", title: "approach 3 people", missionId: "m1" })).rejects.toBeInstanceOf(PlanProjectError);
    expect(mockChat).not.toHaveBeenCalled();
  });
});
