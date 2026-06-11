import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  masteryScore: {
    findMany: vi.fn(),
  },
  task: {
    findMany: vi.fn(),
  },
  brainMemory: {
    findFirst: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    masteryScore: mocks.masteryScore,
    task: mocks.task,
    brainMemory: mocks.brainMemory,
  },
}));

import { buildNextMove } from "@/lib/services/next-move";

describe("next-move service · buildNextMove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles empty mastery scores gracefully", async () => {
    mocks.masteryScore.findMany.mockResolvedValue([]);
    const result = await buildNextMove();
    expect(result.weakestDomain).toBeNull();
    expect(result.suggestions).toHaveLength(0);
    expect(result.criticalFew).toBeUndefined();
  });

  it("identifies weakest domain and populates fallback suggestions when inbox is empty", async () => {
    // Weakest domain is BUSINESS (score 25)
    mocks.masteryScore.findMany.mockResolvedValue([
      { domain: "BUSINESS", score: 25, delta: 0, date: "2026-06-11" },
      { domain: "PERSONAL", score: 80, delta: 0, date: "2026-06-11" },
    ]);
    // First query for suggestions matches 0 tasks
    mocks.task.findMany.mockResolvedValueOnce([]);
    // Brain memory mock for pattern thread
    mocks.brainMemory.findFirst.mockResolvedValue(null);
    // Second query for criticalFew matches 0 tasks
    mocks.task.findMany.mockResolvedValueOnce([]);

    const result = await buildNextMove();

    expect(result.weakestDomain).toBe("BUSINESS");
    expect(result.weakestScore).toBe(25);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].source).toBe("create-daily");
    expect(result.criticalFew).toHaveLength(0);
  });

  it("populates Focus, Weakest Axis, and Quick Win lanes based on task attributes", async () => {
    mocks.masteryScore.findMany.mockResolvedValue([
      { domain: "BUSINESS", score: 20, delta: 0, date: "2026-06-11" },
    ]);

    // Mock tasks return for suggestions (first call)
    mocks.task.findMany.mockResolvedValueOnce([
      { id: "t_weak_axis", title: "Review business plan", roiScore: 90, mission: { domain: "BUSINESS" } },
    ]);

    // Mock tasks return for criticalFew (second call)
    const taskDoing = {
      id: "t_doing",
      title: "Active task",
      status: "DOING",
      roiScore: 70,
      effort: "H1",
      energyRequired: "HIGH",
      loopKind: "ONCE",
      mission: { domain: "PERSONAL" },
    };
    const taskWeakAxis = {
      id: "t_weak_axis",
      title: "Review business plan",
      status: "READY",
      roiScore: 90,
      effort: "M30",
      energyRequired: "MEDIUM",
      loopKind: "ONCE",
      mission: { domain: "BUSINESS" },
    };
    const taskQuick = {
      id: "t_quick",
      title: "Quick check",
      status: "READY",
      roiScore: 50,
      effort: "M5",
      energyRequired: "LOW",
      loopKind: "ONCE",
      mission: { domain: "PERSONAL" },
    };

    mocks.task.findMany.mockResolvedValueOnce([taskWeakAxis, taskDoing, taskQuick]);

    const result = await buildNextMove();

    expect(result.criticalFew).toHaveLength(3);
    
    const focusLane = result.criticalFew?.find(t => t.lane === "focus");
    expect(focusLane?.id).toBe("t_doing");
    expect(focusLane?.reason).toBe("Currently in progress");

    const weakestLane = result.criticalFew?.find(t => t.lane === "weakest");
    expect(weakestLane?.id).toBe("t_weak_axis");
    expect(weakestLane?.reason).toBe("Lifts your weakest axis: BUSINESS");

    const quickLane = result.criticalFew?.find(t => t.lane === "quick");
    expect(quickLane?.id).toBe("t_quick");
    expect(quickLane?.reason).toBe("Low effort, low energy — build momentum");
  });

  it("focus lane falls back to highest ROI non-recurring task when nothing is in DOING status", async () => {
    mocks.masteryScore.findMany.mockResolvedValue([
      { domain: "PERSONAL", score: 10, delta: 0, date: "2026-06-11" },
    ]);

    mocks.task.findMany.mockResolvedValueOnce([]); // suggestions call

    // All READY, highest ROI is strategic (ONCE) t_high
    const taskDaily = {
      id: "t_daily",
      title: "Daily workout",
      status: "READY",
      roiScore: 95,
      effort: "M30",
      energyRequired: "MEDIUM",
      loopKind: "DAILY",
      mission: { domain: "HEALTH" },
    };
    const taskHighRoi = {
      id: "t_high",
      title: "Important work",
      status: "READY",
      roiScore: 90,
      effort: "H2PLUS",
      energyRequired: "HIGH",
      loopKind: "ONCE",
      mission: { domain: "PERSONAL" },
    };

    mocks.task.findMany.mockResolvedValueOnce([taskDaily, taskHighRoi]);

    const result = await buildNextMove();

    const focusLane = result.criticalFew?.find(t => t.lane === "focus");
    expect(focusLane?.id).toBe("t_high"); // skipped daily workout for Focus Lane
    expect(focusLane?.reason).toBe("Highest ROI strategic target (ROI 90)");
  });
});
