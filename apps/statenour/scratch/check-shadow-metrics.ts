import { prisma } from "../lib/prisma";

async function main() {
  const metrics = await prisma.systemMetric.findMany({
    where: {
      metric: { startsWith: "prompt.shadow" }
    },
    orderBy: { createdAt: "desc" },
    take: 20
  });
  console.log("Recent shadow metrics count:", metrics.length);
  console.dir(metrics, { depth: null });
}

main().catch(console.error);
