import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  aiAggregate: vi.fn(),
  chatFindMany: vi.fn(),
  chatAggregate: vi.fn(),
  approvalCount: vi.fn(),
  traceFindMany: vi.fn(),
  brainGroupBy: vi.fn(),
  brainFindMany: vi.fn(),
  promptFindMany: vi.fn(),
  missionGroupBy: vi.fn(),
  realityFindMany: vi.fn(),
  workerSnapshot: vi.fn(),
  health: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiGeneration: { aggregate: (...a: unknown[]) => state.aiAggregate(...a) },
    chatMessage: {
      findMany: (...a: unknown[]) => state.chatFindMany(...a),
      aggregate: (...a: unknown[]) => state.chatAggregate(...a),
    },
    approvalRequest: { count: (...a: unknown[]) => state.approvalCount(...a) },
    agentTrace: { findMany: (...a: unknown[]) => state.traceFindMany(...a) },
    brainMemory: {
      groupBy: (...a: unknown[]) => state.brainGroupBy(...a),
      findMany: (...a: unknown[]) => state.brainFindMany(...a),
    },
    promptVersion: { findMany: (...a: unknown[]) => state.promptFindMany(...a) },
    mission: { groupBy: (...a: unknown[]) => state.missionGroupBy(...a) },
    realityEvent: { findMany: (...a: unknown[]) => state.realityFindMany(...a) },
  },
}));

vi.mock("@/lib/workers/external-worker", () => ({
  getExternalWorkerLaneSnapshots: (...a: unknown[]) => state.workerSnapshot(...a),
}));

vi.mock("@/lib/services/system-pages", () => ({
  buildSystemHealth: (...a: unknown[]) => state.health(...a),
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

vi.mock("@/lib/services/voice-latency", () => ({
  getVoiceLatencyState: vi.fn(),
}));

vi.mock("@/lib/observability/drift-detector", () => ({
  compareToWeekAgo: vi.fn(),
}));

import { buildCockpitStats } from "@/lib/services/system-observability";

beforeEach(() => {
  vi.clearAllMocks();
  state.aiAggregate.mockResolvedValue({
    _sum: { costCents: 321 },
    _avg: { durationMs: 1500 },
  });
  state.chatFindMany.mockResolvedValue([
    { firstTokenLatencyMs: 100 },
    { firstTokenLatencyMs: 200 },
    { firstTokenLatencyMs: 300 },
    { firstTokenLatencyMs: 400 },
  ]);
  state.chatAggregate.mockResolvedValue({ _avg: { feedbackScore: 0.5 } });
  state.approvalCount.mockResolvedValue(2);
  state.traceFindMany.mockResolvedValue([
    {
      id: "trace-row-1",
      traceId: "trace-1",
      provider: "ollama",
      model: "qwen",
      errorClass: null,
      finishedAt: new Date("2026-09-29T19:00:01Z"),
      durationMs: 900,
      costCents: 0,
      startedAt: new Date("2026-09-29T19:00:00Z"),
    },
  ]);
  state.brainGroupBy.mockResolvedValue([
    {
      category: "wisdom",
      _sum: { seenCount: 17 },
      _count: { _all: 4 },
    },
  ]);
  state.brainFindMany.mockResolvedValue([
    {
      id: "eval-1",
      key: "eval:1",
      content: "latest eval",
      metadata: {
        ranAt: "2026-09-29T18:00:00.000Z",
        totalRan: 10,
        passed: 9,
        failed: 1,
        passRate: 0.9,
        scoreAvg: 8.2,
      },
      createdAt: new Date("2026-09-29T18:00:00Z"),
      updatedAt: new Date("2026-09-29T18:00:00Z"),
    },
  ]);
  state.promptFindMany.mockResolvedValue([
    {
      id: "pv1",
      version: 7,
      active: true,
      systemPrompt: "Truth first.",
      createdAt: new Date("2026-09-20T00:00:00Z"),
    },
  ]);
  state.missionGroupBy.mockResolvedValue([
    { status: "ACTIVE", _count: { _all: 3 } },
    { status: "COMPLETE", _count: { _all: 5 } },
  ]);
  state.realityFindMany.mockResolvedValue([
    {
      eventType: "episode.mission.completed",
      observedAt: new Date("2026-09-29T19:30:00Z"),
      payload: { episodeId: "run-1", missionId: "mission-1" },
    },
  ]);
  state.workerSnapshot.mockResolvedValue({
    runnerFresh: true,
    runnerNodeKey: "external-worker:nattynour",
    runnerLastHeartbeatAt: "2026-09-29T19:59:00Z",
    lanes: {
      codex: { health: "degraded", quota: "exhausted", auth: "ChatGPT" },
      "claude-code": { health: "unavailable", quota: "unknown", auth: "not logged in" },
      antigravity: { health: "ready", quota: "available", auth: "Google account" },
      "local-qwen": { health: "ready", quota: "available", auth: "local" },
    },
  });
  state.health.mockResolvedValue({
    status: "healthy",
    degradedSources: [],
  });
});

describe("buildCockpitStats", () => {
  it("uses real incumbent stores instead of fabricated zero/empty placeholders", async () => {
    const out = await buildCockpitStats();

    expect(out.kpis).toMatchObject({
      totalCostCents: 321,
      p95TtftMs: 400,
      averageFeedback: 0.5,
      pendingApprovalsCount: 2,
      avgDurationMs: 1500,
    });
    expect(out.recentRuns).toHaveLength(1);
    expect(out.recentRuns[0]).toMatchObject({
      traceId: "trace-1",
      status: "success",
      model: "qwen",
    });
    expect(out.memoryDecay).toEqual([
      { category: "wisdom", count: 17, memories: 4 },
    ]);
    expect(out.missions).toMatchObject({
      active: 3,
      complete: 5,
      recentReceipts: [
        expect.objectContaining({
          phase: "completed",
          runId: "run-1",
          missionId: "mission-1",
        }),
      ],
    });
    expect(out.externalWorker.runnerFresh).toBe(true);
    expect(out.systemHealth).toEqual({
      status: "healthy",
      degradedSources: [],
    });
    expect(out.eval).toMatchObject({ totalRan: 10, passed: 9, passRate: 0.9 });
  });

  it("never fabricates prompt-version run attribution", async () => {
    const out = await buildCockpitStats();

    expect(out.promptVersions).toEqual([
      expect.objectContaining({
        version: 7,
        usageAttributionAvailable: false,
        totalRuns: null,
        averageFeedback: null,
      }),
    ]);
  });
});
