/**
 * Round 1 (manager, 2026-11-03):
 *  P1-7  a failed goals read must not read as "no goals" in Nick's WHY block; it says the goals are unknown this turn.
 *  P1-12 the /stats mastery tab's grounding gave Nick the stored progress column; it now carries the one computed
 *        number (lib/services/goal-health.ts goalProgress), the same as the card and the goals tab.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lifeGoal: { findMany: vi.fn() },
  goalEvent: { findMany: vi.fn() },
  task: { findMany: vi.fn() },
  masteryScore: { findMany: vi.fn() },
  auditEvent: { findFirst: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: h }));
vi.mock("@/lib/nickstire/revenue", () => ({ readNickRevenue: vi.fn(() => ({ hasToday: false })) }));
vi.mock("@/lib/brain/legacy-shims", () => ({ recentScoreSnapshots: vi.fn(async () => []) }));

import { renderWhyBlock } from "@/lib/ai/prompt/v2/renderer";
import { buildPageData } from "@/lib/ai/page-data";
import type { NickPrimeContext } from "@/lib/ai/context/nick-prime-context";

beforeEach(() => {
  for (const m of Object.values(h)) for (const fn of Object.values(m)) (fn as ReturnType<typeof vi.fn>).mockReset();
  h.goalEvent.findMany.mockResolvedValue([]);
  h.task.findMany.mockResolvedValue([]);
  h.masteryScore.findMany.mockResolvedValue([]);
  h.auditEvent.findFirst.mockResolvedValue(null);
});

describe("WHY block · a failed goals read (P1-7)", () => {
  const ctx = (o: Partial<NickPrimeContext>) => ({ activeMissions: [], activeGoals: [], ...o }) as unknown as NickPrimeContext;

  it("says the goals are unknown this turn instead of dropping the section", () => {
    const block = renderWhyBlock(ctx({ goalsReadFailed: true }));
    expect(block).toContain("Active Goals: couldn't read this turn (unknown, not none)");
  });

  it("a read that worked and found no goals still renders nothing (a measured empty is not an error)", () => {
    expect(renderWhyBlock(ctx({}))).toBe("");
  });
});

describe("mastery tab grounding · the one goal number (P1-12)", () => {
  it("carries goalProgress, never the stored column", async () => {
    h.lifeGoal.findMany.mockResolvedValue([
      { id: "g1", title: "Revenue", kind: "metric", domain: "business", metric: "", unit: "$", currentValue: 3000, targetValue: 15000, progress: 99, horizon: "MONTH", status: "active", deadline: null, createdAt: new Date("2026-11-01T05:00:00.000Z") },
    ]);
    const out = await buildPageData("mastery");
    expect(out).toContain('"Revenue" 20%');
    expect(out).not.toContain("99%");
  });
});
