import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const count = await prisma.vectorEmbedding.count({
    where: { sourceType: "skill" },
  });
  console.log(`skill embeddings in DB: ${count}`);
  const sample = await prisma.vectorEmbedding.findFirst({
    where: { sourceType: "skill" },
    select: { sourceId: true, embedding_dim: true, createdAt: true },
  });
  console.log("sample:", sample);
  await prisma.$disconnect();
}
main();
