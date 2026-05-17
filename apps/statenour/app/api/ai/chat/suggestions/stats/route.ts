import { NextResponse } from "next/server";
import {
  readSuggestionMetrics,
  readHistoricalSuggestionMetrics,
} from "@/lib/ai/suggestion-cache";
import { requireSession } from "@/lib/auth-guard";

export const runtime = "nodejs";

/**
 * GET /api/ai/chat/suggestions/stats
 *
 * Returns both:
 *   live      — lambda-local counters (reset on cold start)
 *   history24 — last 24h persisted to SystemMetric (survives cold
 *               starts; accurate across all lambdas)
 *
 * Panel uses live as the leading indicator and history24 as the
 * baseline. If live hitRate diverges wildly from history24 hitRate,
 * that's signal — might indicate Venice is hot/cold or cache warming
 * is or isn't working.
 */
// v10.0.44 — auth gate. Suggestion-cache hit/miss + Venice OK/fail
// metrics are operator-private (leak system load patterns).
export async function GET(req: Request) {
  await requireSession(req);
  try {
    const live = readSuggestionMetrics();
    const history24 = await readHistoricalSuggestionMetrics(24);
    return NextResponse.json({
      live: {
        requests: live.requests,
        cacheHits: live.cacheHits,
        cacheHitRate: Number(live.cacheHitRate.toFixed(3)),
        veniceOk: live.veniceOk,
        veniceFail: live.veniceFail,
        heuristic: live.heuristic,
        errorFallback: live.errorFallback,
        avgLatencyMs: Math.round(live.avgLatencyMs),
        p50Ms: live.p50Ms,
        p95Ms: live.p95Ms,
        sample: live.latencySamples.length,
      },
      history24: {
        ...history24,
        cacheHitRate:
          history24.requests > 0
            ? Number((history24.cacheHits / history24.requests).toFixed(3))
            : 0,
      },
      // Legacy keys kept for backward-compatible consumers
      requests: live.requests,
      cacheHits: live.cacheHits,
      cacheHitRate: Number(live.cacheHitRate.toFixed(3)),
      veniceOk: live.veniceOk,
      veniceFail: live.veniceFail,
      heuristic: live.heuristic,
      errorFallback: live.errorFallback,
      avgLatencyMs: Math.round(live.avgLatencyMs),
      p50Ms: live.p50Ms,
      p95Ms: live.p95Ms,
      sample: live.latencySamples.length,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "stats read failed",
        code: "SUGGESTION_STATS_FAILED",
      },
      { status: 500 }
    );
  }
}
