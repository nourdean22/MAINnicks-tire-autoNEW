/**
 * scripts/tune-vector-index.ts · v10.0.403
 *
 * pgvector HNSW index health + tuning report.
 *
 * What it does (read-only by default · idempotent):
 *   1. Reports row count, distribution, dim mix, model mix
 *   2. Reports HNSW index size + parameters (m, ef_construction)
 *   3. Runs ANALYZE vector_embeddings to refresh planner stats
 *   4. Benchmarks KNN at ef_search ∈ {20, 40, 80, 160} and reports
 *      p50 / p95 latency + result-set similarity overlap (Jaccard).
 *   5. Reports recommendations · keep / rebuild / scale-up.
 *
 * Why · the v10.0.90 install used m=16 ef_construction=64 (defaults
 * for <100K rows). At our current ~7K wisdom + chat embeddings
 * this is fine. This script makes the assumption testable rather
 * than an assertion of faith. Re-run periodically as rows grow.
 *
 * Tuning matrix (pgvector docs):
 *   Rows      | m   | ef_construction | ef_search
 *   <10K      | 16  | 64              | 40
 *   10-100K   | 16  | 80              | 80
 *   100K-1M   | 24  | 200             | 100
 *   >1M       | 32  | 400             | 200
 *
 * Run: pnpm tsx scripts/tune-vector-index.ts
 *      pnpm tsx scripts/tune-vector-index.ts --apply-ef-search 80
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const APPLY_EF_SEARCH = (() => {
  const i = process.argv.indexOf("--apply-ef-search");
  if (i === -1) return null;
  const v = parseInt(process.argv[i + 1] ?? "", 10);
  return Number.isFinite(v) && v >= 10 && v <= 1000 ? v : null;
})();

interface RowStat { total: number; with_1536: number; with_orig: number; with_dim: number; with_model: number }
interface DimRow { dim: number | null; n: number }
interface ModelRow { model: string | null; n: number }
interface IdxRow { indexname: string; indexdef: string; size_bytes: bigint | number | null }

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function p95(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}

function jaccard<T>(a: Iterable<T>, b: Iterable<T>): number {
  const A = new Set(a), B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

async function main() {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  try {
    console.log("=== pgvector HNSW health check · v10.0.403 ===\n");

    // 1. row + column stats
    const stats = await prisma.$queryRawUnsafe<RowStat[]>(`
      SELECT COUNT(*)::int AS total,
             COUNT(embedding_vec_1536)::int AS with_1536,
             COUNT(embedding_vec)::int AS with_orig,
             COUNT(embedding_dim)::int AS with_dim,
             COUNT(model)::int AS with_model
      FROM vector_embeddings
    `);
    const s = stats[0]!;
    console.log("[rows]");
    console.log(`  total           : ${s.total}`);
    console.log(`  with_1536 col   : ${s.with_1536}  (${((s.with_1536 / Math.max(1, s.total)) * 100).toFixed(1)}%)`);
    console.log(`  with_orig col   : ${s.with_orig}`);
    console.log(`  with_dim meta   : ${s.with_dim}`);
    console.log(`  with_model meta : ${s.with_model}`);

    // 2. dim distribution
    const dims = await prisma.$queryRawUnsafe<DimRow[]>(`
      SELECT embedding_dim AS dim, COUNT(*)::int AS n
      FROM vector_embeddings
      GROUP BY embedding_dim ORDER BY n DESC
    `);
    console.log("\n[dim distribution]");
    for (const d of dims) console.log(`  dim=${d.dim ?? "NULL"} · ${d.n}`);

    // 3. model distribution
    const models = await prisma.$queryRawUnsafe<ModelRow[]>(`
      SELECT model, COUNT(*)::int AS n
      FROM vector_embeddings
      GROUP BY model ORDER BY n DESC
    `);
    console.log("\n[model distribution]");
    for (const m of models) console.log(`  ${m.model ?? "NULL"} · ${m.n}`);

    // 4. index info + size
    const idx = await prisma.$queryRawUnsafe<IdxRow[]>(`
      SELECT i.indexname::text,
             i.indexdef::text,
             pg_relation_size(c.oid) AS size_bytes
      FROM pg_indexes i
      JOIN pg_class c ON c.relname = i.indexname
      WHERE i.tablename = 'vector_embeddings'
        AND i.indexname LIKE '%hnsw%'
    `);
    console.log("\n[hnsw indexes]");
    for (const ix of idx) {
      const sizeMb = Number(ix.size_bytes ?? 0) / 1024 / 1024;
      console.log(`  ${ix.indexname} · ${sizeMb.toFixed(2)} MB`);
      console.log(`    ${ix.indexdef}`);
    }

    // 5. ANALYZE to refresh stats
    console.log("\n[analyze] refreshing planner stats...");
    await prisma.$executeRawUnsafe(`ANALYZE vector_embeddings`);
    console.log("  done");

    // 6. KNN benchmark
    console.log("\n[benchmark] KNN top-10 latency (cold) at varying ef_search");
    const seed = await prisma.$queryRawUnsafe<{ embedding_vec_1536: string }[]>(
      `SELECT embedding_vec_1536::text FROM vector_embeddings WHERE embedding_vec_1536 IS NOT NULL LIMIT 5`,
    );
    if (seed.length === 0) {
      console.log("  no embeddings to benchmark — skip");
    } else {
      const efs = [20, 40, 80, 160];
      const baselineIds: Map<number, string[]> = new Map();
      for (const ef of efs) {
        const lats: number[] = [];
        let resultIds: string[] = [];
        for (const seedRow of seed) {
          const t0 = Date.now();
          // SET LOCAL inside an explicit transaction (Prisma $transaction)
          // is the only safe way to set ef_search per query.
          const ids = await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = ${ef}`);
            return tx.$queryRawUnsafe<{ id: string }[]>(`
              SELECT id::text FROM vector_embeddings
              WHERE embedding_vec_1536 IS NOT NULL
              ORDER BY embedding_vec_1536 <=> '${seedRow.embedding_vec_1536}'::vector(1536)
              LIMIT 10
            `);
          });
          lats.push(Date.now() - t0);
          resultIds = ids.map((r) => r.id);
        }
        baselineIds.set(ef, resultIds); // last seed's results · enough for shape sanity
        const med = median(lats);
        const top = p95(lats);
        console.log(`  ef_search=${String(ef).padStart(3)} · p50=${med}ms · p95=${top}ms · n=${lats.length}`);
      }

      // Recall vs baseline (ef_search=160 treated as ground truth)
      const truth = baselineIds.get(160) ?? [];
      console.log("\n[recall vs ef_search=160]");
      for (const ef of [20, 40, 80]) {
        const r = baselineIds.get(ef) ?? [];
        const j = jaccard(r, truth);
        console.log(`  ef_search=${String(ef).padStart(3)} · jaccard@10 = ${j.toFixed(3)}`);
      }
    }

    // 7. recommendations
    console.log("\n[recommendations]");
    if (s.total < 10_000) {
      console.log("  scale tier: <10K · current params (m=16, ef_construction=64) are optimal");
      console.log("  recommended ef_search at query time: 40 (default) is fine");
    } else if (s.total < 100_000) {
      console.log("  scale tier: 10K-100K · consider rebuilding with ef_construction=80");
      console.log("  recommended ef_search at query time: 80 for high-recall paths (memory-recall)");
    } else if (s.total < 1_000_000) {
      console.log("  scale tier: 100K-1M · REBUILD with m=24, ef_construction=200");
      console.log("  recommended ef_search at query time: 100");
    } else {
      console.log("  scale tier: >1M · REBUILD with m=32, ef_construction=400");
      console.log("  recommended ef_search at query time: 200");
    }

    // 8. optional · apply ef_search at role level (Neon-safe)
    if (APPLY_EF_SEARCH !== null) {
      console.log(`\n[apply] setting role-level hnsw.ef_search = ${APPLY_EF_SEARCH}...`);
      try {
        // Use current_user; on Neon this is the connection role
        const role = await prisma.$queryRawUnsafe<{ current_user: string }[]>(
          `SELECT current_user::text`,
        );
        const roleName = role[0]?.current_user;
        if (roleName) {
          await prisma.$executeRawUnsafe(
            `ALTER ROLE "${roleName}" SET hnsw.ef_search = ${APPLY_EF_SEARCH}`,
          );
          console.log(`  applied to role "${roleName}"`);
          console.log("  note: takes effect on NEXT connection · existing pool sessions keep old value");
        }
      } catch (err) {
        console.warn(`  could not apply: ${err instanceof Error ? err.message.slice(0, 200) : err}`);
        console.warn("  fallback: use lib/db/vector-tuning.ts withEfSearch() helper per-query");
      }
    }

    console.log("\n=== done ===");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
