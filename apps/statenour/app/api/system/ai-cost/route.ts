import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/system/ai-cost — cost + latency + volume feed for /system/ai-cost.
 *
 * Aggregates AiGeneration over three windows (today · 7d · 30d) plus a
 * 14-day daily trend for the sparkline. Breakdowns by feature and by
 * model. All amounts are in cents.
 */

interface Breakdown {
  key: string;
  calls: number;
  costCents: number;
  avgLatencyMs: number;
  errorRate: number;
}

function midnightUTC(daysAgo: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function windowAggregate(since: Date) {
  const rows = await prisma.aiGeneration.findMany({
    where: { createdAt: { gte: since } },
    select: {
      feature: true,
      model: true,
      costCents: true,
      durationMs: true,
      status: true,
    },
  });
  const totalCalls = rows.length;
  const totalCostCents = rows.reduce((s, r) => s + (r.costCents ?? 0), 0);
  const totalLatency = rows.reduce((s, r) => s + (r.durationMs ?? 0), 0);
  const failures = rows.filter((r) => r.status === "failed").length;

  function group(keyFn: (r: (typeof rows)[number]) => string): Breakdown[] {
    const agg = new Map<string, { calls: number; cost: number; latency: number; errors: number }>();
    for (const r of rows) {
      const k = keyFn(r);
      if (!agg.has(k)) agg.set(k, { calls: 0, cost: 0, latency: 0, errors: 0 });
      const b = agg.get(k)!;
      b.calls++;
      b.cost += r.costCents ?? 0;
      b.latency += r.durationMs ?? 0;
      if (r.status === "failed") b.errors++;
    }
    return [...agg.entries()]
      .map(([key, b]): Breakdown => ({
        key,
        calls: b.calls,
        costCents: b.cost,
        avgLatencyMs: b.calls > 0 ? Math.round(b.latency / b.calls) : 0,
        errorRate: b.calls > 0 ? Math.round((b.errors / b.calls) * 100) : 0,
      }))
      .sort((a, b) => b.costCents - a.costCents);
  }

  return {
    totalCalls,
    totalCostCents,
    avgLatencyMs: totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0,
    errorRate: totalCalls > 0 ? Math.round((failures / totalCalls) * 100) : 0,
    byFeature: group((r) => r.feature || "unknown"),
    byModel: group((r) => r.model || "unknown"),
  };
}

export const GET = apiHandler(async () => {
  const todayStart = midnightUTC(0);
  const start7d = midnightUTC(7);
  const start30d = midnightUTC(30);
  const start14d = midnightUTC(14);

  const [today, last7d, last30d, daily] = await Promise.all([
    windowAggregate(todayStart),
    windowAggregate(start7d),
    windowAggregate(start30d),
    // 14-day daily trend
    prisma.$queryRawUnsafe<{ day: string; calls: bigint; cost_cents: bigint; duration_ms: bigint }[]>(`
      SELECT
        TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') as day,
        COUNT(*)::bigint as calls,
        COALESCE(SUM(cost_cents), 0)::bigint as cost_cents,
        COALESCE(SUM(duration_ms), 0)::bigint as duration_ms
      FROM ai_generations
      WHERE created_at >= $1
      GROUP BY 1
      ORDER BY 1 ASC
    `, start14d).catch(() => [] as { day: string; calls: bigint; cost_cents: bigint; duration_ms: bigint }[]),
  ]);

  // Build a dense 14-day series so the sparkline has no gaps.
  const trend: { day: string; calls: number; costCents: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = midnightUTC(i);
    const iso = d.toISOString().slice(0, 10);
    const row = daily.find((r) => r.day === iso);
    trend.push({
      day: iso,
      calls: row ? Number(row.calls) : 0,
      costCents: row ? Number(row.cost_cents) : 0,
    });
  }

  return {
    today,
    last7d,
    last30d,
    trend,
    generatedAt: new Date().toISOString(),
  };
}, { auth: "owner" }); // v9.1.14 · was leaking AI cost telemetry
