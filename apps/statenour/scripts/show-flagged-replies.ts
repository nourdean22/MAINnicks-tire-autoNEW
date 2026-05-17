// One-shot script · prints the 10 reply_to_improve rows so the
// operator can actually see what self-critique flagged tonight.
// No new endpoint, no UI scaffolding — just fetch + log.
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

async function main() {
  const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });
  try {
    const flagged = await prisma.brainMemory.findMany({
      where: { category: "reply_to_improve", deletedAt: null },
      orderBy: { confidence: "desc" }, // higher confidence = more critical
      take: 10,
    });

    console.log(`\n=== ${flagged.length} replies flagged for improvement ===\n`);
    for (let i = 0; i < flagged.length; i++) {
      const r = flagged[i];
      const meta = r.metadata as
        | {
            messageId?: string;
            score?: { specificity: number; cliche: number; antiNour: number; length: number; composite: number };
            conversationId?: string;
          }
        | null;
      const score = meta?.score;
      const tag = `[${i + 1}] composite=${score?.composite ?? "?"}/100`;
      console.log(tag);
      if (score) {
        console.log(
          `  axes: specificity=${score.specificity} cliche=${score.cliche} antiNour=${score.antiNour} length=${score.length}`,
        );
      }
      console.log(`  msgId: ${meta?.messageId ?? "?"}`);
      console.log(`  ${r.content.replace(/Reply scored \d+\/100.*Preview: /, "").slice(0, 280)}`);
      console.log();
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
