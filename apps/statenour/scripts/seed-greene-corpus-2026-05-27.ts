/**
 * 2026-05-27 · Power Atlas Phase 0 · Greene corpus seeder.
 * One-shot · run once · delete after successful run.
 *
 * Usage:
 *   set -a && . ./.env.local && set +a
 *   pnpm tsx scripts/seed-greene-corpus-2026-05-27.ts
 *
 * Verifies idempotently via upsert on (category, key).
 */
import { prisma } from "@/lib/prisma";
import { ALL_GREENE_ENTRIES } from "@/lib/brain/greene-corpus";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

(async () => {
  console.log(`Seeding ${ALL_GREENE_ENTRIES.length} Greene corpus entries...`);
  let upserted = 0;
  for (const entry of ALL_GREENE_ENTRIES) {
    await prisma.brainMemory.upsert({
      where: {
        category_key: { category: BRAIN_CATEGORIES.GREENE_LAW, key: entry.key },
      },
      create: {
        category: BRAIN_CATEGORIES.GREENE_LAW,
        key: entry.key,
        content: JSON.stringify({
          title: entry.title,
          summary: entry.summary,
          fullText: entry.fullText,
          sourceBook: entry.sourceBook,
          applicabilityPrompt: entry.applicabilityPrompt,
          number: entry.number,
          category: entry.category,
        }),
        confidence: 1.0,
        source: "greene-corpus-seed-2026-05-27",
      },
      update: {
        content: JSON.stringify({
          title: entry.title,
          summary: entry.summary,
          fullText: entry.fullText,
          sourceBook: entry.sourceBook,
          applicabilityPrompt: entry.applicabilityPrompt,
          number: entry.number,
          category: entry.category,
        }),
        confidence: 1.0,
      },
    });
    upserted++;
  }
  console.log(`Done · upserted ${upserted} entries.`);
  await prisma.$disconnect();
})();
