/**
 * seed-greene-all · one entrypoint for the entire Greene library · 2026-07-27
 *
 * Run: pnpm seed:greene          (DATABASE_URL must be set)
 *      pnpm seed:greene --check  (verify only · no writes)
 *
 * WHY THIS EXISTS
 *
 * The Greene material lives in TWO stores with different consumers, and
 * seeding it correctly took three separate commands with a silent trap
 * in the middle:
 *
 *   1. prisma/seeds/seed-all.ts          → StrategicLaw, 5 books
 *   2. prisma/seeds/seed-greene-expansion.ts → StrategicLaw, +56 rows
 *   3. scripts/seed-greene-corpus.ts     → BrainMemory(greene_law)
 *
 * `seed-all.ts` is named and documented as the "master seed runner" but
 * never imported step 2, so running it alone leaves out MASTERY 13-20,
 * the seduction archetypes, and all ten FIFTIETH_LAW rows — and still
 * prints "Seed verified OK", because its floor check is `total < 120`
 * and the other books clear 120 without the expansion. An operator
 * following the documented path got a quietly incomplete library.
 *
 * Nothing here changes what any individual seed writes. Every underlying
 * seed is an upsert keyed on (book, number) or (category, key), so this
 * is safe to re-run and safe to run over a partially-seeded database.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

import { seed48Laws } from "./48-laws";
import { seed33Strategies } from "./33-strategies";
import { seedHumanNature } from "./human-nature";
import { seedMastery, MASTERY_LAWS } from "./mastery";
import { CREATIVE_STRATEGIES } from "../../lib/brain/greene-corpus";
import { seedSeduction } from "./art-of-seduction";
import {
  seedGreeneExpansion,
  GREENE_EXPANSION_ENTRIES,
} from "./seed-greene-expansion";

/**
 * Rows the StrategicLaw table must hold once every seed has run:
 *
 *   48-laws           48
 *   33-strategies     33
 *   human-nature      18
 *   art-of-seduction  24
 *   mastery           21   (12 original + 9 Book V creative strategies)
 *   expansion         54   (MASTERY 13-20 · seduction archetypes · FIFTIETH_LAW)
 *                    ───
 *                    198
 *
 * 189 before the Book V rows — which matches the "~189-row strategicLaw
 * query" noted in finalize-system-prompt.ts, confirming the arithmetic.
 * tests/brain/greene-seed-integrity.test.ts recomputes this from the
 * exported sources so it fails loudly rather than drifting.
 */
export const EXPECTED_STRATEGIC_LAWS = 198;

async function main() {
  const checkOnly = process.argv.includes("--check");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const adapter = new PrismaNeon({ connectionString });
  const prisma = new PrismaClient({ adapter });
  let failed = false;

  try {
    if (!checkOnly) {
      console.log("\n=== 1/3 · StrategicLaw · core books ===\n");
      await seed48Laws(prisma);
      await seed33Strategies(prisma);
      await seedHumanNature(prisma);
      await seedMastery(prisma);
      await seedSeduction(prisma);

      console.log("\n=== 2/3 · StrategicLaw · expansion ===\n");
      const { errors } = await seedGreeneExpansion(prisma);
      if (errors > 0) failed = true;

      console.log("\n=== 3/3 · BrainMemory · greene_law corpus ===\n");
      // Must be an awaited CALL, not a bare `await import(...)`. A dynamic
      // import resolves when the module finishes evaluating, so importing
      // a module whose bottom line is `main().catch(...)` returns the
      // instant the seed STARTS. Verification below would then race the
      // writes and, on a fresh database, read zero and exit(1) mid-seed.
      const { seedGreeneCorpus } = await import("../../scripts/seed-greene-corpus");
      await seedGreeneCorpus();
    }

    // ── Verification ──
    console.log(`\n${"=".repeat(52)}`);
    const total = await prisma.strategicLaw.count();
    const byBook = await prisma.strategicLaw.groupBy({
      by: ["book"],
      _count: true,
    });
    console.log(`StrategicLaw rows: ${total} (expected ${EXPECTED_STRATEGIC_LAWS})`);
    for (const b of byBook) console.log(`  ${b.book}: ${b._count}`);

    const corpus = await prisma.brainMemory.count({
      where: { category: "greene_law", deletedAt: null },
    });
    console.log(`\nBrainMemory(greene_law) rows: ${corpus}`);

    // The nine Book V creative strategies must land in BOTH stores.
    const creativeLaws = MASTERY_LAWS.filter((l) => l.number >= 21).length;
    const creativeInDb = await prisma.strategicLaw.count({
      where: { book: "MASTERY", number: { gte: 21 } },
    });
    // Count the NINE EXACT keys, not `startsWith: "mastery_"` — that
    // prefix also matches the legacy phase rows (mastery_apprenticeship,
    // mastery_creative, mastery_invisible), so a stale corpus carrying
    // only those would have satisfied a prefix count while none of the
    // Book V entries existed.
    const creativeKeys = CREATIVE_STRATEGIES.map((e) => e.key);
    const creativeCorpus = await prisma.brainMemory.count({
      where: { category: "greene_law", key: { in: creativeKeys }, deletedAt: null },
    });
    console.log(
      `\nBook V creative strategies · StrategicLaw ${creativeInDb}/${creativeLaws} · corpus ${creativeCorpus}/${creativeKeys.length}`,
    );
    console.log(`${"=".repeat(52)}`);

    if (total < EXPECTED_STRATEGIC_LAWS) {
      console.error(
        `\n❌ StrategicLaw short by ${EXPECTED_STRATEGIC_LAWS - total}. ` +
          `The expansion (${GREENE_EXPANSION_ENTRIES.length} rows) is the usual culprit.`,
      );
      failed = true;
    }
    if (creativeInDb < creativeLaws) {
      console.error(
        `\n❌ Book V incomplete in StrategicLaw: ${creativeInDb}/${creativeLaws}.`,
      );
      failed = true;
    }
    if (corpus === 0) {
      console.error(`\n❌ BrainMemory greene_law corpus is empty.`);
      failed = true;
    }
    // A non-empty corpus is not the same as an UP-TO-DATE corpus: without
    // this, `--check` passed on a database holding only the pre-Book-V
    // corpus, which is exactly the state this runner exists to detect.
    if (creativeCorpus < creativeKeys.length) {
      const present = new Set(
        (
          await prisma.brainMemory.findMany({
            where: { category: "greene_law", key: { in: creativeKeys }, deletedAt: null },
            select: { key: true },
          })
        ).map((r) => r.key),
      );
      console.error(
        `\n❌ Book V incomplete in the corpus: ${creativeCorpus}/${creativeKeys.length}. ` +
          `Missing: ${creativeKeys.filter((k) => !present.has(k)).join(", ")}`,
      );
      failed = true;
    }

    if (failed) process.exit(1);
    console.log("\n✅ Greene library complete across both stores.");
    console.log(
      "   Next: the embed-backfill cron populates vectors for new corpus keys.\n",
    );
  } catch (err) {
    console.error("Seed failed:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Only self-run when invoked directly. Without this guard, merely
// importing EXPECTED_STRATEGIC_LAWS (as the integrity test does) executes
// main(), which process.exit(1)s on a missing DATABASE_URL and takes the
// importing process down with it.
if (process.argv[1]?.includes("seed-greene-all")) {
  main();
}
