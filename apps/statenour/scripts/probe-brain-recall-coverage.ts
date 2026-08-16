/**
 * READ-ONLY · how much of the brain can semantic recall actually SEE?
 *
 * `probe-brain-census.ts` counts what is STORED. This counts what is
 * RETRIEVABLE, which is a different number and the one that decides whether a
 * memory ever influences an answer. A BrainMemory with no embedding is not a
 * weak memory — it is an absent one: recall is a vector search, so an unembedded
 * row cannot be returned at any similarity threshold.
 *
 * Two distinct gaps, and they need different fixes:
 *   1. no `vector_embeddings` row at all        -> never embedded
 *   2. a row whose `embedding_vec` is NULL      -> embedded as JSON text only,
 *      so pgvector cannot search it even though a row exists
 *
 * pg quirks this cost time on: `vector_embeddings` has NO @map, so the columns
 * are quoted camelCase ("sourceType"/"sourceId") — `v.source_type` is a 42703.
 * And information_schema columns are type `name`, which Prisma cannot
 * deserialize; cast to text or the query dies with P2010.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { prisma } from "@/lib/prisma";

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "0.0");

async function main() {
  const [o] = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT
      COUNT(*)::int AS active,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM vector_embeddings v
        WHERE v."sourceType" = 'brain_memory' AND v."sourceId" = bm.id
      ))::int AS embedded,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM vector_embeddings v
        WHERE v."sourceType" = 'brain_memory' AND v."sourceId" = bm.id
          AND v.embedding_vec IS NOT NULL
      ))::int AS pgvector_searchable
    FROM brain_memories bm
    WHERE deleted_at IS NULL
  `);

  const active = n(o.active);
  const embedded = n(o.embedded);
  const searchable = n(o.pgvector_searchable);

  console.log(`active brain memories .......... ${active}`);
  console.log(`have an embedding row .......... ${embedded}  (${pct(embedded, active)}%)`);
  console.log(`pgvector-searchable ............ ${searchable}  (${pct(searchable, active)}%)`);
  console.log(`NEVER EMBEDDED ................. ${active - embedded}  (${pct(active - embedded, active)}% dark)`);
  console.log(`embedded but not searchable .... ${embedded - searchable}`);

  console.log("\n=== what is dark, by category (top 18) ===");
  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT category,
           COUNT(*)::int AS active,
           COUNT(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM vector_embeddings v
             WHERE v."sourceType" = 'brain_memory' AND v."sourceId" = bm.id
           ))::int AS dark
    FROM brain_memories bm
    WHERE deleted_at IS NULL
    GROUP BY category
    ORDER BY 3 DESC LIMIT 18
  `);
  for (const r of rows) {
    const d = n(r.dark);
    const a = n(r.active);
    console.log(
      `  ${String(r.category).padEnd(26)} ${String(d).padStart(6)} / ${String(a).padStart(6)} dark  (${pct(d, a)}%)`,
    );
  }

  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
