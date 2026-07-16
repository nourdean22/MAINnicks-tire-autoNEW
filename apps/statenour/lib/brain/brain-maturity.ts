/**
 * Brain Maturity Score — How developed is each knowledge domain?
 *
 * Measures the DEPTH of Nick's understanding in each domain:
 * - Memory count + average confidence
 * - Wisdom distilled (permanent principles)
 * - Prediction accuracy in this domain
 * - Correlation discoveries
 * - Time span of data (how long has Nick been learning?)
 *
 * Enhanced with:
 * - Velocity per category (memories/week growth rate)
 * - Trajectory prediction (where will each domain be in 30 days?)
 * - Growth rate classification (surging/growing/stable/declining)
 * - Data freshness (% of memories updated in last 7 days)
 * - Depth vs breadth analysis (few deep categories vs many shallow)
 * - Maturity progression history (was this domain better/worse before?)
 * - Recommended actions per domain to accelerate growth
 */

import { prisma } from "@/lib/prisma";
import { daysAgo } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { countLiveBrainMemoryEmbeddings } from "@/lib/brain/embedding-utils";

interface DomainMaturity {
  domain: string;
  score: number; // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
  memoriesCount: number;
  avgConfidence: number;
  wisdomCount: number;
  predictionsScored: number;
  predictionAccuracy: number;
  dataSpanDays: number;
  // Enhanced
  velocity: number; // memories created per week (recent)
  growthRate: "surging" | "growing" | "stable" | "declining" | "new";
  freshness: number; // % of memories touched in last 7d
  trajectory30d: number; // predicted score in 30 days
  recommendedAction: string;
}

export interface BrainMaturityReport {
  overallScore: number;
  overallGrade: string;
  domains: DomainMaturity[];
  strongestDomain: string;
  weakestDomain: string;
  suggestion: string;
  // Enhanced
  overallVelocity: number; // total memories/week
  overallGrowthRate: "surging" | "growing" | "stable" | "declining";
  depthVsBreadth: "deep_focused" | "broad_shallow" | "balanced";
  totalMemories: number;
  totalEmbeddings: number;
  embeddingCoverage: number;
  topGrowingDomain: string;
  topDecliningDomain: string;
}

const BRAIN_DOMAINS = [
  "pattern", "insight", "wisdom", "preference", "routine",
  "anomaly", "counter_intuitive", "prediction_lesson", "blind_spot",
  "hidden_correlation", "learning_journal", "visual_input", "voice_note",
  "teaching_moment", "revenue_aging", "seasonal_intelligence",
  "customer_ltv", "staff_efficiency", "competitive_intel",
  "chatgpt_conversation", "chatgpt_decision", "chatgpt_preference",
  "quote_optimization", "decision_log", "coding_preference", "architecture",
];

function grade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  if (score >= 30) return "D";
  return "F";
}

/**
 * Calculate maturity score for each knowledge domain.
 */
export async function getBrainMaturity(): Promise<BrainMaturityReport> {
  const sevenDaysAgo = daysAgo(7);
  const fourteenDaysAgo = daysAgo(14);

  const [memories, memoriesRecent, memoriesPrevWeek, wisdom, predictions, embeddings, oldestMemory] = await Promise.all([
    prisma.brainMemory.groupBy({
      by: ["category"],
      where: { deletedAt: null },
      _count: { id: true },
      _avg: { confidence: true },
      _min: { createdAt: true },
    }),
    prisma.brainMemory.groupBy({
      by: ["category"],
      where: { deletedAt: null, createdAt: { gte: sevenDaysAgo } },
      _count: { id: true },
    }),
    prisma.brainMemory.groupBy({
      by: ["category"],
      where: { deletedAt: null, createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
      _count: { id: true },
    }),
    prisma.brainMemory.count({ where: { deletedAt: null, category: BRAIN_CATEGORIES.WISDOM } }),
    prisma.prediction.findMany({
      where: { status: { in: ["confirmed", "disproven"] } },
      select: { category: true, status: true },
    }),
    // Live-sourced embeddings only — the memory counts above are all
    // deletedAt-filtered (#773), so an unjoined embedding count here would
    // push coverage past 100% as backfill proceeds (orphaned embeddings of
    // pruned memories were 67% of the table on prod, 2026-07-16).
    countLiveBrainMemoryEmbeddings(),
    prisma.brainMemory.findFirst({
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }).catch(() => null),
  ]);

  const memoryMap = new Map(
    memories.map(m => [m.category, { count: m._count.id, avgConf: m._avg.confidence ?? 0, oldest: m._min.createdAt }])
  );
  const recentMap = new Map(memoriesRecent.map(m => [m.category, m._count.id]));
  const prevWeekMap = new Map(memoriesPrevWeek.map(m => [m.category, m._count.id]));

  // Prediction accuracy by category
  const predByCategory: Record<string, { total: number; correct: number }> = {};
  for (const p of predictions) {
    if (!predByCategory[p.category]) predByCategory[p.category] = { total: 0, correct: 0 };
    predByCategory[p.category].total++;
    if (p.status === "confirmed") predByCategory[p.category].correct++;
  }

  const totalMemories = memories.reduce((s, m) => s + m._count.id, 0);
  const totalRecentMemories = memoriesRecent.reduce((s, m) => s + m._count.id, 0);
  const totalPrevWeekMemories = memoriesPrevWeek.reduce((s, m) => s + m._count.id, 0);

  const domains: DomainMaturity[] = BRAIN_DOMAINS.map(domain => {
    const mem = memoryMap.get(domain) ?? { count: 0, avgConf: 0, oldest: null };
    const pred = predByCategory[domain] ?? { total: 0, correct: 0 };
    const recentCount = recentMap.get(domain) ?? 0;
    const prevWeekCount = prevWeekMap.get(domain) ?? 0;

    // Score components (each 0-25, total 0-100)
    const memoryScore = Math.min(25, mem.count * 2.5);
    const confidenceScore = Math.min(25, mem.avgConf * 25);
    const wisdomScore = domain === "wisdom" ? 25 : Math.min(25, (mem.count > 5 ? 15 : 0));
    const predictionScore = pred.total > 0 ? Math.min(25, (pred.correct / pred.total) * 25) : 10;

    const score = Math.round(memoryScore + confidenceScore + wisdomScore + predictionScore);

    // Data span
    const dataSpanDays = mem.oldest
      ? Math.round((Date.now() - new Date(mem.oldest).getTime()) / 86400000)
      : 0;

    // Velocity: memories created this week
    const velocity = recentCount;

    // Growth rate: compare this week vs last week
    let growthRate: DomainMaturity["growthRate"];
    if (mem.count <= 3) growthRate = "new";
    else if (recentCount > prevWeekCount * 1.5 && recentCount >= 3) growthRate = "surging";
    else if (recentCount > prevWeekCount) growthRate = "growing";
    else if (recentCount === prevWeekCount) growthRate = "stable";
    else growthRate = "declining";

    // Freshness: % of memories created/updated in last 7 days
    const freshness = mem.count > 0 ? Math.round((recentCount / mem.count) * 100) : 0;

    // Trajectory: project score 30 days out based on velocity trend
    const weeklyGrowthPoints = recentCount > prevWeekCount ? (recentCount - prevWeekCount) * 2 : -(prevWeekCount - recentCount);
    const trajectory30d = Math.max(0, Math.min(100, score + weeklyGrowthPoints * 4));

    // Recommended action
    let recommendedAction: string;
    if (growthRate === "new") recommendedAction = `Start building ${domain} knowledge. Discuss this topic with Nick.`;
    else if (growthRate === "declining") recommendedAction = `${domain} is declining. Re-engage: ask Nick about ${domain} trends.`;
    else if (score < 30) recommendedAction = `${domain} is shallow. Need more data points — log more, discuss more.`;
    else if (freshness < 10) recommendedAction = `${domain} data is stale (${freshness}% fresh). Need new inputs.`;
    else recommendedAction = `${domain} is healthy. Keep the momentum.`;

    return {
      domain,
      score,
      grade: grade(score),
      memoriesCount: mem.count,
      avgConfidence: Math.round(mem.avgConf * 100) / 100,
      wisdomCount: domain === "wisdom" ? mem.count : 0,
      predictionsScored: pred.total,
      predictionAccuracy: pred.total > 0 ? Math.round((pred.correct / pred.total) * 100) : 0,
      dataSpanDays,
      velocity,
      growthRate,
      freshness,
      trajectory30d,
      recommendedAction,
    };
  });

  domains.sort((a, b) => b.score - a.score);
  const activeDomains = domains.filter(d => d.memoriesCount > 0);

  const overallScore = activeDomains.length > 0
    ? Math.round(activeDomains.reduce((s, d) => s + d.score, 0) / activeDomains.length)
    : 0;

  const strongest = activeDomains[0]?.domain ?? "none";
  const weakest = activeDomains.length > 0 ? activeDomains[activeDomains.length - 1]?.domain ?? "none" : "none";

  // Overall velocity
  const overallVelocity = totalRecentMemories;
  let overallGrowthRate: BrainMaturityReport["overallGrowthRate"];
  if (totalRecentMemories > totalPrevWeekMemories * 1.3) overallGrowthRate = "surging";
  else if (totalRecentMemories > totalPrevWeekMemories * 0.9) overallGrowthRate = "growing";
  else if (totalRecentMemories > totalPrevWeekMemories * 0.5) overallGrowthRate = "stable";
  else overallGrowthRate = "declining";

  // Depth vs breadth
  const domainsWithData = activeDomains.length;
  const avgPerDomain = domainsWithData > 0 ? totalMemories / domainsWithData : 0;
  let depthVsBreadth: BrainMaturityReport["depthVsBreadth"];
  if (domainsWithData <= 5 && avgPerDomain > 20) depthVsBreadth = "deep_focused";
  else if (domainsWithData >= 15 && avgPerDomain < 10) depthVsBreadth = "broad_shallow";
  else depthVsBreadth = "balanced";

  // Top growing / declining
  const growing = activeDomains.filter(d => d.growthRate === "surging" || d.growthRate === "growing");
  const declining = activeDomains.filter(d => d.growthRate === "declining");
  const topGrowingDomain = growing.sort((a, b) => b.velocity - a.velocity)[0]?.domain ?? "none";
  const topDecliningDomain = declining.sort((a, b) => a.velocity - b.velocity)[0]?.domain ?? "none";

  const embeddingCoverage = totalMemories > 0 ? Math.round((embeddings / totalMemories) * 100) : 0;

  let suggestion = "";
  if (overallScore < 30) suggestion = "Brain is still young. Keep feeding it data — log scores, use Nick chat, let crons run.";
  else if (overallScore < 60) suggestion = `Growing well. Weakest: ${weakest}. Focus conversations there. ${overallGrowthRate === "declining" ? "⚠️ Overall learning is slowing." : ""}`;
  else suggestion = `Brain is maturing (${overallScore}/100). ${embeddingCoverage}% embedding coverage. Focus on prediction accuracy to sharpen intelligence.`;

  if (depthVsBreadth === "broad_shallow") suggestion += " Warning: broad but shallow — go deeper in key domains.";
  if (topDecliningDomain !== "none") suggestion += ` ${topDecliningDomain} is declining — re-engage.`;

  return {
    overallScore,
    overallGrade: grade(overallScore),
    domains: activeDomains,
    strongestDomain: strongest,
    weakestDomain: weakest,
    suggestion,
    overallVelocity,
    overallGrowthRate,
    depthVsBreadth,
    totalMemories,
    totalEmbeddings: embeddings,
    embeddingCoverage,
    topGrowingDomain,
    topDecliningDomain,
  };
}

/**
 * Get brain maturity context for system prompt.
 * Cached for 10 minutes — maturity doesn't change per-message.
 */
export async function getBrainMaturityContext(): Promise<string> {
  const { cached } = await import("@/lib/utils/cache");

  return cached("brain_maturity_context", 600, async () => {
    try {
      const report = await getBrainMaturity();
      if (report.domains.length === 0) return "";

      const domainGrades = report.domains
        .slice(0, 6)
        .map(d => `${d.domain}:${d.grade}(${d.velocity > 0 ? "↑" : d.growthRate === "declining" ? "↓" : "→"})`)
        .join(", ");

      return [
        `── BRAIN MATURITY: ${report.overallGrade} (${report.overallScore}/100) | ${report.overallGrowthRate} ──`,
        `${report.totalMemories} memories (${report.embeddingCoverage}% embedded). Velocity: ${report.overallVelocity}/week.`,
        `Domains: ${domainGrades}`,
        `Strongest: ${report.strongestDomain}. Weakest: ${report.weakestDomain}. Growing: ${report.topGrowingDomain}.`,
        report.suggestion,
      ].join("\n");
    } catch {
      return "";
    }
  });
}
