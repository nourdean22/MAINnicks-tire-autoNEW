/**
 * 2026-05-27 · Power Atlas Phase 0 · hybrid search endpoint.
 *
 * GET /api/people/search?q=<query>[&limit=20]
 *
 * Blends BM25 (postgres full-text) over name + dossierMd + relationship
 * with cosine similarity over VectorEmbedding rows
 * (sourceType = "person_profile").
 *
 * Score = 0.4 * bm25_normalized + 0.6 * cosine_normalized.
 *
 * Degrades to BM25-only if embedding query fails.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { getEmbedding } from "@/lib/ai/provider";
import { logger as rootLogger } from "@/lib/logger";

export const maxDuration = 30;

const log = rootLogger.withSurface("api/people/search");

interface SearchResultRow {
  id: string;
  name: string;
  role: string;
  status: string;
  trustScore: number;
  bm25Score: number;
  cosineScore: number;
  blendedScore: number;
}

export async function GET(req: Request) {
  await requireSession(req);
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 50);

  if (!q) {
    return NextResponse.json({ ok: true, q, results: [] });
  }

  // ─── BM25 via postgres full-text ───────────────────────────────
  const bm25Rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; bm25_score: number }>
  >(
    `SELECT
       p.id::text AS id,
       ts_rank_cd(
         to_tsvector('english',
           coalesce(p.name, '') || ' ' ||
           coalesce(p.dossier_md, '') || ' ' ||
           coalesce(p.relationship, '')
         ),
         plainto_tsquery('english', $1)
       )::double precision AS bm25_score
     FROM person_profiles p
     WHERE p.deleted_at IS NULL
       AND p.status != 'blown_up'
       AND (
         p.name ILIKE '%' || $1 || '%' OR
         to_tsvector('english',
           coalesce(p.name, '') || ' ' ||
           coalesce(p.dossier_md, '') || ' ' ||
           coalesce(p.relationship, '')
         ) @@ plainto_tsquery('english', $1)
       )
     ORDER BY bm25_score DESC NULLS LAST
     LIMIT $2`,
    q,
    limit * 3, // pull extra · cosine reranks
  );

  // ─── Cosine via embeddings (best effort) ──────────────────────
  const cosineMap = new Map<string, number>();
  try {
    const embedding = await getEmbedding(q);
    if (embedding && embedding.length > 0) {
      const vecLit = `[${embedding.join(",")}]`;
      const cosineRows = await prisma.$queryRawUnsafe<
        Array<{ source_id: string; distance: number }>
      >(
        `SELECT
           ve."sourceId"::text AS source_id,
           (ve.embedding_vec_1536 <=> '${vecLit}'::vector(1536))::double precision AS distance
         FROM vector_embeddings ve
         WHERE ve."sourceType" = 'person_profile'
           AND ve.embedding_vec_1536 IS NOT NULL
         ORDER BY ve.embedding_vec_1536 <=> '${vecLit}'::vector(1536)
         LIMIT $1`,
        limit * 3,
      );
      for (const r of cosineRows) {
        cosineMap.set(r.source_id, 1 - r.distance); // distance to similarity
      }
    }
  } catch (err) {
    log.warn("cosine_search_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    // degrade to BM25-only
  }

  // ─── Blend + hydrate ───────────────────────────────────────────
  const maxBm25 = Math.max(0.001, ...bm25Rows.map((r) => r.bm25_score));
  const maxCosine = Math.max(0.001, ...Array.from(cosineMap.values()));
  const idSet = new Set<string>([
    ...bm25Rows.map((r) => r.id),
    ...Array.from(cosineMap.keys()),
  ]);
  const blended: Array<{ id: string; bm25: number; cosine: number; score: number }> = [];
  for (const id of idSet) {
    const bm25 = (bm25Rows.find((r) => r.id === id)?.bm25_score ?? 0) / maxBm25;
    const cosine = (cosineMap.get(id) ?? 0) / maxCosine;
    const score = 0.4 * bm25 + 0.6 * cosine;
    blended.push({ id, bm25, cosine, score });
  }
  blended.sort((a, b) => b.score - a.score);

  const topIds = blended.slice(0, limit).map((r) => r.id);
  const profiles = topIds.length
    ? await prisma.personProfile.findMany({
        where: { id: { in: topIds } },
        select: { id: true, name: true, role: true, status: true, trustScore: true },
      })
    : [];

  const results: SearchResultRow[] = blended
    .slice(0, limit)
    .map((b) => {
      const profile = profiles.find((p) => p.id === b.id);
      if (!profile) return null;
      return {
        id: profile.id,
        name: profile.name,
        role: profile.role,
        status: profile.status,
        trustScore: profile.trustScore,
        bm25Score: b.bm25,
        cosineScore: b.cosine,
        blendedScore: b.score,
      };
    })
    .filter((r): r is SearchResultRow => r !== null);

  return NextResponse.json({ ok: true, q, results });
}
