import { prisma } from "../lib/prisma";
// Cast `name`-typed columns to text — Prisma 6 + the v7 Neon adapter rejects
// the native pg `name` type via $queryRawUnsafe.
async function main() {
  const cols = await prisma.$queryRawUnsafe<{column_name: string; data_type: string}[]>(`SELECT column_name::text AS column_name, data_type::text AS data_type FROM information_schema.columns WHERE table_name = 'vector_embeddings' ORDER BY ordinal_position`);
  console.log("vector_embeddings columns:");
  for (const c of cols) console.log(`  · ${c.column_name} (${c.data_type})`);
  const cm = await prisma.$queryRawUnsafe<{column_name: string}[]>(`SELECT column_name::text AS column_name FROM information_schema.columns WHERE table_name = 'chat_messages' AND column_name = 'searchable_tsv'`);
  console.log("\nchat_messages.searchable_tsv exists:", cm.length > 0);
  const idx = await prisma.$queryRawUnsafe<{indexname: string; indexdef: string}[]>(`SELECT indexname::text AS indexname, indexdef::text AS indexdef FROM pg_indexes WHERE tablename = 'vector_embeddings'`);
  console.log("\nvector_embeddings indexes:");
  for (const i of idx) console.log(`  · ${i.indexname}`);

  // Embedding survival check — does `embedding` text column still
  // hold the JSON array? If yes, we can recover; if no, regenerate.
  const survival = await prisma.$queryRawUnsafe<{total: bigint; with_emb: bigint; sample_len: number | null}[]>(`
    SELECT COUNT(*)::bigint AS total,
           COUNT(NULLIF(embedding, ''))::bigint AS with_emb,
           length(MIN(embedding))::int AS sample_len
    FROM vector_embeddings
  `);
  console.log("\nembedding column survival:");
  for (const s of survival) console.log(`  · total=${s.total} with_emb=${s.with_emb} sample_len=${s.sample_len}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
