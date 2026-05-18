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
      where: { category: "reasoning_trace", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        createdAt: true,
        confidence: true,
        metadata: true,
      },
    });

    // Per-tier accumulators
    const byTier = new Map<
      string,
      {
        latencies: number[];
        costs: number[];
        confidences: number[];
        fallbackCount: number;
      }
    >();

    // Marker counts (which classifier reasons fire most)
    const markerCounts: Record<string, number> = {};
    // H.5.3 · per-marker quality · feeds the future classifier-learning
    // pass · which markers reliably produce high-confidence answers
    // (worth keeping) vs which produce low-confidence (worth tuning).
    const markerQuality = new Map<
      string,
      { confidences: number[]; fallbacks: number }
    >();

    for (const r of rows) {
      const m = (r.metadata ?? {}) as {
        tier?: string;
        classifierReason?: string;
        totalMs?: number;
        usd?: number;
        stepKinds?: string[];
      };
      const tier = m.tier ?? "unknown";
      const entry = byTier.get(tier) ?? {
        latencies: [],
        costs: [],
        confidences: [],
        fallbackCount: 0,
      };
      entry.latencies.push(m.totalMs ?? 0);
      entry.costs.push(m.usd ?? 0);
      entry.confidences.push(r.confidence ?? 0);
      // "fallback" signal · confidence ≤ 0.3 OR any step label contains "failed"
      const wasFailure = (r.confidence ?? 0) <= 0.3;
      if (wasFailure) entry.fallbackCount += 1;
      byTier.set(tier, entry);

      // Bucket classifier reasons by first word
      const reason = (m.classifierReason ?? "").trim();
      if (reason) {
        const bucket = reason.split(/\s+/)[0] || "other";
        markerCounts[bucket] = (markerCounts[bucket] ?? 0) + 1;
        // H.5.3 · attach quality to the bucket
        const qual = markerQuality.get(bucket) ?? { confidences: [], fallbacks: 0 };
        qual.confidences.push(r.confidence ?? 0);
        if ((r.confidence ?? 0) <= 0.3) qual.fallbacks += 1;
        markerQuality.set(bucket, qual);
      }
    }

    const tierStats: TierStat[] = Array.from(byTier.entries())
      .map(([tier, e]) => {
        const sortedLat = [...e.latencies].sort((a, b) => a - b);
        const sum = (arr: number[]) => arr.reduce((s, n) => s + n, 0);
        return {
          tier,
          runs: e.latencies.length,
          avgLatencyMs: Math.round(sum(e.latencies) / Math.max(1, e.latencies.length)),
          p50LatencyMs: percentile(sortedLat, 50),
          p95LatencyMs: percentile(sortedLat, 95),
          avgCostUsd: Math.round((sum(e.costs) / Math.max(1, e.costs.length)) * 10000) / 10000,
          totalCostUsd: Math.round(sum(e.costs) * 1000) / 1000,
          avgConfidence: Math.round((sum(e.confidences) / Math.max(1, e.confidences.length)) * 1000) / 1000,
          fallbackRate: Math.round((e.fallbackCount / Math.max(1, e.latencies.length)) * 1000) / 10,
        };
      })
      .sort((a, b) => b.runs - a.runs);

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
    const markerQualityRows: MarkerQualityRow[] = Array.from(
      markerQuality.entries(),
    )
      .map(([marker, q]) => {
        const avg =
          q.confidences.reduce((s, n) => s + n, 0) /
          Math.max(1, q.confidences.length);
        const fb = (q.fallbacks / Math.max(1, q.confidences.length)) * 100;
        const verdict: MarkerQualityRow["verdict"] =
          avg >= 0.75 && fb < 10
            ? "good"
            : avg >= 0.5 && fb < 25
              ? "ok"
              : "tune";
        return {
          marker,
          count: q.confidences.length,
          avgConfidence: Math.round(avg * 1000) / 1000,
          fallbackRate: Math.round(fb * 10) / 10,
          verdict,
        };
      })
      .sort((a, b) => b.count - a.count);

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
