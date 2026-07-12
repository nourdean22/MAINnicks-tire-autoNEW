// Backfill embedding_vec_1536 by padding shorter vectors to 1536
// dimensions. JS-side padding for reliability — pgvector text
// concat got fiddly across versions.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const TARGET_DIM = 1536;

async function main() {
  const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });
  try {
    const before = await prisma.$queryRawUnsafe<
      Array<{ total: number; padded: number }>
    >(
      `SELECT COUNT(*)::int AS total, COUNT(embedding_vec_1536)::int AS padded FROM vector_embeddings WHERE embedding_vec IS NOT NULL`,
    );
    console.log(
      `before: ${before[0].total} total · ${before[0].padded} already 1536`,
    );

    const BATCH = 200;
    let totalPadded = 0;
    let pass = 0;

    while (true) {
      pass++;
      // 2026-07-12 · do NOT gate on embedding_dim — that column is NULL for a
      // large slice of rows (~1,224 in prod), so the old filter silently
      // skipped them forever, leaving them invisible to live recall (which
      // reads embedding_vec_1536 IS NOT NULL). Pad by the vector's ACTUAL
      // length instead; the JS guard below skips anything already ≥ target.
      const rows = await prisma.$queryRawUnsafe<
        Array<{ id: string; embedding_vec: string }>
      >(
        `SELECT id::text, embedding_vec::text
         FROM vector_embeddings
         WHERE embedding_vec_1536 IS NULL
           AND embedding_vec IS NOT NULL
         LIMIT ${BATCH}`,
      );

      if (rows.length === 0) break;

      let passUpdated = 0;
      for (const r of rows) {
        try {
          // embedding_vec text comes back as "[0.1,0.2,...]"
          const arr = JSON.parse(r.embedding_vec) as number[];
          if (!Array.isArray(arr) || arr.length === 0 || arr.length > TARGET_DIM) continue;
          const padded =
            arr.length === TARGET_DIM
              ? arr
              : [...arr, ...new Array(TARGET_DIM - arr.length).fill(0)];
          const lit = `[${padded.join(",")}]`;
          await prisma.$executeRawUnsafe(
            `UPDATE vector_embeddings SET embedding_vec_1536 = $1::vector(${TARGET_DIM}) WHERE id = $2`,
            lit,
            r.id,
          );
          passUpdated++;
        } catch (err) {
          console.warn(
            `  row ${r.id} failed:`,
            err instanceof Error ? err.message.slice(0, 80) : err,
          );
        }
      }
      totalPadded += passUpdated;
      console.log(`  pass ${pass}: padded ${passUpdated}/${rows.length}`);
      if (passUpdated === 0) break;
      if (pass > 50) break;
    }

    const after = await prisma.$queryRawUnsafe<
      Array<{ total: number; padded: number }>
    >(
      `SELECT COUNT(*)::int AS total, COUNT(embedding_vec_1536)::int AS padded FROM vector_embeddings`,
    );
    console.log(
      `\nafter: ${after[0].total} total · ${after[0].padded} with 1536-dim · padded ${totalPadded} this run`,
    );

    // Quick HNSW benchmark with the populated column
    const seed = await prisma.$queryRawUnsafe<
      Array<{ embedding_vec_1536: string }>
    >(
      `SELECT embedding_vec_1536::text FROM vector_embeddings WHERE embedding_vec_1536 IS NOT NULL LIMIT 1`,
    );
    if (seed.length > 0) {
      const t0 = Date.now();
      const knn = await prisma.$queryRawUnsafe<
        Array<{ id: string; distance: number }>
      >(
        `SELECT id::text, (embedding_vec_1536 <=> '${seed[0].embedding_vec_1536}'::vector(1536)) AS distance
         FROM vector_embeddings
         WHERE embedding_vec_1536 IS NOT NULL
         ORDER BY embedding_vec_1536 <=> '${seed[0].embedding_vec_1536}'::vector(1536)
         LIMIT 10`,
      );
      const ms = Date.now() - t0;
      console.log(
        `\nKNN HNSW top-10: ${ms}ms · top-3 distances ${knn.slice(0, 3).map((k) => k.distance.toFixed(4)).join(", ")}`,
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
