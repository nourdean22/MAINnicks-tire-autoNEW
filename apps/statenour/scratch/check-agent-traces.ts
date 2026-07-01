import { prisma } from "../lib/prisma";

async function main() {
  const traces = await prisma.agentTrace.findMany({
    where: {
      createdAt: {
        gte: new Date("2026-06-30T17:40:00.000Z"),
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  console.log("Agent traces since 17:40:");
  console.log(JSON.stringify(traces, null, 2));
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
