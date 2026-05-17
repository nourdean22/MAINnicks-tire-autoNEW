/**
 * scripts/cleanup-junk-wisdoms.ts · v10.0.416
 *
 * 7-day audit (v10.0.397-415 wave) found 15.3% of the wisdom corpus
 * is auto-promoted junk · the autonomous-engine + memory-consolidation
 * crons promoted nick_advice memories to wisdom without quality
 * checking content. Result: image markdown, system pulses, sycophantic
 * chat replies, even a list of "brothels and establishments" all live
 * as confidence=1 wisdoms in the recall pool.
 *
 * This script soft-deletes them in bulk. The criteria is OBJECTIVE
 * (the leading tag is a literal signature of auto-promotion) so this
 * isn't violating the operator-confirms-each rule of v10.0.406 · the
 * operator never typed `[PROMOTED TO WISDOM]` themselves.
 *
 * Two-pass · dry-run by default · pass --apply to actually deprecate.
 *
 * Run · pnpm tsx scripts/cleanup-junk-wisdoms.ts          (dry-run)
 *       pnpm tsx scripts/cleanup-junk-wisdoms.ts --apply  (deprecate)
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");

const JUNK_PREFIXES = [
  "[PROMOTED TO WISDOM]",
  "[PROVEN PATTERN]",
  "[SYSTEM PULSE",
];

interface WisdomRow { id: string; key: string; content: string; confidence: number; createdAt: Date }

async function main() {
  console.log(`=== junk-wisdom cleanup · v10.0.416 · ${APPLY ? "APPLY" : "DRY-RUN"} ===\n`);

  const all: WisdomRow[] = [];
  for (const prefix of JUNK_PREFIXES) {
    const rows = await prisma.brainMemory.findMany({
      where: {
        category: "wisdom",
        deletedAt: null,
        content: { startsWith: prefix },
      },
      select: { id: true, key: true, content: true, confidence: true, createdAt: true },
    });
    all.push(...rows);
  }

  // Also check for nick_advice_-prefixed keys (legacy auto-promotes)
  // that don't have a junk tag prefix · these are slightly noisier so
  // we report them but don't auto-deprecate · operator can sweep via
  // /brain/wisdom?evolution=1 if needed.
  const nickAdviceWithoutTag = await prisma.brainMemory.findMany({
    where: {
      category: "wisdom",
      deletedAt: null,
      key: { startsWith: "nick_advice_" },
      NOT: { OR: JUNK_PREFIXES.map((p) => ({ content: { startsWith: p } })) },
    },
    select: { id: true, key: true, content: true },
    take: 5,
  });

  console.log(`junk-tag wisdoms found:    ${all.length}`);
  console.log(`nick_advice_ keys (no tag): ${nickAdviceWithoutTag.length} (sampled, manual review)`);
  console.log();

  if (all.length === 0) {
    console.log("✓ corpus is clean · nothing to do");
    await prisma.$disconnect();
    return;
  }

  // Show sample of what we'll delete
  console.log("sample (first 5):");
  for (const r of all.slice(0, 5)) {
    console.log(`  · ${r.key.slice(0, 40)} · conf ${r.confidence}`);
    console.log(`    "${r.content.slice(0, 110)}…"`);
  }
  console.log();

  if (!APPLY) {
    console.log(`[DRY-RUN] would soft-delete ${all.length} junk wisdoms`);
    console.log("re-run with --apply to actually deprecate");
    await prisma.$disconnect();
    return;
  }

  const ids = all.map((r) => r.id);
  const result = await prisma.brainMemory.updateMany({
    where: { id: { in: ids } },
    data: { deletedAt: new Date() },
  });

  console.log(`✓ soft-deleted ${result.count} junk wisdoms`);
  console.log("  these are reversible · find them via:");
  console.log("  prisma.brainMemory.findMany({ where: { category: 'wisdom', deletedAt: { not: null } } })");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
