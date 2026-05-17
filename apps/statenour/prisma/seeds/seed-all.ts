/**
 * Master seed runner — imports and executes all Greene book seeds.
 * Run: DATABASE_URL="..." npx tsx prisma/seeds/seed-all.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { seed48Laws } from "./48-laws";
import { seed33Strategies } from "./33-strategies";
import { seedHumanNature } from "./human-nature";
import { seedMastery } from "./mastery";
import { seedSeduction } from "./art-of-seduction";

async function main() {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    console.log("Starting Greene Strategic Intelligence seed...\n");

    await seed48Laws(prisma);
    await seed33Strategies(prisma);
    await seedHumanNature(prisma);
    await seedMastery(prisma);
    await seedSeduction(prisma);

    // Verify counts
    const total = await prisma.strategicLaw.count();
    const byBook = await prisma.strategicLaw.groupBy({
      by: ["book"],
      _count: true,
    });

    console.log(`\n${"=".repeat(50)}`);
    console.log(`Total laws seeded: ${total}`);
    console.log("By book:");
    for (const b of byBook) {
      console.log(`  ${b.book}: ${b._count}`);
    }
    console.log(`${"=".repeat(50)}`);

    if (total < 120) {
      console.error(`\nWARNING: Seed incomplete — need 120+, got ${total}`);
      process.exit(1);
    } else {
      console.log("\nSeed verified OK");
    }
  } catch (err) {
    console.error("Seed failed:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
