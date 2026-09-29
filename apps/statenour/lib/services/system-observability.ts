import { prisma } from "@/lib/prisma";
import {
  computeBurnRateForecast,
  costByProvider,
  resolveDailyAiBudgetCents,
  etDateKey,
  isOverBudget,
  sparkline7d,
  topConversationsByCost,
} from "@/lib/services/cost-slo";
import { getVoiceLatencyState } from "@/lib/services/voice-latency";
import { OS_SNAPSHOT_METRIC_NAMES } from "@/lib/observability/os-snapshot";
import { compareToWeekAgo } from "@/lib/observability/drift-detector";

const DEFAULT_LIMIT = 14;
const MAX_LIMIT = 90;
const MEMORY_CATEGORY = "eval_result";

interface PerQuestionMeta {
  id: string;
  category: string;
  passed: boolean;
  score: number;
  failures: string[];
  replyPreview: string;
  toolCalls: string[];
  durationMs: number;
  pipelineError?: string;
}

interface EvalResultMeta {
  ranAt?: string;
  totalRan?: number;
  passed?: number;
  failed?: number;
  passRate?: number;
  scoreAvg?: number;
  durationMs?: number;
  worstCategories?: Array<{ category: string; failed: number; total: number }>;
  perQuestionResults?: PerQuestionMeta[];
}

export async function buildCostSloSnapshot() {
  const [state, spark, top, providers] = await Promise.all([
    isOverBudget(),
    sparkline7d(),
    topConversationsByCost(7, 10),
    costByProvider(7),
  ]);

  // null = the burn read failed — render zeros but carry readFailed so
  // the surface can say "unknown" instead of asserting $0 (2026-07-30).
  const forecast = await computeBurnRateForecast();
  const readFailed = forecast === null || state === null;
  const { burnCents, forecastCents, hoursElapsed } = forecast ?? {
    burnCents: 0,
    forecastCents: 0,
    hoursElapsed: 0,
  };
  const budget = await resolveDailyAiBudgetCents();
  const threshold = Math.round(budget * 1.2);

  return {
    date: etDateKey(),
    readFailed,
    today: {
      burnCents,
      hoursElapsed: Number(hoursElapsed.toFixed(2)),
    },
    forecast: {
      forecastCents,
      thresholdCents: threshold,
      over: state?.over ?? false,
    },
    budget: {
      dailyCents: budget,
      thresholdMultiplier: 1.2,
    },
    sparkline7d: spark,
    topConversations: top,
    byProvider: providers,
  };
}

export async function buildVoiceLatencySnapshot(days: number = 7) {
  const safeDays = Math.max(1, Math.min(90, days));
  return await getVoiceLatencyState(safeDays);
}

export async function buildEvalResults(limitRaw?: number) {
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(limitRaw) ? Number(limitRaw) : DEFAULT_LIMIT),
  );

  const rows = await prisma.brainMemory.findMany({
    where: { category: MEMORY_CATEGORY, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      key: true,
      content: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const results = rows.map((r) => {
    const meta = (r.metadata ?? {}) as EvalResultMeta;
    return {
      id: r.id,
      key: r.key,
      summary: r.content,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      ranAt: meta.ranAt ?? r.createdAt.toISOString(),
      totalRan: meta.totalRan ?? 0,
      passed: meta.passed ?? 0,
      failed: meta.failed ?? 0,
      passRate: meta.passRate ?? 0,
      scoreAvg: meta.scoreAvg ?? 0,
      durationMs: meta.durationMs ?? 0,
      worstCategories: meta.worstCategories ?? [],
      perQuestionResults:
        limit === 1 ? meta.perQuestionResults ?? [] : undefined,
    };
  });

  return { results, count: results.length };
}

interface SeriesPoint {
  value: number;
  createdAt: Date;
}

export async function buildCockpitStats() {
  const now = Date.now();
  const since7d = new Date(now - 7 * 24 * 60 * 60_000);
  const since30d = new Date(now - 30 * 24 * 60 * 60_000);

  const [
    costAgg,
    latencyRows,
    feedbackAgg,
    pendingApprovalsCount,
    traces,
    memoryHits,
    promptVersionsRaw,
    workerSnapshot,
    evalResults,
    missionStats,
    recentMissionEvents,
    systemHealth,
  ] = await Promise.all([
    prisma.aiGeneration.aggregate({
      where: { createdAt: { gte: since7d } },
      _sum: { costCents: true },
      _avg: { durationMs: true },
    }),
    prisma.chatMessage.findMany({
      where: {
        createdAt: { gte: since7d },
        role: "assistant",
        firstTokenLatencyMs: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 1_000,
      select: { firstTokenLatencyMs: true },
    }),
    prisma.chatMessage.aggregate({
      where: {
        createdAt: { gte: since30d },
        role: "assistant",
        feedbackScore: { not: null },
      },
      _avg: { feedbackScore: true },
    }),
    prisma.approvalRequest.count({
      where: { status: "pending_approval" },
    }),
    prisma.agentTrace.findMany({
      orderBy: { startedAt: "desc" },
      take: 20,
      select: {
        id: true,
        traceId: true,
        provider: true,
        model: true,
        errorClass: true,
        finishedAt: true,
        durationMs: true,
        costCents: true,
        startedAt: true,
      },
    }),
    prisma.brainMemory.groupBy({
      by: ["category"],
      where: {
        deletedAt: null,
        lastSeen: { gte: since7d },
      },
      _sum: { seenCount: true },
      _count: { _all: true },
    }),
    prisma.promptVersion.findMany({
      orderBy: { version: "desc" },
      select: {
        id: true,
        version: true,
        active: true,
        systemPrompt: true,
        createdAt: true,
      },
    }),
    import("@/lib/workers/external-worker")
      .then(({ getExternalWorkerLaneSnapshots }) => getExternalWorkerLaneSnapshots())
      .catch(() => ({
        runnerFresh: false,
        runnerNodeKey: null,
        runnerLastHeartbeatAt: null,
        lanes: {
          codex: null,
          "claude-code": null,
          antigravity: null,
          "local-qwen": null,
        },
      })),
    buildEvalResults(1).catch(() => ({ results: [], count: 0 })),
    prisma.mission.groupBy({
      by: ["status"],
      where: { deletedAt: null },
      _count: { _all: true },
    }).catch(() => []),
    prisma.realityEvent.findMany({
      where: {
        eventType: { startsWith: "episode.mission." },
        observedAt: { gte: since7d },
      },
      orderBy: { observedAt: "desc" },
      take: 25,
      select: { eventType: true, observedAt: true, payload: true },
    }).catch(() => []),
    import("@/lib/services/system-pages")
      .then(({ buildSystemHealth }) => buildSystemHealth())
      .catch(() => ({
        status: "degraded" as const,
        degradedSources: ["system-health-read"],
      })),
  ]);

  const ttftValues = latencyRows
    .map((row) => row.firstTokenLatencyMs)
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b);
  const p95Index =
    ttftValues.length === 0
      ? -1
      : Math.min(ttftValues.length - 1, Math.ceil(ttftValues.length * 0.95) - 1);

  const missionCounts = Object.fromEntries(
    missionStats.map((row) => [row.status, row._count._all]),
  ) as Record<string, number>;
  const missionReceipts = recentMissionEvents.map((event) => {
    const payload =
      event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
        ? (event.payload as Record<string, unknown>)
        : {};
    return {
      phase: event.eventType.replace(/^episode\.mission\./, ""),
      observedAt: event.observedAt.toISOString(),
      runId: typeof payload.episodeId === "string" ? payload.episodeId : null,
      missionId: typeof payload.missionId === "string" ? payload.missionId : null,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    window: {
      costDays: 7,
      ttftDays: 7,
      feedbackDays: 30,
      memoryDays: 7,
    },
    kpis: {
      totalCostCents: costAgg._sum.costCents ?? 0,
      p95TtftMs: p95Index >= 0 ? ttftValues[p95Index] ?? 0 : 0,
      averageFeedback: feedbackAgg._avg.feedbackScore ?? 0,
      pendingApprovalsCount,
      avgDurationMs: costAgg._avg.durationMs ?? 0,
    },
    recentRuns: traces.map((trace) => ({
      id: trace.id,
      traceId: trace.traceId,
      model: trace.model ?? "non-model-step",
      provider: trace.provider ?? "system",
      status: trace.errorClass
        ? "errored"
        : trace.finishedAt
          ? "success"
          : "running",
      costCents: trace.costCents ?? 0,
      durationMs: trace.durationMs ?? 0,
      feedback: null,
      createdAt: trace.startedAt.toISOString(),
    })),
    memoryDecay: memoryHits
      .map((row) => ({
        category: row.category,
        count: row._sum.seenCount ?? row._count._all,
        memories: row._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    promptVersions: promptVersionsRaw.map((pv) => ({
      id: pv.id,
      version: pv.version,
      active: pv.active,
      systemPrompt:
        pv.systemPrompt.length > 100
          ? `${pv.systemPrompt.slice(0, 100)}...`
          : pv.systemPrompt,
      createdAt: pv.createdAt.toISOString(),
      totalRuns: null,
      averageFeedback: null,
      usageAttributionAvailable: false,
    })),
    eval: evalResults.results[0] ?? null,
    missions: {
      active: missionCounts.ACTIVE ?? 0,
      paused: missionCounts.PAUSED ?? 0,
      complete: missionCounts.COMPLETE ?? 0,
      killed: missionCounts.KILLED ?? 0,
      recentReceipts: missionReceipts,
    },
    systemHealth: {
      status: systemHealth.status,
      degradedSources: systemHealth.degradedSources ?? [],
    },
    externalWorker: workerSnapshot,
  };
}

export async function buildOsSnapshot() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000);

  const seriesByMetric: Record<string, SeriesPoint[]> = {};
  await Promise.all(
    OS_SNAPSHOT_METRIC_NAMES.map(async (metric) => {
      const rows = await prisma.systemMetric
        .findMany({
          where: { metric, createdAt: { gte: thirtyDaysAgo } },
          select: { value: true, createdAt: true },
          orderBy: { createdAt: "asc" },
          take: 200,
        })
        .catch((): SeriesPoint[] => []);
      seriesByMetric[metric] = rows;
    }),
  );

  const report = await compareToWeekAgo();

  return {
    series: seriesByMetric,
    drift: report,
    metricNames: OS_SNAPSHOT_METRIC_NAMES,
  };
}
