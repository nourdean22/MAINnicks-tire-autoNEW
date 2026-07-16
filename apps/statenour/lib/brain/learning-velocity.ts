/**
 * Learning Velocity Dashboard
 *
 * Tracks how fast the brain is getting smarter:
 * - Memories created per week (growth rate)
 * - Wisdom promotions (knowledge maturity)
 * - Prediction accuracy trend (calibration)
 * - New causal chains discovered (depth)
 * - Contradiction resolution rate (self-correction)
 * - Cross-pollination connections (integration)
 *
 * Produces: "The brain is 40% smarter than 30 days ago"
 */

import { prisma } from "@/lib/prisma";
import { daysAgo } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export interface LearningVelocity {
  period: string;
  memoriesCreated: { thisWeek: number; lastWeek: number; delta: number };
  wisdomPromotions: { total: number; recent: number };
  predictionAccuracy: { confirmed: number; disproven: number; rate: number; trend: string };
  causalChains: { total: number; new: number };
  contradictions: { resolved: number; unresolved: number; resolutionRate: number };
  connections: { total: number; new: number };
  overallGrowth: number; // percentage smarter vs 30 days ago
  healthScore: number; // 0-100
}

/**
 * Calculate learning velocity metrics.
 */
export async function measureLearningVelocity(): Promise<LearningVelocity> {
  const sevenDaysAgo = daysAgo(7);
  const fourteenDaysAgo = daysAgo(14);
  const thirtyDaysAgo = daysAgo(30);

  const [
    memoriesThisWeek,
    memoriesLastWeek,
    totalWisdom,
    recentWisdom,
    confirmedPredictions,
    disprovenPredictions,
    olderConfirmed,
    olderDisproven,
    totalChains,
    newChains,
    resolvedContradictions,
    unresolvedContradictions,
    totalEdges,
    newEdges,
    totalMemories,
    avgConfidence,
    oldAvgConfidence,
  ] = await Promise.all([
    prisma.brainMemory.count({ where: { deletedAt: null, createdAt: { gte: sevenDaysAgo } } }),
    prisma.brainMemory.count({
      where: { deletedAt: null, createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
    }),
    prisma.brainMemory.count({ where: { deletedAt: null, category: BRAIN_CATEGORIES.WISDOM } }),
    prisma.brainMemory.count({
      where: { deletedAt: null, category: BRAIN_CATEGORIES.WISDOM, createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.prediction.count({ where: { status: "confirmed" } }),
    prisma.prediction.count({ where: { status: "disproven" } }),
    prisma.prediction.count({
      where: { status: "confirmed", createdAt: { lt: thirtyDaysAgo } },
    }),
    prisma.prediction.count({
      where: { status: "disproven", createdAt: { lt: thirtyDaysAgo } },
    }),
    prisma.causalChain.count(),
    prisma.causalChain.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.contradiction.count({ where: { resolved: true } }),
    prisma.contradiction.count({ where: { resolved: false } }),
    prisma.memoryEdge.count(),
    prisma.memoryEdge.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.brainMemory.count({ where: { deletedAt: null } }),
    prisma.brainMemory.aggregate({ where: { deletedAt: null }, _avg: { confidence: true } }),
    // Estimate old avg confidence from memories created before 30d.
    // Filtered as a PAIR with the current avg above (both live-rows-only):
    // the pruner soft-deletes low-confidence rows, so filtering only one
    // side of confidenceDelta would manufacture a fake trend signal.
    prisma.brainMemory.aggregate({
      _avg: { confidence: true },
      where: { deletedAt: null, createdAt: { lt: thirtyDaysAgo } },
    }),
  ]);

  // Prediction accuracy
  const totalPredictions = confirmedPredictions + disprovenPredictions;
  const predictionRate = totalPredictions > 0 ? confirmedPredictions / totalPredictions : 0;

  const olderTotal = olderConfirmed + olderDisproven;
  const olderRate = olderTotal > 0 ? olderConfirmed / olderTotal : 0;
  const predictionTrend =
    totalPredictions < 3
      ? "insufficient data"
      : predictionRate > olderRate + 0.05
        ? "improving"
        : predictionRate < olderRate - 0.05
          ? "declining"
          : "stable";

  // Contradiction resolution
  const totalContradictions = resolvedContradictions + unresolvedContradictions;
  const resolutionRate =
    totalContradictions > 0
      ? resolvedContradictions / totalContradictions
      : 1;

  // Overall growth score (composite)
  const memoryGrowth = memoriesThisWeek > memoriesLastWeek ? 1.2 : memoriesThisWeek === memoriesLastWeek ? 1.0 : 0.8;
  const wisdomRatio = totalMemories > 0 ? totalWisdom / totalMemories : 0;
  const confidenceDelta = (avgConfidence._avg.confidence ?? 0.5) - (oldAvgConfidence._avg.confidence ?? 0.5);

  const growthScore = (
    (memoryGrowth - 1) * 30 + // memory growth contribution
    wisdomRatio * 20 + // wisdom density contribution
    predictionRate * 25 + // prediction accuracy contribution
    resolutionRate * 15 + // self-correction contribution
    Math.max(0, confidenceDelta * 50) // confidence improvement contribution
  );

  // Health score (0-100)
  const healthFactors = [
    totalMemories > 20 ? 20 : totalMemories, // has memories
    totalWisdom > 0 ? 15 : 0, // has wisdom
    predictionRate > 0.5 ? 15 : predictionRate > 0.3 ? 10 : 5, // predictions work
    resolutionRate > 0.5 ? 15 : 5, // resolving contradictions
    totalEdges > 10 ? 15 : totalEdges, // connected knowledge
    memoriesThisWeek > 0 ? 10 : 0, // actively growing
    recentWisdom > 0 ? 10 : 0, // promoting wisdom
  ];
  const healthScore = Math.min(100, healthFactors.reduce((s, v) => s + v, 0));

  const velocity: LearningVelocity = {
    period: `${daysAgo(7).toISOString().slice(0, 10)} to ${new Date().toISOString().slice(0, 10)}`,
    memoriesCreated: {
      thisWeek: memoriesThisWeek,
      lastWeek: memoriesLastWeek,
      delta: memoriesThisWeek - memoriesLastWeek,
    },
    wisdomPromotions: { total: totalWisdom, recent: recentWisdom },
    predictionAccuracy: {
      confirmed: confirmedPredictions,
      disproven: disprovenPredictions,
      rate: predictionRate,
      trend: predictionTrend,
    },
    causalChains: { total: totalChains, new: newChains },
    contradictions: {
      resolved: resolvedContradictions,
      unresolved: unresolvedContradictions,
      resolutionRate,
    },
    connections: { total: totalEdges, new: newEdges },
    overallGrowth: Math.round(growthScore),
    healthScore,
  };

  // Store as brain memory
  await prisma.brainMemory.upsert({
    where: {
      category_key: {
        category: BRAIN_CATEGORIES.LEARNING_VELOCITY,
        key: `velocity_${new Date().toISOString().slice(0, 10)}`,
      },
    },
    create: {
      category: BRAIN_CATEGORIES.LEARNING_VELOCITY,
      key: `velocity_${new Date().toISOString().slice(0, 10)}`,
      content: `Brain health: ${healthScore}/100 | Growth: ${growthScore > 0 ? "+" : ""}${growthScore.toFixed(0)}% | Memories: ${memoriesThisWeek}/wk (${memoriesThisWeek > memoriesLastWeek ? "↑" : memoriesThisWeek < memoriesLastWeek ? "↓" : "→"}) | Wisdom: ${totalWisdom} | Predictions: ${(predictionRate * 100).toFixed(0)}% accurate (${predictionTrend}) | Chains: ${totalChains}`,
      confidence: 0.9,
      source: "learning_velocity",
    },
    update: {
      content: `Brain health: ${healthScore}/100 | Growth: ${growthScore > 0 ? "+" : ""}${growthScore.toFixed(0)}% | Memories: ${memoriesThisWeek}/wk (${memoriesThisWeek > memoriesLastWeek ? "↑" : memoriesThisWeek < memoriesLastWeek ? "↓" : "→"}) | Wisdom: ${totalWisdom} | Predictions: ${(predictionRate * 100).toFixed(0)}% accurate (${predictionTrend}) | Chains: ${totalChains}`,
      confidence: 0.9,
    },
  }).catch(() => {});

  return velocity;
}

/**
 * Get learning velocity for system prompt.
 */
export async function getLearningVelocityContext(): Promise<string> {
  const vel = await prisma.brainMemory
    .findFirst({
      where: { category: BRAIN_CATEGORIES.LEARNING_VELOCITY },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    })
    .catch(() => null);

  if (!vel) return "";

  return `\n## Brain Learning Velocity\n${vel.content}`;
}
