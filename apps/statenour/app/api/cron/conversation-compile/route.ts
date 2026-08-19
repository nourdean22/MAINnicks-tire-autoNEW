import { cronHandler } from "@/lib/utils/http";
import { summarizeIdleConversations } from "@/lib/brain/conversation-memory";
export const maxDuration = 60;

/**
 * GET /api/cron/conversation-compile — the compiler's tail-catcher.
 *
 * 2026-08-19 · memory-loop wave. The per-turn compiler digests a
 * conversation WHILE it is active (first pass at message 4-6, staleness-
 * debounced recompiles after); this nightly sweep catches the tail every
 * conversation grows after its last compile, plus anything the per-turn
 * path lost to a budget-exhausted evening. Prod measurement that forced
 * it: 283 conversations → 15 live summaries vs 158 merge-ground
 * soft-deletes (grinder now excluded) and a one-shot-forever guard
 * (now staleness-based).
 *
 * Cap 10/run, 200ms apart — one digest is a full "reason"-lane LLM call;
 * a backfill over the whole corpus drains across nights by design, never
 * in one shot (the $5/day AI budget is enforced pre-flight per call).
 * Schedule: NIGHTLY via the mega-evening fan-out (EVENING_JOBS).
 */
export const GET = cronHandler(async () => {
  return await summarizeIdleConversations({ limit: 10 });
});
