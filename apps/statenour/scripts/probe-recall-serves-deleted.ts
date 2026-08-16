/**
 * READ-ONLY · does semantic recall still serve SOFT-DELETED memories?
 *
 * `pgvectorSemanticSearch` (lib/brain/embedding-utils.ts) searches
 * `vector_embeddings` with no join to `brain_memories`, takes `content` from the
 * EMBEDDING row rather than the memory row, and — critically — keeps a hit even
 * when the metadata lookup misses, falling back to `confidence ?? 0.5`. Nothing
 * in that path filters `deleted_at`.
 *
 * If that reading is right, every memory the operator soft-deleted is still
 * reachable by Nick. This checks it against prod instead of trusting the read.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { prisma } from "@/lib/prisma";

const n = (v: unknown) => Number(v ?? 0);

async function main() {
  const [idx] = await prisma.$queryRaw<{ total: bigint; live: bigint; dead: bigint }[]>`
    SELECT COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE bm.id IS NOT NULL AND bm.deleted_at IS NULL)::bigint AS live,
           COUNT(*) FILTER (WHERE bm.id IS NULL OR bm.deleted_at IS NOT NULL)::bigint AS dead
    FROM vector_embeddings v
    LEFT JOIN brain_memories bm ON bm.id = v."sourceId"
    WHERE v."sourceType" = 'brain_memory' AND v.embedding_vec IS NOT NULL
  `;
  const total = n(idx.total), live = n(idx.live), dead = n(idx.dead);
  console.log("=== the brain_memory vector index, as recall sees it ===");
  console.log(`  searchable entries .......... ${total}`);
  console.log(`  point at a LIVE memory ...... ${live}  (${((live / total) * 100).toFixed(1)}%)`);
  console.log(`  point at DELETED/MISSING .... ${dead}  (${((dead / total) * 100).toFixed(1)}%)`);

  console.log("\n=== is the operator's 2026-08-14 cleanup still reachable? ===");
  const rows = await prisma.$queryRaw<{ key: string; category: string; deleted_at: Date; has_vec: boolean }[]>`
    SELECT bm.key, bm.category, bm.deleted_at,
           (v.embedding_vec IS NOT NULL) AS has_vec
    FROM brain_memories bm
    JOIN vector_embeddings v ON v."sourceId" = bm.id AND v."sourceType" = 'brain_memory'
    WHERE bm.deleted_at IS NOT NULL
    ORDER BY bm.deleted_at DESC
    LIMIT 10
  `;
  if (rows.length === 0) {
    console.log("  none — soft-deleted memories carry no searchable vector.");
  } else {
    for (const r of rows)
      console.log(`  ${r.key.slice(0, 42).padEnd(44)} ${r.category.slice(0, 18).padEnd(20)} deleted ${r.deleted_at.toISOString().slice(0, 10)} · searchable: ${r.has_vec}`);
  }

  const [c] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n
    FROM brain_memories bm
    JOIN vector_embeddings v ON v."sourceId" = bm.id AND v."sourceType" = 'brain_memory'
    WHERE bm.deleted_at IS NOT NULL AND v.embedding_vec IS NOT NULL
  `;
  console.log(`\n  SOFT-DELETED memories that are still vector-searchable: ${n(c.n)}`);

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
