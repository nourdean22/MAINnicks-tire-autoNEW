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
import { isAiSentinel } from "@/lib/ai/provider";
import { brainMemory } from "@/lib/brain/memory-manager";
import { today, toDateString } from "@/lib/utils/datetime";
import { recentScoreSnapshots, recentShopJobs } from "@/lib/brain/legacy-shims";
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

/** How many unreadable verdicts a prediction gets before it is parked as unverifiable. */
const MAX_VERDICT_ATTEMPTS = 3;

/** A reply line's label, with list and heading markers and bold markup removed. Used for matching only. */
function labelOf(line: string): string {
  return line.replace(/^[\s*_#>-]+/, "").replace(/\*\*/g, "").trim();
}

/** The text after a line's first colon, minus the markup that wraps it. Underscores inside the text are kept. */
function valueOf(line: string): string {
  return line.split(":").slice(1).join(":").replace(/^[\s*]+/, "").replace(/[\s*]+$/, "");
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
    // Oldest target first; an unordered take:3 let newer rows starve past-due ones.
    orderBy: { targetDate: "asc" },
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
  // 2026-11-01 · the nightly "N predictions failed to score" (5 of 7 nights) carried no cause.
  let firstScoreFailure: string | null = null;
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
      // The outage apology has no "ACCURATE: true" line and would score as
      // DISPROVEN. Leave the prediction pending for the next run instead.
      if (isAiSentinel(result)) {
        scoreFailCount++;
        continue;
      }

      // Model replies are markdown ("**ACCURATE:** true"). Labels are matched on a
      // markup-free copy; values come from the original line, so underscores survive.
      const lines = result.content.split("\n");
      const accurateRaw = lines.find((l) => labelOf(l).toUpperCase().startsWith("ACCURATE"));
      const outcomeRaw = lines.find((l) => labelOf(l).toUpperCase().startsWith("OUTCOME"));
      const lessonRaw = lines.find((l) => labelOf(l).toUpperCase().startsWith("LESSON"));

      // The verdict must be exactly true or false, optionally with a trailing period.
      // An echoed placeholder ("true or false") or a hedge ("true-ish") is unreadable.
      const verdictText = accurateRaw ? valueOf(accurateRaw).toLowerCase() : "";
      const verdict = /^(true|false)[.!]?$/.exec(verdictText)?.[1];
      const accurate = verdict === "true";
      const outcome = outcomeRaw ? valueOf(outcomeRaw) : "Unable to determine";
      const lesson = lessonRaw ? valueOf(lessonRaw) : "";

      // An unreadable verdict stays pending so the next run retries it. After
      // MAX_VERDICT_ATTEMPTS it is parked as 'unverifiable', and nothing else resolves it.
      if (verdict === undefined) {
        const attempts = Number((pred.metadata as Record<string, unknown> | null)?.verdictAttempts ?? 0) + 1;
        const terminal = attempts >= MAX_VERDICT_ATTEMPTS;
        await prisma.prediction.update({
          where: { id: pred.id },
          data: {
            status: terminal ? "unverifiable" : "pending",
            metadata: {
              ...(pred.metadata as Record<string, unknown> ?? {}),
              verdictAttempts: attempts,
              verdictLine: accurateRaw ?? null,
              ...(terminal ? { scoredAt: new Date().toISOString() } : {}),
            },
          },
        });
        continue;
      }

      // v10.0.150 · Brier scoring on resolution. For binary predictions
      // (every existing one is binary by default) we can compute the
      // proper score now that we know the outcome. Lower is better;
      // the SignalZone forecast source reads this back as a calibration
      // signal rather than a throughput count.
      const outcomeBit: 0 | 1 = accurate ? 1 : 0;
      const brier = (pred.confidence - outcomeBit) ** 2;
      const status = accurate ? "confirmed" : "disproven";

      // Update the prediction record
      await prisma.prediction.update({
        where: { id: pred.id },
        data: {
          status,
          outcome,
          brierScore: brier,
          metadata: {
            ...(pred.metadata as Record<string, unknown> ?? {}),
            scoredAt: new Date().toISOString(),
            lesson,
            originalConfidence: pred.confidence,
            verdictLine: accurateRaw ?? null,
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
    } catch (err) {
      // Skip predictions that fail to score
      scoreFailCount++;
      firstScoreFailure ??= `${pred.id}: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`;
    }
  }

  if (scoreFailCount > 0) {
    logError("brain.outcome-tracker", new Error(`${scoreFailCount} predictions failed to score`), {
      fn: "scorePendingPredictions",
      firstFailure: firstScoreFailure,
    });
  }

  return scored;
}

