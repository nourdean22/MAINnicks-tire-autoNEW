import { prisma } from "../lib/prisma";

async function main() {
  const changes = await prisma.schemaChangeLedger.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  console.log("=== SCHEMA CHANGE LEDGER ===");
  for (const c of changes) {
    console.log(`[${c.createdAt.toISOString()}] Key: ${c.changeKey} | Title: ${c.title} | Status: ${c.status}`);
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
