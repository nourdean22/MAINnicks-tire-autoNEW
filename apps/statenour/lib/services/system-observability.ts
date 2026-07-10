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

  const { burnCents, forecastCents, hoursElapsed } = await computeBurnRateForecast();
  const budget = await resolveDailyAiBudgetCents();
  const threshold = Math.round(budget * 1.2);

  return {
    date: etDateKey(),
    today: {
      burnCents,
      hoursElapsed: Number(hoursElapsed.toFixed(2)),
    },
    forecast: {
      forecastCents,
      thresholdCents: threshold,
      over: state.over,
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
