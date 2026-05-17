import { runEmbeddingCleanup } from "@/lib/db/embedding-cleanup";
import { cronHandler } from "@/lib/utils/http";

export const maxDuration = 60;

/**
 * GET /api/cron/embed-cleanup — drop orphan vector_embeddings rows.
 *
 * v10.0.192 · folded into mega-evening. Initial backfill cleared
 * 5,655 of 8,158 rows (69%) where the source row was deleted or
 * archived. Without this cron, the same drift accumulates: every
 * brain_memory soft-delete leaves its embedding behind, slowing
 * /brain recall + the conversation→mission linker over time.
 *
 * Idempotent: nightly DELETE WHERE source not live. Returns the
 * deleted-by-sourceType breakdown for observability.
 */
export const GET = cronHandler(async () => {
  const started = Date.now();
  const report = await runEmbeddingCleanup();
  return { ok: true, durationMs: Date.now() - started, ...report };
});
