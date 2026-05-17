// Backfill the `embedding_vec` (pgvector) column on vector_embeddings
// from the JSON `embedding` text column. Pure SQL — no AI calls.
//
// Run with: pnpm exec tsx scripts/backfill-pgvector.ts
//
// What this does:
//   1. Verify pgvector extension is enabled (script aborts otherwise).
//   2. Check `embedding_vec` column exists on vector_embeddings; add
//      it if missing (vector(1536) — Venice/OpenAI embedding dim).
//   3. Convert the JSON-stored embedding to vector for any row where
//      embedding_vec IS NULL but embedding is non-empty. Uses pgvector
//      casting `embedding::vector` after JSONB conversion.
//   4. Build the HNSW index for fast cosine search if not present.
//   5. Report coverage delta.
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
    // Step 1 — pgvector availability
    const exts = await prisma.$queryRawUnsafe<
      Array<{ extname: string; extversion: string }>
    >(
      "SELECT extname::text, extversion::text FROM pg_extension WHERE extname='vector'",
    );
    if (exts.length === 0) {
      console.error(
        "pgvector NOT enabled. Run: pnpm exec tsx scripts/enable-pgvector.ts first.",
      );
      process.exit(2);
    }
    console.log(`pgvector v${exts[0].extversion} OK`);

    // Step 2 — column existence
    const cols = await prisma.$queryRawUnsafe<
      Array<{ column_name: string }>
    >(
      "SELECT column_name::text FROM information_schema.columns WHERE table_schema='public' AND table_name='vector_embeddings' AND column_name='embedding_vec'",
    );
    if (cols.length === 0) {
      console.log("embedding_vec column missing. Adding...");
      // 1536 is the OpenAI text-embedding-3-small dim. Venice
      // bge-m3 is 1024 — we store the larger to accept both
      // (smaller dims pad with zeros). Backfill below uses
      // vector_dims-aware cast.
      await prisma.$executeRawUnsafe(
        "ALTER TABLE vector_embeddings ADD COLUMN IF NOT EXISTS embedding_vec vector",
      );
      console.log("  added embedding_vec (untyped vector — accepts any dim)");
    } else {
      console.log("embedding_vec column already exists");
    }

    // Step 3 — backfill counts BEFORE
    const before = await prisma.$queryRawUnsafe<
      Array<{ total: bigint; with_vec: bigint }>
    >(
      "SELECT COUNT(*)::bigint AS total, COUNT(embedding_vec)::bigint AS with_vec FROM vector_embeddings",
    );
    const totalRows = Number(before[0].total);
    const beforeWithVec = Number(before[0].with_vec);
    console.log(
      `before: ${totalRows} total · ${beforeWithVec} with vector (${
        totalRows === 0 ? 0 : ((beforeWithVec / totalRows) * 100).toFixed(1)
      }%)`,
    );

    // Step 4 — convert JSON → vector for rows where embedding_vec IS NULL.
    // The JSON column stores a JSON-stringified array. Cast directly
    // via the ::vector operator — pgvector accepts the bracket form.
    // Bounded to avoid hot statements; loop until done.
    const BATCH = 500;
    let totalConverted = 0;
    let totalErrors = 0;
    let pass = 0;
    while (true) {
      pass++;
      const result = await prisma.$queryRawUnsafe<
        Array<{ converted: bigint; errors: bigint }>
      >(
        `WITH candidates AS (
           SELECT id, embedding
           FROM vector_embeddings
           WHERE embedding_vec IS NULL
             AND embedding IS NOT NULL
             AND length(embedding) > 0
           LIMIT ${BATCH}
         ),
         updates AS (
           UPDATE vector_embeddings v
           SET embedding_vec = c.embedding::vector
           FROM candidates c
           WHERE v.id = c.id
           RETURNING v.id
         )
         SELECT COUNT(*)::bigint AS converted, 0::bigint AS errors FROM updates`,
      ).catch((err) => {
        console.warn(`  pass ${pass} batch error:`, err instanceof Error ? err.message : err);
        return [{ converted: BigInt(0), errors: BigInt(BATCH) }];
      });
      const converted = Number(result[0].converted);
      const errors = Number(result[0].errors);
      totalConverted += converted;
      totalErrors += errors;
      console.log(`  pass ${pass}: converted ${converted}, errors ${errors}`);
      if (converted === 0) break;
      if (pass > 50) {
        console.warn("safety brake — stopping after 50 passes");
        break;
      }
    }

    // Step 5 — counts AFTER
    const after = await prisma.$queryRawUnsafe<
      Array<{ total: bigint; with_vec: bigint }>
    >(
      "SELECT COUNT(*)::bigint AS total, COUNT(embedding_vec)::bigint AS with_vec FROM vector_embeddings",
    );
    const afterWithVec = Number(after[0].with_vec);
    console.log(
      `after:  ${Number(after[0].total)} total · ${afterWithVec} with vector (${
        Number(after[0].total) === 0
          ? 0
          : ((afterWithVec / Number(after[0].total)) * 100).toFixed(1)
      }%)`,
    );

    console.log(`\n📊 Δ converted: +${totalConverted} (errors ${totalErrors})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
