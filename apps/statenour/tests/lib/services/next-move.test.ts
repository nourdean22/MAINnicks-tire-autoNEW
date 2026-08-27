import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  masteryScore: {
    findMany: vi.fn(),
  },
  mission: {
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
    mission: mocks.mission,
    task: mocks.task,
    brainMemory: mocks.brainMemory,
  },
}));

import { buildNextMove } from "@/lib/services/next-move";

// 2026-08-27 (#1946 + its P1 review): buildNextMove fetches open tasks ONCE
// and scores them FRESH per request via scoreTaskPriority — the persisted
// autoPriority column is never consulted (its time terms go stale between
// mutations). So: single task.findMany call, mission.findMany feeds the
// ranking map, and lane reasons carry the scorer's one-line explanation.

describe("next-move service · buildNextMove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mission.findMany.mockResolvedValue([]);
    mocks.brainMemory.findFirst.mockResolvedValue(null);
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
    // The single open-tasks fetch returns nothing
    mocks.task.findMany.mockResolvedValue([]);

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

    const taskDoing = {
      id: "t_doing",
      title: "Active task",
      missionId: "m_p",
      status: "DOING",
      roiScore: 70,
      frictionScore: 20,
      effort: "H1",
      energyRequired: "HIGH",
      loopKind: "ONCE",
      mission: { id: "m_p", domain: "PERSONAL" },
    };
    const taskWeakAxis = {
      id: "t_weak_axis",
      title: "Review business plan",
      missionId: "m_b",
      status: "READY",
      roiScore: 90,
      frictionScore: 20,
      effort: "M30",
      energyRequired: "MEDIUM",
      loopKind: "ONCE",
      mission: { id: "m_b", domain: "BUSINESS" },
    };
    const taskQuick = {
      id: "t_quick",
      title: "Quick check",
      missionId: "m_p",
      status: "READY",
      roiScore: 50,
      frictionScore: 10,
      effort: "M5",
      energyRequired: "LOW",
      loopKind: "ONCE",
      mission: { id: "m_p", domain: "PERSONAL" },
    };

    mocks.task.findMany.mockResolvedValue([taskWeakAxis, taskDoing, taskQuick]);

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

    // The weakest-domain inbox suggestion is derived from the SAME freshly
    // scored set — no second query — and carries the scorer's explanation.
    const inboxSuggestion = result.suggestions.find(s => s.source === "existing-inbox");
    expect(inboxSuggestion?.taskId).toBe("t_weak_axis");
    expect(inboxSuggestion?.reason).toContain("picked because:");
  });

  it("focus lane falls back to the best non-recurring task, scored fresh, when nothing is in DOING", async () => {
    mocks.masteryScore.findMany.mockResolvedValue([
      { domain: "PERSONAL", score: 10, delta: 0, date: "2026-06-11" },
    ]);

    // The DAILY habit carries the HIGHER hand-assigned roiScore — under the
    // old raw-roiScore ordering it would have led. Fresh scoring demotes it
    // (habit ×0.5) and the ONCE task wins the focus lane.
    const taskDaily = {
      id: "t_daily",
      title: "Daily workout",
      missionId: "m_h",
      status: "READY",
      roiScore: 95,
      frictionScore: 20,
      effort: "M30",
      energyRequired: "MEDIUM",
      loopKind: "DAILY",
      mission: { id: "m_h", domain: "HEALTH" },
    };
    const taskHighRoi = {
      id: "t_high",
      title: "Important work",
      missionId: "m_p",
      status: "READY",
      roiScore: 90,
      frictionScore: 20,
      effort: "H2PLUS",
      energyRequired: "HIGH",
      loopKind: "ONCE",
      mission: { id: "m_p", domain: "PERSONAL" },
    };

    mocks.task.findMany.mockResolvedValue([taskDaily, taskHighRoi]);

    const result = await buildNextMove();

    const focusLane = result.criticalFew?.find(t => t.lane === "focus");
    expect(focusLane?.id).toBe("t_high"); // skipped daily workout for Focus Lane
    // Reason is the live computed explanation, not a stored column.
    expect(focusLane?.reason).toContain("picked because:");
    expect(focusLane?.reason).toContain("roi 90");
  });

  it("stored autoPriority CANNOT influence the ranking — only fresh scores do", async () => {
    mocks.masteryScore.findMany.mockResolvedValue([
      { domain: "PERSONAL", score: 10, delta: 0, date: "2026-06-11" },
    ]);

    // Poisoned stored column: the WORSE task carries a stale autoPriority of
    // 99. If any code path consults the persisted column, t_stale wins and
    // this canary names the regression.
    const staleHighStored = {
      id: "t_stale",
      title: "Stale winner",
      missionId: "m_p",
      status: "READY",
      roiScore: 50,
      frictionScore: 90,
      effort: "H1",
      energyRequired: "HIGH",
      loopKind: "ONCE",
      autoPriority: 99,
      autoPriorityExplanation: "stale stored explanation",
      mission: { id: "m_p", domain: "PERSONAL" },
    };
    const freshWinner = {
      id: "t_fresh",
      title: "Overdue $846 collection",
      missionId: "m_p",
      status: "READY",
      roiScore: 50,
      frictionScore: 10,
      effort: "M30",
      energyRequired: "MEDIUM",
      loopKind: "ONCE",
      autoPriority: 5,
      autoPriorityExplanation: "stale stored explanation",
      dueDate: "2026-08-01",
      mission: { id: "m_p", domain: "PERSONAL" },
    };

    mocks.task.findMany.mockResolvedValue([staleHighStored, freshWinner]);

    const result = await buildNextMove();

    const focusLane = result.criticalFew?.find(t => t.lane === "focus");
    expect(focusLane?.id).toBe("t_fresh");
    expect(focusLane?.reason).toContain("overdue");
    expect(focusLane?.reason).not.toContain("stale stored explanation");
  });
});
