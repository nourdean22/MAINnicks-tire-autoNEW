/**
 * lib/services/goal-health.ts (W6): the getGoals read recall also uses. A failed GoalEvent read must not leave a
 * confident pace behind: without horizon_set the pace would count from creation and could read "behind", and recall
 * would then fire a behind-pace maxim on a read that failed (second reader, pr-test-analyzer P1).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ goalFindMany: vi.fn(), eventFindMany: vi.fn(), taskFindMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { lifeGoal: { findMany: h.goalFindMany }, goalEvent: { findMany: h.eventFindMany }, task: { findMany: h.taskFindMany } },
}));

import { activeGoalsWithHealth } from "@/lib/services/goal-health";
import { goalRecallBlock } from "@/lib/brain/goal-people-recall";
import type { Maxim } from "@/lib/wisdom/maxims";

const NOW = Date.parse("2026-11-20T17:00:00.000Z");
// A MONTH goal made on Nov 1 at 10% of target by Nov 20: from creation it reads behind.
const goal = (id: string) => ({
  id, title: `Revenue ${id}`, kind: "metric", horizon: "MONTH", unit: "$", currentValue: 1500, targetValue: 15000,
  status: "active", deadline: null, createdAt: new Date("2026-11-01T05:00:00.000Z"), _count: { tasks: 1 },
});
const POOL: Maxim[] = [
  { id: "p:t", text: "timing", source: "T", ref: "t", tags: ["timing"] },
  { id: "p:d", text: "decide", source: "D", ref: "d", tags: ["decisions"] },
];

beforeEach(() => {
  h.goalFindMany.mockReset().mockResolvedValue([goal("g1"), goal("g2")]);
  h.eventFindMany.mockReset().mockResolvedValue([]);
  h.taskFindMany.mockReset().mockResolvedValue([]);
});

describe("activeGoalsWithHealth on a failed GoalEvent read", () => {
  it("CONTROL: with the read working, the same goal reads behind (so the gate below is what blanks it)", async () => {
    const r = await activeGoalsWithHealth(NOW);
    expect(r.goals[0].paceKind).toBe("behind");
  });

  it("every goal is unknown, with no pace kind, and recall earns no maxim from it", async () => {
    h.eventFindMany.mockRejectedValue(new Error("db down"));
    const r = await activeGoalsWithHealth(NOW);
    expect(r.failed).toEqual(["check_ins"]);
    expect(r.goals).toHaveLength(2);
    for (const g of r.goals) {
      expect(g.health).toEqual({ state: "unknown", at: null });
      expect(g.paceKind).toBeNull();
      expect(g.pace).toBeNull();
    }
    expect(goalRecallBlock(r.goals, ["revenue"], "how is revenue", POOL, "2026-11-20").maxim).toBeNull();
  });
});
