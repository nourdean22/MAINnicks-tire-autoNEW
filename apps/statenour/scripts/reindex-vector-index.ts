/**
 * reindex-vector-index - rebuild an HNSW index on vector_embeddings after a mass
 * delete (2026-09-23: 58,950 of 92,190 brain-memory vectors drained). HNSW
 * handles deletes with tombstones; the graph keeps the dead entries until the
 * index is rebuilt, so ef_search still walks them.
 *
 *   railway run -s statenour-web -- pnpm exec tsx scripts/reindex-vector-index.ts             # DRY RUN: list indexes + sizes
 *   railway run -s statenour-web -- pnpm exec tsx scripts/reindex-vector-index.ts --apply --index=<name>
 *
 * The dry run lists every index on vector_embeddings with its definition and
 * size. --apply runs REINDEX INDEX CONCURRENTLY on exactly one named index,
 * which must exist on vector_embeddings and be an hnsw index - anything else is
 * refused. CONCURRENTLY holds no lock that blocks reads or writes; on failure
 * PostgreSQL leaves an INVALID index suffixed _ccnew, which this script reports
 * (drop it by hand, operator). Sizes are printed before and after.
 *
 * prod-db-guard: read this file before running it; the dry run is the plan.
 */
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const indexArg = process.argv.find((a) => a.startsWith("--index="));
const INDEX = indexArg ? indexArg.slice("--index=".length) : "";

interface IndexRow {
  indexname: string;
  indexdef: string;
  size: string;
  bytes: bigint;
  valid: boolean;
}

function hostOf(url: string | undefined): string {
  if (!url) return "(DATABASE_URL unset)";
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function listIndexes(prisma: PrismaClient): Promise<IndexRow[]> {
  return prisma.$queryRawUnsafe<IndexRow[]>(
    `SELECT i.indexname, i.indexdef,
            pg_size_pretty(pg_relation_size(c.oid)) AS size,
            pg_relation_size(c.oid)::bigint AS bytes,
            x.indisvalid AS valid
       FROM pg_indexes i
       JOIN pg_class c ON c.relname = i.indexname
       JOIN pg_index x ON x.indexrelid = c.oid
      WHERE i.tablename = 'vector_embeddings'
      ORDER BY pg_relation_size(c.oid) DESC`,
  );
}

async function main(): Promise<void> {
  console.log(`database host: ${hostOf(process.env.DATABASE_URL)}`);
  console.log(`mode: ${APPLY ? `APPLY - REINDEX INDEX CONCURRENTLY ${INDEX || "(no --index given)"}` : "DRY RUN - listing indexes (pass --apply --index=<name> to rebuild one)"}`);
  const prisma = new PrismaClient();
  try {
    const before = await listIndexes(prisma);
    const [tbl] = await prisma.$queryRawUnsafe<Array<{ size: string; rows: bigint }>>(
      `SELECT pg_size_pretty(pg_total_relation_size('vector_embeddings')) AS size, (SELECT count(*) FROM vector_embeddings)::bigint AS rows`,
    );
    console.log(`vector_embeddings: ${Number(tbl?.rows ?? 0)} rows, total ${tbl?.size ?? "?"} (table + indexes)`);
    for (const r of before) console.log(`  ${r.indexname.padEnd(48)} ${r.size.padStart(9)} ${r.valid ? "" : "INVALID "}${r.indexdef.replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+ /, "")}`);
    if (!APPLY) return;

    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(INDEX)) {
      console.error(`refusing: --index must match ^[a-z_][a-z0-9_]{0,62}$ (got ${JSON.stringify(INDEX)})`);
      process.exitCode = 1;
      return;
    }
    const target = before.find((r) => r.indexname === INDEX);
    if (!target) {
      console.error(`refusing: ${INDEX} is not an index on vector_embeddings`);
      process.exitCode = 1;
      return;
    }
    if (!/USING hnsw/i.test(target.indexdef)) {
      console.error(`refusing: ${INDEX} is not an hnsw index (${target.indexdef})`);
      process.exitCode = 1;
      return;
    }
    const t0 = Date.now();
    await prisma.$executeRawUnsafe(`REINDEX INDEX CONCURRENTLY ${INDEX}`);
    const after = await listIndexes(prisma);
    const rebuilt = after.find((r) => r.indexname === INDEX);
    const leftovers = after.filter((r) => /_ccnew/.test(r.indexname) || !r.valid);
    console.log(`reindexed ${INDEX} in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${target.size} -> ${rebuilt?.size ?? "?"}${rebuilt?.valid === false ? " (INVALID - rebuild failed)" : ""}`);
    if (leftovers.length > 0) {
      console.error(`leftover invalid or _ccnew indexes (drop by hand, operator): ${leftovers.map((r) => r.indexname).join(", ")}`);
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("reindex failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
