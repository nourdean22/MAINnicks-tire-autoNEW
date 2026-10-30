/**
 * Audit 2026-10-10 06-F9-N1 + 06-F6: the cockpit's 30-day feedback average read
 * `_avg ?? 0`, so "no thumbs at all" rendered as a measured neutral 0.0, and the
 * aggregate counted seeded msg_calibration_* thumbs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({ chatAggregate: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiGeneration: { aggregate: vi.fn().mockResolvedValue({ _sum: { costCents: 0 }, _avg: { durationMs: 0 } }) },
    chatMessage: { findMany: vi.fn().mockResolvedValue([]), aggregate: (...a: unknown[]) => s.chatAggregate(...a) },
    approvalRequest: { count: vi.fn().mockResolvedValue(0) },
    autonomousAction: { findMany: vi.fn().mockResolvedValue([]) },
    agentTrace: { findMany: vi.fn().mockResolvedValue([]) },
    brainMemory: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
    promptVersion: { findMany: vi.fn().mockResolvedValue([]) },
    mission: { groupBy: vi.fn().mockResolvedValue([]) },
    realityEvent: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/workers/external-worker", () => ({ getExternalWorkerLaneSnapshots: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/services/system-pages", () => ({
  buildSystemHealth: vi.fn().mockResolvedValue({ status: "healthy", degradedSources: [] }),
}));
vi.mock("@/lib/services/cost-slo", () => ({
  computeBurnRateForecast: vi.fn(),
  costByProvider: vi.fn(),
  resolveDailyAiBudgetCents: vi.fn(),
  etDateKey: vi.fn(),
  isOverBudget: vi.fn(),
  sparkline7d: vi.fn(),
  topConversationsByCost: vi.fn(),
}));
vi.mock("@/lib/observability/drift-detector", () => ({ compareToWeekAgo: vi.fn() }));

import { buildCockpitStats } from "@/lib/services/system-observability";

beforeEach(() => s.chatAggregate.mockReset());

describe("cockpit 30-day feedback average", () => {
  it("no rated rows -> averageFeedback null, not a measured 0", async () => {
    s.chatAggregate.mockResolvedValueOnce({ _avg: { feedbackScore: null } });
    expect((await buildCockpitStats()).kpis.averageFeedback).toBeNull();
  });

  it("CONTROL: a real average passes through", async () => {
    s.chatAggregate.mockResolvedValueOnce({ _avg: { feedbackScore: 0.5 } });
    expect((await buildCockpitStats()).kpis.averageFeedback).toBe(0.5);
  });

  it("the aggregate excludes seeded msg_calibration_* thumbs (06-F6)", async () => {
    s.chatAggregate.mockResolvedValueOnce({ _avg: { feedbackScore: 0.5 } });
    await buildCockpitStats();
    expect(s.chatAggregate.mock.calls[0][0].where).toMatchObject({
      NOT: { id: { startsWith: "msg_calibration_" } },
    });
  });
});
