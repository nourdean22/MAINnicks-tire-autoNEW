/**
 * Embedding utilities for semantic memory recall.
 *
 * Core capabilities:
 * - Cosine similarity between vectors
 * - Euclidean distance for clustering
 * - Semantic search with hybrid scoring (embedding + recency + confidence)
 * - Semantic deduplication (find near-duplicate memories)
 * - Memory clustering (group related memories by topic)
 * - Batch embedding with rate limiting
 * - Embedding health metrics (coverage, dimension consistency)
 */

import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/ai/provider";
import {
  isPgvectorAvailable,
  vectorLiteral,
  padToVectorDim,
  VECTOR_DIM_1536,
} from "@/lib/db/pgvector";
import { RECALL_EXCLUDE_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";
import { logError } from "@/lib/utils/error-log";

const log = rootLogger.withSurface("brain/embedding");

/**
 * v8.5 BATCH 31 — write the native vector column when pgvector is
 * available AND the migration has shipped. Fire-and-forget; failures
 * fall back to "JSON column only" behavior. Never throws.
 *
 * Tracks pgvector availability via the shared cache in lib/db/pgvector
 * so the probe runs at most once per 5min across the whole process.
 */
// Exported in the durable-fanout wave (audit 2026-07-15) so
// journal-convergence's ensureEmbeddings can dual-write the native
// vector column — it was the last writer producing JSON-only rows,
// which kept the pgvector kNN path starved for journal entries.
export async function writePgvectorColumn(
  rowId: string,
  vec: number[],
): Promise<void> {
  try {
    if (!(await isPgvectorAvailable())) return;
    if (vec.length === 0) return;
    // embedding_vec is constrained to vector(1024) in the database.
    const lit = vectorLiteral(padToVectorDim(vec, 1024));
    // Cast literal → vector inline; safe because vectorLiteral
    // already sanitizes (only finite numbers + brackets/commas).
    await prisma.$executeRawUnsafe(
      `UPDATE vector_embeddings SET embedding_vec = '${lit}'::vector(1024) WHERE id = $1`,
      rowId,
    );

    // Also populate the fixed-1536 column. The opinionated chat-context
    // recall (lib/brain/memory-recall.ts → recallMemoriesForQuery) reads
    // ONLY `embedding_vec_1536 IS NOT NULL` through its HNSW index. Pre-
    // fix that column was filled solely by the WEEKLY embed-backfill
    // cron, so a freshly-written memory was invisible to Nick's live
    // recall for up to 7 days. Zero-pad to 1536 (cosine-preserving) with
    // the same convention the recall query's padToTargetDim uses. Wrapped
    // in its own try so a missing column / dim issue can never undo the
    // embedding_vec write above — that statement has already committed.
    try {
      const lit1536 = vectorLiteral(padToVectorDim(vec, VECTOR_DIM_1536));
      await prisma.$executeRawUnsafe(
        `UPDATE vector_embeddings SET embedding_vec_1536 = '${lit1536}'::vector(${VECTOR_DIM_1536}) WHERE id = $1`,
        rowId,
      );
    } catch (err1536) {
      log.warn("pgvector_1536_write_failed", {
        hint: "embedding_vec_1536 column missing or dim mismatch — weekly backfill will still catch it",
        error: err1536 instanceof Error ? err1536.message : String(err1536),
      });
    }
  } catch (err) {
    // Most likely: column doesn't exist yet (migration not applied)
    // or wrong dim. Either way the JSON column has the truth, so we
    // just log and move on.
    log.warn("pgvector_dual_write_failed", {
      hint: "column missing or wrong dim — JSON column has truth, will retry next save",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Vector math
// ---------------------------------------------------------------------------

/** Cosine similarity between two vectors. Returns 0-1 (1 = identical). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/** Euclidean distance between two vectors. Lower = more similar. */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/** Average of multiple vectors (centroid computation for clustering). */
export function vectorCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const centroid = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) centroid[i] += vec[i];
  }
  for (let i = 0; i < dim; i++) centroid[i] /= vectors.length;
  return centroid;
}

// ---------------------------------------------------------------------------
// Embedding storage (uses existing VectorEmbedding table)
// ---------------------------------------------------------------------------

/**
 * Supported embedding source types. Keeping this as a union so
 * downstream code has compile-time safety on the namespace —
 * adding a new one = one edit here + one spot in backfill.
 */
export type EmbeddingSourceType =
  | "brain_memory"
  | "brain_dump"
  | "reflection"
  | "strategic_law"
  | "chat_message"
  // v10.0.515 · #4 semantic tool-result cache · reuses vector_embeddings
  // with a dedicated sourceType namespace. Avoids a schema migration.
  // sourceId = sha1(toolName + ":" + normalizedQuestion); content
  // stores { result, expiresAt } JSON.
  | "tool_cache"
  // v10.0.515 · #10 Document Q&A · sourceType for ingested documents.
  // Each chunk is one row · sourceId = `${documentId}:chunk:${i}`.
  // Recall via knnSearch then surface in chat as context.
  | "document"
  // AG-31 · the Wave Z Greene corpus (BrainMemory category greene_law —
  // the actions-bearing store). sourceId = the BrainMemory key. Enables
  // the matcher's vector fallback for paraphrases keyword triggers miss.
  | "greene_law"
  // Silo wave (audit 2026-07-15) · the two journal silos that were
  // invisible to ALL semantic recall — convergence scans wrote raw
  // vector rows for them directly via prisma, but nothing typed
  // could. sourceId = the silo row id.
  | "situation_log"
  | "decision_replay";

async function markMemoryEmbeddingPending(memoryId: string): Promise<void> {
  try {
    const memory = await prisma.brainMemory.findUnique({
      where: { id: memoryId },
      select: { metadata: true },
    });
    if (memory) {
      const currentMeta = (memory.metadata as Record<string, any>) || {};
      if (currentMeta.embedding_status !== "pending") {
        await prisma.brainMemory.update({
          where: { id: memoryId },
          data: {
            metadata: {
              ...currentMeta,
              embedding_status: "pending",
            },
          },
        });
      }
    }
  } catch (err) {
    log.warn("failed_to_mark_embedding_pending", {
      memoryId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function markMemoryEmbeddingSuccess(memoryId: string): Promise<void> {
  try {
    const memory = await prisma.brainMemory.findUnique({
      where: { id: memoryId },
      select: { metadata: true },
    });
    if (memory) {
      const currentMeta = (memory.metadata as Record<string, any>) || {};
      if (currentMeta.embedding_status) {
        const nextMeta = { ...currentMeta };
        delete nextMeta.embedding_status;
        await prisma.brainMemory.update({
          where: { id: memoryId },
          data: {
            metadata: nextMeta,
          },
        });
      }
    }
  } catch (err) {
    log.warn("failed_to_mark_embedding_success", {
      memoryId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Store or update an embedding for any source type.
 * Non-blocking — failures are logged but don't break the caller.
 *
 * Designed so any engine can cheaply index content into the shared
 * vector table. Contextual recall can then search across types
 * (e.g. "when Nick wrote X in a brain dump on April 2nd").
 */
export async function storeGenericEmbedding(
  sourceType: EmbeddingSourceType,
  sourceId: string,
  content: string
): Promise<void> {
  try {
    // 2026-05-23 · Wave B · C2 · skip-on-identical-content gate.
    // Pre-fix: getEmbedding() ran on EVERY call · 8 call sites
    // (memory-manager × 2, auto-learn, auto-learn-llm, pins × 2,
    // conversation-memory, blind-spot-pinner) re-embedded identical
    // content on every "touch" (remember(), pin update, recall
    // bookkeeping). Cheapest correct path: check existing row's
    // content FIRST · if byte-identical, return immediately.
    // Saves both the embedding-provider call AND the Prisma write.
    const existing = await prisma.vectorEmbedding.findFirst({
      where: { sourceType, sourceId },
      select: { id: true, content: true },
    });

    if (existing && existing.content === content) {
      // Identical content · no-op. The vector + native pgvector
      // column already represent this string.
      if (sourceType === "brain_memory") {
        await markMemoryEmbeddingSuccess(sourceId);
      }
      return;
    }

    const vec = await getEmbedding(content);
    if (vec.length === 0) {
      if (sourceType === "brain_memory") {
        await markMemoryEmbeddingPending(sourceId);
      }
      return; // Embedding provider unavailable
    }

    if (existing) {
      await prisma.vectorEmbedding.update({
        where: { id: existing.id },
        data: { content, embedding: JSON.stringify(vec) },
      });
      // v8.5 BATCH 31 — dual-write the native vector column when
      // the v8.5 migration has shipped. No-ops gracefully when the
      // column doesn't exist (writePgvectorColumn catches + warns).
      void writePgvectorColumn(existing.id, vec);
    } else {
      const created = await prisma.vectorEmbedding.create({
        data: {
          sourceType,
          sourceId,
          content,
          embedding: JSON.stringify(vec),
        },
      });
      void writePgvectorColumn(created.id, vec);
    }

    if (sourceType === "brain_memory") {
      await markMemoryEmbeddingSuccess(sourceId);
    }
  } catch (err) {
    log.warn("store_failed", {
      sourceType,
      sourceId,
      error: err instanceof Error ? err.message : String(err),
    });
    if (sourceType === "brain_memory") {
      await markMemoryEmbeddingPending(sourceId);
    }
  }
}

/**
 * Legacy wrapper — kept because lots of call sites already use it.
 * Delegates to storeGenericEmbedding with sourceType = brain_memory.
 */
export async function storeMemoryEmbedding(
  memoryId: string,
  content: string
): Promise<void> {
  return storeGenericEmbedding("brain_memory", memoryId, content);
}

/**
 * Batch store embeddings for multiple memories.
 * Processes sequentially with 100ms delay to avoid rate limits.
 */
export async function batchStoreEmbeddings(
  items: { memoryId: string; content: string }[],
  delayMs: number = 100
): Promise<{ stored: number; failed: number }> {
  let stored = 0;
  let failed = 0;

  for (const item of items) {
    try {
      await storeMemoryEmbedding(item.memoryId, item.content);
      stored++;
    } catch {
      failed++;
    }
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }

  return { stored, failed };
}

// ---------------------------------------------------------------------------
// Semantic search (enhanced with hybrid scoring)
// ---------------------------------------------------------------------------

interface SemanticMatch {
  sourceType: string;
  sourceId: string;
  content: string;
  similarity: number;
  hybridScore: number; // Combined score: embedding similarity + recency + confidence
  category?: string;
}

/**
 * v8.7 BATCH 40 — pgvector-backed fast path. Uses the native HNSW
 * cosine index instead of fetching + scoring every row. Returns the
 * same `SemanticMatch[]` shape so it's a drop-in replacement.
 *
 * Returns null (not []) when pgvector isn't available — caller falls
 * through to the in-memory cosine path.
 *
 * Performance: ~5ms for top-30 across 100K rows vs ~800ms+ for the
 * full-scan cosine. Lights up automatically once the v8.5 migration
 * + v8.7 backfill have run.
 */
async function pgvectorSemanticSearch(
  queryVec: number[],
  limit: number,
  sourceTypes: EmbeddingSourceType[],
): Promise<SemanticMatch[] | null> {
  // Late-imported to avoid a circular dep with lib/db/pgvector
  const { isPgvectorAvailable, knnSearch } = await import("@/lib/db/pgvector");
  if (!(await isPgvectorAvailable())) return null;

  // KNN over each source type. The helper handles the WHERE filter
  // + cosine `<=>` operator. We cap each call at limit*2 to give the
  // hybrid re-rank some headroom (recency/confidence can re-shuffle).
  const fanLimit = Math.min(limit * 2, 200);
  const hitsByType = await Promise.all(
    sourceTypes.map((st) =>
      // RECALL_EXCLUDE_CATEGORIES is enforced HERE, at the vector boundary, so
      // all twelve semanticSearch callers inherit it. It was previously honoured
      // only by callers that hand-wrote `category: { notIn: [...] }` into a
      // Prisma where-clause, which the vector path never did — so the quarantine
      // did not hold for grounding.ts or contradiction-surfacer.ts. Those two
      // matter epistemically: groundClaim() could match an un-promoted
      // research_claim_candidate and return "source_supported", i.e. one
      // unverified external claim corroborating another.
      knnSearch(queryVec, {
        sourceType: st,
        limit: fanLimit,
        metric: "cosine",
        excludeCategories: RECALL_EXCLUDE_CATEGORIES,
      }),
    ),
  );
  // forensic-audit MEDIUM · knnSearch returns null on FAILURE and [] on a
  // successful-but-empty query. If EVERY source-type query failed, return null
  // so semanticSearch falls through to the legacy in-memory cosine scan —
  // previously `h ?? []` coerced the failures to [] and the function reported
  // "no matches" instead of falling back.
  if (hitsByType.length > 0 && hitsByType.every((h) => h === null)) return null;
  const allHits = hitsByType.flatMap((h) => h ?? []);
  if (allHits.length === 0) return [];

  // Pull metadata for memories so hybrid scoring matches the
  // cosine-path's contract.
  const memoryIds = allHits
    .filter((h) => h.sourceType === "brain_memory")
    .map((h) => h.sourceId);
  // `deletedAt: null` is not a refinement here — it is the ONLY thing that keeps
  // deleted memories out of recall. knnSearch reads `vector_embeddings` with no
  // join back to `brain_memories`, and the loop below takes its text from
  // `hit.content` (the embedding row's own copy), so a deleted memory stays
  // fully readable through the index unless it is dropped here. Measured on prod
  // 2026-08-16: of 9,919 searchable brain_memory entries, only 2,526 (25.5%)
  // pointed at a live memory — 2,526 were soft-deleted and 4,867 had no memory
  // row at all. Three of every four candidates were content the operator had
  // already removed.
  const memories = memoryIds.length
    ? await prisma.brainMemory
        .findMany({
          where: { id: { in: memoryIds }, deletedAt: null },
          select: { id: true, confidence: true, createdAt: true, category: true, seenCount: true },
        })
        .catch((): never[] => [])
    : [];
  const metaMap = new Map<string, (typeof memories)[number]>();
  for (const m of memories) metaMap.set(m.id, m);

  const now = Date.now();
  const maxAgeDays = 90;
  const scored: SemanticMatch[] = [];
  for (const hit of allHits) {
    // pgvector cosine: distance = 1 - similarity → similarity = 1 - distance
    const sim = Math.max(0, Math.min(1, 1 - hit.distance));
    if (sim < 0.15) continue;

    const meta = metaMap.get(hit.sourceId);
    const isMem = hit.sourceType === "brain_memory";
    // A brain_memory hit with no live metadata row is deleted or gone. It used
    // to survive this loop on the `confidence ?? 0.5` fallback and be served
    // from hit.content, which is how soft-deleting a memory failed to remove it
    // from Nick's context. Non-memory source types legitimately have no row here
    // and are unaffected.
    if (isMem && !meta) continue;
    const confidenceScore = isMem ? meta?.confidence ?? 0.5 : 0.6;
    const ageDays =
      isMem && meta ? (now - meta.createdAt.getTime()) / 86400000 : maxAgeDays / 2;
    const recencyScore = Math.max(0, 1 - ageDays / maxAgeDays);
    const hybridScore = 0.7 * sim + 0.15 * recencyScore + 0.15 * confidenceScore;

    scored.push({
      sourceType: hit.sourceType,
      sourceId: hit.sourceId,
      content: hit.content,
      similarity: sim,
      hybridScore,
      category: meta?.category,
    });
  }

  scored.sort((a, b) => b.hybridScore - a.hybridScore);
  return scored.slice(0, limit);
}

/**
 * Find the most semantically similar rows to a query across one or
 * more source types. Defaults to brain_memory for backward compat
 * with existing call sites.
 *
 * Hybrid scoring: 70% embedding similarity + 15% recency + 15% confidence.
 * Non-brain_memory rows get a synthetic confidence of 0.6 so they're
 * not penalized relative to real memories.
 */
export async function semanticSearch(
  query: string,
  limit: number = 30,
  sourceTypes: EmbeddingSourceType[] = ["brain_memory"]
): Promise<SemanticMatch[]> {
  const queryVec = await getEmbedding(query);
  if (queryVec.length === 0) return []; // Embedding unavailable

  // v8.7 BATCH 40 — fast path via pgvector when available. Returns
  // null when extension is off or column missing → falls through to
  // the legacy in-memory cosine scan.
  const pgvectorHits = await pgvectorSemanticSearch(queryVec, limit, sourceTypes);
  if (pgvectorHits !== null) return pgvectorHits;

  // Load embeddings from the requested source types
  const rows = await prisma.vectorEmbedding
    .findMany({
      where: { sourceType: { in: sourceTypes } },
      select: { sourceId: true, sourceType: true, content: true, embedding: true },
    })
    .catch((): never[] => []);

  if (rows.length === 0) return [];

  // For brain_memory rows, pull metadata so hybrid scoring has recency,
  // confidence, seenCount. Other source types use sensible defaults.
  // v10.0.38 — restrict the metadata query to the brain_memory rows
  // we actually have embeddings for. Pre-fix this was an unbounded
  // full-table scan; on a mature brain (10k+ rows) that was a
  // multi-second query + memory spike on every cold semantic search.
  const memoryIds = rows
    .filter((r) => r.sourceType === "brain_memory")
    .map((r) => r.sourceId);
  const memories = sourceTypes.includes("brain_memory") && memoryIds.length > 0
    ? await prisma.brainMemory
        .findMany({
          where: { id: { in: memoryIds } },
          select: {
            id: true,
            confidence: true,
            createdAt: true,
            category: true,
            seenCount: true,
          },
        })
        .catch((): never[] => [])
    : [];
  const metaMap = new Map<string, (typeof memories)[number]>();
  for (const m of memories) metaMap.set(m.id, m);

  const now = Date.now();
  const maxAgeDays = 90;

  const scored: SemanticMatch[] = [];
  let corrupted = 0;
  for (const row of rows) {
    try {
      const vec = JSON.parse(row.embedding) as number[];
      if (vec.length !== queryVec.length) continue;

      const sim = cosineSimilarity(queryVec, vec);
      if (sim < 0.15) continue; // Skip noise

      const meta = metaMap.get(row.sourceId);
      const isMem = row.sourceType === "brain_memory";

      // Non-memory rows default to a synthetic confidence so they're
      // not crushed by missing metadata. brain_dump / reflection /
      // strategic_law are inherently high-signal sources.
      const confidenceScore = isMem ? meta?.confidence ?? 0.5 : 0.6;

      // Recency only tracked for memories; others get a neutral 0.5.
      const ageDays =
        isMem && meta ? (now - meta.createdAt.getTime()) / 86400000 : maxAgeDays / 2;
      const recencyScore = Math.max(0, 1 - ageDays / maxAgeDays);

      const reinforcementBonus =
        isMem && meta?.seenCount
          ? Math.min(0.1, (meta.seenCount - 1) * 0.02)
          : 0;

      const hybridScore =
        sim * 0.7 + recencyScore * 0.15 + confidenceScore * 0.15 + reinforcementBonus;

      scored.push({
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        content: row.content,
        similarity: sim,
        hybridScore,
        category: meta?.category,
      });
    } catch {
      // Corrupted embedding row — skip · aggregated below (this loop is a
      // full scan over all vector rows on every cold search)
      corrupted++;
    }
  }
  if (corrupted > 0) {
    logError(
      "brain.embedding-utils",
      new Error(`${corrupted} corrupted embedding rows skipped`),
      { fn: "semanticSearch", corrupted, scanned: rows.length },
      "warn",
    );
  }

  scored.sort((a, b) => b.hybridScore - a.hybridScore);
  return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Semantic deduplication
// ---------------------------------------------------------------------------

interface DuplicatePair {
  id1: string;
  id2: string;
  content1: string;
  content2: string;
  similarity: number;
}

/**
 * Find near-duplicate memories based on embedding similarity.
 * Duplicates are memories with similarity > threshold (default 0.92).
 * Used by data-cleanup cron to merge or remove redundant memories.
 */
export async function findSemanticDuplicates(
  threshold: number = 0.92,
  limit: number = 20
): Promise<DuplicatePair[]> {
  // v10.0.38 — bounded scan. Pre-fix: no take cap on the embedding
  // fetch + O(n²) JS-cosine loop with 10k+ rows = ~5s blocking
  // operation that timed out the cleanup cron. 1000-row cap covers
  // realistic dedup needs (older memories have already been deduped
  // by prior runs); take ordered by createdAt desc so the freshest
  // candidates always win.
  const rows = await prisma.vectorEmbedding.findMany({
    where: { sourceType: "brain_memory" },
    select: { sourceId: true, content: true, embedding: true },
    orderBy: { createdAt: "desc" },
    take: 1000,
  }).catch((): never[] => []);

  if (rows.length < 2) return [];

  // Parse all vectors
  const parsed: { sourceId: string; content: string; vec: number[] }[] = [];
  let corrupted = 0;
  for (const row of rows) {
    try {
      const vec = JSON.parse(row.embedding) as number[];
      if (vec.length > 0) parsed.push({ sourceId: row.sourceId, content: row.content, vec });
    } catch {
      corrupted++; // aggregated below — up to 1000 rows per pass
    }
  }
  if (corrupted > 0) {
    logError(
      "brain.embedding-utils",
      new Error(`${corrupted} corrupted embedding rows skipped`),
      { fn: "findSemanticDuplicates", corrupted, scanned: rows.length },
      "warn",
    );
  }

  // Compare all pairs (O(n²) but capped at ~1000 memories = ~500K comparisons = ~50ms)
  const duplicates: DuplicatePair[] = [];
  for (let i = 0; i < parsed.length && duplicates.length < limit; i++) {
    for (let j = i + 1; j < parsed.length && duplicates.length < limit; j++) {
      if (parsed[i].vec.length !== parsed[j].vec.length) continue;
      const sim = cosineSimilarity(parsed[i].vec, parsed[j].vec);
      if (sim >= threshold) {
        duplicates.push({
          id1: parsed[i].sourceId,
          id2: parsed[j].sourceId,
          content1: parsed[i].content.slice(0, 100),
          content2: parsed[j].content.slice(0, 100),
          similarity: Math.round(sim * 1000) / 1000,
        });
      }
    }
  }

  return duplicates.sort((a, b) => b.similarity - a.similarity);
}

// ---------------------------------------------------------------------------
// Memory clustering
// ---------------------------------------------------------------------------

interface MemoryCluster {
  centroidCategory: string;
  members: { sourceId: string; content: string; similarity: number }[];
  size: number;
  avgSimilarity: number;
}

/**
 * Cluster memories by semantic similarity using simple greedy clustering.
 * Each cluster forms around a seed memory; subsequent memories join the
 * closest cluster if similarity > joinThreshold.
 */
export async function clusterMemories(
  joinThreshold: number = 0.65,
  maxClusters: number = 15
): Promise<MemoryCluster[]> {
  const rows = await prisma.vectorEmbedding.findMany({
    where: { sourceType: "brain_memory" },
    select: { sourceId: true, content: true, embedding: true },
  }).catch((): never[] => []);

  if (rows.length < 3) return [];

  // Parse vectors
  const parsed: { sourceId: string; content: string; vec: number[] }[] = [];
  let corrupted = 0;
  for (const row of rows) {
    try {
      const vec = JSON.parse(row.embedding) as number[];
      if (vec.length > 0) parsed.push({ sourceId: row.sourceId, content: row.content, vec });
    } catch {
      corrupted++; // aggregated below — unbounded brain_memory scan
    }
  }
  if (corrupted > 0) {
    logError(
      "brain.embedding-utils",
      new Error(`${corrupted} corrupted embedding rows skipped`),
      { fn: "clusterMemories", corrupted, scanned: rows.length },
      "warn",
    );
  }

  // Greedy clustering
  const clusters: { centroidVec: number[]; members: typeof parsed; category: string }[] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < parsed.length && clusters.length < maxClusters; i++) {
    if (assigned.has(i)) continue;

    // Start a new cluster with this memory as seed
    const cluster = { centroidVec: [...parsed[i].vec], members: [parsed[i]], category: "" };
    assigned.add(i);

    // Find all unassigned memories similar to this seed
    for (let j = i + 1; j < parsed.length; j++) {
      if (assigned.has(j)) continue;
      if (parsed[j].vec.length !== cluster.centroidVec.length) continue;

      const sim = cosineSimilarity(cluster.centroidVec, parsed[j].vec);
      if (sim >= joinThreshold) {
        cluster.members.push(parsed[j]);
        assigned.add(j);
        // Update centroid
        cluster.centroidVec = vectorCentroid(cluster.members.map(m => m.vec));
      }
    }

    if (cluster.members.length >= 2) {
      // Derive category from most common words in cluster
      const words = cluster.members.flatMap(m => m.content.toLowerCase().split(/\s+/).filter(w => w.length > 4));
      const wordCount: Record<string, number> = {};
      for (const w of words) wordCount[w] = (wordCount[w] ?? 0) + 1;
      const topWord = Object.entries(wordCount).sort(([, a], [, b]) => b - a)[0];
      cluster.category = topWord?.[0] ?? "mixed";

      clusters.push(cluster);
    }
  }

  // Format output
  return clusters.map(c => {
    const sims = c.members.map(m => cosineSimilarity(c.centroidVec, m.vec));
    return {
      centroidCategory: c.category,
      members: c.members.map((m, i) => ({
        sourceId: m.sourceId,
        content: m.content.slice(0, 120),
        similarity: Math.round(sims[i] * 100) / 100,
      })),
      size: c.members.length,
      avgSimilarity: sims.length > 0 ? Math.round((sims.reduce((s, v) => s + v, 0) / sims.length) * 100) / 100 : 0,
    };
  }).sort((a, b) => b.size - a.size);
}

// ---------------------------------------------------------------------------
// Embedding health metrics
// ---------------------------------------------------------------------------

export interface EmbeddingHealth {
  totalMemories: number;
  embeddedMemories: number;
  coveragePercent: number;
  dimensionDistribution: Record<number, number>; // dim size → count
  avgVectorMagnitude: number;
  duplicateCount: number;
  healthScore: number; // 0-100
}

/**
 * Count embeddings whose SOURCE brain memory is still alive.
 *
 * Soft-deleting a memory never deletes its embedding (only the hard-delete
 * path in semantic-dedup does), so `vectorEmbedding.count({sourceType:
 * "brain_memory"})` counts orphans. Measured on prod 2026-07-16: 4,330 of
 * 6,482 brain-memory embeddings (67%) belonged to soft-deleted rows — an
 * unjoined numerator over a live denominator would report 55.6% coverage
 * when the live truth was 18.4%. This helper is the ONLY sanctioned
 * numerator for any embeddings-per-memory ratio; pair it with a
 * `deletedAt: null` denominator.
 *
 * Raw SQL because sourceType/sourceId are polymorphic (no Prisma relation).
 * Camel columns quoted per the check:raw-sql rule.
 */
export async function countLiveBrainMemoryEmbeddings(): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM vector_embeddings ve
      JOIN brain_memories bm ON bm.id = ve."sourceId"
      WHERE ve."sourceType" = 'brain_memory' AND bm.deleted_at IS NULL
    `;
    return rows[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Compute health metrics for the embedding system.
 * Used by brain maturity and system health checks.
 *
 * Coverage is LIVE/LIVE: live-sourced embeddings over live memories — the
 * pair moved together (see countLiveBrainMemoryEmbeddings).
 */
export async function getEmbeddingHealth(): Promise<EmbeddingHealth> {
  const [totalMemories, embeddedCount, sampleRows] = await Promise.all([
    prisma.brainMemory.count({ where: { deletedAt: null } }).catch(() => 0),
    countLiveBrainMemoryEmbeddings(),
    prisma.vectorEmbedding.findMany({
      where: { sourceType: "brain_memory" },
      select: { embedding: true },
      take: 100,
    }).catch((): never[] => []),
  ]);

  const coveragePercent = totalMemories > 0 ? Math.round((embeddedCount / totalMemories) * 100) : 0;

  // Analyze dimensions and magnitude from sample
  const dimDist: Record<number, number> = {};
  let totalMag = 0;
  let magCount = 0;
  let malformed = 0;

  for (const row of sampleRows) {
    try {
      const vec = JSON.parse(row.embedding) as number[];
      dimDist[vec.length] = (dimDist[vec.length] ?? 0) + 1;
      const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      totalMag += mag;
      magCount++;
    } catch {
      malformed++; // aggregated below — sample loop, up to 100 rows
    }
  }
  if (malformed > 0) {
    logError(
      "brain.embedding-utils",
      new Error(`${malformed} corrupted embedding rows in health sample`),
      { fn: "getEmbeddingHealth", malformed, sampled: sampleRows.length },
      "warn",
    );
  }

  const avgMagnitude = magCount > 0 ? Math.round(totalMag / magCount * 100) / 100 : 0;

  // Quick duplicate check (sample only)
  const dupes = await findSemanticDuplicates(0.95, 5).catch((): never[] => []);

  // Health score: coverage (40%) + dimension consistency (30%) + low duplicates (30%)
  const dimConsistency = Object.keys(dimDist).length <= 1 ? 100 : Object.keys(dimDist).length <= 2 ? 70 : 30;
  const dupeScore = dupes.length === 0 ? 100 : dupes.length <= 3 ? 70 : 30;
  const healthScore = Math.round(coveragePercent * 0.4 + dimConsistency * 0.3 + dupeScore * 0.3);

  return {
    totalMemories,
    embeddedMemories: embeddedCount,
    coveragePercent,
    dimensionDistribution: dimDist,
    avgVectorMagnitude: avgMagnitude,
    duplicateCount: dupes.length,
    healthScore,
  };
}
