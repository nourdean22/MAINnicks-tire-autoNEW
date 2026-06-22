/**
 * Seed dark-psychology corpus → BrainMemory · 2026-06-20
 *
 * Mirrors scripts/seed-greene-corpus.ts exactly. Reads the structured
 * entries from lib/brain/dark-psychology-corpus.ts and upserts each into
 * BrainMemory under the appropriate category.
 *
 * Categories seeded:
 *   · dark_psychology    — cognitive biases, manipulation, social engineering
 *   · negotiation_tactic — Voss negotiation patterns
 *   · competitive_intel  — Chanakya principles
 *   · tactical_playbook  — concrete tactical patterns
 *
 * SHAPE (same as Greene seed):
 *   key:       entry.key (idempotent · upsert by (category,key))
 *   content:   "[Source · <Book>] <Title> · <Summary>"
 *   confidence: 1.0
 *   source:    "skill_ingestion"
 *   metadata:  { title, summary, fullText, triggers[], actions[],
 *               relatedKeys[], applicabilityPrompt, sourceBook, version }
 *
 * Run: pnpm tsx scripts/seed-dark-psychology-corpus.ts
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  DARK_PSYCHOLOGY_ENTRIES,
  NEGOTIATION_TACTIC_ENTRIES,
  COMPETITIVE_INTEL_ENTRIES,
  TACTICAL_PLAYBOOK_ENTRIES,
  ALL_DARK_KNOWLEDGE_ENTRIES,
  DARK_KNOWLEDGE_CORPUS_COUNTS,
  DARK_KNOWLEDGE_SOURCE_LABELS,
} from "@/lib/brain/dark-psychology-corpus";
import type { GreeneEntry } from "@/lib/brain/greene/schema";

const CATEGORY_MAP: Record<string, GreeneEntry[]> = {
  [BRAIN_CATEGORIES.DARK_PSYCHOLOGY]: DARK_PSYCHOLOGY_ENTRIES,
  [BRAIN_CATEGORIES.NEGOTIATION_TACTIC]: NEGOTIATION_TACTIC_ENTRIES,
  [BRAIN_CATEGORIES.COMPETITIVE_INTEL]: COMPETITIVE_INTEL_ENTRIES,
  [BRAIN_CATEGORIES.TACTICAL_PLAYBOOK]: TACTICAL_PLAYBOOK_ENTRIES,
};

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  SEED DARK PSYCHOLOGY CORPUS → BRAIN · 2026-06-20");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Loaded ${DARK_KNOWLEDGE_CORPUS_COUNTS.total} entries across 4 categories`);
  for (const [cat, count] of Object.entries(DARK_KNOWLEDGE_CORPUS_COUNTS.byCategory)) {
    const label = DARK_KNOWLEDGE_SOURCE_LABELS[cat] ?? cat;
    console.log(`    ${label}: ${count}`);
  }
  console.log("");

  let inserted = 0;
  let updated = 0;

  for (const [category, entries] of Object.entries(CATEGORY_MAP)) {
    const sourceLabel = DARK_KNOWLEDGE_SOURCE_LABELS[category] ?? category;

    for (const entry of entries) {
      const content = `[${sourceLabel}] ${entry.title} · ${entry.summary}`;

      const existing = await prisma.brainMemory.findFirst({
        where: { category, key: entry.key, deletedAt: null },
        select: { id: true },
      });

      const metadata = {
        title: entry.title,
        summary: entry.summary,
        fullText: entry.fullText,
        triggers: entry.triggers,
        actions: entry.actions,
        relatedKeys: entry.relatedKeys,
        applicabilityPrompt: entry.applicabilityPrompt,
        sourceBook: sourceLabel,
        ingestedAt: new Date().toISOString(),
        version: "2026-06-20-dark-psychology",
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
            category,
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
  }

  console.log("");
  console.log(`  ✅ Inserted: ${inserted}`);
  console.log(`  🔄 Updated:  ${updated}`);
  console.log(`  Total:       ${ALL_DARK_KNOWLEDGE_ENTRIES.length}`);
  console.log("");
  console.log("  Dark-psychology-matcher + reasoning engine can now");
  console.log("  pull triggers + actions from metadata on every match.");
  console.log("");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Dark psychology corpus seed failed:", err);
  process.exit(1);
});
