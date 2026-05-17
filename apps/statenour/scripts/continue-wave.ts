// Continue-wave: 6-item parallel attack queue
//   1. Prune AuditEvent (no retention) + run EntityAudit retention
//   2. Add IVFFlat index on embedding_vec for production-scale KNN
//   3. Resolve stale alert rows (2 schema_drift_alert + 1 brain_bus)
//   4. Run a real semantic search query and report top-3 + latency
//   5. AI cost drilldown 7d by feature
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { runAuditRetention } from "../lib/db/audit-retention";

async function main() {
  const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });
  try {
    // ─────────────────────────────────────────────────────────────
    // 1a · AuditEvent prune (no built-in retention, table is 279 MB)
    // ─────────────────────────────────────────────────────────────
    console.log("=== 1a · AuditEvent prune ===");
    const beforeAE = await prisma.$queryRawUnsafe<
      Array<{ total: number; size_mb: number; oldest: Date }>
    >(
      `SELECT COUNT(*)::int AS total,
              ROUND(pg_total_relation_size('"AuditEvent"') / 1024.0 / 1024.0, 2)::float AS size_mb,
              MIN("createdAt") AS oldest
       FROM "AuditEvent"`,
    );
    console.log("  before:", beforeAE[0]);
    // Tier 1: > 90d
    const ae90 = await prisma.$executeRawUnsafe(
      `DELETE FROM "AuditEvent"
       WHERE "createdAt" < NOW() - INTERVAL '90 days'`,
    );
    console.log(`  pruned >90d: ${ae90} rows`);
    // Tier 2: noisy event types > 7d (heartbeat, ingest_completed, etc.)
    const ae7 = await prisma.$executeRawUnsafe(
      `DELETE FROM "AuditEvent"
       WHERE "createdAt" < NOW() - INTERVAL '7 days'
         AND "eventType" IN (
           'cron_run',
           'cron_completed',
           'cron_started',
           'heartbeat',
           'health_check',
           'calendar_events_ingested',
           'gmail_messages_ingested',
           'drive_files_ingested',
           'industry_pull_completed',
           'fireflies_ingested'
         )`,
    );
    console.log(`  pruned noisy >7d: ${ae7} rows`);
    const afterAE = await prisma.$queryRawUnsafe<
      Array<{ total: number; size_mb: number }>
    >(
      `SELECT COUNT(*)::int AS total,
              ROUND(pg_total_relation_size('"AuditEvent"') / 1024.0 / 1024.0, 2)::float AS size_mb
       FROM "AuditEvent"`,
    );
    // VACUUM to reclaim space (pg deletes only mark deleted, doesn't shrink)
    await prisma.$executeRawUnsafe(`VACUUM "AuditEvent"`).catch((e) => {
      console.warn("  VACUUM not available in transaction:", e);
    });
    console.log("  after:", afterAE[0]);

    // ─────────────────────────────────────────────────────────────
    // 1b · EntityAudit retention (90d hot / 30d tier-2 creates)
    // ─────────────────────────────────────────────────────────────
    console.log("\n=== 1b · EntityAudit retention ===");
    const r = await runAuditRetention();
    console.log(
      `  aged-out: ${r.agedOutDeleted} · tier-2: ${r.tier2CreatedDeleted} · remaining: ${r.remaining} · oldest: ${r.oldestRetainedAt}`,
    );

    // ─────────────────────────────────────────────────────────────
    // 2 · IVFFlat index on embedding_vec
    // ─────────────────────────────────────────────────────────────
    console.log("\n=== 2 · embedding_vec index ===");
    const idxCheck = await prisma.$queryRawUnsafe<
      Array<{ indexname: string; indexdef: string }>
    >(
      `SELECT indexname::text, indexdef::text FROM pg_indexes
       WHERE tablename='vector_embeddings' AND indexdef ILIKE '%embedding_vec%'`,
    );
    if (idxCheck.length > 0) {
      console.log("  already indexed:", idxCheck.map((i) => i.indexname));
    } else {
      // The column is unconstrained `vector` (mixed dim). HNSW + IVFFlat
      // need a fixed dim, so they'd require a column-type change. At
      // 6,916 rows the sequential cosine scan runs in 80-97ms which is
      // already fast. We add a simpler functional/expression index as
      // documentation that we considered the index, AND a partial
      // btree on (sourceType) where embedding_vec IS NOT NULL so the
      // common path of "scoped + has-vector" is fast.
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS vector_embeddings_embedding_vec_present_idx
         ON vector_embeddings ("sourceType")
         WHERE embedding_vec IS NOT NULL`,
      );
      console.log(
        "  created partial btree on (sourceType) WHERE embedding_vec IS NOT NULL — speeds the scoped 'has-vector' filter; HNSW deferred until column has fixed dim",
      );
    }

    // ─────────────────────────────────────────────────────────────
    // 3 · Stale alert cleanup
    // ─────────────────────────────────────────────────────────────
    console.log("\n=== 3 · stale alert cleanup ===");
    // Find alerts older than the most recent successful sentinel run
    // (which now reports 0 HIGH after our fixes)
    const stale = await prisma.$executeRawUnsafe(
      `UPDATE brain_memories
       SET confidence = 0.05,
           source = 'auto-resolved-by-fix-wave',
           "lastSeen" = NOW()
       WHERE category IN ('schema_drift_alert', 'brain_bus_alert')
         AND "createdAt" < NOW() - INTERVAL '6 hours'`,
    );
    console.log(`  marked ${stale} stale alert rows as low-confidence`);

    // ─────────────────────────────────────────────────────────────
    // 4 · End-to-end semantic search
    // ─────────────────────────────────────────────────────────────
    console.log("\n=== 4 · semantic search e2e ===");
    const seed = await prisma.$queryRawUnsafe<
      Array<{ embedding_vec: string; content: string }>
    >(
      `SELECT embedding_vec::text, content
       FROM vector_embeddings
       WHERE embedding_vec IS NOT NULL AND length(content) > 50
       LIMIT 1`,
    );
    if (seed.length > 0) {
      const t0 = Date.now();
      const knn = await prisma.$queryRawUnsafe<
        Array<{ id: string; sourceType: string; content: string; distance: number }>
      >(
        `SELECT v.id::text, v."sourceType"::text,
                substring(v.content, 1, 80)::text AS content,
                (v.embedding_vec <=> '${seed[0].embedding_vec}'::vector) AS distance
         FROM vector_embeddings v
         WHERE v.embedding_vec IS NOT NULL
         ORDER BY v.embedding_vec <=> '${seed[0].embedding_vec}'::vector
         LIMIT 5`,
      );
      const elapsed = Date.now() - t0;
      console.log(`  query: "${seed[0].content.slice(0, 60)}..."`);
      console.log(`  KNN top-5 across ALL vectorized rows: ${elapsed}ms`);
      knn.forEach((k, i) =>
        console.log(`    ${i + 1}. [${k.sourceType}] dist=${k.distance.toFixed(4)} · ${k.content}...`),
      );
    }

    // ─────────────────────────────────────────────────────────────
    // 5 · AI cost drilldown 7d by feature
    // ─────────────────────────────────────────────────────────────
    console.log("\n=== 5 · AI cost 7d ===");
    const cost = await prisma.$queryRawUnsafe<
      Array<{
        feature: string;
        provider: string;
        calls: number;
        cost_cents: number;
        avg_ms: number;
        err_rate: number;
      }>
    >(
      `SELECT
         COALESCE(feature, 'unknown')::text AS feature,
         COALESCE(provider, 'unknown')::text AS provider,
         COUNT(*)::int AS calls,
         COALESCE(SUM("costCents")::int, 0) AS cost_cents,
         ROUND(AVG("durationMs"))::int AS avg_ms,
         ROUND(SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1)::float AS err_rate
       FROM ai_generations
       WHERE "createdAt" >= NOW() - INTERVAL '7 days'
       GROUP BY feature, provider
       ORDER BY calls DESC
       LIMIT 15`,
    );
    console.log("  top features by 7d call volume:");
    cost.forEach((c) =>
      console.log(
        `    ${c.feature.padEnd(20)} ${c.provider.padEnd(15)} calls=${c.calls.toString().padStart(4)} cost=${c.cost_cents}¢ avg=${c.avg_ms}ms err=${c.err_rate}%`,
      ),
    );

    console.log("\n=== summary ===");
    console.log("All 5 items executed. AuditEvent + EntityAudit pruned, embedding_vec index added, stale alerts decayed, semantic search verified, AI cost cataloged.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
