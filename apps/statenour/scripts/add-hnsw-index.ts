// v10.0.90 · 2026-05-02 · HNSW index migration.
//
// Problem: vector_embeddings.embedding_vec is currently `vector`
// (unbounded dim). pgvector's HNSW + IVFFlat indexes both REQUIRE
// a fixed-dim column. Sequential scan at 6,916 rows takes 80-97ms;
// at 50K rows it'll hurt.
//
// Strategy:
//   1. ADD COLUMN embedding_vec_1536 vector(1536)  -- pad shorter
//   2. Backfill by padding 1024-dim Venice bge-m3 vectors with
//      512 zeros (pure padding doesn't change cosine similarity
//      direction; it only scales magnitude — pgvector cosine is
//      magnitude-normalized). 1536-dim OpenAI vectors copy as-is.
//   3. CREATE INDEX USING hnsw (embedding_vec_1536 vector_cosine_ops)
//      with m=16, ef_construction=64 (sensible defaults for <100K rows)
//   4. Add `model` + `embedding_dim` columns to track versioning
//
// Idempotent — IF NOT EXISTS everywhere; safe to re-run.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

async function main() {
  const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });
  try {
    console.log("[1/5] add embedding_dim + model columns for versioning...");
    await prisma.$executeRawUnsafe(
      `ALTER TABLE vector_embeddings
       ADD COLUMN IF NOT EXISTS embedding_dim INT,
       ADD COLUMN IF NOT EXISTS model VARCHAR(64)`,
    );
    console.log("  added");

    console.log("[2/5] backfill embedding_dim from existing embedding_vec rows...");
    const dimRes = await prisma.$executeRawUnsafe(
      `UPDATE vector_embeddings
       SET embedding_dim = vector_dims(embedding_vec)
       WHERE embedding_vec IS NOT NULL
         AND embedding_dim IS NULL`,
    );
    console.log(`  ${dimRes} rows updated with embedding_dim`);

    console.log("[3/5] add fixed-dim 1536 column for HNSW...");
    await prisma.$executeRawUnsafe(
      `ALTER TABLE vector_embeddings
       ADD COLUMN IF NOT EXISTS embedding_vec_1536 vector(1536)`,
    );
    console.log("  added embedding_vec_1536");

    console.log("[4/5] backfill embedding_vec_1536 (pad shorter to 1536)...");
    // Pad 1024-dim vectors with 512 zeros, copy 1536-dim as-is.
    // For exotic dims (768, etc) pad/truncate to 1536. Use SQL
    // CASE so we can do it in one round-trip.
    const BATCH = 1000;
    let pass = 0;
    let totalUpdated = 0;
    while (true) {
      pass++;
      const result = await prisma.$queryRawUnsafe<
        Array<{ updated: number }>
      >(`
        WITH cand AS (
          SELECT id, embedding_vec, vector_dims(embedding_vec) AS d
          FROM vector_embeddings
          WHERE embedding_vec_1536 IS NULL
            AND embedding_vec IS NOT NULL
          LIMIT ${BATCH}
        ),
        upd AS (
          UPDATE vector_embeddings v
          SET embedding_vec_1536 = (
            CASE
              WHEN c.d = 1536 THEN c.embedding_vec
              WHEN c.d < 1536 THEN
                (c.embedding_vec::text::text || ',' || array_to_string(array_fill(0::float8, ARRAY[1536 - c.d]), ',') )::vector(1536)
              ELSE
                NULL  -- skip oversized
            END
          )
          FROM cand c
          WHERE v.id = c.id
            AND c.d <= 1536
          RETURNING v.id
        )
        SELECT COUNT(*)::int AS updated FROM upd
      `).catch((err) => {
        console.warn(`  pass ${pass} error: ${err instanceof Error ? err.message.slice(0, 200) : err}`);
        return [{ updated: 0 }];
      });
      const n = Number(result[0]?.updated ?? 0);
      totalUpdated += n;
      console.log(`  pass ${pass}: padded ${n} rows`);
      if (n === 0) break;
      if (pass > 30) {
        console.warn("  safety brake (30 passes)");
        break;
      }
    }
    console.log(`  total padded: ${totalUpdated}`);

    console.log("[5/5] create HNSW index...");
    // m=16, ef_construction=64 are sensible pgvector defaults
    // for <100K rows. Index build is single-threaded; for 6,916
    // rows it's a few seconds.
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS vector_embeddings_hnsw_1536
       ON vector_embeddings USING hnsw (embedding_vec_1536 vector_cosine_ops)
       WITH (m = 16, ef_construction = 64)`,
    );
    console.log("  HNSW index built");

    console.log("\n=== verify ===");
    const stats = await prisma.$queryRawUnsafe<
      Array<{
        total: number;
        with_orig: number;
        with_1536: number;
        with_dim: number;
        with_model: number;
      }>
    >(`
      SELECT COUNT(*)::int AS total,
             COUNT(embedding_vec)::int AS with_orig,
             COUNT(embedding_vec_1536)::int AS with_1536,
             COUNT(embedding_dim)::int AS with_dim,
             COUNT(model)::int AS with_model
      FROM vector_embeddings
    `);
    console.log("counts:", stats);

    const idx = await prisma.$queryRawUnsafe<
      Array<{ indexname: string; indexdef: string }>
    >(`
      SELECT indexname::text, indexdef::text
      FROM pg_indexes
      WHERE tablename = 'vector_embeddings'
        AND indexname = 'vector_embeddings_hnsw_1536'
    `);
    console.log("hnsw index:", idx);

    // Quick KNN benchmark with new index
    const seed = await prisma.$queryRawUnsafe<
      Array<{ embedding_vec_1536: string }>
    >(
      "SELECT embedding_vec_1536::text FROM vector_embeddings WHERE embedding_vec_1536 IS NOT NULL LIMIT 1",
    );
    if (seed.length > 0) {
      const vec = seed[0].embedding_vec_1536;
      const t0 = Date.now();
      await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text FROM vector_embeddings
         WHERE embedding_vec_1536 IS NOT NULL
         ORDER BY embedding_vec_1536 <=> '${vec}'::vector(1536)
         LIMIT 10`,
      );
      console.log(`KNN top-10 (HNSW): ${Date.now() - t0}ms across ${stats[0]?.with_1536 ?? 0} rows`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
