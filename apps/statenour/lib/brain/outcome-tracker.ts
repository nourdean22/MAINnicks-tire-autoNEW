/**
 * Outcome Tracker — Closed-loop learning for Nick's brain.
 *
 * Tracks whether predictions, recommendations, and decisions
 * turned out to be RIGHT or WRONG. Feeds accuracy data back
 * into the brain so Nick gets smarter over time.
 *
 * Three tracking dimensions:
 * 1. PREDICTIONS — scored against actual outcomes
 * 2. RECOMMENDATIONS — did Nour follow them? What happened?
 * 3. DECISIONS — graded by Nour after maturity period
 *
 * The accuracy data is surfaced in:
 * - System prompt (so Nick knows his own accuracy)
 * - Learning journal (daily self-assessment)
 * - Confidence calibration (adjusts future prediction confidence)
 */

import { prisma } from "@/lib/prisma";
// v10.0.64 · AgentTrace coverage.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("outcome-tracker");
import { brainMemory } from "@/lib/brain/memory-manager";
import { today, daysAgo, toDateString } from "@/lib/utils/datetime";
import { recentScoreSnapshots, recentShopJobs } from "@/lib/brain/legacy-shims";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

// ---------------------------------------------------------------------------
// Prediction outcome scoring
// ---------------------------------------------------------------------------

interface PredictionScore {
  id: string;
  prediction: string;
  category: string;
  confidence: number;
  outcome: string;
  accurate: boolean;
}

/**
 * Score predictions whose target date has passed.
 * Uses AI to compare prediction vs actual data, then marks as confirmed/disproven.
 */
export async function scorePendingPredictions(): Promise<PredictionScore[]> {
  const todayStr = today();

  // Find predictions whose target date has passed and are still pending
  const pending = await prisma.prediction.findMany({
    where: {
      status: "pending",
      targetDate: { lte: todayStr },
    },
    take: 3, // Max 3 per cron run — each needs an AI call (~10s each)
  });

  if (pending.length === 0) return [];

  // Gather actual data for comparison
  // v10.0.55 · scores + jobs via legacy-shims.
  const recentScores = await recentScoreSnapshots(7);

  const recentJobs = await recentShopJobs(7);

  const actualContext = [
    `Recent scores: ${recentScores.map(s => `${s.date}: ${s.overallScore}/10 energy:${s.energyLevel} workout:${s.workoutDone}`).join("; ")}`,
    `Recent revenue: ${recentJobs.length} jobs, $${recentJobs.reduce((s, j) => s + Number(j.totalRevenue), 0).toFixed(0)} total`,
  ].join("\n");

  const scored: PredictionScore[] = [];

  let scoreFailCount = 0;
  for (const pred of pending) {
    try {
      const result = await aiChat(
        [
          {
            role: "system",
            content: `You are scoring a prediction made by the NOUR OS brain. Compare the prediction against actual outcomes.
Reply in this exact format:
ACCURATE: true or false
OUTCOME: One sentence describing what actually happened
LESSON: One sentence about what this teaches the brain for future predictions`,
          },
          {
            role: "user",
            content: `PREDICTION (made ${pred.date}, for ${pred.targetDate}):
Category: ${pred.category}
Prediction: "${pred.prediction}"
Basis: "${pred.basis}"
Confidence: ${(pred.confidence * 100).toFixed(0)}%

ACTUAL DATA:
${actualContext}

Was this prediction accurate?`,
          },
        ],
        "fast"
      );

      const lines = result.content.split("\n");
      const accurateLine = lines.find((l) => l.toUpperCase().startsWith("ACCURATE"));
      const outcomeLine = lines.find((l) => l.toUpperCase().startsWith("OUTCOME"));
      const lessonLine = lines.find((l) => l.toUpperCase().startsWith("LESSON"));

      const accurate = accurateLine?.toLowerCase().includes("true") ?? false;
      const outcome = outcomeLine?.split(":").slice(1).join(":").trim() ?? "Unable to determine";
      const lesson = lessonLine?.split(":").slice(1).join(":").trim() ?? "";

      // v10.0.150 · Brier scoring on resolution. For binary predictions
      // (every existing one is binary by default) we can compute the
      // proper score now that we know the outcome. Lower is better;
      // the SignalZone forecast source reads this back as a calibration
      // signal rather than a throughput count.
      const outcomeBit: 0 | 1 = accurate ? 1 : 0;
      const brier = (pred.confidence - outcomeBit) ** 2;

      // Update the prediction record
      await prisma.prediction.update({
        where: { id: pred.id },
        data: {
          status: accurate ? "confirmed" : "disproven",
          outcome,
          brierScore: brier,
          metadata: {
            ...(pred.metadata as Record<string, unknown> ?? {}),
            scoredAt: new Date().toISOString(),
            lesson,
            originalConfidence: pred.confidence,
          },
        },
      });

      // Store the lesson as a brain memory
      if (lesson) {
        await brainMemory.remember(
          "prediction_lesson",
          `prediction_${pred.category}_${pred.id.slice(-6)}`,
          `[${accurate ? "CONFIRMED" : "DISPROVEN"}] ${pred.category}: "${pred.prediction}" → ${outcome}. Lesson: ${lesson}`,
          "outcome-tracker"
        );
      }

      scored.push({
        id: pred.id,
        prediction: pred.prediction,
        category: pred.category,
        confidence: pred.confidence,
        outcome,
        accurate,
      });
    } catch {
      // Skip predictions that fail to score
      scoreFailCount++;
    }
  }

  if (scoreFailCount > 0) {
    logError("brain.outcome-tracker", new Error(`${scoreFailCount} predictions failed to score`), { fn: "scorePendingPredictions" });
  }

  return scored;
}

// ---------------------------------------------------------------------------
// Accuracy calibration — how good is Nick at predicting?
// ---------------------------------------------------------------------------

export interface AccuracyReport {
  totalPredictions: number;
  confirmed: number;
  disproven: number;
  pending: number;
  overallAccuracy: number;
  byCategory: Record<string, { total: number; correct: number; accuracy: number }>;
  calibration: string; // overconfident, well-calibrated, underconfident
  trend: string; // improving, stable, degrading
  lessons: string[];
}

/**
 * Calculate Nick's prediction accuracy across all categories.
 * This is fed into the system prompt so Nick knows his own reliability.
 */
export async function getAccuracyReport(): Promise<AccuracyReport> {
  const sixtyDaysAgo = daysAgo(60);

  const [confirmed, disproven, pending, recentLessons] = await Promise.all([
    prisma.prediction.findMany({
      where: { status: "confirmed", createdAt: { gte: sixtyDaysAgo } },
      take: 100,
      orderBy: { createdAt: "desc" },
      select: { category: true, confidence: true, createdAt: true },
    }),
    prisma.prediction.findMany({
      where: { status: "disproven", createdAt: { gte: sixtyDaysAgo } },
      take: 100,
      orderBy: { createdAt: "desc" },
      select: { category: true, confidence: true, createdAt: true },
    }),
    prisma.prediction.count({ where: { status: "pending" } }),
    prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.PREDICTION_LESSON, deletedAt: null }, // v10.0.66
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { content: true },
    }),
  ]);

  const total = confirmed.length + disproven.length;
  const overallAccuracy = total > 0 ? confirmed.length / total : 0;

  // By category
  const byCategory: Record<string, { total: number; correct: number; accuracy: number }> = {};

  for (const p of confirmed) {
    if (!byCategory[p.category]) byCategory[p.category] = { total: 0, correct: 0, accuracy: 0 };
    byCategory[p.category].total++;
    byCategory[p.category].correct++;
  }
  for (const p of disproven) {
    if (!byCategory[p.category]) byCategory[p.category] = { total: 0, correct: 0, accuracy: 0 };
    byCategory[p.category].total++;
  }
  for (const cat of Object.values(byCategory)) {
    cat.accuracy = cat.total > 0 ? cat.correct / cat.total : 0;
  }

  // Calibration: compare average confidence with actual accuracy
  const avgConfidence = total > 0
    ? [...confirmed, ...disproven].reduce((s, p) => s + p.confidence, 0) / total
    : 0.6;

  let calibration = "well-calibrated";
  if (total > 0) {
    if (avgConfidence > overallAccuracy + 0.15) calibration = "overconfident";
    else if (avgConfidence < overallAccuracy - 0.15) calibration = "underconfident";
  }

  // Trend: compare last 30 days vs previous 30 days
  const thirtyDaysAgo = daysAgo(30);

  const recentCorrect = confirmed.filter((p) => p.createdAt >= thirtyDaysAgo).length;
  const recentWrong = disproven.filter((p) => p.createdAt >= thirtyDaysAgo).length;
  const olderCorrect = confirmed.filter((p) => p.createdAt >= sixtyDaysAgo && p.createdAt < thirtyDaysAgo).length;
  const olderWrong = disproven.filter((p) => p.createdAt >= sixtyDaysAgo && p.createdAt < thirtyDaysAgo).length;

  const recentRate = recentCorrect + recentWrong > 0 ? recentCorrect / (recentCorrect + recentWrong) : 0;
  const olderRate = olderCorrect + olderWrong > 0 ? olderCorrect / (olderCorrect + olderWrong) : 0;

  let trend = "stable";
  if (recentCorrect + recentWrong > 0 && olderCorrect + olderWrong > 0) {
    if (recentRate > olderRate + 0.1) trend = "improving";
    else if (recentRate < olderRate - 0.1) trend = "degrading";
  }

  return {
    totalPredictions: total,
    confirmed: confirmed.length,
    disproven: disproven.length,
    pending,
    overallAccuracy: Math.round(overallAccuracy * 100),
    byCategory,
    calibration,
    trend,
    lessons: recentLessons.map((l) => l.content.slice(0, 150)),
  };
}

/**
 * Get a one-line accuracy context string for the system prompt.
 */
export async function getAccuracyContext(): Promise<string> {
  try {
    const report = await getAccuracyReport();
    if (report.totalPredictions === 0) {
      return "Brain accuracy: No predictions scored yet. Building baseline.";
    }

    const catSummary = Object.entries(report.byCategory)
      .map(([cat, d]) => `${cat}: ${Math.round(d.accuracy * 100)}%`)
      .join(", ");

    return [
      `── SELF-AWARENESS: PREDICTION ACCURACY ──`,
      `Overall: ${report.overallAccuracy}% (${report.confirmed}/${report.totalPredictions}). Calibration: ${report.calibration}. Trend: ${report.trend}.`,
      `By domain: ${catSummary}`,
      report.calibration === "overconfident"
        ? "⚠️ You tend to be overconfident. Lower your certainty on predictions."
        : report.calibration === "underconfident"
          ? "You're more accurate than you think. Trust your analysis more."
          : "Your confidence aligns with your accuracy. Maintain current calibration.",
      report.lessons.length > 0 ? `Recent lessons: ${report.lessons[0]}` : "",
    ].filter(Boolean).join("\n");
  } catch (err) {
    logError("brain.outcome-tracker", err, { fn: "getAccuracyContext" });
    return "";
  }
}
