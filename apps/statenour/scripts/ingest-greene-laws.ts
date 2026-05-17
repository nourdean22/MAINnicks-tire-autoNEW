/**
 * Ingest Greene's Laws → BrainMemory · v10.0.382
 *
 * 189 laws already live in the StrategicLaw table · they're searchable
 * via the searchGreeneLaws chat tool + cross-source semantic pull. But
 * they're NOT in BrainMemory · so the wisdom-slot guarantee (top 3
 * wisdom per chat turn · v10.0.354 source-trust 1.5x · v10.0.367 CoALA
 * procedural-kind boost) doesn't apply to them.
 *
 * This script promotes every StrategicLaw row into a wisdom-category
 * BrainMemory entry · same shape as the v10.0.353 Steve Jobs/Satori
 * ingestion + the v10.0.365 Buffett/Gates/Musk persona pack.
 *
 * INGESTION SHAPE
 *   category: "wisdom"
 *   key:      "wisdom_greene_<book>_<number>"     (idempotent · upsert)
 *   content:  "[Greene · {book}, Law/Strategy N] {title} ·
 *              {essence} · Apply: {nourApplication}"
 *   confidence: 1.0  (operator-curated · maximum trust)
 *   source:   "skill_ingestion"
 *   metadata: { origin: "greene-laws", book, number }
 *
 * The /brain/wisdom dashboard will auto-render a new "greene-laws"
 * origin section once these are in place.
 *
 * Run: pnpm tsx scripts/ingest-greene-laws.ts
 */

import { prisma } from "@/lib/prisma";

const BOOK_LABELS: Record<string, string> = {
  FORTY_EIGHT_LAWS: "48 Laws of Power",
  FIFTIETH_LAW: "The 50th Law",
  HUMAN_NATURE: "Laws of Human Nature",
  ART_OF_SEDUCTION: "Art of Seduction",
  MASTERY: "Mastery",
  THIRTY_THREE_STRATEGIES: "33 Strategies of War",
};

const BOOK_KEY_FRAGMENT: Record<string, string> = {
  FORTY_EIGHT_LAWS: "48laws",
  FIFTIETH_LAW: "50th",
  HUMAN_NATURE: "human_nature",
  ART_OF_SEDUCTION: "seduction",
  MASTERY: "mastery",
  THIRTY_THREE_STRATEGIES: "33strategies",
};

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  INGEST GREENE LAWS → BRAIN · v10.0.382");
  console.log("═══════════════════════════════════════════════════════════");

  const laws = await prisma.strategicLaw.findMany({
    select: {
      id: true,
      book: true,
      number: true,
      title: true,
      shortTitle: true,
      essence: true,
      shopApplication: true,
      nourApplication: true,
    },
    orderBy: [{ book: "asc" }, { number: "asc" }],
  });

  console.log(`  Loaded ${laws.length} StrategicLaw rows`);

  let inserted = 0;
  let updated = 0;

  for (const law of laws) {
    const bookLabel = BOOK_LABELS[law.book] ?? law.book;
    const bookKey = BOOK_KEY_FRAGMENT[law.book] ?? law.book.toLowerCase();
    const key = `wisdom_greene_${bookKey}_${law.number}`;

    // Build the wisdom content · structured + dense · capped under
    // the 800-char gate (v10.0.356) so it lands in wisdom not
    // wisdom_candidate. Trim aggressively to stay sharp.
    const essence = law.essence.replace(/\s+/g, " ").trim().slice(0, 280);
    const application =
      (law.nourApplication || law.shopApplication)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 280);
    const content = `[Greene · ${bookLabel}, ${law.book === "THIRTY_THREE_STRATEGIES" ? "Strategy" : "Law"} ${law.number}] ${law.shortTitle || law.title} · ${essence}${application ? ` · Apply: ${application}` : ""}`;

    const existing = await prisma.brainMemory.findFirst({
      where: { key },
      select: { id: true },
    });

    if (existing) {
      await prisma.brainMemory.update({
        where: { id: existing.id },
        data: {
          content,
          confidence: 1.0,
          lastSeen: new Date(),
          source: "skill_ingestion",
          createdBy: "user",
          metadata: {
            origin: "greene-laws",
            book: law.book,
            number: law.number,
            sourceLawId: law.id,
            ingestedAt: new Date().toISOString(),
            version: "v10.0.382",
          },
        },
      });
      updated++;
    } else {
      await prisma.brainMemory.create({
        data: {
          category: "wisdom",
          key,
          content,
          confidence: 1.0,
          source: "skill_ingestion",
          createdBy: "user",
          metadata: {
            origin: "greene-laws",
            book: law.book,
            number: law.number,
            sourceLawId: law.id,
            ingestedAt: new Date().toISOString(),
            version: "v10.0.382",
          },
        },
      });
      inserted++;
    }
  }

  // Per-book summary
  const byBook = laws.reduce<Record<string, number>>((acc, l) => {
    acc[l.book] = (acc[l.book] ?? 0) + 1;
    return acc;
  }, {});
  console.log("");
  console.log("  By book:");
  for (const [book, count] of Object.entries(byBook).sort()) {
    console.log(`    ${BOOK_LABELS[book] ?? book}: ${count}`);
  }

  console.log("");
  console.log(`  ✅ Inserted: ${inserted}`);
  console.log(`  🔄 Updated:  ${updated}`);
  console.log(`  Total:       ${laws.length}`);
  console.log("");
  console.log("  Brain wisdom layer now spans:");
  console.log("    · Steve Jobs (12)");
  console.log("    · Satori (10)");
  console.log("    · Buffett + Gates + Musk (30)");
  console.log(`    · Greene (${laws.length})`);
  console.log("    + cron-distilled / consolidated / scrape entries");
  console.log("");
  console.log("  /brain/wisdom dashboard will auto-render the new");
  console.log("  'greene-laws' origin section on next page load.");
  console.log("");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Greene ingestion failed:", err);
  process.exit(1);
});
