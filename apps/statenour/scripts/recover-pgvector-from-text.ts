/**
 * Recover pgvector columns dropped by v10.0.148/.150 db-push · v10.0.154
 *
 * Background:
 *   The schema-drift guard caught what `prisma db push --accept-data-loss`
 *   actually did during v10.0.148 + v10.0.150 ships: it pruned three
 *   columns that lived in the DB but not in prisma/schema.prisma —
 *     · vector_embeddings.embedding_vec       (vector, ~7000 rows)
 *     · vector_embeddings.embedding_vec_1536  (vector(1536), ~7000 rows)
 *     · vector_embeddings.embedding_dim       (int)
 *     · vector_embeddings.model               (varchar)
 *     · chat_messages.searchable_tsv         (tsvector, FTS)
 *   plus the HNSW index on embedding_vec_1536.
 *
 *   These were managed via raw SQL (scripts/add-hnsw-index.ts) because
 *   prisma can't model `vector(N)` natively. They got lost when prisma
 *   compared schema vs DB and aggressively pruned.
 *
 *   Survival check: the `embedding` text column (JSON-encoded float[])
 *   is still intact across all 7653 rows. Recovery rebuilds the
 *   pgvector column from this text source — no embedding regeneration
 *   needed.
 *
 * What this script does (idempotent):
 *   1. Re-add embedding_vec_1536 (vector(1536)) + embedding_dim + model columns
 *   2. Re-add searchable_tsv generated column on chat_messages
 *   3. Backfill embedding_vec_1536 from the surviving `embedding` JSON
 *      column (parses array, pads to 1536, casts to vector)
 *   4. Rebuild HNSW index
 *
 * Usage:
 *   set -a && . ./.env.local && set +a
 *   pnpm tsx scripts/recover-pgvector-from-text.ts
 */

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
    console.log("[1/6] add embedding_vec_1536 + embedding_dim + model columns…");
    await prisma.$executeRawUnsafe(
      `ALTER TABLE vector_embeddings
       ADD COLUMN IF NOT EXISTS embedding_vec_1536 vector(1536),
       ADD COLUMN IF NOT EXISTS embedding_dim INT,
       ADD COLUMN IF NOT EXISTS model VARCHAR(64)`,
    );
    console.log("  added (idempotent)");

    console.log("[2/6] re-add chat_messages.searchable_tsv (generated)…");
    // Generated column · tsvector built from message content for FTS.
    // STORED so it persists; the v7.6 contract had it as a generated
    // column auto-updated on row write.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE chat_messages
       ADD COLUMN IF NOT EXISTS searchable_tsv tsvector
       GENERATED ALWAYS AS (
         to_tsvector(
           'english',
           coalesce(content, '')
         )
       ) STORED`,
    );
    console.log("  added (idempotent)");

    console.log("[3/6] re-create chat_messages searchable_tsv GIN index…");
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS chat_messages_searchable_tsv_idx
       ON chat_messages USING gin (searchable_tsv)`,
    );
    console.log("  index ensured");

    console.log("[4/6] backfill embedding_vec_1536 from embedding text JSON…");
    // The `embedding` column holds JSON like "[0.1, 0.2, …]". Convert
    // to vector(1536). pgvector accepts the same '[..]' literal as a
    // vector cast input. Pad with zeros if the JSON has fewer than
    // 1536 elements (matches the v10.0.90 padding strategy for 1024-dim
    // Venice bge-m3 vectors). Truncate if longer (defensive).
    //
    // Done in batches so a single transaction doesn't lock the whole
    // table for minutes on bigger sets.
    const BATCH = 500;
    let pass = 0;
    let totalUpdated = 0;
    while (true) {
      pass++;
      const updated = await prisma.$executeRawUnsafe(`
        WITH cand AS (
          SELECT id, embedding
          FROM vector_embeddings
          WHERE embedding_vec_1536 IS NULL
            AND embedding IS NOT NULL
            AND embedding != ''
          LIMIT ${BATCH}
        ),
        parsed AS (
          SELECT
            c.id,
            -- Parse JSON array → text[]
            ARRAY(SELECT jsonb_array_elements_text(c.embedding::jsonb)) AS arr
          FROM cand c
          WHERE c.embedding ~ '^\\['
        ),
        sized AS (
          SELECT
            id,
            -- Pad with zeros to 1536, truncate to 1536, then assemble
            -- the canonical "[x,y,z]" pgvector literal.
            '[' || array_to_string(
              CASE
                WHEN array_length(arr, 1) = 1536 THEN arr
                WHEN array_length(arr, 1) < 1536 THEN
                  arr || array_fill('0'::text, ARRAY[1536 - array_length(arr, 1)])
                ELSE arr[1:1536]
              END,
              ','
            ) || ']' AS literal,
            array_length(arr, 1) AS orig_dim
          FROM parsed
        )
        UPDATE vector_embeddings v
        SET
          embedding_vec_1536 = s.literal::vector(1536),
          embedding_dim = COALESCE(v.embedding_dim, s.orig_dim)
        FROM sized s
        WHERE v.id = s.id
      `);
      totalUpdated += Number(updated);
      console.log(`  pass ${pass}: padded ${updated} rows`);
      if (Number(updated) === 0) break;
      if (pass > 60) {
        console.warn("  safety brake (60 passes)");
        break;
      }
    }
    console.log(`  total backfilled: ${totalUpdated}`);

    console.log("[5/6] rebuild HNSW index on embedding_vec_1536…");
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS vector_embeddings_hnsw_1536
       ON vector_embeddings USING hnsw (embedding_vec_1536 vector_cosine_ops)
       WITH (m = 16, ef_construction = 64)`,
    );
    console.log("  HNSW index ensured");

    console.log("[6/6] verify…");
    const stats = await prisma.$queryRawUnsafe<
      Array<{ total: bigint; with_text: bigint; with_vec: bigint; with_dim: bigint }>
    >(`
      SELECT COUNT(*)::bigint AS total,
             COUNT(NULLIF(embedding, ''))::bigint AS with_text,
             COUNT(embedding_vec_1536)::bigint AS with_vec,
             COUNT(embedding_dim)::bigint AS with_dim
      FROM vector_embeddings
    `);
    console.log("  vector_embeddings:");
    for (const s of stats) {
      console.log(
        `    total=${s.total}  with_text=${s.with_text}  with_vec=${s.with_vec}  with_dim=${s.with_dim}`,
      );
    }

    const cm = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'chat_messages' AND column_name = 'searchable_tsv'
      ) AS exists
    `);
    console.log(`  chat_messages.searchable_tsv exists: ${cm[0]?.exists}`);

    const idx = await prisma.$queryRawUnsafe<{ indexname: string }[]>(`
      SELECT indexname::text
      FROM pg_indexes
      WHERE tablename = 'vector_embeddings'
        AND indexname = 'vector_embeddings_hnsw_1536'
    `);
    console.log(
      `  HNSW index restored: ${idx.length > 0 ? "yes" : "MISSING"}`,
    );

    // Quick sanity benchmark — KNN top-10 against the new index.
    const seed = await prisma.$queryRawUnsafe<{ vec: string }[]>(
      "SELECT embedding_vec_1536::text AS vec FROM vector_embeddings WHERE embedding_vec_1536 IS NOT NULL LIMIT 1",
    );
    if (seed.length > 0) {
      const t0 = Date.now();
      await prisma.$queryRawUnsafe(
        `SELECT id FROM vector_embeddings
         WHERE embedding_vec_1536 IS NOT NULL
         ORDER BY embedding_vec_1536 <=> '${seed[0].vec}'::vector(1536)
         LIMIT 10`,
      );
      console.log(`  KNN top-10 latency: ${Date.now() - t0}ms`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
