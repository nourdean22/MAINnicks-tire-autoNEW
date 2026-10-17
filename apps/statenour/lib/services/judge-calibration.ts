/**
 * lib/services/judge-calibration.ts · task #22 slice 5.5 (2026-05-23)
 *
 * Ground-truth feedback for judge-eval · the LeCun-lens move on the
 * AI quality stack.
 *
 * Today the judge-eval pipeline (Phase V/W) lets an LLM judge decide
 * "did V2 beat V1?" and we trust that judgment to gate the V1→V2
 * canary. Problem: the judge is an LLM scoring an LLM. If both judge
 * and V2 share blind spots, we get systematically wrong "V2 wins"
 * verdicts and ship a regression.
 *
 * The ground-truth signal that DOESN'T share those blind spots:
 * `ChatMessage.feedbackScore` · the operator's thumbs-up / -down on
 * the V2 reply that was actually shown to them. Each comparison row
 * stores `sourceMessageId` in metadata · we can join back to the
 * source message + read the operator's reaction.
 *
 * The calibration metric. Raw agreement is not enough: a judge that always
 * picks v2 agrees with the operator exactly as often as the operator
 * thumbs-ups v2, and says nothing. So the report leads with Cohen's kappa,
 * agreement corrected for chance, and adds the two error rates (the
 * false-pass / false-fail vocabulary of ChainForge's evalgen
 * computeAlignmentStats). Positive class = "v2 is good".
 *
 *   TP           · judge picked v2 AND operator gave +1
 *   TN           · judge picked v1 AND operator gave −1
 *   FP           · judge picked v2 AND operator gave −1 (false pass)
 *   FN           · judge picked v1 AND operator gave +1 (false fail)
 *   EXCLUDED     · judge tied · OR operator didn't react · OR no source msg
 *
 *   agreementPct  · (TP + TN) / scored · kept for context, not the verdict
 *   kappa         · (po − pe) / (1 − pe) · null when nothing is scored or when
 *                   judge and operator each used a single class (pe = 1) ·
 *                   undefined is null, never 0
 *   falsePassRate · FP / (FP + TN) · share of operator-rejected replies the
 *                   judge passed · null when the operator rejected none
 *   falseFailRate · FN / (FN + TP) · share of operator-liked replies the
 *                   judge failed · null when the operator liked none
 *
 * Verdict (≥30 scored): kappa ≥0.6 well-calibrated · 0.4 to <0.6 moderate ·
 * <0.4 miscalibrated. <30 scored stays preliminary, and so does operator data
 * that is all one class (all thumbs-up or all thumbs-down): kappa is 0 or
 * undefined there whatever the judge does, so nothing was measured.
 *
 * Output is shaped so the dashboard can show:
 *   · headline · kappa + agreement, e.g. "kappa 0.53 · agreement 77% (n=65 over 30d)"
 *   · confusion matrix · 4 cells with counts
 *   · sample size warning · n<20 = "preliminary" tag
 *
 * Read-only · degrades to zero-confidence empty payload on DB error
 * (matches the pattern from buildHealthReport).
 */

import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";
import type { Winner } from "@/lib/ai/judge-eval/comparator";
import { cohensKappa, type LabeledComparison } from "@/lib/ai/judge-eval/calibration";

const log = rootLogger.withSurface("services/judge-calibration");

export type CalibrationVerdict =
  | "well-calibrated" // ≥30 samples · kappa ≥0.6
  | "moderate" // ≥30 samples · kappa 0.4 to <0.6
  | "miscalibrated" // ≥30 samples · kappa <0.4
  | "preliminary"; // <30 samples, or operator reactions all one class · not enough signal

export interface CalibrationCell {
  /** How the judge ruled. */
  judge: "v1" | "v2";
  /** What the operator did. */
  human: "thumbs_up" | "thumbs_down";
  count: number;
}

export interface JudgeCalibrationReport {
  generatedAt: string;
  /** Sample size · comparisons that had BOTH a judge ruling and an operator reaction. */
  totalScored: number;
  /** Comparisons that had a sourceMessageId but no operator reaction (excluded). */
  noOperatorReaction: number;
  /** Comparisons with no sourceMessageId (excluded · usually batch/synthetic). */
  noSourceMessage: number;
  /** Tied judgments (excluded · agreement undefined). */
  ties: number;
  /** Window the report covers. */
  sinceDays: number;
  /** Agreement % · 0-100 · -1 when totalScored = 0. Context only; the verdict reads kappa. */
  agreementPct: number;
  /** Cohen's kappa (chance-corrected agreement) · null when undefined (nothing scored, or one class only). */
  kappa: number | null;
  /** FP / (FP + TN) · share of operator-rejected replies the judge passed · null on a zero denominator. */
  falsePassRate: number | null;
  /** FN / (FN + TP) · share of operator-liked replies the judge failed · null on a zero denominator. */
  falseFailRate: number | null;
  /** 4-cell confusion matrix · empty when totalScored = 0. */
  matrix: CalibrationCell[];
  /** Operator-readable verdict. */
  verdict: CalibrationVerdict;
  /** 1-line reason · for the dashboard chip. */
  verdictReason: string;
}

/** Minimum sample size before we move off "preliminary". */
const MIN_SAMPLE_FOR_VERDICT = 30;
const KAPPA_WELL_CALIBRATED = 0.6;
const KAPPA_MODERATE = 0.4;

function emptyReport(sinceDays: number): JudgeCalibrationReport {
  return {
    generatedAt: new Date().toISOString(),
    totalScored: 0,
    noOperatorReaction: 0,
    noSourceMessage: 0,
    ties: 0,
    sinceDays,
    agreementPct: -1,
    kappa: null,
    falsePassRate: null,
    falseFailRate: null,
    matrix: [],
    verdict: "preliminary",
    verdictReason: "no comparison runs in window · ship a few judge-eval comparisons first",
  };
}

function deriveVerdict(
  totalScored: number,
  agreementPct: number,
  kappa: number | null,
  liked: number,
  rejected: number,
): { verdict: CalibrationVerdict; reason: string } {
  if (totalScored < MIN_SAMPLE_FOR_VERDICT) {
    return {
      verdict: "preliminary",
      reason: `${totalScored} scored comparisons in window · need ≥${MIN_SAMPLE_FOR_VERDICT} for a confident verdict`,
    };
  }
  // One-class reactions: kappa is 0 or undefined whatever the judge does, so nothing was measured.
  if (rejected === 0 || liked === 0) {
    const only = rejected === 0 ? "thumbs-up" : "thumbs-down";
    return {
      verdict: "preliminary",
      reason: `every one of the ${totalScored} reactions was a ${only}: kappa cannot check the judge until both appear (agreement ${agreementPct}%)`,
    };
  }
  // Defensive: kappa is only null here if the guard above missed a case. Not a measurement, so not a verdict.
  if (kappa === null) {
    return {
      verdict: "preliminary",
      reason: `kappa could not be computed for ${totalScored} scored comparisons (agreement ${agreementPct}%)`,
    };
  }
  if (kappa < KAPPA_MODERATE) {
    return {
      verdict: "miscalibrated",
      reason: `kappa ${kappa.toFixed(2)}, agreement ${agreementPct}% · the judge adds little beyond chance agreement and is not a reliable proxy here`,
    };
  }
  if (kappa < KAPPA_WELL_CALIBRATED) {
    return {
      verdict: "moderate",
      reason: `kappa ${kappa.toFixed(2)}, agreement ${agreementPct}% · usable but interpret verdicts with caution`,
    };
  }
  return {
    verdict: "well-calibrated",
    reason: `kappa ${kappa.toFixed(2)}, agreement ${agreementPct}% over ${totalScored} samples · ground-truth confirms judge rulings`,
  };
}

/**
 * Pure aggregation step · separated for testability. Takes the raw
 * (winner, sourceMessageId, feedbackScore) tuples and produces the
 * report shape.
 *
 * Exported for the unit test in tests/lib/services/judge-calibration.test.ts.
 */
export function computeCalibration(
  rows: Array<{
    winner: Winner;
    sourceMessageId: string | null;
    feedbackScore: number | null;
  }>,
  sinceDays: number,
  now: Date = new Date(),
): JudgeCalibrationReport {
  let noSourceMessage = 0;
  let noOperatorReaction = 0;
  let ties = 0;
  let agreeJ2H1 = 0; // judge=v2 · human=+1
  let agreeJ1HMinus1 = 0; // judge=v1 · human=-1
  let disagreeJ2HMinus1 = 0; // judge=v2 · human=-1 (false positive)
  let disagreeJ1H1 = 0; // judge=v1 · human=+1 (false negative)
  // Positive class = "v2 is good": a thumbs-up maps to v2, a thumbs-down to v1.
  const scored: LabeledComparison[] = [];

  for (const r of rows) {
    if (!r.sourceMessageId) {
      noSourceMessage++;
      continue;
    }
    if (r.feedbackScore !== 1 && r.feedbackScore !== -1) {
      noOperatorReaction++;
      continue;
    }
    if (r.winner === "tie") {
      ties++;
      continue;
    }
    scored.push({ judgeWinner: r.winner, operatorWinner: r.feedbackScore === 1 ? "v2" : "v1" });
    if (r.winner === "v2" && r.feedbackScore === 1) agreeJ2H1++;
    else if (r.winner === "v1" && r.feedbackScore === -1) agreeJ1HMinus1++;
    else if (r.winner === "v2" && r.feedbackScore === -1) disagreeJ2HMinus1++;
    else if (r.winner === "v1" && r.feedbackScore === 1) disagreeJ1H1++;
  }

  const totalScored =
    agreeJ2H1 + agreeJ1HMinus1 + disagreeJ2HMinus1 + disagreeJ1H1;

  const agreementPct =
    totalScored === 0
      ? -1
      : Number(
          (((agreeJ2H1 + agreeJ1HMinus1) / totalScored) * 100).toFixed(1),
        );

  // cohensKappa returns null for n = 0 and for pe = 1 (one class on both sides).
  const kappa = cohensKappa(scored);
  const rejected = disagreeJ2HMinus1 + agreeJ1HMinus1; // operator thumbs-down
  const liked = agreeJ2H1 + disagreeJ1H1; // operator thumbs-up
  const falsePassRate = rejected === 0 ? null : disagreeJ2HMinus1 / rejected;
  const falseFailRate = liked === 0 ? null : disagreeJ1H1 / liked;

  const matrix: CalibrationCell[] = [
    { judge: "v2", human: "thumbs_up", count: agreeJ2H1 },
    { judge: "v2", human: "thumbs_down", count: disagreeJ2HMinus1 },
    { judge: "v1", human: "thumbs_up", count: disagreeJ1H1 },
    { judge: "v1", human: "thumbs_down", count: agreeJ1HMinus1 },
  ];

  const { verdict, reason } = deriveVerdict(totalScored, agreementPct, kappa, liked, rejected);

  return {
    generatedAt: now.toISOString(),
    totalScored,
    noOperatorReaction,
    noSourceMessage,
    ties,
    sinceDays,
    agreementPct,
    kappa,
    falsePassRate,
    falseFailRate,
    matrix,
    verdict,
    verdictReason: reason,
  };
}

/**
 * Build the calibration report from production data. 1 query for the
 * comparison rows, 1 query for the chat-message feedback scores ·
 * joined in-memory (the dataset is small · max few-thousand rows even
 * at high volume).
 *
 * Best-effort · degrades to empty report on DB error so the dashboard
 * never blanks.
 */
export async function buildJudgeCalibration(
  options?: { sinceDays?: number },
): Promise<JudgeCalibrationReport> {
  const sinceDays = options?.sinceDays ?? 30;

  try {
    const { prisma } = await import("@/lib/prisma");
    const since = new Date(Date.now() - sinceDays * 86_400_000);

    // 1. Pull comparison heads + sourceMessageId from BrainMemory metadata.
    //    We deliberately read the full row so we can extract the metadata
    //    fields the persistence layer promotes (winner + sourceMessageId).
    const rows = await prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.PROMPT_COMPARISON_RUN,
        deletedAt: null,
        createdAt: { gte: since },
        // scripts/seed-judge-calibration.ts fabricates these (audit 06-F6).
        NOT: { key: { startsWith: "comparison_calibration_" } },
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
      select: { metadata: true },
    });

    type PromotedMeta = {
      winner?: string;
      sourceMessageId?: string | null;
    };

    const tuples = rows.flatMap(
      (
        r,
      ): Array<{
        winner: Winner;
        sourceMessageId: string | null;
      }> => {
        const m = (r.metadata ?? {}) as PromotedMeta;
        const winner = m.winner;
        if (winner !== "v1" && winner !== "v2" && winner !== "tie") return [];
        return [
          {
            winner,
            sourceMessageId: m.sourceMessageId ?? null,
          },
        ];
      },
    );

    if (tuples.length === 0) return emptyReport(sinceDays);

    // 2. Batch-fetch feedback scores for the source messages we have.
    const sourceIds = tuples
      .map((t) => t.sourceMessageId)
      .filter((id): id is string => typeof id === "string" && id.length > 0 && !id.startsWith("msg_calibration_"));

    const feedbackByMessageId = new Map<string, number | null>();
    if (sourceIds.length > 0) {
      const msgs = await prisma.chatMessage.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, feedbackScore: true },
      });
      for (const m of msgs) {
        feedbackByMessageId.set(m.id, m.feedbackScore ?? null);
      }
    }

    // 3. Join in-memory.
    const joined = tuples.map((t) => ({
      winner: t.winner,
      sourceMessageId: t.sourceMessageId,
      feedbackScore: t.sourceMessageId
        ? feedbackByMessageId.get(t.sourceMessageId) ?? null
        : null,
    }));

    return computeCalibration(joined, sinceDays);
  } catch (e) {
    log.warn("calibration_build_failed", {
      err: (e as Error).message?.slice(0, 200),
    });
    return emptyReport(sinceDays);
  }
}
