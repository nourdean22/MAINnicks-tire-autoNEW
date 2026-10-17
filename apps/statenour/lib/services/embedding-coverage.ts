/**
 * lib/services/embedding-coverage.ts · Phase VV (2026-05-22 ·
 * legacy-modernizer REST→tRPC system slice).
 *
 * The pgvector-migration coverage rollup. Lifted verbatim from
 * app/api/system/embedding-coverage/route.ts so the legacy REST
 * endpoint AND the new `system.embeddingCoverage` tRPC procedure call
 * the same function · drift between consumers structurally impossible.
 *
 * Surfaces: pgvector extension state · dual-write coverage % ·
 * backfill progress · per-sourceType breakdown · recent dedup +
 * backfill cron runs.
 */

import { prisma } from "@/lib/prisma";
import { embeddingSpaceSql, isPgvectorAvailable } from "@/lib/db/pgvector";
import { TELEMETRY_CATEGORY_LIST } from "@/lib/brain/embedding-policy";
import type { PersonalGap } from "@/lib/services/personal-gap";

/**
 * The embed-backfill never embeds a row below this confidence
 * (app/api/cron/embed-backfill/route.ts, `bm.confidence >= 0.2`; pinned by
 * tests/services/embedding-coverage-personal-gap.test.ts). Counting those rows
 * as "missing" would be a permanent false backlog.
 */
const EMBED_MIN_CONFIDENCE = 0.2;

/**
 * "Searchable memories without a vector" (brain W5, 2026-10-17). Type and wording:
 * ./personal-gap.ts (pure, client-safe).
 *
 * Counts live brain_memories that the embedding policy says SHOULD be embedded
 * (not in TELEMETRY_CATEGORY_LIST, so no edges, shadows or event logs) and that
 * have NO brain_memory vector in the space dense recall reads (embedding_vec_1536
 * in the active model's space, the same predicate memory-recall.ts uses). A raw
 * "rows with no vector" count is dominated by telemetry and says nothing about
 * whether Nour's own memories can be found. A failed read is `unknown`, never 0.
 */
export async function buildPersonalGap(): Promise<PersonalGap> {
  try {
    if (!(await isPgvectorAvailable())) {
      return { state: "unknown", reason: "pgvector extension is off, so vectors cannot be counted" };
    }
    const rows = await prisma.$queryRawUnsafe<Array<{ category: string; eligible: unknown; missing: unknown }>>(
      `SELECT category, COUNT(*)::int AS eligible,
              SUM(CASE WHEN has_vec THEN 0 ELSE 1 END)::int AS missing
         FROM (
           SELECT bm.category::text AS category,
                  EXISTS (
                    SELECT 1 FROM vector_embeddings ve
                     WHERE ve."sourceType" = 'brain_memory'
                       AND ve."sourceId" = bm.id
                       AND ve.embedding_vec_1536 IS NOT NULL
                       AND ${embeddingSpaceSql("ve.model")}
                  ) AS has_vec
             FROM brain_memories bm
            WHERE bm.deleted_at IS NULL
              AND bm.confidence >= ${EMBED_MIN_CONFIDENCE}
              AND NOT (bm.category = ANY($1::text[]))
         ) t
        GROUP BY category`,
      TELEMETRY_CATEGORY_LIST,
    );
    let eligible = 0;
    let missing = 0;
    const perCategory: Array<{ category: string; missing: number }> = [];
    for (const r of rows) {
      const e = Number(r.eligible);
      const m = Number(r.missing);
      if (!Number.isFinite(e) || !Number.isFinite(m) || r.missing === null || r.eligible === null) {
        return { state: "unknown", reason: "gauge query returned a malformed row" };
      }
      eligible += e;
      missing += m;
      if (m > 0) perCategory.push({ category: String(r.category), missing: m });
    }
    perCategory.sort((a, b) => b.missing - a.missing || a.category.localeCompare(b.category));
    return { state: "ok", eligible, missing, byCategoryTop5: perCategory.slice(0, 5) };
  } catch (err) {
    return { state: "unknown", reason: err instanceof Error ? err.message : "gauge query failed" };
  }
}

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

/** Composite embedding-coverage payload for the /system/coverage card. */
export async function buildEmbeddingCoverage() {
  const pgvectorAvailable = await isPgvectorAvailable();

  // Per-sourceType totals + dual-write coverage in a single grouped
  // query. Uses a CASE WHEN so we don't need two separate scans.
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
          coveragePct:
            total === 0 ? 0 : Math.round((withVec / total) * 1000) / 10,
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
      const rows = await prisma.$queryRaw<
        Array<{ sourceType: string; total: bigint }>
      >`
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
  const personalGap = await buildPersonalGap();

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
      where: {
        eventType: {
          in: ["semantic_dedup_complete", "semantic_dedup_dry_run"],
        },
      },
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
        rowsCoveredAcrossCategories:
          p.pgvector?.rowsCoveredAcrossCategories ?? 0,
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
        totalRows === 0
          ? 0
          : Math.round((totalWithVec / totalRows) * 1000) / 10,
    },
    perSource,
    personalGap,
    recentDedupRuns,
    recentBackfillRuns,
    generatedAt: new Date().toISOString(),
  };
}
