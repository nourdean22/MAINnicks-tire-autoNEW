/**
 * "Plan it" on a goal never dead-ends (2026-11-02).
 *
 * agent_traces that day: 3 of 3 `plan-project:plan` calls ended provider_emergency
 * at 53-58 s. The prompt asked a local model for 15-30 steps with costs, tools,
 * risks and a weekend schedule (~8,000 output tokens) under the 100 s provider
 * timeout, so no provider ever finished; the mission was left with no plan and
 * the goal with no mission. With confirmed milestones the plan is small (the
 * ladder is already decided), the call gets the time the tRPC route allows, and
 * when the model still fails the milestones themselves become the plan.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  tracedAiChat: (...a: unknown[]) => mockChat(...a),
}));
vi.mock("@/lib/ai/strategic-frameworks", () => ({
  pickFrameworks: () => [],
  composeStrategicLensBlock: () => "",
}));
vi.mock("@/lib/ai/strategic-frameworks/record-lens-fire", () => ({ recordLensFire: vi.fn() }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
const db = vi.hoisted(() => ({ missionFind: vi.fn(), missionUpdate: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    mission: { findUnique: db.missionFind, update: db.missionUpdate },
    brainMemory: { findMany: vi.fn().mockResolvedValue([]) },
    masteryDecision: { findMany: vi.fn().mockResolvedValue([]) },
    task: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { runPlanProject } from "@/lib/services/ai-plan-project";

const SENTINEL = { content: "I'm having trouble connecting to my AI providers right now.", provider: "emergency", model: "none" };
const MILESTONES = ["Prepare three openers", "First approach done", "Third approach done"];

const planCall = () => mockChat.mock.calls.find((c) => (c[0] as { label: string }).label === "plan-project:plan")!;
const userPrompt = () => (planCall()[1] as Array<{ role: string; content: string }>).find((m) => m.role === "user")!.content;

beforeEach(() => {
  mockChat.mockReset();
  db.missionFind.mockReset().mockResolvedValue({ id: "m1", title: "approach 3 people", planData: null });
  db.missionUpdate.mockReset().mockResolvedValue({});
});

describe("plan mode with confirmed milestones", () => {
  it("asks for a small plan and gives the call the route's time, not the 100 s default", async () => {
    mockChat.mockResolvedValue({
      content: JSON.stringify({ phases: MILESTONES.map((m) => ({ name: m, steps: [{ title: `do ${m}` }] })) }),
      provider: "ollama",
      model: "m",
    });

    await runPlanProject({ mode: "plan", title: "approach 3 people", missionId: "m1", milestones: MILESTONES });

    const opts = planCall()[3] as { timeoutMs?: number } | undefined;
    expect(opts?.timeoutMs).toBe(170_000);
    const p = userPrompt();
    expect(p).toContain("EXACTLY 3 phases");
    expect(p).toMatch(/2-4 steps per phase/i);
    for (const heavy of ["weekendSchedule", "toolsAndMaterials", "totalEstimatedCost", "decisionPoints", "15-30"]) {
      expect(p).not.toContain(heavy);
    }
  });

  it("every provider failed: the milestones become the plan, persisted, flagged as a skeleton", async () => {
    mockChat.mockResolvedValue(SENTINEL);

    const res = await runPlanProject({ mode: "plan", title: "approach 3 people", missionId: "m1", milestones: MILESTONES });

    expect(res.mode).toBe("plan");
    if (res.mode !== "plan") throw new Error("unreachable");
    expect(res.fallback).toBe("skeleton");
    expect(res.plan.phases.map((p) => p.name)).toEqual(MILESTONES);
    for (const phase of res.plan.phases) {
      expect(phase.steps).toHaveLength(1);
      expect(phase.steps[0].isCheckpoint).toBe(true);
      expect(phase.steps[0].title).toBe(phase.name);
    }
    expect(res.flatSteps).toHaveLength(3);
    expect(db.missionUpdate).toHaveBeenCalledTimes(1);
    const written = db.missionUpdate.mock.calls[0][0].data.planData as { phases: unknown[]; summary?: string };
    expect(written.phases).toHaveLength(3);
    expect(written.summary).toMatch(/milestones/i);
  });

  it("without milestones a failed provider still throws (an outage must not erase an existing plan)", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    await expect(runPlanProject({ mode: "plan", title: "x", missionId: "m1" })).rejects.toThrow();
    expect(db.missionUpdate).not.toHaveBeenCalled();
  });

  it("a plan that cannot be saved is a failure, not a warning", async () => {
    mockChat.mockResolvedValue({
      content: JSON.stringify({ phases: [{ name: "Prep", steps: [{ title: "a" }] }] }),
      provider: "ollama",
      model: "m",
    });
    db.missionUpdate.mockRejectedValue(new Error("db down"));

    await expect(runPlanProject({ mode: "plan", title: "x", missionId: "m1", milestones: ["Prep"] })).rejects.toThrow(/db down/);
  });
});
