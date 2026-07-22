/**
 * Experiment resolver — the measurement leg of the closed-loop Experiment factory.
 *
 * Accepting an opportunity (/api/intelligence/decisions/log) spawns an Experiment
 * with a 14-day horizon. This resolver, fired daily by the experiment-measure cron,
 * scores each DUE experiment (did the hypothesis hold up?) and feeds a DECISIVE
 * outcome back into the attributed source's authScore — so source trust LEARNS from
 * whether accepted bets actually panned out, instead of sitting static at its seed.
 *
 * Safety properties (both were adversarial-review blockers, fixed here):
 *  - CONCURRENCY: EVENING_JOBS is fanned out by two consumers, so two runs can
 *    overlap. Each experiment is ATOMICALLY CLAIMED (running -> measuring, guarded
 *    on status) before scoring; a loser sees count===0 and skips. No double-score,
 *    no double-nudge.
 *  - BOUNDED + REVERSIBLE: authScore moves by a damped EWMA (ALPHA=0.08) toward the
 *    outcome extreme, always within [0,100], with no absorbing state — a bad streak
 *    fully recovers via later good outcomes.
 *
 * Node-20 safe: plain for-of only, no ES2024 static methods (Map.groupBy etc.).
 */
import { prisma } from "@/lib/prisma";
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
import { recentShopJobs } from "@/lib/brain/legacy-shims";
import { logError } from "@/lib/utils/error-log";

const aiChat = makeTracedAiChat("experiment-measure");

/** EWMA learning rate / damping: one resolved outcome moves authScore by at most
 *  ALPHA*100 = 8 pts (≈2.4 from a 70 baseline), so a single soft AI score can never
 *  dominate — the deliberate safety margin for weak binary measurement. */
const ALPHA = 0.08;

/** Max experiments per run — each costs one AI call (~10s); stays well under the
 *  route's 120s maxDuration even if latency rises. */
const BATCH = 3;

export interface ExperimentResolveResult {
  resolved: number; // experiments scored this run
  feedbackWrites: number; // decisive + attributed -> authScore nudged
}

/**
 * Pure damped-EWMA step: nudge `current` (∈[0,100]) toward the outcome extreme.
 * reward +1 pulls toward 100, -1 toward 0. Result always in [0,100] by construction
 * (convex combination), clamped defensively. Exported for unit tests.
 */
export function nudgeAuthScore(current: number, reward: 1 | -1): number {
  const target = reward > 0 ? 100 : 0;
  const next = current + ALPHA * (target - current);
  return Math.min(100, Math.max(0, Math.round(next * 100) / 100));
}

/**
 * Persist an authScore nudge. Reads the CURRENT authScore fresh so sequential
 * outcomes on the same source compound off the just-written value. Returns true iff
 * it wrote (false when the source was deleted since the experiment was spawned).
 */
async function applyAuthScoreFeedback(sourceId: string, reward: 1 | -1): Promise<boolean> {
  const src = await prisma.registeredSource.findUnique({
    where: { id: sourceId },
    select: { authScore: true },
  });
  if (!src) return false;

  await prisma.registeredSource.update({
    where: { id: sourceId },
    data: {
      authScore: nudgeAuthScore(src.authScore, reward),
      authScoreUpdatedAt: new Date(),
      authScoreSamples: { increment: 1 },
    },
  });
  return true;
}

export async function resolveDueExperiments(): Promise<ExperimentResolveResult> {
  const now = new Date();
  const due = await prisma.experiment.findMany({
    where: { status: "running", dueAt: { lte: now } },
    orderBy: { dueAt: "asc" },
    take: BATCH,
  });
  if (due.length === 0) return { resolved: 0, feedbackWrites: 0 };

  // Thin actual-context bundle (the same weak signal the Prediction template uses);
  // the heavy EWMA damping above is what makes soft scoring safe.
  const recentJobs = await recentShopJobs(14);
  const actualContext = `Recent shop activity (14d): ${recentJobs.length} jobs, $${recentJobs
    .reduce((s, j) => s + Number(j.totalRevenue), 0)
    .toFixed(0)} revenue.`;

  let resolved = 0;
  let feedbackWrites = 0;

  for (const exp of due) {
    // ATOMIC CLAIM: running -> measuring, guarded on the current status. A
    // concurrent run that lost the race sees count===0 and skips.
    const claim = await prisma.experiment.updateMany({
      where: { id: exp.id, status: "running" },
      data: { status: "measuring" },
    });
    if (claim.count === 0) continue;

    try {
      const result = await aiChat(
        [
          {
            role: "system",
            content: `You are scoring an accepted opportunity (an "experiment") for the NOUR intelligence OS. Decide whether the hypothesis HELD UP given the actual outcome data. If there is not enough signal to tell, say INCONCLUSIVE — do not guess.
Reply in this exact format:
VERDICT: HELD_UP or FAILED or INCONCLUSIVE
OUTCOME: One sentence on what actually happened (or why it is inconclusive)`,
          },
          {
            role: "user",
            content: `HYPOTHESIS (accepted ${exp.startedAt.toISOString().slice(0, 10)}, horizon ${exp.dueAt
              .toISOString()
              .slice(0, 10)}):
"${exp.hypothesis}"
Expected effect: ${exp.expectedEffect ?? "n/a"}

ACTUAL DATA:
${actualContext}

Did the hypothesis hold up?`,
          },
        ],
        "fast",
      );

      const lines = result.content.split("\n");
      const verdict = (lines.find((l) => l.toUpperCase().includes("VERDICT")) ?? "").toUpperCase();
      const status =
        verdict.includes("HELD_UP") || verdict.includes("HELD UP")
          ? "held_up"
          : verdict.includes("FAILED")
            ? "failed"
            : "inconclusive";
      const outcomeLine = lines.find((l) => l.toUpperCase().startsWith("OUTCOME"));
      const actualResult =
        outcomeLine?.split(":").slice(1).join(":").trim() || result.content.slice(0, 280);

      await prisma.experiment.update({
        where: { id: exp.id },
        data: { status, actualResult, measuredAt: new Date() },
      });
      resolved += 1;

      // Feedback: only a DECISIVE outcome on an ATTRIBUTED source moves trust.
      // Inconclusive is a deliberate no-op (no signal must not move the score).
      if (exp.sourceId && (status === "held_up" || status === "failed")) {
        const wrote = await applyAuthScoreFeedback(exp.sourceId, status === "held_up" ? 1 : -1);
        if (wrote) feedbackWrites += 1;
      }
    } catch (err) {
      // Release the claim so a later run retries, rather than stranding it in 'measuring'.
      await prisma.experiment.updateMany({
        where: { id: exp.id, status: "measuring" },
        data: { status: "running" },
      });
      logError("experiment-measure", err, { experimentId: exp.id });
    }
  }

  return { resolved, feedbackWrites };
}
