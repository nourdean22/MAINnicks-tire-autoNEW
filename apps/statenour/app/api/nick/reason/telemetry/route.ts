/**
 * GET /api/nick/reason/telemetry · Phase H.4 (2026-05-18 PM)
 *
 * Aggregates the persisted reasoning_trace rows into a telemetry
 * snapshot the operator can use to evaluate the engine itself:
 *
 *   · totalRuns, totalSpendAllUsd, spentTodayUsd, dailyCapUsd
 *   · per-tier · count · avg latency · avg cost · avg confidence
 *   · classifier marker breakdown · which markers fire most
 *   · timing distribution · p50 / p95 latency per tier
 *   · fallback rate · how often a step failed within a run
 *
 * Read-only · no AI calls · ~50ms typical. The /reason/history page
 * already shows the run list · this endpoint is for the meta-view
 * (which tier is worth its cost, which markers misfire, etc).
 *
 * Owner-only.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import { sanitizeError } from "@/lib/ai/reasoning/error-sanitizer";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  DEFAULT_DAILY_CAP_USD,
  __internals as budgetInternals,
} from "@/lib/ai/reasoning/budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

interface TierStat {
  tier: string;
  runs: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgCostUsd: number;
  totalCostUsd: number;
  avgConfidence: number;
  fallbackRate: number; // % of runs that hit a step labeled "failed"
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length));
  return sorted[idx];
}

export async function GET(req: Request) {
  try {
    await requireSession(req);

    const rows = await prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.REASONING_TRACE, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        createdAt: true,
        confidence: true,
        metadata: true,
      },
    });

    // L.2 · Pre-extract the typed metadata so the groupBy callbacks
    // stay declarative · pre-L the accumulator loop was 20 LOC of
    // .get/.set boilerplate.
    interface TraceRow {
      tier: string;
      classifierReason: string;
      totalMs: number;
      usd: number;
      confidence: number;
      isFallback: boolean;
      markerBucket: string | null;
    }
    const traces: TraceRow[] = rows.map((r) => {
      const m = (r.metadata ?? {}) as {
        tier?: string;
        classifierReason?: string;
        totalMs?: number;
        usd?: number;
      };
      const confidence = r.confidence ?? 0;
      const reason = (m.classifierReason ?? "").trim();
      return {
        tier: m.tier ?? "unknown",
        classifierReason: reason,
        totalMs: m.totalMs ?? 0,
        usd: m.usd ?? 0,
        confidence,
        isFallback: confidence <= 0.3,
        markerBucket: reason ? (reason.split(/\s+/)[0] || "other") : null,
      };
    });

    // L.2 · Map.groupBy (ES2024) · replaces the per-tier .get/.set loop
    const byTier = Map.groupBy(traces, (t) => t.tier);

    // Marker counts (which classifier reasons fire most)
    const markerCounts: Record<string, number> = {};
    // H.5.3 + L.2 · group by marker bucket · skip rows with no bucket
    const tracesWithMarker = traces.filter(
      (t): t is TraceRow & { markerBucket: string } => t.markerBucket !== null,
    );
    const byMarker = Map.groupBy(tracesWithMarker, (t) => t.markerBucket);
    for (const [bucket, items] of byMarker) {
      markerCounts[bucket] = items.length;
    }

    // L.3 · toSorted (ES2023) replaces spread-then-mutate sort
    const tierStats: TierStat[] = Array.from(byTier.entries())
      .map(([tier, items]) => {
        const latencies = items.map((i) => i.totalMs);
        const costs = items.map((i) => i.usd);
        const confidences = items.map((i) => i.confidence);
        const fallbackCount = items.filter((i) => i.isFallback).length;
        const sortedLat = latencies.toSorted((a, b) => a - b);
        const sum = (arr: number[]) => arr.reduce((s, n) => s + n, 0);
        return {
          tier,
          runs: items.length,
          avgLatencyMs: Math.round(sum(latencies) / Math.max(1, items.length)),
          p50LatencyMs: percentile(sortedLat, 50),
          p95LatencyMs: percentile(sortedLat, 95),
          avgCostUsd: Math.round((sum(costs) / Math.max(1, items.length)) * 10000) / 10000,
          totalCostUsd: Math.round(sum(costs) * 1000) / 1000,
          avgConfidence: Math.round((sum(confidences) / Math.max(1, items.length)) * 1000) / 1000,
          fallbackRate: Math.round((fallbackCount / Math.max(1, items.length)) * 1000) / 10,
        };
      })
      .toSorted((a, b) => b.runs - a.runs);

    const totalRuns = rows.length;
    const totalSpendAll = Math.round(
      tierStats.reduce((s, t) => s + t.totalCostUsd, 0) * 1000,
    ) / 1000;
    // H.7.2 · degrade BUDGET_READ_FAILED sentinel to 0 for telemetry read-path
    const rawSpend = await budgetInternals.getTodaySpendUsd();
    const spentTodayUsd = typeof rawSpend === "number" ? rawSpend : 0;

    // H.5.3 · marker quality summary · per bucket, avg confidence +
    // fallback rate. Surfaces the learning signal · a marker with
    // low avg confidence + high fallback rate is a candidate to tune.
    interface MarkerQualityRow {
      marker: string;
      count: number;
      avgConfidence: number;
      fallbackRate: number;
      verdict: "good" | "ok" | "tune";
    }
    // L.2 + L.3 · iterate the byMarker groupBy directly · toSorted result
    const markerQualityRows: MarkerQualityRow[] = Array.from(byMarker.entries())
      .map(([marker, items]) => {
        const confidences = items.map((i) => i.confidence);
        const fallbacks = items.filter((i) => i.isFallback).length;
        const avg = confidences.reduce((s, n) => s + n, 0) / Math.max(1, items.length);
        const fb = (fallbacks / Math.max(1, items.length)) * 100;
        const verdict: MarkerQualityRow["verdict"] =
          avg >= 0.75 && fb < 10
            ? "good"
            : avg >= 0.5 && fb < 25
              ? "ok"
              : "tune";
        return {
          marker,
          count: items.length,
          avgConfidence: Math.round(avg * 1000) / 1000,
          fallbackRate: Math.round(fb * 10) / 10,
          verdict,
        };
      })
      .toSorted((a, b) => b.count - a.count);

    // AG-21 · persona effectiveness. recordPersonaUsage has written
    // telemetry rows from all three reasoning sub-pipelines since M.2,
    // but scorePersonas() — the read side — had ZERO callers: weeks of
    // accumulated data was invisible and could never feed selection.
    // Best-effort: a scorer failure never breaks the telemetry view.
    const personas = await (async () => {
      try {
        const { scorePersonas } = await import("@/lib/ai/personas/scorer");
        return await scorePersonas();
      } catch {
        return [];
      }
    })();

    return NextResponse.json(
      {
        totals: {
          totalRuns,
          totalSpendAllUsd: totalSpendAll,
          spentTodayUsd,
          dailyCapUsd: DEFAULT_DAILY_CAP_USD,
          oldestRun: rows[rows.length - 1]?.createdAt?.toISOString() ?? null,
          newestRun: rows[0]?.createdAt?.toISOString() ?? null,
        },
        tierStats,
        markerCounts,
        markerQuality: markerQualityRows,
        personas,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "private, max-age=30" } },
    );
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const { publicMessage, errorId } = sanitizeError(err, {
      route: "/api/nick/reason/telemetry",
      op: "GET",
    });
    return NextResponse.json(
      { error: "telemetry_failed", message: publicMessage, errorId },
      { status: 500 },
    );
  }
}
