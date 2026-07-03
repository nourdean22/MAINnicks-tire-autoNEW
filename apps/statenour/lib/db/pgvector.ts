/**
 * pgvector skeleton · v8.4 · Apr 29.
 *
 * Optional pgvector backend for the brain's semantic-recall path.
 * Runtime-detected: if the `vector` extension is enabled on the live
 * DB AND the v8.5 schema migration (separate batch) has shipped a
 * `vector` column, this helper provides native KNN search via the
 * `<->` (L2) and `<=>` (cosine) operators. Otherwise callers fall
 * back to the existing JSON-cosine path in lib/brain/embedding-utils.
 *
 * Why split this from the embedding-utils refactor:
 *   1. The schema migration to add `embedding_vec vector(1536)` is
 *      irreversible-ish (HNSW index build is expensive on big tables).
 *      Want to ship the application-layer detection + queries FIRST,
 *      flip the migration on intentionally.
 *   2. Neon supports pgvector, but the extension must be explicitly
 *      enabled (`CREATE EXTENSION vector`). isPgvectorAvailable()
 *      lets the brain layer adapt automatically post-enable.
 *   3. Writes can dual-target — JSON column (current) + vector column
 *      (new) — during the transition window so rollback is trivial.
 *
 * Public API:
 *   · isPgvectorAvailable() — cached probe of pg_extension
 *   · enablePgvector(adminPassword) — admin-only one-shot
 *   · knnSearch(embedding, opts) — returns null if extension off
 *   · vectorLiteral(arr) — turns a JS number[] into pgvector literal
 */

import { prisma } from "@/lib/prisma";

// 5-minute cache so the probe doesn't hit the DB on every recall call.
let cachedAvailability: { at: number; available: boolean } | null = null;
const CACHE_TTL_MS = 5 * 60_000;

interface ExtensionRow {
  extname: string;
}

/**
 * Detect whether the `vector` extension is currently enabled on the
 * connected database. Cached for 5 minutes — enabling/disabling the
 * extension is a manual admin op, not something that happens mid-run.
 */
export async function isPgvectorAvailable(): Promise<boolean> {
  if (cachedAvailability && Date.now() - cachedAvailability.at < CACHE_TTL_MS) {
    return cachedAvailability.available;
  }
  try {
    // 2026-05-02 — explicit ::text cast. extname is the pg-internal
    // `name` type which Prisma's $queryRaw can't deserialize, so the
    // unprotected SELECT below silently threw, the catch below wrote
    // `available: false` to cache, and the dual-write +
    // semantic-recall paths shut off even though pgvector was happily
    // indexing 6,916+ rows on the live DB. Same root cause as the
    // schema-sentinel false-positives fixed in v10.0.82.
    const rows = await prisma.$queryRaw<ExtensionRow[]>`
      SELECT extname::text AS extname
      FROM pg_extension
      WHERE extname = 'vector'
      LIMIT 1
    `;
    const available = rows.length > 0;
    cachedAvailability = { at: Date.now(), available };
    return available;
  } catch (err) {
    console.warn("[pgvector] availability probe failed:", err);
    cachedAvailability = { at: Date.now(), available: false };
    return false;
  }
}

/**
 * Force-clear the availability cache. Use after enable/disable so the
 * next call probes the DB again.
 */
export function bustPgvectorCache(): void {
  cachedAvailability = null;
}

/**
 * One-shot admin call — `CREATE EXTENSION IF NOT EXISTS vector`.
 * Returns the resulting availability state (after the call).
 *
 * Auth: caller is responsible for gating this (route-level admin
 * check). Function itself doesn't enforce permissions — too easy to
 * forget the call site uses the right guard.
 */
export async function enablePgvector(): Promise<boolean> {
  try {
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
    bustPgvectorCache();
    return await isPgvectorAvailable();
  } catch (err) {
    console.error("[pgvector] enable failed:", err);
    return false;
  }
}

/**
 * Format a JS number[] as a pgvector literal string. The literal
 * is `'[1.2,3.4,5.6]'::vector` — note the cast suffix, applied by
 * the caller in the SQL fragment.
 *
 *   const lit = vectorLiteral(myEmbedding);
 *   await prisma.$queryRaw`
 *     SELECT id, content, embedding_vec <=> ${lit}::vector AS dist
 *     FROM vector_embeddings
 *     ORDER BY embedding_vec <=> ${lit}::vector
 *     LIMIT 10
 *   `;
 */
export function vectorLiteral(vec: number[]): string {
  // Exclude NaN / Infinity — pgvector rejects them.
  const cleaned = vec.map((v) => (Number.isFinite(v) ? v : 0));
  return `[${cleaned.join(",")}]`;
}

/**
 * Canonical fixed dimension for the HNSW-indexed `embedding_vec_1536`
 * column. The brain's opinionated recall path
 * (lib/brain/memory-recall.ts) searches this column, so every embedding
 * written for recall must be normalized to exactly this many dims.
 */
export const VECTOR_DIM_1536 = 1536;

/**
 * Normalize an embedding to exactly `dim` dimensions for a fixed-width
 * pgvector column.
 *
 * - Shorter → zero-pad. This is cosine-preserving: appending zeros
 *   changes neither the dot product nor either vector's magnitude, so
 *   `cos(pad(a), pad(b)) === cos(a, b)` exactly. That invariant is what
 *   lets sub-1536 embeddings (e.g. 1024-dim) live in a `vector(1536)`
 *   HNSW column alongside native-1536 vectors.
 * - Longer → truncate (defensive clamp; embeddings should already be
 *   <= dim, but a misconfigured provider must not throw a dim error).
 *
 * Mirrors memory-recall.ts `padToTargetDim` and
 * scripts/backfill-hnsw-1536.ts so writers and readers agree on the
 * padding convention.
 */
export function padToVectorDim(vec: number[], dim: number): number[] {
  if (vec.length === dim) return vec;
  if (vec.length > dim) return vec.slice(0, dim);
  return [...vec, ...new Array(dim - vec.length).fill(0)];
}

/**
 * v9.1.15 · Defense-in-depth validator for any string about to be
 * interpolated into a $queryRawUnsafe SQL fragment as a vector literal.
 * The shape is `[float,float,...,float]` — letters, spaces, single
 * quotes, semicolons, etc. would indicate either a corrupted embedding
 * response or an injection attempt that slipped past vectorLiteral.
 *
 * Throws (loudly) if the literal doesn't match the expected shape.
 * Better to fail the query than risk pushing tainted SQL.
 */
export function assertSafeVectorLiteral(lit: string): void {
  if (!/^\[-?[0-9.eE+\-,]+\]$/.test(lit)) {
    throw new Error(
      `[pgvector] refusing to interpolate non-numeric vector literal: ${lit.slice(0, 60)}`,
    );
  }
}

export interface KnnHit {
  id: string;
  sourceType: string;
  sourceId: string;
  content: string;
  /** L2 distance OR (1 - cosine), depending on op. Lower = more similar. */
  distance: number;
}

export interface KnnSearchOptions {
  /** Filter by sourceType — e.g. "brain_memory". */
  sourceType?: string;
  /** Cap rows. Default 10, max 100. */
  limit?: number;
  /** Distance operator. "cosine" → `<=>`. "l2" → `<->`. Defaults cosine. */
  metric?: "cosine" | "l2";
}

/**
 * KNN search against the vector column (when present). Returns null
 * when the extension isn't available — caller should fall back to
 * the JSON-cosine path. Returns an empty array when the extension is
 * available but no rows match.
 *
 * NOTE: this requires a `embedding_vec vector(<dim>)` column on
 * `vector_embeddings`, which lands in a separate schema migration.
 * Until then, the runtime probe will fail at query time and we
 * console.warn + return null.
 */
export async function knnSearch(
  embedding: number[],
  opts: KnnSearchOptions = {},
): Promise<KnnHit[] | null> {
  if (!(await isPgvectorAvailable())) return null;
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 100);
  const sourceType = opts.sourceType;
  const op = opts.metric === "l2" ? "<->" : "<=>";
  const lit = vectorLiteral(embedding);
  // v9.1.15 · defense-in-depth: validate the vector literal shape
  // before interpolating into $queryRawUnsafe. The current call sites
  // pass internally-generated embeddings (number[]) so injection isn't
  // exploitable today, but the pattern is fragile — this guard makes
  // it impossible for a malformed embedding response to produce a
  // tainted SQL string.
  assertSafeVectorLiteral(lit);

  try {
    if (sourceType) {
      // Templated query — `op` is a literal from {<->, <=>}, not user input.
      const rows = await prisma.$queryRawUnsafe<KnnHit[]>(
        `SELECT id, "sourceType", "sourceId", content,
                embedding_vec ${op} '${lit}'::vector AS distance
         FROM vector_embeddings
         WHERE "sourceType" = $1 AND embedding_vec IS NOT NULL
         ORDER BY embedding_vec ${op} '${lit}'::vector
         LIMIT ${limit}`,
        sourceType,
      );
      return rows;
    } else {
      const rows = await prisma.$queryRawUnsafe<KnnHit[]>(
        `SELECT id, "sourceType", "sourceId", content,
                embedding_vec ${op} '${lit}'::vector AS distance
         FROM vector_embeddings
         WHERE embedding_vec IS NOT NULL
         ORDER BY embedding_vec ${op} '${lit}'::vector
         LIMIT ${limit}`,
      );
      return rows;
    }
  } catch (err) {
    // forensic-audit HIGH · only cache a NEGATIVE when the error means the
    // pgvector column/extension is genuinely absent (pre-migration). A
    // TRANSIENT error (Neon blip, dim-mismatched query literal) must NOT
    // poison the process-wide cache: that also gates isPgvectorAvailable()
    // and silently disabled ALL dual-writes for 5 min (memories written with
    // NULL embeddings, invisible to recall). Persistent "does not exist" →
    // cache; anything else → fail just this query and retry next time.
    const msg = err instanceof Error ? err.message : String(err);
    const columnOrExtMissing = /does not exist|undefined column|no such|relation .* does not exist/i.test(msg);
    if (columnOrExtMissing) {
      cachedAvailability = { at: Date.now(), available: false };
    }
    console.warn("[pgvector] knn query failed:", err);
    return null;
  }
}
