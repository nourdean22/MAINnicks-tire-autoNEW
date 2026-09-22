/**
 * proof:recall-pool - READ-ONLY: does the dense recall pool fill 50/50 on Neon?
 *
 *   railway run -s statenour-web -- pnpm proof:recall-pool
 *
 * Runs the pool query in the shape getKnnPoolRows (lib/brain/contextual-recall.ts)
 * ships since #2521 - liveness filter on `sourceUnavailableAt`, the quarantine
 * list bound as a text[] parameter, and `SET LOCAL hnsw.iterative_scan =
 * relaxed_order` inside a bounded transaction - for four real memory vectors,
 * and reports how many of the 50 slots come back and whether any quarantined
 * category leaks in.
 *
 * Why it exists: before #2521 the same query returned 9-28 rows of 50, because
 * 45% of the HNSW candidates within ef_search were dead vectors and the
 * post-filter starved. A source-contract test proves the SQL text; only this
 * run proves the planner behaves on production data. Baseline 2026-09-22 after
 * deploy: 50/50 on all four seeds, 0 quarantined categories, 424-1031 ms.
 *
 * ⚠ THIS MIRRORS THE SHIPPED SQL. If getKnnPoolRows changes shape, change this
 * file with it or it proves the wrong query - tests/brain/recall-knn-pool-
 * iterative.test.ts pins the shipped shape; this pins its behaviour.
 *
 * Read-only by construction: SELECTs and a session-local SET only.
 */
import Module from "node:module";

{
  const cjs = Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => (request === "server-only" ? {} : original(request, parent, isMain));
}

const SEED_CATEGORIES = ["insight", "concern", "emotional_state", "decision_log"];

async function main(): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  const { RECALL_EXCLUDE_CATEGORIES } = await import("@/lib/brain/categories");
  const excluded: string[] = [...RECALL_EXCLUDE_CATEGORIES];

  const seeds = await prisma.$queryRawUnsafe<Array<{ category: string; vec: string }>>(
    "SELECT bm.category::text AS category, ve.embedding_vec_1536::text AS vec " +
      "FROM vector_embeddings ve JOIN brain_memories bm ON bm.id = ve.\"sourceId\" " +
      "WHERE ve.\"sourceType\" = 'brain_memory' AND ve.embedding_vec_1536 IS NOT NULL AND bm.deleted_at IS NULL " +
      "AND bm.category IN ('" + SEED_CATEGORIES.join("','") + "') ORDER BY bm.created_at DESC LIMIT 4",
  );
  if (seeds.length === 0) {
    console.log("no seed vectors found - nothing to prove");
    await prisma.$disconnect();
    return;
  }

  const sql =
    "SELECT bm.id::text AS id, bm.category::text AS category FROM vector_embeddings ve " +
    "JOIN brain_memories bm ON bm.id = ve.\"sourceId\" AND bm.deleted_at IS NULL " +
    "WHERE ve.\"sourceType\" = 'brain_memory' AND ve.embedding_vec_1536 IS NOT NULL AND ve.\"sourceUnavailableAt\" IS NULL " +
    "AND bm.confidence >= 0.3 AND bm.category <> ALL($2::text[]) AND (bm.valid_until IS NULL OR bm.valid_until > now()) " +
    "ORDER BY ve.embedding_vec_1536 <=> $1::vector(1536) LIMIT 50";

  let worst = 50;
  for (const s of seeds) {
    const t0 = Date.now();
    const rows = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL hnsw.iterative_scan = relaxed_order");
        return tx.$queryRawUnsafe<Array<{ id: string; category: string }>>(sql, s.vec, excluded);
      },
      { timeout: 10_000 },
    );
    const leaked = rows.filter((r) => excluded.includes(r.category)).length;
    worst = Math.min(worst, rows.length);
    console.log(
      "seed " + s.category.padEnd(16) + " pool " + String(rows.length).padStart(2) + "/50 in " + String(Date.now() - t0).padStart(5) + " ms · quarantined in pool: " + leaked +
        " · categories: " + [...new Set(rows.map((r) => r.category))].slice(0, 6).join(","),
    );
    if (leaked > 0) process.exitCode = 1;
  }
  console.log(worst === 50 ? "PROVEN: every seed filled 50/50" : "NOT PROVEN: worst seed filled " + worst + "/50");
  if (worst < 50) process.exitCode = 1;

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("proof:recall-pool failed:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
