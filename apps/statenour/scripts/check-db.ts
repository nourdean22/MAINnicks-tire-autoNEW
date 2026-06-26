import { prisma } from "../lib/prisma";
async function main() {
  const result = await prisma.$queryRaw`
    SELECT column_name, data_type, udt_name 
    FROM information_schema.columns 
    WHERE table_name = 'vector_embeddings' AND column_name LIKE 'embedding_vec%';
  `;
  console.log(result);
}
main();
