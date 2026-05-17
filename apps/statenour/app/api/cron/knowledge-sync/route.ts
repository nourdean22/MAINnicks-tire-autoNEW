import { cronHandler } from "@/lib/utils/http";
import { runKnowledgeSync } from "@/lib/brain/knowledge-sync";

// 300s lambda ceiling — sync is batched to stay well under this but
// give it the headroom for a slow Venice day.
export const maxDuration = 300;

/**
 * GET /api/cron/knowledge-sync
 *
 * Automated knowledge-layer sync. Runs three idempotent stages:
 *   1. Classify raw BrainDumps that haven't been processed yet
 *      and promote substantial new chat messages into BrainDumps
 *   2. Rebalance priorities on all backfill/journal-sourced tasks
 *      using the heuristic re-scorer
 *   3. Index substantial assistant chat messages as nick_advice
 *      brain memories so Nick's corpus stays current
 *
 * Schedule it via Railway cron (see NEXT-SESSION-PLAN.md) or
 * Vercel cron. Recommended cadence: every 6 hours. The stages are
 * designed to be cheap when there's no new data — if nothing has
 * changed since the last run, each stage is a single indexed query
 * that returns zero rows.
 *
 * Can also be invoked on-demand via the `syncKnowledge` AI tool.
 */
export const GET = cronHandler(async () => {
  return await runKnowledgeSync();
});
