// audit · brain memory category distribution
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { prisma } from "@/lib/prisma";

async function main() {
  const counts = await prisma.$queryRawUnsafe<{ category: string; n: bigint }[]>(`
    SELECT category, COUNT(*)::bigint AS n FROM brain_memories
    WHERE deleted_at IS NULL
    GROUP BY category ORDER BY n DESC LIMIT 15
  `);
  console.log("top 15 active categories:");
  let total = 0n;
  for (const c of counts) {
    console.log(`  ${c.category.padEnd(32)} ${c.n.toString().padStart(6)}`);
    total += c.n;
  }
  const grand = await prisma.brainMemory.count({ where: { deletedAt: null } });
  console.log(`\nactive total: ${grand}  ·  top-15 covers: ${total} (${((Number(total) / grand) * 100).toFixed(1)}%)`);

  const deleted = await prisma.brainMemory.count({ where: { deletedAt: { not: null } } });
  console.log(`soft-deleted: ${deleted}  (operator can restore via /brain/wisdom)`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
