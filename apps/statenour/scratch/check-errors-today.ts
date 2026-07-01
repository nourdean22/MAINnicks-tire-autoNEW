import { prisma } from "../lib/prisma";

async function main() {
  const today = new Date("2026-06-30T00:00:00.000Z");
  const errors = await prisma.errorLog.findMany({
    where: {
      createdAt: {
        gte: today,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  console.log(`Found ${errors.length} error logs for today:`);
  for (const err of errors) {
    console.log(`\n======================================================`);
    console.log(`[${err.createdAt.toISOString()}] Level: ${err.level} | Message: ${err.message}`);
    console.log(`Stack:`, err.stack);
    if (err.context) {
      console.log(`Context:`, JSON.stringify(err.context, null, 2));
    }
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
