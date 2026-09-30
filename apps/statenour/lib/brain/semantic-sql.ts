/**
 * Semantic stage of contextual recall, scored IN POSTGRES (Q-17 · WP-R).
 *
 * WHAT THIS REPLACES. `getSemanticScores` used to `findMany` the JSON
 * `embedding` text of up to 300 candidate rows, JSON.parse each 1024-float
 * array in Node and compute cosine there — about 4 MB over the wire on every
 * chat turn (estate architecture §7.1: "the latency is payload, not the
 * index"). The novelty pass then reused those parsed vectors. This module
 * returns the same numbers without shipping a single vector:
 *
 *   1. `SEMANTIC_SCORE_SQL` — one statement, one row per candidate: the
 *      pgvector cosine score, or (only for a row that has no `embedding_vec`)
 *      the JSON text as a fallback so an unmigrated row still scores.
 *   2. `NOVELTY_PAIR_SQL` — the cosine between each candidate and the
 *      `window` candidates ranked just before it, i.e. exactly the pairs
 *      `noveltyMultiplier` compares. <= 300 x 5 floats instead of 300 vectors.
 *
 * EQUALITY CONTRACT (what "same numbers" means, and where it bends):
 * - `1 - (a <=> b)` over `embedding_vec` is the same cosine as the Node loop;
 *   measured against a real pgvector 0.6 the difference is ~3e-8 (float4
 *   storage), inside the 1e-6 the queue's acceptance asks for. The
 *   `semantic-sql.pg.test.ts` equality test enforces it when a database is
 *   supplied.
 * - Width: `vector_dims(embedding_vec) = $dim` is the SQL twin of the old
 *   `vec.length !== queryVec.length` skip (same rule as lib/db/pgvector.ts).
 * - Zero vectors: pgvector returns NaN for a zero-norm operand, the Node
 *   cosine returned 0. Guarded in SQL so the score is 0 again.
 * - Duplicate embedding rows for one memory: Node kept whichever row
 *   `findMany` happened to return last; SQL keeps the NEWEST (`DISTINCT ON`).
 *   Deterministic where the old path was arbitrary — the one intended change.
 */
import { vectorLiteral, assertSafeVectorLiteral } from "@/lib/db/pgvector";
import { cosineSimilarity } from "@/lib/brain/embedding-utils";

/** The slice of the Prisma client this module needs — injectable for tests. */
export interface RawQueryClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

/** $1 query vector literal · $2 candidate ids · $3 query width. */
export const SEMANTIC_SCORE_SQL = `SELECT DISTINCT ON (ve."sourceId")
       ve."sourceId" AS id,
       CASE
         WHEN ve.embedding_vec IS NULL OR vector_dims(ve.embedding_vec) <> $3 THEN NULL
         WHEN vector_norm(ve.embedding_vec) = 0 OR vector_norm($1::vector) = 0 THEN 0::float8
         ELSE (1 - (ve.embedding_vec <=> $1::vector))::float8
       END AS score,
       CASE WHEN ve.embedding_vec IS NULL THEN ve.embedding END AS json
  FROM vector_embeddings ve
 WHERE ve."sourceType" = 'brain_memory'
   AND ve."sourceId" = ANY($2::text[])
 ORDER BY ve."sourceId", ve."createdAt" DESC`;

/**
 * $1 ids in rank order · $2 their rank among vector-bearing candidates ·
 * $3 window · $4 query width. Only SQL-scored ids are passed.
 */
export const NOVELTY_PAIR_SQL = `WITH o AS (
       SELECT t.id, t.rn FROM unnest($1::text[], $2::int[]) AS t(id, rn)
     ),
     v AS (
       SELECT DISTINCT ON (ve."sourceId") ve."sourceId" AS id, ve.embedding_vec AS vec
         FROM vector_embeddings ve
        WHERE ve."sourceType" = 'brain_memory'
          AND ve."sourceId" = ANY($1::text[])
          AND ve.embedding_vec IS NOT NULL
          AND vector_dims(ve.embedding_vec) = $4
        ORDER BY ve."sourceId", ve."createdAt" DESC
     ),
     r AS (SELECT o.id, o.rn, v.vec FROM o JOIN v ON v.id = o.id)
SELECT a.id AS a,
       b.id AS b,
       CASE
         WHEN vector_norm(a.vec) = 0 OR vector_norm(b.vec) = 0 THEN 0::float8
         ELSE (1 - (a.vec <=> b.vec))::float8
       END AS sim
  FROM r a
  JOIN r b ON b.rn < a.rn AND b.rn >= a.rn - $3`;

interface ScoreRow {
  id: string;
  score: number | null;
  json: string | null;
}

export interface SemanticScores {
  scores: Map<string, number>;
  /** Ids scored in SQL — their vectors stay in Postgres. */
  sqlIds: Set<string>;
  /** Parsed vectors, ONLY for fallback rows that have no `embedding_vec`. */
  fallbackVectors: Map<string, number[]>;
  /** Rows found at all (the old `embeddingRows.length`, deduplicated). */
  rowsFound: number;
  /** Fallback rows whose JSON failed to parse. */
  corrupted: number;
}

function finite(n: number | null): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export async function scoreCandidatesInSql(
  db: RawQueryClient,
  queryVec: number[],
  candidateIds: string[],
): Promise<SemanticScores> {
  const lit = vectorLiteral(queryVec);
  assertSafeVectorLiteral(lit);
  const rows = await db.$queryRawUnsafe<ScoreRow[]>(
    SEMANTIC_SCORE_SQL,
    lit,
    candidateIds,
    Math.trunc(queryVec.length),
  );

  const scores = new Map<string, number>();
  const sqlIds = new Set<string>();
  const fallbackVectors = new Map<string, number[]>();
  let corrupted = 0;
  for (const row of rows) {
    const score = row.score === null ? null : Number(row.score);
    if (finite(score)) {
      scores.set(row.id, score);
      sqlIds.add(row.id);
      continue;
    }
    if (row.json == null) continue; // other-width vector: incomparable, skipped as before
    try {
      const vec = JSON.parse(row.json) as number[];
      if (!Array.isArray(vec) || vec.length !== queryVec.length) continue;
      scores.set(row.id, cosineSimilarity(queryVec, vec));
      fallbackVectors.set(row.id, vec);
    } catch {
      corrupted++;
    }
  }
  return { scores, sqlIds, fallbackVectors, rowsFound: rows.length, corrupted };
}

/** Order-independent key for a pair of ids. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/**
 * For each candidate (in rank order) that has a vector, the similarities to
 * the `window` vector-bearing candidates ranked just before it — the exact
 * comparison set the novelty pass uses.
 *
 * SQL-SQL pairs come from Postgres; fallback-fallback pairs are computed here.
 * A MIXED pair (one side only in SQL) is skipped, as the old loop skipped a
 * width mismatch — it cannot occur once every row has `embedding_vec`, and the
 * returned `mixedPairsSkipped` makes it visible when it does.
 */
export async function noveltyWindowSims(
  db: RawQueryClient,
  rankedIds: string[],
  semantic: Pick<SemanticScores, "sqlIds" | "fallbackVectors">,
  window: number,
  dim: number,
): Promise<{ simsById: Map<string, number[]>; mixedPairsSkipped: number }> {
  const withVec = rankedIds.filter(
    (id) => semantic.sqlIds.has(id) || semantic.fallbackVectors.has(id),
  );
  const rank = new Map(withVec.map((id, i) => [id, i + 1]));

  const sqlOrdered = withVec.filter((id) => semantic.sqlIds.has(id));
  const pairSims = new Map<string, number>();
  if (sqlOrdered.length > 1) {
    const rows = await db.$queryRawUnsafe<{ a: string; b: string; sim: number }[]>(
      NOVELTY_PAIR_SQL,
      sqlOrdered,
      sqlOrdered.map((id) => rank.get(id)!),
      window,
      Math.trunc(dim),
    );
    for (const r of rows) pairSims.set(pairKey(r.a, r.b), Number(r.sim));
  }

  const simsById = new Map<string, number[]>();
  let mixedPairsSkipped = 0;
  for (let i = 0; i < withVec.length; i++) {
    const a = withVec[i];
    const sims: number[] = [];
    for (let j = Math.max(0, i - window); j < i; j++) {
      const b = withVec[j];
      const aSql = semantic.sqlIds.has(a);
      const bSql = semantic.sqlIds.has(b);
      if (aSql && bSql) {
        const s = pairSims.get(pairKey(a, b));
        if (s !== undefined && Number.isFinite(s)) sims.push(s);
      } else if (!aSql && !bSql) {
        sims.push(cosineSimilarity(semantic.fallbackVectors.get(a)!, semantic.fallbackVectors.get(b)!));
      } else {
        mixedPairsSkipped++;
      }
    }
    simsById.set(a, sims);
  }
  return { simsById, mixedPairsSkipped };
}
