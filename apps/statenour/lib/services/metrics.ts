import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Proof that a metric row actually landed.
 *
 * Deliberately NOT `void`. A caller that swallows its own write failure cannot
 * produce an id it never observed, so any instrument that needs to tell "wrote
 * a zero" apart from "could not write" can demand this type and a fail-soft
 * writer will not type-check. That is a compile-time guard where a comment
 * would have been a suggestion.
 */
export interface MetricWriteReceipt {
  id: string;
}

/**
 * Record a metric data point, PROPAGATING a write failure to the caller.
 *
 * 2026-09-16 · added after review found that the fail-soft `recordMetric` below
 * made a broken instrument unreadable: `action.done.shadow` recorded 0 for "no
 * gap" and recorded nothing at all when `system_metrics` was unavailable, and
 * because the write never rejected, its own error branch could not run. A zero
 * and a dead writer looked identical — the exact confusion the census (#2359)
 * documents as its worst failure.
 *
 * Use this anywhere the WRITE ITSELF is the measurement. Use `recordMetric`
 * for incidental telemetry on a hot path, where losing a point is preferable to
 * failing the operation.
 */
export async function recordMetricStrict(
  metric: string,
  value: number,
  options: { unit?: string; tags?: Record<string, unknown>; source?: string } = {}
): Promise<MetricWriteReceipt> {
  const row = await prisma.systemMetric.create({
    data: {
      metric,
      value,
      unit: options.unit ?? "ms",
      tags: options.tags ? (options.tags as Prisma.InputJsonValue) : undefined,
      source: options.source ?? "api",
    },
    select: { id: true },
  });
  return { id: row.id };
}

/**
 * Record a metric data point, never failing the caller.
 *
 * Delegates to `recordMetricStrict` so there is ONE definition of the insert —
 * two copies would be free to drift, and the fail-soft behaviour is the only
 * intended difference.
 */
export async function recordMetric(
  metric: string,
  value: number,
  options: { unit?: string; tags?: Record<string, unknown>; source?: string } = {}
): Promise<void> {
  await recordMetricStrict(metric, value, options).catch(() => {}); // Never fail the main operation
}

/**
 * How far back a per-turn shadow looks for an earlier row with the same
 * traceId. The window only has to cover how late an outbox replay can arrive;
 * seven days is generous for a post-turn outbox.
 */
export const TRACE_DEDUPE_WINDOW_MS = 7 * 86_400_000;

/**
 * Has a row for `metric` already been written for this `traceId`?
 *
 * 2026-09-22 · the post-turn outbox REPLAYS `runDeferredBackgroundWork` after
 * a crash or an unmarked completion, so any per-turn shadow metric written
 * there can land twice for one turn — inflating `writesInWindow`, crossing
 * `MIN_POWERED_N` early and biasing every rate read off the rows. Review on
 * #2485 caught it for `recommendation.novelty`; `action.done.shadow` had the
 * identical exposure. Both consult this before writing. One indexed read on
 * (metric, createdAt); the JSON-key filter shape is the one measured against
 * production for the calibration reader (#2484).
 */
export async function metricRecordedForTrace(
  metric: string,
  traceId: string,
  windowMs: number = TRACE_DEDUPE_WINDOW_MS,
): Promise<boolean> {
  const row = await prisma.systemMetric.findFirst({
    where: {
      metric,
      createdAt: { gte: new Date(Date.now() - windowMs) },
      tags: { path: ["traceId"], equals: traceId },
    },
    select: { id: true },
  });
  return row !== null;
}

/** Query metrics with aggregation */
export async function queryMetrics(
  metric: string,
  options: { from?: Date; to?: Date; limit?: number } = {}
): Promise<{ metric: string; value: number; createdAt: Date }[]> {
  return prisma.systemMetric.findMany({
    where: {
      metric,
      createdAt: {
        ...(options.from && { gte: options.from }),
        ...(options.to && { lte: options.to }),
      },
    },
    select: { metric: true, value: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 100,
  });
}

/** Get metric summary (avg, min, max, count) for a time window */
export async function getMetricSummary(
  metric: string,
  options: { from?: Date; to?: Date } = {}
): Promise<{ avg: number; min: number; max: number; count: number }> {
  const result = await prisma.systemMetric.aggregate({
    where: {
      metric,
      createdAt: {
        ...(options.from && { gte: options.from }),
        ...(options.to && { lte: options.to }),
      },
    },
    _avg: { value: true },
    _min: { value: true },
    _max: { value: true },
    _count: { id: true },
  });

  return {
    avg: result._avg.value ?? 0,
    min: result._min.value ?? 0,
    max: result._max.value ?? 0,
    count: result._count.id,
  };
}

/** Get KPI summary for dashboard (24h, 7d, 30d) */
export async function getKpiSummary(): Promise<Record<string, unknown>> {
  const now = new Date();
  const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [latency24h, errors24h, requests24h, aiCost7d] = await Promise.all([
    getMetricSummary("api.latency", { from: h24 }),
    prisma.errorLog.count({ where: { createdAt: { gte: h24 } } }),
    prisma.apiRequestLog.count({ where: { createdAt: { gte: h24 } } }),
    prisma.systemMetric.aggregate({
      where: { metric: "ai.cost", createdAt: { gte: d7 } },
      _sum: { value: true },
    }),
  ]);

  return {
    latency_24h: { avg_ms: Math.round(latency24h.avg), p95_ms: Math.round(latency24h.max) },
    errors_24h: errors24h,
    requests_24h: requests24h,
    ai_cost_7d_cents: aiCost7d._sum.value ?? 0,
  };
}
