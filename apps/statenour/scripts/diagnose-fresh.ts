// Hard verification of state since the v10.0.82+83 fixes landed.
// Confirms: brain-bus-backfill fail rate post-fix, schema-drift root
// cause for 3 HIGH findings, semantic search latency.
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
    console.log("=== brain-bus-backfill fresh run stats (since v10.0.82 push) ===");
    const fixedAt = new Date("2026-05-02T00:00:00Z");
    const fresh = await prisma.$queryRawUnsafe<
      Array<{ status: string; cnt: number }>
    >(
      `SELECT status::text, COUNT(*)::int AS cnt
       FROM cron_job_logs
       WHERE "jobName"='brain-bus-backfill'
         AND "createdAt" >= '${fixedAt.toISOString()}'
       GROUP BY status`,
    );
    console.log("post-fix run breakdown:", fresh);
    const totalPost = fresh.reduce((s, r) => s + r.cnt, 0);
    const failPost = fresh.find((r) => r.status === "failed")?.cnt ?? 0;
    console.log(
      `post-fix runs: ${totalPost} total · ${failPost} failed (${
        totalPost === 0 ? "n/a" : ((failPost / totalPost) * 100).toFixed(1) + "%"
      })`,
    );

    console.log("\n=== existence of HIGH-severity drift items ===");
    // 1. chat_messages.searchable_tsv
    const tsv = await prisma.$queryRawUnsafe<
      Array<{ has: boolean }>
    >(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema='public' AND table_name='chat_messages'
                      AND column_name='searchable_tsv') AS has`,
    );
    console.log("chat_messages.searchable_tsv exists:", tsv[0].has);

    // 2 + 3 — idempotency partial unique indexes
    const idx = await prisma.$queryRawUnsafe<
      Array<{ indexname: string }>
    >(
      `SELECT indexname::text FROM pg_indexes
       WHERE schemaname='public'
         AND indexname IN ('autonomous_actions_idempotency_key_uniq','entity_audits_idempotency_key_uniq')`,
    );
    console.log(
      "idempotency indexes present:",
      idx.map((i) => i.indexname),
    );

    console.log("\n=== semantic search latency (KNN cosine, real query) ===");
    // Pull a real embedding from the table, use it as the query vector
    const seed = await prisma.$queryRawUnsafe<
      Array<{ embedding_vec: string }>
    >(
      "SELECT embedding_vec::text AS embedding_vec FROM vector_embeddings WHERE embedding_vec IS NOT NULL LIMIT 1",
    );
    if (seed.length > 0) {
      const vecLit = seed[0].embedding_vec;
      const t0 = Date.now();
      const knn = await prisma.$queryRawUnsafe<
        Array<{ id: string; distance: number }>
      >(
        `SELECT id::text, (embedding_vec <=> '${vecLit}'::vector) AS distance
         FROM vector_embeddings
         WHERE embedding_vec IS NOT NULL
         ORDER BY embedding_vec <=> '${vecLit}'::vector
         LIMIT 10`,
      );
      const elapsed = Date.now() - t0;
      console.log(`KNN top-10 search: ${elapsed}ms across 6,916 rows`);
      console.log(`top-3 distances:`, knn.slice(0, 3).map((k) => k.distance));
    } else {
      console.log("no embeddings to seed query");
    }

    console.log("\n=== entity_audits + brain-memory storage ===");
    const sizes = await prisma.$queryRawUnsafe<
      Array<{ table: string; rows: number; size_mb: number }>
    >(
      `SELECT c.relname::text AS table,
              s.n_live_tup::int AS rows,
              ROUND(pg_total_relation_size(c.oid) / 1024.0 / 1024.0, 2)::float AS size_mb
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_stat_user_tables s ON s.relname = c.relname AND s.schemaname = n.nspname
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
       ORDER BY pg_total_relation_size(c.oid) DESC
       LIMIT 12`,
    );
    console.log("biggest tables:");
    sizes.forEach((s) =>
      console.log(`  ${s.table.padEnd(30)} ${s.rows} rows · ${s.size_mb} MB`),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
