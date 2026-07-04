/**
 * Embedding-based cross-memory linker · v10.0.89 · 2026-05-02.
 *
 * Walks brain_memories in batches; for each high-confidence row,
 * runs a KNN cosine query against vector_embeddings, persists the
 * top-K neighbors as edges in BrainMemory category=semantic_edge.
 *
 * Edge shape (stored in `metadata`):
 *   {
 *     fromMemoryId, toMemoryId, fromCategory, toCategory,
 *     distance, score: 1 - distance
 *   }
 *
 * Idempotent — edges are keyed `{fromId}__{toId}` so re-runs
 * upsert. Doesn't block on missing pgvector — falls back to no-op
 * if extension not available.
 *
 * Use case: surfaces semantically related memories on /brain/galaxy
 * even when no rule-based auto-linker hit fires. Composes with the
 * existing rule-driven auto-linker without overlap.
 */

import { prisma } from "@/lib/prisma";
import { isPgvectorAvailable } from "@/lib/db/pgvector";

const EDGE_CATEGORY = "semantic_edge";
const TOP_K = 3;
const DISTANCE_CEILING = 0.4; // skip weak links (cosine distance > 0.4)

export interface LinkReport {
  ranAt: string;
  scanned: number;
  edgesCreated: number;
  edgesUpdated: number;
  skippedNoVector: number;
  errors: number;
  pgvectorAvailable: boolean;
}

interface NeighborRow {
  id: string;
  source_id: string;
  source_type: string;
  distance: number;
}

export async function runSemanticLinker(
  opts: { batch?: number } = {},
): Promise<LinkReport> {
  const ranAt = new Date().toISOString();
  const batch = opts.batch ?? 25;

  const pgvOk = await isPgvectorAvailable();
  if (!pgvOk) {
    return {
      ranAt,
      scanned: 0,
      edgesCreated: 0,
      edgesUpdated: 0,
      skippedNoVector: 0,
      errors: 0,
      pgvectorAvailable: false,
    };
  }

  // Pick high-confidence brain memories that haven't had edges
  // computed in the last 7 days. The category check on
  // semantic_edge is a JOIN — we look for rows whose id has no
  // edge marker newer than 7d.
  const since7d = new Date(Date.now() - 7 * 86_400_000);
  const candidates = await prisma.$queryRawUnsafe<
    Array<{ id: string; category: string }>
  >(
    `
    SELECT bm.id::text, bm.category::text
    FROM brain_memories bm
    LEFT JOIN brain_memories edges
      ON edges.category = $1
     AND edges.metadata->>'fromMemoryId' = bm.id
     AND edges.created_at >= $2
    WHERE bm.deleted_at IS NULL
      AND bm.confidence >= 0.5
      AND edges.id IS NULL
    ORDER BY bm.last_seen DESC
    LIMIT $3
    `,
    EDGE_CATEGORY,
    since7d.toISOString(),
    batch,
  );

  let edgesCreated = 0;
  let edgesUpdated = 0;
  let skippedNoVector = 0;
  let errors = 0;

  for (const c of candidates) {
    // Pull the embedding_vec for this memory
    const vec = await prisma.$queryRawUnsafe<
      Array<{ embedding_vec: string | null }>
    >(
      `SELECT embedding_vec::text
       FROM vector_embeddings
       WHERE "sourceId" = $1 AND "sourceType" = 'brain_memory' AND embedding_vec IS NOT NULL
       LIMIT 1`,
      c.id,
    ).catch(() => []);

    if (vec.length === 0 || !vec[0].embedding_vec) {
      skippedNoVector++;
      continue;
    }

    const vecLit = vec[0].embedding_vec;

    // KNN top-K+1 (we'll filter out the self-match)
    const neighbors = await prisma.$queryRawUnsafe<NeighborRow[]>(
      `
      SELECT
        ve.id::text,
        ve."sourceId"::text AS source_id,
        ve."sourceType"::text AS source_type,
        (ve.embedding_vec <=> '${vecLit}'::vector) AS distance
      FROM vector_embeddings ve
      WHERE ve.embedding_vec IS NOT NULL
        AND ve."sourceType" = 'brain_memory'
        AND ve."sourceId" != $1
        AND vector_dims(ve.embedding_vec) = vector_dims('${vecLit}'::vector)
      ORDER BY ve.embedding_vec <=> '${vecLit}'::vector
      LIMIT ${TOP_K}
      `,
      c.id,
    ).catch(() => []);

    for (const n of neighbors) {
      if (n.distance > DISTANCE_CEILING) continue;

      const edgeKey = `${c.id}__${n.source_id}`;
      const score = Math.max(0, 1 - n.distance);

      try {
        // Look up neighbor's category for the edge metadata
        const neighbor = await prisma.brainMemory
          .findUnique({
            where: { id: n.source_id },
            select: { category: true },
          })
          .catch(() => null);

        // v10.0.198 · dual-write to typed SemanticEdge table.
        // Phase 1: legacy BrainMemory write preserved until /brain/galaxy
        // cuts over in Phase 2.
        await prisma.semanticEdge.upsert({
          where: { fromMemoryId_toMemoryId: { fromMemoryId: c.id, toMemoryId: n.source_id } },
          create: {
            fromMemoryId: c.id,
            toMemoryId: n.source_id,
            fromCategory: c.category.slice(0, 64),
            toCategory: (neighbor?.category ?? null)?.slice(0, 64) ?? null,
            distance: n.distance,
            score,
          },
          update: {
            fromCategory: c.category.slice(0, 64),
            toCategory: (neighbor?.category ?? null)?.slice(0, 64) ?? null,
            distance: n.distance,
            score,
          },
        }).catch(() => undefined);
        const result = await prisma.brainMemory.upsert({
          where: { category_key: { category: EDGE_CATEGORY, key: edgeKey } },
          create: {
            category: EDGE_CATEGORY,
            key: edgeKey,
            content: `[${c.category}] ↔ [${neighbor?.category ?? "?"}] · score=${score.toFixed(3)}`,
            confidence: score,
            source: "lib:semantic-link",
            metadata: {
              fromMemoryId: c.id,
              toMemoryId: n.source_id,
              fromCategory: c.category,
              toCategory: neighbor?.category ?? null,
              distance: n.distance,
              score,
            },
          },
          update: {
            content: `[${c.category}] ↔ [${neighbor?.category ?? "?"}] · score=${score.toFixed(3)}`,
            confidence: score,
            metadata: {
              fromMemoryId: c.id,
              toMemoryId: n.source_id,
              fromCategory: c.category,
              toCategory: neighbor?.category ?? null,
              distance: n.distance,
              score,
            },
          },
        });
        if (result.createdAt.getTime() > Date.now() - 5_000) {
          edgesCreated++;
        } else {
          edgesUpdated++;
        }
      } catch (err) {
        errors++;
        void err;
      }
    }
  }

  return {
    ranAt,
    scanned: candidates.length,
    edgesCreated,
    edgesUpdated,
    skippedNoVector,
    errors,
    pgvectorAvailable: true,
  };
}
