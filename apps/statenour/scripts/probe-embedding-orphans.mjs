/**
 * Embedding orphan probe · v10.0.192
 *
 * Confirms how many VectorEmbedding rows have no live source row.
 * "Orphan" = sourceType row in vector_embeddings where the
 * referenced source either doesn't exist OR has deleted_at != null.
 *
 * Don't write yet — just measure.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Total per source type
  const totals = await prisma.vectorEmbedding.groupBy({
    by: ["sourceType"],
    _count: { id: true },
  });

  console.log("\n=== VectorEmbedding totals by sourceType ===");
  for (const t of totals) {
    console.log(`  ${(t.sourceType ?? "(null)").padEnd(28)} ${t._count.id}`);
  }

  // Orphans for brain_memory: source row doesn't exist OR deleted_at != null
  const memOrphans = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n
    FROM vector_embeddings ve
    LEFT JOIN brain_memories bm ON bm.id = ve."sourceId"
    WHERE ve."sourceType" = 'brain_memory'
      AND (bm.id IS NULL OR bm.deleted_at IS NOT NULL)
  `);
  console.log(`\nbrain_memory orphans: ${memOrphans[0]?.n ?? 0}`);

  // Orphans for chat_message
  const msgOrphans = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n
    FROM vector_embeddings ve
    LEFT JOIN chat_messages cm ON cm.id = ve."sourceId"
    WHERE ve."sourceType" = 'chat_message'
      AND cm.id IS NULL
  `);
  console.log(`chat_message orphans: ${msgOrphans[0]?.n ?? 0}`);

  // Orphans for chat_conversation
  const convOrphans = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n
    FROM vector_embeddings ve
    LEFT JOIN chat_conversations cc ON cc.id = ve."sourceId"
    WHERE ve."sourceType" = 'chat_conversation'
      AND (cc.id IS NULL OR cc.archived_at IS NOT NULL)
  `);
  console.log(`chat_conversation orphans: ${convOrphans[0]?.n ?? 0}`);

  // Orphans for mission
  const missionOrphans = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n
    FROM vector_embeddings ve
    LEFT JOIN "Mission" m ON m.id = ve."sourceId"
    WHERE ve."sourceType" = 'mission'
      AND (m.id IS NULL OR m.deleted_at IS NOT NULL)
  `);
  console.log(`mission orphans: ${missionOrphans[0]?.n ?? 0}`);

  // Sample old orphan rows (created date)
  const sample = await prisma.$queryRawUnsafe(`
    SELECT ve."sourceType", ve."sourceId", ve."createdAt" AS created_at
    FROM vector_embeddings ve
    LEFT JOIN brain_memories bm ON bm.id = ve."sourceId"
    WHERE ve."sourceType" = 'brain_memory'
      AND (bm.id IS NULL OR bm.deleted_at IS NOT NULL)
    ORDER BY ve."createdAt" ASC
    LIMIT 5
  `);
  if (sample.length > 0) {
    console.log("\n=== Oldest 5 brain_memory orphans ===");
    for (const r of sample) {
      console.log(
        `  ${r.source_id} · created ${new Date(r.created_at).toISOString().slice(0, 10)}`,
      );
    }
  }

  // Total bytes / row count for context
  const total = totals.reduce((s, t) => s + t._count.id, 0);
  const orphanTotal =
    Number(memOrphans[0]?.n ?? 0) +
    Number(msgOrphans[0]?.n ?? 0) +
    Number(convOrphans[0]?.n ?? 0) +
    Number(missionOrphans[0]?.n ?? 0);
  console.log(
    `\nTOTAL embeddings: ${total} · orphans: ${orphanTotal} (${total > 0 ? Math.round((orphanTotal / total) * 100) : 0}%)`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
