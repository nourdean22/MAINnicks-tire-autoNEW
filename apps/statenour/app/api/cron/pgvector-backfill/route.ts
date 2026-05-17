/**
 * /api/cron/pgvector-backfill · v8.7 BATCH 39 · Apr 29.
 *
 * Migrates legacy JSON-string embeddings into the v8.5 native
 * `embedding_vec vector(1536)` column. Reads ~250 rows per pass
 * (rate-limited so we don't pin the connection pool) and updates
 * each in place. Self-terminating: when the WHERE clause returns 0
 * rows, the migration is complete.
 *
 * Composes:
 *   · v8.4 isPgvectorAvailable() — bails early if extension off
 *   · v8.5 schema migration — provides the embedding_vec column
 *   · vectorLiteral() — safe pgvector literal formatter
 *
 * Cadence: every 30 min until backfill drains. Each pass takes
 * <2s on Neon for 250 rows. After the last batch the cron becomes
 * a no-op.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { isPgvectorAvailable, vectorLiteral, assertSafeVectorLiteral } from "@/lib/db/pgvector";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/pgvector-backfill");

const BATCH_SIZE = 250;
export const maxDuration = 60;

interface BackfillRow {
  id: string;
  embedding: string;
}

export const GET = cronHandler(async () => {
  const started = Date.now();

  if (!(await isPgvectorAvailable())) {
    return {
      ok: true,
      durationMs: Date.now() - started,
      skipped: true,
      reason: "pgvector extension not enabled — nothing to backfill",
    };
  }

  // Pull rows that have a JSON embedding but no native vector yet.
  const rows = await prisma.$queryRaw<BackfillRow[]>`
    SELECT id, embedding
    FROM vector_embeddings
    WHERE embedding IS NOT NULL
      AND embedding_vec IS NULL
    LIMIT ${BATCH_SIZE}
  `.catch((err) => {
    log.warn("read_failed", { err: err instanceof Error ? err.message : String(err) });
    return [] as BackfillRow[];
  });

  if (rows.length === 0) {
    return {
      ok: true,
      durationMs: Date.now() - started,
      processed: 0,
      remaining: 0,
      done: true,
    };
  }

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const vec = JSON.parse(row.embedding) as unknown;
      if (
        !Array.isArray(vec) ||
        vec.length === 0 ||
        !vec.every((n) => typeof n === "number")
      ) {
        skipped++;
        continue;
      }
      const lit = vectorLiteral(vec as number[]);
      // v10.0.45 — assert literal is a strict numeric vector before
      // string-interpolating into raw SQL. assertSafeVectorLiteral
      // already exists in @/lib/db/pgvector for exactly this surface
      // but was not being called here. Belt-and-suspenders against a
      // future pgvector edge-case (e.g., `Number.isFinite` evolving
      // or cleaned input regaining `'` somehow) producing a SQL
      // injection vector. Throws on any non-numeric content.
      assertSafeVectorLiteral(lit);
      await prisma.$executeRawUnsafe(
        `UPDATE vector_embeddings SET embedding_vec = '${lit}'::vector WHERE id = $1`,
        row.id,
      );
      updated++;
    } catch (err) {
      errors++;
      log.warn("row_failed", { rowId: row.id, err: err instanceof Error ? err.message : String(err) });
    }
  }

  // Cheap remaining-count probe so dashboards can show progress.
  let remaining = -1;
  try {
    const probe = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM vector_embeddings
      WHERE embedding IS NOT NULL AND embedding_vec IS NULL
    `;
    remaining = Number(probe[0]?.count ?? 0);
  } catch {
    // not fatal
  }

  return {
    ok: true,
    durationMs: Date.now() - started,
    processed: rows.length,
    updated,
    skipped,
    errors,
    remaining,
    done: remaining === 0,
  };
});
