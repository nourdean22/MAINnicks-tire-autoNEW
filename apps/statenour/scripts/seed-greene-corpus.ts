/**
 * Seed Greene corpus → BrainMemory · v10.0.x · 2026-05-28
 *
 * Power Atlas wave Y · operator asked "add all, merge them, make what
 * they relay more useful." This script reads the now-merged
 * `ALL_GREENE_ENTRIES` (153 entries across 6 books) from
 * `lib/brain/greene-corpus.ts` and upserts each into
 * `BrainMemory(category="greene_law")`.
 *
 * Each row carries the structured shape — triggers (observable
 * conditions) + actions (concrete moves) + relatedKeys (cross-book
 * references) — in `metadata` so the Sunday digest cron + the
 * GreeneLawSidebar can render concrete next-moves without re-deriving
 * them from prose at runtime.
 *
 * SHAPE
 *   category: BRAIN_CATEGORIES.GREENE_LAW
 *   key:      entry.key  (idempotent · upsert by (category,key))
 *   content:  "[Greene · <Book>, <Type> <N?>] <Title> · <Summary>"
 *   confidence: 1.0
 *   source:   "skill_ingestion"
 *   metadata: { book, type, number?, chapter?, title, summary, fullText,
 *               triggers[], actions[], relatedKeys[], applicabilityPrompt,
 *               version }
 *
 * Run: pnpm tsx scripts/seed-greene-corpus.ts
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  ALL_GREENE_ENTRIES,
  GREENE_CORPUS_COUNTS,
} from "@/lib/brain/greene-corpus";

const BOOK_LABELS: Record<string, string> = {
  "48LP": "48 Laws of Power",
  "33SW": "33 Strategies of War",
  "50L": "The 50th Law",
  Mastery: "Mastery",
  Seduction: "The Art of Seduction",
  HN: "Laws of Human Nature",
};

const TYPE_LABELS: Record<string, string> = {
  law: "Law",
  strategy: "Strategy",
  seducer_type: "Seducer",
  victim_type: "Victim",
  phase: "Phase",
  dark_trait: "Dark Trait",
  mentorship_role: "Mentor Role",
  principle: "Principle",
  fearless_law: "Fearless Law",
  creative_strategy: "Creative Strategy",
};

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  SEED GREENE CORPUS → BRAIN · 2026-05-28");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Loaded ${GREENE_CORPUS_COUNTS.total} entries across 6 books`);
  for (const [book, count] of Object.entries(GREENE_CORPUS_COUNTS.byBook)) {
    console.log(`    ${BOOK_LABELS[book] ?? book}: ${count}`);
  }
  console.log("");

  let inserted = 0;
  let updated = 0;

  for (const entry of ALL_GREENE_ENTRIES) {
    const bookLabel = BOOK_LABELS[entry.book] ?? entry.book;
    const typeLabel = TYPE_LABELS[entry.type] ?? entry.type;
    const numberSuffix = entry.number !== undefined ? ` ${entry.number}` : "";

    const content = `[Greene · ${bookLabel}, ${typeLabel}${numberSuffix}] ${entry.title} · ${entry.summary}`;

    const existing = await prisma.brainMemory.findFirst({
      where: { category: BRAIN_CATEGORIES.GREENE_LAW, key: entry.key },
      select: { id: true },
    });

    const metadata = {
      book: entry.book,
      type: entry.type,
      number: entry.number ?? null,
      chapter: entry.chapter ?? null,
      title: entry.title,
      summary: entry.summary,
      fullText: entry.fullText,
      triggers: entry.triggers,
      // 2026-07-27 · chat-side match surface. Null (not omitted) when the
      // entry has none, so an upsert over a previously-seeded row clears
      // a stale value instead of leaving it orphaned in metadata.
      matchPhrases: entry.matchPhrases ?? null,
      actions: entry.actions,
      relatedKeys: entry.relatedKeys,
      applicabilityPrompt: entry.applicabilityPrompt,
      ingestedAt: new Date().toISOString(),
      version: "2026-07-27-mastery-book-v",
    } as const;

    if (existing) {
      await prisma.brainMemory.update({
        where: { id: existing.id },
        data: {
          content,
          confidence: 1.0,
          lastSeen: new Date(),
          source: "skill_ingestion",
          createdBy: "user",
          metadata: metadata as never,
        },
      });
      updated++;
    } else {
      await prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.GREENE_LAW,
          key: entry.key,
          content,
          confidence: 1.0,
          source: "skill_ingestion",
          createdBy: "user",
          metadata: metadata as never,
        },
      });
      inserted++;
    }
  }

  console.log("");
  console.log(`  ✅ Inserted: ${inserted}`);
  console.log(`  🔄 Updated:  ${updated}`);
  console.log(`  Total:       ${ALL_GREENE_ENTRIES.length}`);
  console.log("");
  console.log("  Power Atlas digest cron + GreeneLawSidebar can now");
  console.log("  pull triggers + actions + relatedKeys from metadata");
  console.log("  on every render. No prose re-derivation needed.");
  console.log("");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Greene corpus seed failed:", err);
  process.exit(1);
});
