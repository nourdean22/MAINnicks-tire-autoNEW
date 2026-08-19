/**
 * SEMANTIC DEDUP — vector-similarity-based BrainMemory consolidation.
 *
 * v7 · BATCH 1A · Apr 28. Fast + cheap dedup pass that runs every 6h.
 * Complements the daily AI-merge in lib/brain/memory-consolidation.ts —
 * that one uses LLM prompts to find fuzzy similar insights; this one
 * uses vector embeddings to kill near-identical phrasings.
 *
 * v8.12 BATCH 67 · Apr 29 — pgvector dual-read.
 * The legacy path parses the JSON `embedding` column and runs N² JS
 * cosine in app code. With pgvector enabled (v8.4 + v8.5 migration),
 * we now prefer a single SQL self-join with the `<=>` operator that
 * returns all near-duplicate pairs in one query. Rows without an
 * `embedding_vec` value (pre-backfill) still flow through the JS path,
 * so the upgrade is migration-safe and transparent.
 *
 * Categories scoped:
 *   · industry_intel — RSS items often repeat
 *   · customer_stories — same customer over time
 *   · content_performance — same post scored multiple times
 *   · feedback / content_feedback — recurring same-pattern reactions
 *   · pinned_user — Nour pins similar facts twice
 *
 * Algorithm:
 *   1. For each scoped category, fetch up to 500 entries (≥1h old)
 *   2. Build the near-duplicate adjacency map:
 *      a. pgvector path (when available) — single SQL self-join
 *      b. JS-cosine fallback — only for rows without embedding_vec
 *   3. Greedy clustering: highest-confidence row claims its un-claimed
 *      near-duplicates from the adjacency map
 *   4. Merge each group: winner keeps confidence, sums seenCount,
 *      takes max lastSeen, concats metadata. Losers deleted.
 *   5. Cap at 100 deletions per run. Audit-log the action.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { isPgvectorAvailable } from "@/lib/db/pgvector";
import { logger as rootLogger } from "@/lib/logger";
import { logError } from "@/lib/utils/error-log";

const log = rootLogger.withSurface("brain/semantic-dedup");

const SIMILARITY_THRESHOLD = 0.95;
// pgvector `<=>` returns (1 - cosine_similarity); threshold flips.
const COSINE_DISTANCE_THRESHOLD = 1 - SIMILARITY_THRESHOLD;
const MIN_AGE_BEFORE_MERGE_MS = 60 * 60 * 1000;
const MAX_DELETIONS_PER_RUN = 100;
const MAX_ENTRIES_PER_CATEGORY = 500;

const CATEGORIES_TO_DEDUP = [
  "industry_intel",
  "customer_stories",
  "content_performance",
  "feedback",
  "pinned_user",
  "content_feedback",
];

interface MemoryRow {
  id: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  seenCount: number;
  lastSeen: Date;
  metadata: unknown;
  createdAt: Date;
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

async function loadEmbeddings(memoryIds: string[]): Promise<Map<string, number[]>> {
  if (memoryIds.length === 0) return new Map();
  const rows = await prisma.vectorEmbedding
    .findMany({
      where: { sourceType: "brain_memory", sourceId: { in: memoryIds } },
      select: { sourceId: true, embedding: true },
    })
    .catch((err) => {
      logError("brain.semantic-dedup", err, { fn: "loadEmbeddings.findMany" });
      return [] as Array<{ sourceId: string; embedding: string }>;
    });
  const map = new Map<string, number[]>();
  let malformedCount = 0;
  const malformedErrors: unknown[] = [];
  for (const r of rows) {
    try {
      const vec = JSON.parse(r.embedding) as number[];
      if (Array.isArray(vec) && vec.length > 0) map.set(r.sourceId, vec);
    } catch (err) {
      // skip malformed
      malformedCount++;
      malformedErrors.push(err);
    }
  }
  
  if (malformedCount > 0) {
    logError("brain.semantic-dedup", new Error(`${malformedCount} malformed embeddings skipped`), { fn: "loadEmbeddings", errors: malformedErrors.map(String) }, "warn");
  }
  return map;
}

/**
 * Build the near-duplicate adjacency map for a category's rows.
 *
 * Strategy (v8.12):
 *   1. pgvector path (when available) — one SQL self-join over the
 *      memoryIds with `<=>` cosine distance. Returns all pairs with
 *      distance < 0.05 (== similarity ≥ 0.95). HNSW index doesn't
 *      help self-joins so it's still O(N²) at the DB level, but the
 *      whole loop runs in one query instead of N² JS cosine calls.
 *   2. Fallback (rows without embedding_vec) — JS cosine pairwise on
 *      whatever JSON embeddings we loaded, but only between rows that
 *      pgvector didn't already cover. Migration-safe: as the backfill
 *      cron drains, the JS path naturally shrinks toward zero.
 *
 * Returns a Map<id, Set<id>> where every undirected pair {a, b}
 * appears as both a→b and b→a so the caller can do single-key lookups.
 */
async function buildNearDupAdjacency(
  memoryIds: string[],
  embeddings: Map<string, number[]>,
): Promise<{
  adj: Map<string, Set<string>>;
  pgvectorRowsCovered: Set<string>;
}> {
  const adj = new Map<string, Set<string>>();
  const pgvectorRowsCovered = new Set<string>();

  const addPair = (a: string, b: string): void => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };

  // ── Path A: pgvector self-join ──
  if (memoryIds.length > 1 && (await isPgvectorAvailable())) {
    try {
      // Self-join with id-ordering to avoid double-counting pairs.
      // `embedding_vec IS NOT NULL` lets the partial index help filter.
      const pairs = await prisma.$queryRaw<
        Array<{ a: string; b: string; distance: number }>
      >`
        SELECT a."sourceId" AS a, b."sourceId" AS b,
               (a.embedding_vec <=> b.embedding_vec)::float8 AS distance
        FROM vector_embeddings a
        JOIN vector_embeddings b
          ON a."sourceType" = b."sourceType"
         AND a."sourceId" < b."sourceId"
        WHERE a."sourceType" = 'brain_memory'
          AND a."sourceId" IN (${Prisma.join(memoryIds)})
          AND b."sourceId" IN (${Prisma.join(memoryIds)})
          AND a.embedding_vec IS NOT NULL
          AND b.embedding_vec IS NOT NULL
          AND vector_dims(a.embedding_vec) = vector_dims(b.embedding_vec)
          AND (a.embedding_vec <=> b.embedding_vec) < ${COSINE_DISTANCE_THRESHOLD}
      `.catch((err) => {
        logError("brain.semantic-dedup", err, { fn: "buildNearDupAdjacency.pgvectorPairs" });
        return null as Array<{ a: string; b: string; distance: number }> | null;
      });

      if (pairs) {
        for (const p of pairs) addPair(p.a, p.b);
        // Track which rows were ANALYZED via pgvector (had a non-null
        // embedding_vec). We do this by re-querying the IDs of rows
        // with embedding_vec NOT NULL among our set, so the fallback
        // doesn't re-walk them.
        const covered = await prisma.$queryRaw<Array<{ sourceId: string }>>`
          SELECT "sourceId"
          FROM vector_embeddings
          WHERE "sourceType" = 'brain_memory'
            AND "sourceId" IN (${Prisma.join(memoryIds)})
            AND embedding_vec IS NOT NULL
        `.catch((err) => {
          logError("brain.semantic-dedup", err, { fn: "buildNearDupAdjacency.pgvectorCovered" });
          return [] as Array<{ sourceId: string }>;
        });
        for (const r of covered) pgvectorRowsCovered.add(r.sourceId);
      }
    } catch (err) {
      // pgvector unavailable mid-run (extension dropped, schema mismatch);
      // fall through to JS path covering everything.
      log.warn("pgvector_self_join_failed", { err: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Path B: JS-cosine for rows pgvector didn't cover ──
  // For correctness, any pair where AT LEAST ONE side wasn't covered by
  // pgvector still needs JS scoring (the pgvector self-join skipped it
  // entirely). We compute pairwise only for the "uncovered" half.
  const uncovered = memoryIds.filter((id) => !pgvectorRowsCovered.has(id));
  if (uncovered.length > 0) {
    for (let i = 0; i < uncovered.length; i++) {
      const aId = uncovered[i];
      const aVec = embeddings.get(aId);
      if (!aVec) continue;
      // Compare uncovered[i] against EVERY other memoryId (covered or not).
      // Required because a covered row's pgvector entry can't be paired
      // with an uncovered row via the SQL path.
      for (const bId of memoryIds) {
        if (bId === aId) continue;
        // Avoid duplicate work: only compare each unordered pair once.
        if (
          pgvectorRowsCovered.has(bId) ||
          (uncovered.indexOf(bId) > i)
        ) {
          const bVec = embeddings.get(bId);
          if (!bVec) continue;
          if (cosine(aVec, bVec) >= SIMILARITY_THRESHOLD) {
            addPair(aId, bId);
          }
        }
      }
    }
  }

  return { adj, pgvectorRowsCovered };
}

export interface SemanticDedupResult {
  scanned: number;
  groups: number;
  merged: number;
  deleted: number;
  skipped: number;
  durationMs: number;
  errors: string[];
  /** v8.12 telemetry: how many rows were paired via pgvector vs JS. */
  pgvector: {
    available: boolean;
    rowsCoveredAcrossCategories: number;
    rowsViaJsAcrossCategories: number;
  };
}

export async function runSemanticDedup(opts: { dryRun?: boolean } = {}): Promise<SemanticDedupResult> {
  const { dryRun = false } = opts;
  const t0 = Date.now();
  const pgvectorAvailable = await isPgvectorAvailable();
  const result: SemanticDedupResult = {
    scanned: 0, groups: 0, merged: 0, deleted: 0, skipped: 0, durationMs: 0, errors: [],
    pgvector: {
      available: pgvectorAvailable,
      rowsCoveredAcrossCategories: 0,
      rowsViaJsAcrossCategories: 0,
    },
  };

  for (const category of CATEGORIES_TO_DEDUP) {
    if (result.deleted >= MAX_DELETIONS_PER_RUN) break;

    let rows: MemoryRow[] = [];
    try {
      rows = (await prisma.brainMemory.findMany({
        where: { category, createdAt: { lt: new Date(Date.now() - MIN_AGE_BEFORE_MERGE_MS) }, deletedAt: null }, // v10.0.66 · don't dedup soft-deleted
        orderBy: { confidence: "desc" },
        take: MAX_ENTRIES_PER_CATEGORY,
        select: { id: true, category: true, key: true, content: true, confidence: true, seenCount: true, lastSeen: true, metadata: true, createdAt: true },
      })) as MemoryRow[];
    } catch (err) {
      result.errors.push(`fetch ${category}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (rows.length < 2) continue;
    result.scanned += rows.length;

    const embeddings = await loadEmbeddings(rows.map((r) => r.id));
    if (embeddings.size < 2) {
      result.skipped++;
      continue;
    }

    // v8.12 BATCH 67 — build the near-dup adjacency map. pgvector
    // handles whatever has embedding_vec, JS-cosine fills the rest.
    const memoryIds = rows.map((r) => r.id);
    const { adj, pgvectorRowsCovered } = await buildNearDupAdjacency(
      memoryIds,
      embeddings,
    );
    result.pgvector.rowsCoveredAcrossCategories += pgvectorRowsCovered.size;
    result.pgvector.rowsViaJsAcrossCategories +=
      memoryIds.length - pgvectorRowsCovered.size;

    const claimed = new Set<string>();
    const groups: Array<{ winner: MemoryRow; losers: MemoryRow[] }> = [];

    // Greedy clustering — confidence-ordered (rows is already sorted
    // desc by confidence). Each winner claims un-claimed neighbors.
    for (let i = 0; i < rows.length; i++) {
      const winner = rows[i];
      if (claimed.has(winner.id)) continue;
      const neighbors = adj.get(winner.id);
      if (!neighbors || neighbors.size === 0) continue;
      const losers: MemoryRow[] = [];
      // Walk in row-order so the highest-confidence remaining neighbor
      // is checked first — preserves v7-era semantics where ties broke
      // toward earlier rows.
      for (let j = i + 1; j < rows.length; j++) {
        const candidate = rows[j];
        if (claimed.has(candidate.id)) continue;
        if (!neighbors.has(candidate.id)) continue;
        losers.push(candidate);
        claimed.add(candidate.id);
      }
      if (losers.length > 0) {
        groups.push({ winner, losers });
        claimed.add(winner.id);
      }
    }

    for (const group of groups) {
      if (result.deleted >= MAX_DELETIONS_PER_RUN) break;
      result.groups++;
      const sumSeen = group.winner.seenCount + group.losers.reduce((s, l) => s + l.seenCount, 0);
      const maxLastSeen = group.losers.reduce(
        (m, l) => (l.lastSeen > m ? l.lastSeen : m),
        group.winner.lastSeen,
      );

      const winnerMeta = (group.winner.metadata as Record<string, unknown> | null) ?? {};
      const mergedFrom: string[] = Array.isArray((winnerMeta as { merged_from?: unknown }).merged_from)
        ? (winnerMeta as { merged_from: string[] }).merged_from
        : [];
      for (const l of group.losers) {
        mergedFrom.push(l.id);
        const lm = (l.metadata as Record<string, unknown> | null) ?? {};
        for (const k of Object.keys(lm)) {
          if (!(k in winnerMeta)) (winnerMeta as Record<string, unknown>)[k] = lm[k];
        }
      }
      (winnerMeta as Record<string, unknown>).merged_from = mergedFrom;
      (winnerMeta as Record<string, unknown>).consolidated_at = new Date().toISOString();

      if (dryRun) {
        result.merged += group.losers.length;
        continue;
      }

      try {
        await prisma.$transaction(async (tx) => {
          await tx.brainMemory.update({
            where: { id: group.winner.id },
            data: {
              seenCount: sumSeen,
              lastSeen: maxLastSeen,
              metadata: winnerMeta as unknown as Parameters<typeof tx.brainMemory.update>[0]["data"]["metadata"],
            },
          });
          await tx.brainMemory.deleteMany({ where: { id: { in: group.losers.map((l) => l.id) } } });
          await tx.vectorEmbedding.deleteMany({
            where: { sourceType: "brain_memory", sourceId: { in: group.losers.map((l) => l.id) } },
          });
        });
        result.merged += group.losers.length;
        result.deleted += group.losers.length;
      } catch (err) {
        result.errors.push(`merge ${group.winner.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  try {
    await prisma.auditEvent.create({
      data: {
        actor: dryRun ? "semantic-dedup-dry" : "semantic-dedup",
        eventType: dryRun ? "semantic_dedup_dry_run" : "semantic_dedup_complete",
        detail: `${result.merged} merged into ${result.groups} winners · ${result.deleted} deleted`,
        payload: { ...result, threshold: SIMILARITY_THRESHOLD, categories: CATEGORIES_TO_DEDUP } as unknown as Parameters<typeof prisma.auditEvent.create>[0]["data"]["payload"],
      },
    });
  } catch (err) {
    // non-critical
    logError("brain.semantic-dedup", err, { fn: "runSemanticDedup.auditEvent" });
  }

  result.durationMs = Date.now() - t0;
  return result;
}
