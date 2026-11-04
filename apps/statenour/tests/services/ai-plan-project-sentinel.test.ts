/**
 * Audit 2026-10-10 sentinel sweep (Task 2b): traced-aichat's own comment
 * records plan-project:plan returning the outage apology. The apology is not
 * JSON, so parseJson gave {} and the empty plan was written over
 * Mission.planData (the operator's existing plan). Every mode must throw
 * AiUnavailableError on a sentinel and write nothing.
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
    mission: { findUnique: db.missionFind, update: db.missionUpdate, updateMany: db.missionUpdate },
    brainMemory: { findMany: vi.fn().mockResolvedValue([]) },
    masteryDecision: { findMany: vi.fn().mockResolvedValue([]) },
    task: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { runPlanProject } from "@/lib/services/ai-plan-project";
import { AiUnavailableError } from "@/lib/ai/structured";

const SENTINEL = {
  content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
  provider: "emergency",
  model: "none",
};

beforeEach(() => {
  mockChat.mockReset();
  db.missionFind.mockReset().mockResolvedValue({ id: "m1", title: "Open a second bay", planData: null });
  db.missionUpdate.mockReset().mockResolvedValue({ count: 1 });
});

describe("runPlanProject - provider sentinel", () => {
  // "plan" is not in this loop since W8a: with milestones a sentinel is the skeleton (ai-plan-project-goal-ladder.test.ts),
  // and without them plan mode is a 400 before any provider call (ai-plan-project-spawn.test.ts).
  for (const mode of ["clarify", "milestones", "learn", "guide"] as const) {
    it(`${mode}: throws AiUnavailableError and writes nothing`, async () => {
      mockChat.mockResolvedValue(SENTINEL);
      await expect(
        runPlanProject({ mode, title: "Open a second bay", missionId: "m1" }),
      ).rejects.toBeInstanceOf(AiUnavailableError);
      expect(db.missionUpdate).not.toHaveBeenCalled();
    });
  }

  it("control: a real plan is persisted", async () => {
    mockChat.mockResolvedValue({
      content: JSON.stringify({ phases: [{ name: "Prep", steps: [{ title: "Measure the lot" }] }] }),
      provider: "ollama",
      model: "m",
    });
    // W8a: plan mode needs confirmed milestones (the milestone-less 15-30-step prompt had no caller and is gone).
    const res = await runPlanProject({ mode: "plan", title: "Open a second bay", missionId: "m1", milestones: ["Prep"] });
    expect(res.mode).toBe("plan");
    expect(db.missionUpdate).toHaveBeenCalledTimes(1);
  });
});
