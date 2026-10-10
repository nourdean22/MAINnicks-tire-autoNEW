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
    mission: { findUnique: db.missionFind, update: db.missionUpdate },
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
  db.missionUpdate.mockReset().mockResolvedValue({});
});

describe("runPlanProject - provider sentinel", () => {
  for (const mode of ["clarify", "milestones", "plan", "learn", "guide"] as const) {
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
    const res = await runPlanProject({ mode: "plan", title: "Open a second bay", missionId: "m1" });
    expect(res.mode).toBe("plan");
    expect(db.missionUpdate).toHaveBeenCalledTimes(1);
  });
});
