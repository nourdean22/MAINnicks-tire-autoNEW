/**
 * Calibrated confidence helper · v10.0.91 · 2026-05-02.
 *
 * Computes a confidence score for advice/predictions/recommendations
 * based on how often similar past advice was correct. The "similar"
 * lookup uses the embedding of the current statement; the "correct"
 * signal comes from feedbackScore on past chat messages + outcome
 * grades on past decisions.
 *
 * Returns:
 *   · accuracy: fraction of past similar items that were graded
 *     positive (feedback +1 OR decision A/B grade)
 *   · sampleSize: how many past items contributed
 *   · confidence: smoothed accuracy with Wilson lower-bound when
 *     sample is small (avoid declaring 100% from 1 data point)
 *
 * Designed to be embedded into the chat reply tail:
 *   "This advice is calibrated at 73% (based on 12 similar past
 *    pieces of advice you graded positively)."
 *
 * No ML — pure lookup + statistics.
 */

import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/ai/provider";

const TARGET_DIM = 1536;
const KNN_TOP = 30;
const SIM_THRESHOLD = 0.65; // cosine similarity (1 - distance) above this counts

export interface CalibratedConfidence {
  accuracy: number; // 0..1
  sampleSize: number;
  positiveCount: number;
  negativeCount: number;
  confidence: number; // smoothed; lower bound when sample small
  /** Wilson 95% lower bound — useful as the "trust this score" guard */
  wilsonLower: number;
  notes?: string;
}

function padToTargetDim(arr: number[]): number[] {
  if (arr.length === TARGET_DIM) return arr;
  if (arr.length > TARGET_DIM) return arr.slice(0, TARGET_DIM);
  return [...arr, ...new Array(TARGET_DIM - arr.length).fill(0)];
}

/**
 * Wilson score interval lower bound (95% CI).
 * https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval
 *
 * Why: when sample size is small (e.g., 2 of 3 = 67%), naive accuracy
 * overstates confidence. Wilson lower bound stays conservative.
 */
function wilsonLowerBound(positive: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.96; // 95% CI
  const p = positive / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return Math.max(0, (center - margin) / denom);
}

/**
 * Pull calibrated confidence for a piece of advice text.
 *
 * @param advice — the candidate text whose accuracy we're estimating
 */
export async function calibrateAdvice(
  advice: string,
): Promise<CalibratedConfidence> {
  if (!advice?.trim() || advice.length < 8) {
    return {
      accuracy: 0,
      sampleSize: 0,
      positiveCount: 0,
      negativeCount: 0,
      confidence: 0,
      wilsonLower: 0,
      notes: "advice too short to calibrate",
    };
  }

  // 1. Embed the advice
  const emb = await getEmbedding(advice).catch(() => [] as number[]);
  if (emb.length === 0) {
    return {
      accuracy: 0,
      sampleSize: 0,
      positiveCount: 0,
      negativeCount: 0,
      confidence: 0,
      wilsonLower: 0,
      notes: "embedding unavailable",
    };
  }
  const padded = padToTargetDim(emb);
  const vecLit = `[${padded.join(",")}]`;

  // 2. Find similar past assistant messages with feedbackScore set
  const similar = await prisma
    .$queryRawUnsafe<
      Array<{
        id: string;
        feedback_score: number | null;
        distance: number;
      }>
    >(
      `SELECT cm.id::text,
              cm."feedbackScore"::int AS feedback_score,
              (ve.embedding_vec_1536 <=> '${vecLit}'::vector(${TARGET_DIM})) AS distance
       FROM chat_messages cm
       JOIN vector_embeddings ve
         ON ve."sourceType" = 'chat_message'
        AND ve."sourceId" = cm.id
       WHERE cm.role = 'assistant'
         AND cm."feedbackScore" IS NOT NULL
         AND ve.embedding_vec_1536 IS NOT NULL
       ORDER BY ve.embedding_vec_1536 <=> '${vecLit}'::vector(${TARGET_DIM})
       LIMIT ${KNN_TOP}`,
    )
    .catch(() => []);

  const filtered = similar.filter(
    (r) => 1 - r.distance >= SIM_THRESHOLD && r.feedback_score !== null,
  );

  if (filtered.length === 0) {
    return {
      accuracy: 0,
      sampleSize: 0,
      positiveCount: 0,
      negativeCount: 0,
      confidence: 0,
      wilsonLower: 0,
      notes: "no similar past advice with feedback found",
    };
  }

  const positive = filtered.filter((r) => (r.feedback_score ?? 0) > 0).length;
  const negative = filtered.filter((r) => (r.feedback_score ?? 0) < 0).length;
  const total = positive + negative;
  if (total === 0) {
    return {
      accuracy: 0,
      sampleSize: filtered.length,
      positiveCount: 0,
      negativeCount: 0,
      confidence: 0,
      wilsonLower: 0,
      notes: "neutral feedback only",
    };
  }
  const accuracy = positive / total;
  const wilsonLower = wilsonLowerBound(positive, total);
  // Smoothed confidence — interpolate accuracy and wilsonLower based
  // on sample size. <5 → mostly wilson; >=20 → mostly accuracy.
  const weight = Math.min(1, total / 20);
  const confidence = wilsonLower * (1 - weight) + accuracy * weight;

  return {
    accuracy: Math.round(accuracy * 1000) / 1000,
    sampleSize: total,
    positiveCount: positive,
    negativeCount: negative,
    confidence: Math.round(confidence * 1000) / 1000,
    wilsonLower: Math.round(wilsonLower * 1000) / 1000,
    notes:
      total < 5
        ? "small sample — confidence weighted toward Wilson lower bound"
        : undefined,
  };
}

/**
 * Format calibrated confidence as a short tail line for chat reply.
 */
export function formatConfidenceTail(c: CalibratedConfidence): string | null {
  if (c.sampleSize < 3) return null;
  const pct = Math.round(c.confidence * 100);
  return `<i>Calibrated ~${pct}% (n=${c.sampleSize})</i>`;
}
