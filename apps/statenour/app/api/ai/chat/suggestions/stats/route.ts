import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { buildSuggestionStats } from "@/lib/services/brain-domain";

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
 *
 * Phase B.6d (2026-05-22 · legacy-modernizer REST→tRPC brain slice) ·
 * the inline metric assembly moved to
 * `lib/services/brain-domain.buildSuggestionStats` so this route AND the
 * new `trpc.brain.suggestionStats` procedure call the same function ·
 * drift impossible.
 */
// v10.0.44 — auth gate. Suggestion-cache hit/miss + Venice OK/fail
// metrics are operator-private (leak system load patterns).
export async function GET(req: Request) {
  await requireSession(req);
  try {
    return NextResponse.json(await buildSuggestionStats());
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "stats read failed",
        code: "SUGGESTION_STATS_FAILED",
      },
      { status: 500 },
    );
  }
}
