/**
 * lib/db/vector-tuning.ts · v10.0.403
 *
 * Per-query pgvector HNSW tuning · wraps a callback in a Prisma
 * transaction with `SET LOCAL hnsw.ef_search = N` so a single
 * KNN query gets higher recall than the role default.
 *
 * Why · ef_search is a query-time tradeoff:
 *   - low (20-40)  : fast, ~92-95% recall · default for most paths
 *   - mid (80)     : +50% latency, ~98%+ recall · brain memory recall
 *   - high (160+)  : 2-3x latency, ~99.5%+ recall · audit / eval only
 *
 * Most callers should use ef_search=40 (the role default) and only
 * upgrade specific high-leverage paths (memory recall, calibrated
 * confidence) where missing a near-neighbor materially hurts.
 *
 * Usage:
 *   import { withEfSearch } from "@/lib/db/vector-tuning";
 *   const ids = await withEfSearch(prisma, 80, async (tx) => {
 *     return tx.$queryRawUnsafe<{ id: string }[]>(`
 *       SELECT id::text FROM vector_embeddings
 *       WHERE embedding_vec_1536 IS NOT NULL
 *       ORDER BY embedding_vec_1536 <=> $1::vector(1536)
 *       LIMIT 10
 *     `, vecLit);
 *   });
 */

import type { PrismaClient } from "@prisma/client";

type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Wraps `fn` in an explicit transaction with `SET LOCAL hnsw.ef_search = N`.
 *
 * The setting only persists for the transaction's lifetime · subsequent
 * queries on the same pool connection revert to the role default.
 *
 * Falls back to running fn against the base prisma client (no tuning)
 * if the transaction fails to start · we'd rather get results with
 * default recall than fail closed.
 */
export async function withEfSearch<T>(
  prisma: PrismaClient,
  efSearch: number,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  // Clamp to sane bounds · pgvector accepts 1-1000 but anything <10 or >500
  // is almost certainly wrong.
  const ef = Math.max(10, Math.min(500, Math.floor(efSearch)));
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL hnsw.ef_search = ${ef}`;
      return fn(tx);
    });
  } catch (err) {
    // Don't let tuning break the call site · log + fall through.
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[vector-tuning] withEfSearch(${ef}) failed, falling back: ${
          err instanceof Error ? err.message.slice(0, 200) : err
        }`,
      );
    }
    // Fall back · run fn against the base client (caller's tx-shape compatible
    // because PrismaClient and TxClient share the $queryRawUnsafe surface we use).
    return fn(prisma as unknown as TxClient);
  }
}

/**
 * Recall-tier presets · use these names instead of magic numbers in callers.
 *
 * BALANCED · default for most paths
 * HIGH_RECALL · for the brain memory recall pipeline (where missing a
 *               match silently hurts answer quality)
 * AUDIT · for evaluation harnesses + offline analysis where speed
 *         doesn't matter and we want near-ground-truth
 */
export const EF_SEARCH = {
  BALANCED: 40,
  HIGH_RECALL: 80,
  AUDIT: 200,
} as const;
