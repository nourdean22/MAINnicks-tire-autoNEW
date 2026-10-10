/**
 * Audit 2026-10-10 sentinel sweep (Task 2b): on an outage the goal coach
 * appended a `read: "Parse failed"` entry to LifeGoal.coachLog (the apology
 * is not JSON) and returned ok:true. A sentinel must throw AiUnavailableError
 * and leave the coach log untouched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  tracedAiChat: (...a: unknown[]) => mockChat(...a),
}));
vi.mock("@/lib/ai/style-adapter", () => ({ applyOperatorStyle: async (s: string) => s }));
vi.mock("@/lib/ai/strategic-frameworks", () => ({
  pickFrameworks: () => [],
  composeStrategicLensBlock: () => "",
}));
vi.mock("@/lib/ai/strategic-frameworks/record-lens-fire", () => ({ recordLensFire: vi.fn() }));
vi.mock("@/lib/services/operator-state", () => ({
  currentOperatorState: async () => ({ confidence: 0 }),
  formatOperatorStateBlock: () => "",
}));
const db = vi.hoisted(() => ({ goalFind: vi.fn(), goalUpdate: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: { findUnique: db.goalFind, update: db.goalUpdate },
    task: { findMany: vi.fn().mockResolvedValue([]) },
    brainMemory: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { runCoachGoal } from "@/lib/services/ai-coach-goal";
import { AiUnavailableError } from "@/lib/ai/structured";

const SENTINEL = {
  content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
  provider: "emergency",
  model: "none",
};

beforeEach(() => {
  mockChat.mockReset();
  db.goalFind.mockReset().mockResolvedValue({
    id: "g1",
    title: "Hire a second tech",
    domain: "business",
    why: "capacity",
    coachLog: [],
  });
  db.goalUpdate.mockReset().mockResolvedValue({});
});

describe("runCoachGoal - provider sentinel", () => {
  it("throws AiUnavailableError and writes no coach entry", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    await expect(runCoachGoal({ goalId: "g1" })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(db.goalUpdate).not.toHaveBeenCalled();
  });

  it("control: a real coaching read is appended", async () => {
    mockChat.mockResolvedValue({
      content: JSON.stringify({ read: "On track", nextAction: "Post the ad", blocker: null, risks: [] }),
      provider: "ollama",
      model: "m",
    });
    const res = await runCoachGoal({ goalId: "g1" });
    expect(res.entry.read).toBe("On track");
    expect(db.goalUpdate).toHaveBeenCalledTimes(1);
  });
});
