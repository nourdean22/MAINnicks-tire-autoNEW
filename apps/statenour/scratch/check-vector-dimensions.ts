import { prisma } from "../lib/prisma";

async function main() {
  const result = await prisma.$queryRawUnsafe(`
    SELECT column_name::text, data_type::text, udt_name::text
    FROM information_schema.columns
    WHERE table_name = 'vector_embeddings'
  `);
  console.log("Vector Embeddings Columns:", JSON.stringify(result, null, 2));

  const dimCheck = await prisma.$queryRawUnsafe(`
    SELECT attname::text, atttypmod
    FROM pg_attribute
    WHERE attrelid = 'vector_embeddings'::regclass
      AND attname IN ('embedding_vec', 'embedding_vec_1536')
  `);
  console.log("pg_attribute atttypmod for vector columns:", JSON.stringify(dimCheck, null, 2));
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
