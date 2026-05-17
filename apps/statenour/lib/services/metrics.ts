import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Record a metric data point */
export async function recordMetric(
  metric: string,
  value: number,
  options: { unit?: string; tags?: Record<string, unknown>; source?: string } = {}
): Promise<void> {
  await prisma.systemMetric.create({
    data: {
      metric,
      value,
      unit: options.unit ?? "ms",
      tags: options.tags ? (options.tags as Prisma.InputJsonValue) : undefined,
      source: options.source ?? "api",
    },
  }).catch(() => {}); // Never fail the main operation
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
