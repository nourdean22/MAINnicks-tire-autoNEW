import { cronHandler } from "@/lib/utils/http";
import { logger } from "@/lib/logger";
import { runConsolidation } from "@/lib/brain/memory-consolidation";
import { autoPromoteStableSkillsToWisdom } from "@/lib/brain/skill-extractor";
import { flushSlowQueriesToSystemMetric } from "@/lib/db/slow-query-tracker";
import { runSemanticDedup } from "@/lib/brain/semantic-dedup";
// v10.0.178 · was 60s — task itself takes ~51s p95, which left zero
// headroom. Mega's per-child timeout was the actual blocker (50s,
// now 90s); bumping this in lockstep so a slow run doesn't trip
// against the route's own ceiling either.
export const maxDuration = 90;

/**
 * GET /api/cron/consolidate — Memory Consolidation Engine
 *
 * Like sleep consolidation in the human brain:
 * 1. Prune expired + noise memories
 * 2. Merge similar memories into stronger ones
 * 3. Promote high-signal memories to wisdom
 * 4. Distill higher-order knowledge from patterns
 * 5. Re-score all memories by dynamic importance
 *
 * Runs in the evening cron — the brain "sleeps" and gets smarter.
 *
 * v10.0.529.106 · Wave 62 · two additional consolidation passes:
 * 6. Auto-promote stable-30d skills to wisdom (skill graduation loop)
 * 7. Flush in-memory slow-query tracker to SystemMetric for durability
 */
export const GET = cronHandler(async () => {
  const result = await runConsolidation();

  // v10.0.529.106 · Wave 62 · best-effort additional passes · failures
  // here don't block the primary consolidation result.
  const skillPromote = await autoPromoteStableSkillsToWisdom().catch((err) => {
    logger.warn("consolidate_skill_promote_failed", {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
    return { promoted: 0, skipped: 0, promotedKeys: [] as string[] };
  });
  const slowQueryFlush = await flushSlowQueriesToSystemMetric().catch((err) => {
    logger.warn("consolidate_slow_query_flush_failed", {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
    return { flushed: 0, topMs: 0 };
  });

  // Wave 63 · semantic near-duplicate sweep — complements the AI-merge in
  // runConsolidation by collapsing near-identical memories (pgvector cosine
  // >= 0.95, capped at 100/run, soft-deletes excluded) that quietly degrade
  // recall quality. DRY-RUN by default: emits a `semantic_dedup_dry_run` audit
  // event and deletes NOTHING, so the operator can inspect candidate counts
  // (System > Coverage) before flipping it live with SEMANTIC_DEDUP_LIVE=1.
  // Best-effort — a failure here never blocks consolidation.
  const semanticDedup = await runSemanticDedup({
    dryRun: process.env.SEMANTIC_DEDUP_LIVE !== "1",
  }).catch((err) => {
    logger.warn("consolidate_semantic_dedup_failed", {
      error: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
    return null;
  });

  return {
    ...result,
    skillPromotion: skillPromote,
    slowQueryFlush,
    semanticDedup,
  };
});
