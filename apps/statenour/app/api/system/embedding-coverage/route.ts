/**
 * GET /api/system/embedding-coverage · v8.13 · Apr 29.
 *
 * Operator-visibility rollup for the pgvector migration in flight.
 * Surfaces:
 *   · Whether the `vector` extension is enabled
 *   · Total VectorEmbedding rows + per-sourceType breakdown
 *   · Dual-write coverage (% of rows with embedding_vec NOT NULL)
 *   · Pgvector backfill progress (rows remaining)
 *   · Recent semantic-dedup runs and their pgvector vs JS coverage
 *
 * Drives /system/embedding-coverage page. Composes on the v8.5
 * pgvector skeleton + v8.7 backfill cron + v8.12 dedup telemetry.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { isPgvectorAvailable } from "@/lib/db/pgvector";

interface SourceTypeRow {
  sourceType: string;
  total: bigint;
  withVec: bigint;
}

interface DedupRunRow {
  createdAt: Date;
  detail: string;
  payload: Record<string, unknown> | null;
}

export const GET = apiHandler(async () => {
  const pgvectorAvailable = await isPgvectorAvailable();

  // Per-sourceType totals + dual-write coverage in a single grouped query.
  // Uses a CASE WHEN so we don't need two separate scans.
  let perSource: Array<{
    sourceType: string;
    total: number;
    withVec: number;
    coveragePct: number;
  }> = [];
  let totalRows = 0;
  let totalWithVec = 0;
  let backfillBackgroundError: string | null = null;

  if (pgvectorAvailable) {
    try {
      const rows = await prisma.$queryRaw<SourceTypeRow[]>`
        SELECT "sourceType",
               COUNT(*)::bigint AS total,
               COUNT(embedding_vec)::bigint AS "withVec"
        FROM vector_embeddings
        GROUP BY "sourceType"
        ORDER BY COUNT(*) DESC
      `;
      perSource = rows.map((r) => {
        const total = Number(r.total);
        const withVec = Number(r.withVec);
        return {
          sourceType: r.sourceType,
          total,
          withVec,
          coveragePct: total === 0 ? 0 : Math.round((withVec / total) * 1000) / 10,
        };
      });
      totalRows = perSource.reduce((s, r) => s + r.total, 0);
      totalWithVec = perSource.reduce((s, r) => s + r.withVec, 0);
    } catch (err) {
      backfillBackgroundError =
        err instanceof Error ? err.message : "embedding_vec query failed";
    }
  } else {
    // Without pgvector, fall back to a JSON-only count so the dashboard
    // still has something to show (and Nour can see "extension off").
    try {
      const rows = await prisma.$queryRaw<Array<{ sourceType: string; total: bigint }>>`
        SELECT "sourceType", COUNT(*)::bigint AS total
        FROM vector_embeddings
        GROUP BY "sourceType"
        ORDER BY COUNT(*) DESC
      `;
      perSource = rows.map((r) => ({
        sourceType: r.sourceType,
        total: Number(r.total),
        withVec: 0,
        coveragePct: 0,
      }));
      totalRows = perSource.reduce((s, r) => s + r.total, 0);
    } catch (err) {
      backfillBackgroundError =
        err instanceof Error ? err.message : "vector_embeddings query failed";
    }
  }

  const backfillRemaining = Math.max(totalRows - totalWithVec, 0);

  // Recent dedup runs — last 10. Telemetry from v8.12 includes the
  // pgvector / JS row split so we can show how often the SQL path
  // is winning.
  let recentDedupRuns: Array<{
    at: string;
    summary: string;
    pgvectorAvailable: boolean;
    rowsCoveredAcrossCategories: number;
    rowsViaJsAcrossCategories: number;
    deleted: number;
    durationMs: number;
  }> = [];
  try {
    const rows = (await prisma.auditEvent.findMany({
      where: { eventType: { in: ["semantic_dedup_complete", "semantic_dedup_dry_run"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { createdAt: true, detail: true, payload: true },
    })) as DedupRunRow[];
    recentDedupRuns = rows.map((r) => {
      const p = (r.payload ?? {}) as {
        deleted?: number;
        durationMs?: number;
        pgvector?: {
          available?: boolean;
          rowsCoveredAcrossCategories?: number;
          rowsViaJsAcrossCategories?: number;
        };
      };
      return {
        at: r.createdAt.toISOString(),
        summary: r.detail,
        pgvectorAvailable: p.pgvector?.available ?? false,
        rowsCoveredAcrossCategories: p.pgvector?.rowsCoveredAcrossCategories ?? 0,
        rowsViaJsAcrossCategories: p.pgvector?.rowsViaJsAcrossCategories ?? 0,
        deleted: p.deleted ?? 0,
        durationMs: p.durationMs ?? 0,
      };
    });
  } catch {
    // Non-fatal — recent runs section just renders empty.
  }

  // Recent backfill cron runs (last 10) so progress velocity is visible.
  let recentBackfillRuns: Array<{
    at: string;
    status: string;
    durationMs: number | null;
    error: string | null;
  }> = [];
  try {
    const rows = await prisma.cronJobLog.findMany({
      where: { jobName: { contains: "pgvector-backfill" } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { createdAt: true, status: true, duration: true, error: true },
    });
    recentBackfillRuns = rows.map((r) => ({
      at: r.createdAt.toISOString(),
      status: r.status,
      durationMs: r.duration,
      error: r.error,
    }));
  } catch {
    // Non-fatal.
  }

  return {
    pgvectorAvailable,
    backfillBackgroundError,
    rollup: {
      totalRows,
      totalWithVec,
      backfillRemaining,
      coveragePct:
        totalRows === 0 ? 0 : Math.round((totalWithVec / totalRows) * 1000) / 10,
    },
    perSource,
    recentDedupRuns,
    recentBackfillRuns,
    generatedAt: new Date().toISOString(),
  };
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts