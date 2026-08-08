/**
 * lib/services/ai-cost.ts · Phase Y.1 (2026-05-18 PM)
 *
 * AI cost / latency / volume aggregator. Extracted from
 * `app/api/system/ai-cost/route.ts` so the legacy REST handler AND
 * the new tRPC procedure `trpc.system.aiCost` both call this single
 * function · drift between consumers is structurally impossible.
 * Same shared-service pattern as S.2 (system-health) + U.3 (lens-stats).
 *
 * Aggregates AiGeneration over three windows (today · 7d · 30d) plus
 * a 14-day daily trend for the sparkline. Breakdowns by feature and
 * by model. All amounts in cents.
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { isAiGenerationError } from "@/lib/ai/generation-status";

const log = rootLogger.withSurface("services/ai-cost");

export interface CostBreakdown {
  key: string;
  calls: number;
  costCents: number;
  avgLatencyMs: number;
  errorRate: number;
}

export interface CostWindow {
  totalCalls: number;
  totalCostCents: number;
  avgLatencyMs: number;
  errorRate: number;
  byFeature: CostBreakdown[];
  byModel: CostBreakdown[];
}

export interface AiCostFeed {
  today: CostWindow;
  last7d: CostWindow;
  last30d: CostWindow;
  trend: Array<{ day: string; calls: number; costCents: number }>;
  generatedAt: string;
}

function midnightUTC(daysAgo: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Phase CC bug-fix · hard cap on the per-window query. Pre-fix the
// findMany had no `take` · a 30-day window on a busy AiGeneration
// table could return tens of thousands of rows + OOM the dashboard
// load. 50k samples is enough to keep aggregate ratios statistically
// meaningful while bounding memory. The cap is high enough that
// realistic traffic (~1-5k/day) on the operator's actual table won't
// hit it · trip is logged so we know if it ever fires.
const PER_WINDOW_ROW_CAP = 50_000;

async function windowAggregate(since: Date): Promise<CostWindow> {
  const rows = await prisma.aiGeneration.findMany({
    where: { createdAt: { gte: since } },
    select: {
      feature: true,
      model: true,
      costCents: true,
      durationMs: true,
      status: true,
    },
    orderBy: { createdAt: "desc" },
    take: PER_WINDOW_ROW_CAP,
  });
  if (rows.length === PER_WINDOW_ROW_CAP) {
    // Cap hit · aggregates are based on the most recent PER_WINDOW
    // rows only. Phase FF · use structured logger so the operator can
    // grep `/system/logs` for `window_cap_hit` instead of stderr-
    // scraping · matches the rest of lib/services/* + lib/ai/judge-eval/*.
    log.warn("window_cap_hit", {
      cap: PER_WINDOW_ROW_CAP,
      windowSince: since.toISOString(),
    });
  }
  const totalCalls = rows.length;
  const totalCostCents = rows.reduce((s, r) => s + (r.costCents ?? 0), 0);
  const totalLatency = rows.reduce((s, r) => s + (r.durationMs ?? 0), 0);
  // 2026-08-08 · was `status === "failed"` — a status NO writer emits
  // (track.ts defaults to "complete", failure paths pass "error"), so
  // failures and every per-group errorRate below were structurally ZERO
  // since this file existed — the exact 2026-07-30 trap-table row, still
  // live here. The shared predicate matches the writers' vocabulary.
  const failures = rows.filter((r) => isAiGenerationError(r.status)).length;

  function group(keyFn: (r: (typeof rows)[number]) => string): CostBreakdown[] {
    const agg = new Map<
      string,
      { calls: number; cost: number; latency: number; errors: number }
    >();
    for (const r of rows) {
      const k = keyFn(r);
      if (!agg.has(k)) agg.set(k, { calls: 0, cost: 0, latency: 0, errors: 0 });
      const b = agg.get(k)!;
      b.calls++;
      b.cost += r.costCents ?? 0;
      b.latency += r.durationMs ?? 0;
      if (isAiGenerationError(r.status)) b.errors++;
    }
    return [...agg.entries()]
      .map(([key, b]): CostBreakdown => ({
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

export async function buildAiCostFeed(): Promise<AiCostFeed> {
  const todayStart = midnightUTC(0);
  const start7d = midnightUTC(7);
  const start30d = midnightUTC(30);
  const start14d = midnightUTC(14);

  const [today, last7d, last30d, daily] = await Promise.all([
    windowAggregate(todayStart),
    windowAggregate(start7d),
    windowAggregate(start30d),
    // 14-day daily trend
    prisma.$queryRawUnsafe<
      { day: string; calls: bigint; cost_cents: bigint; duration_ms: bigint }[]
    >(
      `
      SELECT
        TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') as day,
        COUNT(*)::bigint as calls,
        COALESCE(SUM(cost_cents), 0)::bigint as cost_cents,
        COALESCE(SUM(duration_ms), 0)::bigint as duration_ms
      FROM ai_generations
      WHERE created_at >= $1
      GROUP BY 1
      ORDER BY 1 ASC
    `,
      start14d,
    ).catch((err) => {
      // 2026-05-30 · was a silent `() => []` — a failed sparkline query
      // rendered 14 flat zero-bars, indistinguishable from "no AI spend."
      // Keep the empty fallback (sparkline still renders) but leave a
      // breadcrumb so the failure is diagnosable instead of silent.
      log.warn("ai_cost_trend_query_failed", {
        error: err instanceof Error ? err.message.slice(0, 160) : String(err),
      });
      return [] as {
        day: string;
        calls: bigint;
        cost_cents: bigint;
        duration_ms: bigint;
      }[];
    }),
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
}
