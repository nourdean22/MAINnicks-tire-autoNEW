// audit · find low-quality wisdoms (nick_advice keys, junk content patterns)
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { prisma } from "@/lib/prisma";

async function main() {
  // 1. Wisdoms with nick_advice_ key prefix
  const nickAdviceWisdoms = await prisma.brainMemory.findMany({
    where: { category: "wisdom", deletedAt: null, key: { startsWith: "nick_advice_" } },
    select: { id: true, key: true, content: true, confidence: true, createdAt: true, lastSeen: true },
  });
  console.log(`[1] wisdoms with nick_advice_ key prefix: ${nickAdviceWisdoms.length}`);
  for (const w of nickAdviceWisdoms.slice(0, 5)) {
    console.log(`  · ${w.key} · conf ${w.confidence} · ${w.content.slice(0, 80)}…`);
  }

  // 2. Wisdoms whose content starts with [PROMOTED TO WISDOM]
  const promotedJunk = await prisma.brainMemory.findMany({
    where: {
      category: "wisdom",
      deletedAt: null,
      content: { startsWith: "[PROMOTED TO WISDOM]" },
    },
    select: { id: true, key: true, content: true, confidence: true },
    take: 100,
  });
  console.log(`\n[2] wisdoms with [PROMOTED TO WISDOM] prefix: ${promotedJunk.length}`);

  // 3. Wisdoms whose content starts with [PROVEN PATTERN]
  const provenPattern = await prisma.brainMemory.findMany({
    where: {
      category: "wisdom",
      deletedAt: null,
      content: { startsWith: "[PROVEN PATTERN]" },
    },
    select: { id: true, key: true, content: true, confidence: true },
    take: 100,
  });
  console.log(`[3] wisdoms with [PROVEN PATTERN] prefix: ${provenPattern.length}`);

  // 4. Wisdoms with content < 40 chars (too short to be wisdom)
  const tooShort = await prisma.$queryRawUnsafe<Array<{ id: string; key: string; len: number }>>(
    `SELECT id, key, length(content) AS len FROM brain_memories
     WHERE category = 'wisdom' AND deleted_at IS NULL AND length(content) < 40`,
  );
  console.log(`[4] wisdoms with content < 40 chars: ${tooShort.length}`);
  for (const r of tooShort.slice(0, 5)) console.log(`  · ${r.key} · ${r.len} chars`);

  // 5. Total wisdoms
  const total = await prisma.brainMemory.count({
    where: { category: "wisdom", deletedAt: null },
  });
  console.log(`\n[5] total active wisdoms: ${total}`);
  const junkPct = (((nickAdviceWisdoms.length + promotedJunk.length + provenPattern.length + tooShort.length) / Math.max(1, total)) * 100).toFixed(1);
  console.log(`    junk-pattern coverage: ${junkPct}% of corpus`);

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
