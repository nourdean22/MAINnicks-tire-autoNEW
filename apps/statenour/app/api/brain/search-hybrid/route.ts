/**
 * GET/POST /api/brain/search-hybrid · v10.0.90 · 2026-05-02.
 *
 * Hybrid search across brain memories + chat messages combining:
 *   · BM25-style FTS via tsvector @@ plainto_tsquery (chat_messages
 *     has searchable_tsv column added in v10.0.84)
 *   · KNN cosine via embedding_vec_1536 (HNSW-indexed v10.0.90)
 *
 * Scoring: Reciprocal Rank Fusion (RRF) — for each result, sum
 * 1/(60 + rank) over the two channels. Standard RRF k=60. Robust
 * when the two channels return different score scales.
 *
 * Query:
 *   ?q=<text>                — text query (required)
 *   ?limit=20                — final output cap
 *   ?source=brain_memory|chat_message|all (default all)
 *
 * Or POST { q, limit, source, embedding? } when caller already has
 * an embedding to skip the AI call.
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { getEmbedding } from "@/lib/ai/provider";

const RRF_K = 60;
const FTS_TOP = 50;
const KNN_TOP = 50;
const TARGET_DIM = 1536;

interface SearchHit {
  id: string;
  sourceType: string;
  sourceId: string;
  content: string;
  ftsRank: number | null;
  ftsScore: number | null;
  knnRank: number | null;
  knnDistance: number | null;
  rrfScore: number;
}

function padToTargetDim(arr: number[]): number[] {
  if (arr.length === TARGET_DIM) return arr;
  if (arr.length > TARGET_DIM) return arr.slice(0, TARGET_DIM);
  return [...arr, ...new Array(TARGET_DIM - arr.length).fill(0)];
}

async function runHybridSearch(opts: {
  q: string;
  limit?: number;
  source?: "all" | "brain_memory" | "chat_message";
  embedding?: number[];
}): Promise<{
  query: string;
  source: string;
  ftsCount: number;
  knnCount: number;
  results: SearchHit[];
  durationMs: number;
}> {
  const t0 = Date.now();
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 50));
  const source = opts.source ?? "all";

  // ── Channel 1 · KNN cosine on embedding_vec_1536 ────────────
  let queryEmb = opts.embedding;
  if (!queryEmb) {
    queryEmb = await getEmbedding(opts.q);
  }
  if (!queryEmb || queryEmb.length === 0) {
    throw new ServiceError("Failed to generate query embedding", 502);
  }
  const padded = padToTargetDim(queryEmb);
  const vecLit = `[${padded.join(",")}]`;

  const sourceFilter =
    source === "all"
      ? `'brain_memory','chat_message'`
      : `'${source}'`;

  // SHADOW FILTER (2026-09-18 · review on #2430). This route runs its OWN KNN
  // instead of lib/db/pgvector.ts knnSearch, so it inherited NEITHER liveness
  // guard — and unlike memory-recall / contextual-recall / brain-save it does not
  // JOIN a source table, it returns `content` straight off the embedding. That is
  // what made it the worst of the twelve raw vector-search paths: a hard-deleted
  // chat message could be READ BACK here in full, from the index's own copy.
  //
  // The rule this encodes: a query that joins its source table is safe by
  // construction; one that reads `content` off vector_embeddings must filter
  // explicitly. tests/repo/vector-search-shadow-filter.test.ts pins it.
  const knnRows = await prisma
    .$queryRawUnsafe<
      Array<{
        id: string;
        source_type: string;
        source_id: string;
        content: string;
        distance: number;
      }>
    >(
      `SELECT id::text, "sourceType"::text AS source_type, "sourceId"::text AS source_id,
              substring(content, 1, 280)::text AS content,
              (embedding_vec_1536 <=> '${vecLit}'::vector(${TARGET_DIM})) AS distance
       FROM vector_embeddings
       WHERE embedding_vec_1536 IS NOT NULL
         AND "sourceUnavailableAt" IS NULL
         AND "sourceType" = ANY(ARRAY[${sourceFilter}]::text[])
       ORDER BY embedding_vec_1536 <=> '${vecLit}'::vector(${TARGET_DIM})
       LIMIT ${KNN_TOP}`,
    )
    .catch(() => []);

  // ── Channel 2 · FTS on chat_messages.searchable_tsv ─────────
  // Brain memories don't have a tsvector column yet (a future
  // migration would add one); for now FTS only covers chat_messages
  // when source includes it.
  const ftsRows: Array<{
    id: string;
    source_type: string;
    source_id: string;
    content: string;
    rank: number;
  }> = [];
  if (source === "all" || source === "chat_message") {
    const rows = await prisma
      .$queryRawUnsafe<
        Array<{
          id: string;
          source_id: string;
          content: string;
          rank: number;
        }>
      >(
        `SELECT cm.id::text,
                cm.id::text AS source_id,
                substring(cm.content, 1, 280)::text AS content,
                ts_rank_cd(cm.searchable_tsv, plainto_tsquery('english', $1))::float AS rank
         FROM chat_messages cm
         WHERE cm.searchable_tsv @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT ${FTS_TOP}`,
        opts.q,
      )
      .catch(() => []);
    for (const r of rows) {
      ftsRows.push({
        id: r.id,
        source_type: "chat_message",
        source_id: r.source_id,
        content: r.content,
        rank: r.rank,
      });
    }
  }

  // ── RRF fusion ───────────────────────────────────────────────
  const merged = new Map<string, SearchHit>();
  knnRows.forEach((r, idx) => {
    const key = `${r.source_type}:${r.source_id}`;
    const rank = idx + 1;
    const rrf = 1 / (RRF_K + rank);
    merged.set(key, {
      id: r.id,
      sourceType: r.source_type,
      sourceId: r.source_id,
      content: r.content,
      ftsRank: null,
      ftsScore: null,
      knnRank: rank,
      knnDistance: r.distance,
      rrfScore: rrf,
    });
  });
  ftsRows.forEach((r, idx) => {
    const key = `${r.source_type}:${r.source_id}`;
    const rank = idx + 1;
    const rrf = 1 / (RRF_K + rank);
    const existing = merged.get(key);
    if (existing) {
      existing.ftsRank = rank;
      existing.ftsScore = r.rank;
      existing.rrfScore += rrf;
    } else {
      merged.set(key, {
        id: r.id,
        sourceType: r.source_type,
        sourceId: r.source_id,
        content: r.content,
        ftsRank: rank,
        ftsScore: r.rank,
        knnRank: null,
        knnDistance: null,
        rrfScore: rrf,
      });
    }
  });

  const sorted = [...merged.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit);

  return {
    query: opts.q,
    source,
    ftsCount: ftsRows.length,
    knnCount: knnRows.length,
    results: sorted,
    durationMs: Date.now() - t0,
  };
}

// v10.0.529.2 T-2 fix · runtime enum allowlist for `source` (the value
// gets interpolated into raw SQL inside runHybridSearch via sourceFilter).
// Pre-fix · TypeScript `as` cast did NOT validate at runtime, so a payload
// like `?source=' UNION SELECT ...` would interpolate directly into the
// raw query. The route is auth-gated `owner` so the immediate blast radius
// was already bounded, but defense-in-depth costs nothing: if a session
// cookie ever leaks via XSS / stolen device / malware, this allowlist
// stops the escalation path cold.
const ALLOWED_SOURCES = ["all", "brain_memory", "chat_message"] as const;
type AllowedSource = (typeof ALLOWED_SOURCES)[number];

function validateSource(raw: string | null | undefined): AllowedSource {
  const v = raw ?? "all";
  if (!ALLOWED_SOURCES.includes(v as AllowedSource)) {
    throw new ServiceError(
      `invalid source: must be one of ${ALLOWED_SOURCES.join(", ")}`,
      400,
    );
  }
  return v as AllowedSource;
}

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim();
    if (!q) throw new ServiceError("q required", 400);
    const limit = parseInt(url.searchParams.get("limit") ?? "20", 10) || 20;
    const source = validateSource(url.searchParams.get("source"));
    return await runHybridSearch({ q, limit, source });
  },
  { auth: "owner" },
);

export const POST = apiHandler(
  async (req) => {
    const body = (await req.json()) as {
      q?: string;
      limit?: number;
      source?: string;
      embedding?: number[];
    };
    if (!body.q?.trim()) throw new ServiceError("q required", 400);
    return await runHybridSearch({
      q: body.q,
      limit: body.limit,
      source: validateSource(body.source),
      embedding: body.embedding,
    });
  },
  { auth: "owner" },
);
