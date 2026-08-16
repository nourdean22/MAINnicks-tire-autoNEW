/**
 * READ-ONLY · why is 83.5% of the brain unembedded when a backfill runs 2x/day?
 *
 * Hypothesis: `app/api/cron/embed-backfill/route.ts` selects candidates as
 *   findMany({ where: confidence >= 0.2, orderBy: confidence desc, take: 200 })
 * — a FIXED top-200-by-confidence window, not a queue. Once those 200 are
 * embedded, `missing` is empty forever and every row below the cut is
 * permanently unreachable, at any cadence.
 *
 * Kept to cheap single-table aggregates: the correlated NOT EXISTS version of
 * this timed out at 10m against the pooled Neon endpoint.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { prisma } from "@/lib/prisma";

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

async function main() {
  const [cut] = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT MIN(confidence)::float8 AS c FROM (
      SELECT confidence FROM brain_memories
      WHERE deleted_at IS NULL AND confidence >= 0.2
      ORDER BY confidence DESC LIMIT 200
    ) t
  `);
  const c = n(cut.c);
  console.log(`the window's floor — confidence of the 200th row: ${c}`);

  const [b] = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT
      COUNT(*) FILTER (WHERE confidence <  ${c})::int AS below_floor,
      COUNT(*) FILTER (WHERE confidence <  0.2)::int  AS below_conf_filter,
      COUNT(*)::int AS active
    FROM brain_memories WHERE deleted_at IS NULL
  `);
  console.log(`active rows ................................. ${n(b.active)}`);
  console.log(`BELOW the floor — never a candidate ......... ${n(b.below_floor)}`);
  console.log(`  (of those, excluded by confidence < 0.2) .. ${n(b.below_conf_filter)}`);

  console.log("\n=== confidence distribution of ACTIVE rows ===");
  const dist = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT CASE WHEN confidence >= 0.9 THEN '0.9-1.0'
                WHEN confidence >= 0.7 THEN '0.7-0.9'
                WHEN confidence >= 0.5 THEN '0.5-0.7'
                WHEN confidence >= 0.2 THEN '0.2-0.5'
                ELSE '<0.2' END AS band,
           COUNT(*)::int AS rows
    FROM brain_memories WHERE deleted_at IS NULL
    GROUP BY 1 ORDER BY 1 DESC
  `);
  for (const r of dist) console.log(`  ${String(r.band).padEnd(10)} ${String(n(r.rows)).padStart(6)}`);

  console.log("\n=== is it re-embedding the same rows? ===");
  const [d] = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT COUNT(*)::int AS embedding_rows,
           COUNT(DISTINCT "sourceId")::int AS distinct_memories
    FROM vector_embeddings WHERE "sourceType"='brain_memory'
  `);
  const er = n(d.embedding_rows), dm = n(d.distinct_memories);
  console.log(`  embedding rows ${er} · distinct memories ${dm} · ${(er / (dm || 1)).toFixed(2)}x per memory`);

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
