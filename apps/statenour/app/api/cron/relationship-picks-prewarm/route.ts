/**
 * GET /api/cron/relationship-picks-prewarm · Wave AK · 2026-05-28.
 *
 * Daily 7am UTC · ONE HOUR BEFORE the nick-action-proposal cron at
 * 8am UTC. Pre-warms the RELATIONSHIPS_PICKS_TODAY cache so the
 * proposer's outreach source has data before it runs.
 *
 * Pre-fix: the relationships-pick-today cache was populated LAZILY ·
 * only when the operator opened /relationships. At 8am UTC (3-4am ET)
 * the operator was asleep · cache was empty · proposer's outreach
 * slot silently degraded (4 sources instead of 5) every morning. The
 * silent-failure-hunter audit (2026-05-28 PM) flagged this.
 *
 * This cron is the fix · runs at 7am UTC sharp · uses the same lib
 * function the endpoint uses (drift impossible) · returns counts so
 * cron telemetry can see whether the warmup found candidates.
 *
 * Idempotent · `pickRelationshipsForToday` is itself idempotent (returns
 * cached value if already populated for today) · cron retries are safe.
 *
 * Cost · ~$0.005 per run via Anthropic (one tracedAiChat for the rank).
 * Falls back to the heuristic path if AI fails. Telegram alert NOT
 * needed here · the cron's role is to populate cache · the 8am proposer
 * handles its own alerting if the cache STILL ends up empty (proposer-
 * side telegram on failure is its job, not this cron's).
 */

import { cronHandler } from "@/lib/utils/http";
import { pickRelationshipsForToday } from "@/lib/ai/relationships-pick-today";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const startedAt = Date.now();
  try {
    const result = (await pickRelationshipsForToday()) as {
      picks?: Array<{ personId: string; personName: string }>;
      source?: string;
    };
    return {
      ok: true,
      pickCount: result.picks?.length ?? 0,
      source: result.source ?? "unknown",
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
});
