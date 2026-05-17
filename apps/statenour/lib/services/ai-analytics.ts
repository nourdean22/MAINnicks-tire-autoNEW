import { prisma } from "@/lib/prisma";
import { daysAgo, toDateString } from "@/lib/utils/datetime";

/** Get daily AI costs for the last N days */
export async function getDailyCosts(days: number = 30) {
  const since = daysAgo(days);

  const generations = await prisma.aiGeneration.findMany({
    where: { createdAt: { gte: since } },
    select: { costCents: true, createdAt: true },
  });

  // Group by date
  const byDate: Record<string, number> = {};
  for (const g of generations) {
    const date = toDateString(g.createdAt);
    byDate[date] = (byDate[date] ?? 0) + (g.costCents ?? 0);
  }

  return Object.entries(byDate)
    .map(([date, costCents]) => ({ date, costCents }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Get costs broken down by feature */
export async function getCostsByFeature(days: number = 30) {
  const since = daysAgo(days);

  const results = await prisma.aiGeneration.groupBy({
    by: ["feature"],
    where: { createdAt: { gte: since } },
    _sum: { costCents: true, promptTokens: true, outputTokens: true },
    _count: { id: true },
    orderBy: { _sum: { costCents: "desc" } },
  });

  return results.map((r) => ({
    feature: r.feature,
    costCents: r._sum.costCents ?? 0,
    count: r._count.id,
    tokens: {
      prompt: r._sum.promptTokens ?? 0,
      output: r._sum.outputTokens ?? 0,
    },
  }));
}

/** Get costs broken down by model */
export async function getCostsByModel(days: number = 30) {
  const since = daysAgo(days);

  const results = await prisma.aiGeneration.groupBy({
    by: ["model"],
    where: { createdAt: { gte: since } },
    _sum: { costCents: true, promptTokens: true, outputTokens: true },
    _count: { id: true },
    orderBy: { _sum: { costCents: "desc" } },
  });

  return results.map((r) => ({
    model: r.model,
    costCents: r._sum.costCents ?? 0,
    count: r._count.id,
    tokens: {
      prompt: r._sum.promptTokens ?? 0,
      output: r._sum.outputTokens ?? 0,
    },
  }));
}

/** Get token usage trends over time */
export async function getTokenUsage(days: number = 30) {
  const since = daysAgo(days);

  const generations = await prisma.aiGeneration.findMany({
    where: { createdAt: { gte: since } },
    select: { promptTokens: true, outputTokens: true, createdAt: true },
  });

  const byDate: Record<string, { prompt: number; output: number }> = {};
  for (const g of generations) {
    const date = toDateString(g.createdAt);
    if (!byDate[date]) byDate[date] = { prompt: 0, output: 0 };
    byDate[date].prompt += g.promptTokens ?? 0;
    byDate[date].output += g.outputTokens ?? 0;
  }

  return Object.entries(byDate)
    .map(([date, tokens]) => ({ date, ...tokens }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
