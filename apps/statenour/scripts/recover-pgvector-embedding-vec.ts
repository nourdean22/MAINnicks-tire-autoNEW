/**
 * Recover the unbounded `embedding_vec` column · v10.0.155
 *
 * Sister to scripts/recover-pgvector-from-text.ts. That script restored
 * embedding_vec_1536 (used by HNSW + chat memory recall). The schema
 * sentinel found one more dropped column the first script missed:
 * `embedding_vec` (vector, unbounded dim) — used by:
 *   · lib/brain/semantic-link.ts        (cron · semantic linker)
 *   · lib/brain/journal-ingest.ts       (chat ingest dedup)
 *   · lib/brain/semantic-dedup.ts       (cron · brain dedup)
 *   · app/api/cron/pgvector-backfill/route.ts
 *   · lib/db/pgvector.ts                (the wrapper itself)
 *
 * Restore by:
 *   1. ALTER TABLE add `embedding_vec vector` (unbounded) IF NOT EXISTS
 *   2. Backfill from the surviving JSON text in `embedding` column
 *      (no padding needed because the column is unbounded — accepts
 *      any dim: 768, 1024, 1536, etc.)
 *   3. Sanity-verify count + KNN benchmark
 *
 * Idempotent. Safe to re-run.
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
    console.log("[1/3] add embedding_vec (unbounded vector) column…");
    await prisma.$executeRawUnsafe(
      `ALTER TABLE vector_embeddings
       ADD COLUMN IF NOT EXISTS embedding_vec vector`,
    );
    console.log("  added (idempotent)");

    console.log("[2/3] backfill embedding_vec from embedding text JSON…");
    // Parse the JSON array → assemble pgvector literal → cast.
    // Unbounded `vector` accepts any dim, so no padding/truncation.
    const BATCH = 500;
    let pass = 0;
    let totalUpdated = 0;
    while (true) {
      pass++;
      const updated = await prisma.$executeRawUnsafe(`
        WITH cand AS (
          SELECT id, embedding
          FROM vector_embeddings
          WHERE embedding_vec IS NULL
            AND embedding IS NOT NULL
            AND embedding != ''
            AND embedding ~ '^\\['
          LIMIT ${BATCH}
        ),
        parsed AS (
          SELECT
            c.id,
            ARRAY(SELECT jsonb_array_elements_text(c.embedding::jsonb)) AS arr
          FROM cand c
        )
        UPDATE vector_embeddings v
        SET embedding_vec = ('[' || array_to_string(p.arr, ',') || ']')::vector
        FROM parsed p
        WHERE v.id = p.id
      `);
      totalUpdated += Number(updated);
      console.log(`  pass ${pass}: backfilled ${updated} rows`);
      if (Number(updated) === 0) break;
      if (pass > 60) {
        console.warn("  safety brake (60 passes)");
        break;
      }
    }
    console.log(`  total backfilled: ${totalUpdated}`);

    console.log("[3/3] verify…");
    const stats = await prisma.$queryRawUnsafe<
      Array<{ total: bigint; with_text: bigint; with_vec: bigint }>
    >(`
      SELECT COUNT(*)::bigint AS total,
             COUNT(NULLIF(embedding, ''))::bigint AS with_text,
             COUNT(embedding_vec)::bigint AS with_vec
      FROM vector_embeddings
    `);
    for (const s of stats) {
      console.log(
        `  vector_embeddings: total=${s.total}  with_text=${s.with_text}  with_vec=${s.with_vec}`,
      );
    }

    // Quick KNN benchmark — confirms the column is queryable.
    const seed = await prisma.$queryRawUnsafe<{ vec: string }[]>(
      "SELECT embedding_vec::text AS vec FROM vector_embeddings WHERE embedding_vec IS NOT NULL LIMIT 1",
    );
    if (seed.length > 0) {
      const t0 = Date.now();
      await prisma.$queryRawUnsafe(
        `SELECT id FROM vector_embeddings
         WHERE embedding_vec IS NOT NULL
         ORDER BY embedding_vec <=> '${seed[0].vec}'::vector
         LIMIT 10`,
      );
      console.log(
        `  KNN top-10 latency (no HNSW · sequential scan expected): ${Date.now() - t0}ms`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
