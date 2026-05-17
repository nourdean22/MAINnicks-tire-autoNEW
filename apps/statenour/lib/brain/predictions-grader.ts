/**
 * Predictions outcome auto-grader · v10.0.91 · 2026-05-02.
 *
 * Closes the Ghost Nour calibration gap. Currently /api/brain/maturity
 * shows ghost: { hits: 0, surprises: 0, accuracy: null } because no
 * predictions ever get graded.
 *
 * Algorithm: for each past prediction whose `targetDate` is in the
 * past AND `actualOutcome` is null, attempt to auto-grade by:
 *   1. Embedding the prediction text
 *   2. Searching brain_memories created on/after targetDate for
 *      semantically similar items
 *   3. If a match exists with similarity > 0.7 AND content contains
 *      keywords like "achieved", "missed", "didn't", "exceeded",
 *      "fell short" — fold that as evidence
 *   4. When confidence is high enough, write actualOutcome with a
 *      grade (A=on-target, B=near-miss, C=missed, D=opposite)
 *
 * For predictions that can't be auto-graded (too new, no matching
 * evidence), no action is taken — user can always grade manually.
 *
 * Output: BrainMemory category=prediction_grade per graded item.
 */

import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/ai/provider";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/predictions-grader");

const TARGET_DIM = 1536;
const SIM_THRESHOLD_HIGH = 0.72;
const KNN_TOP = 10;

const POSITIVE_PATTERNS = [
  /\bachieved\b/i,
  /\bhit\b/i,
  /\bexceeded\b/i,
  /\bsucceeded\b/i,
  /\bcrushed\b/i,
  /\bnailed\b/i,
  /\bon target\b/i,
  /\bon time\b/i,
];
const NEGATIVE_PATTERNS = [
  /\bmissed\b/i,
  /\bfailed\b/i,
  /\bfell short\b/i,
  /\bdidn'?t\b/i,
  /\bcouldn'?t\b/i,
  /\bopposite\b/i,
  /\bbusted\b/i,
];

export interface GraderReport {
  ranAt: string;
  candidatesScanned: number;
  graded: number;
  skippedNoEvidence: number;
  errors: number;
}

function padToTargetDim(arr: number[]): number[] {
  if (arr.length === TARGET_DIM) return arr;
  if (arr.length > TARGET_DIM) return arr.slice(0, TARGET_DIM);
  return [...arr, ...new Array(TARGET_DIM - arr.length).fill(0)];
}

function gradeFromEvidence(
  evidence: string,
): "A" | "B" | "C" | "D" | null {
  let positive = 0;
  let negative = 0;
  for (const rx of POSITIVE_PATTERNS) if (rx.test(evidence)) positive++;
  for (const rx of NEGATIVE_PATTERNS) if (rx.test(evidence)) negative++;
  if (positive === 0 && negative === 0) return null;
  if (positive >= 2 && negative === 0) return "A";
  if (positive > negative) return "B";
  if (negative > positive && positive > 0) return "C";
  if (negative >= 2 && positive === 0) return "D";
  return null;
}

export async function runPredictionsGrader(): Promise<GraderReport> {
  const ranAt = new Date().toISOString();
  const now = new Date();

  // Pull predictions that are due (targetDate < now) and not yet graded.
  // MasteryDecisions store predictedOutcome; reviewDate is a string YYYY-MM-DD.
  const candidates = await prisma.masteryDecision
    .findMany({
      where: {
        actualOutcome: null,
        deletedAt: null,
        reviewDate: { lte: now.toISOString().slice(0, 10) },
      },
      take: 25,
      orderBy: { reviewDate: "asc" },
      select: {
        id: true,
        title: true,
        predictedOutcome: true,
        reviewDate: true,
        createdAt: true,
      },
    })
    .catch(() => []);

  let graded = 0;
  let skippedNoEvidence = 0;
  let errors = 0;

  for (const c of candidates) {
    if (!c.predictedOutcome || !c.title) {
      skippedNoEvidence++;
      continue;
    }
    try {
      const queryText = `${c.title}: ${c.predictedOutcome}`;
      const emb = await getEmbedding(queryText).catch(() => [] as number[]);
      if (emb.length === 0) {
        skippedNoEvidence++;
        continue;
      }
      const padded = padToTargetDim(emb);
      const vecLit = `[${padded.join(",")}]`;

      // Look for evidence created at or after the predicted reviewDate
      const reviewDateIso = c.reviewDate
        ? new Date(`${c.reviewDate}T00:00:00Z`).toISOString()
        : c.createdAt.toISOString();
      const evidence = await prisma
        .$queryRawUnsafe<
          Array<{ content: string; distance: number }>
        >(
          `SELECT substring(bm.content, 1, 600)::text AS content,
                  (ve.embedding_vec_1536 <=> '${vecLit}'::vector(${TARGET_DIM})) AS distance
           FROM vector_embeddings ve
           JOIN brain_memories bm
             ON bm.id = ve."sourceId"
            AND bm.deleted_at IS NULL
           WHERE ve."sourceType" = 'brain_memory'
             AND ve.embedding_vec_1536 IS NOT NULL
             AND bm.created_at >= '${reviewDateIso}'
           ORDER BY ve.embedding_vec_1536 <=> '${vecLit}'::vector(${TARGET_DIM})
           LIMIT ${KNN_TOP}`,
        )
        .catch(() => []);

      const strong = evidence.filter(
        (e) => 1 - e.distance >= SIM_THRESHOLD_HIGH,
      );
      if (strong.length === 0) {
        skippedNoEvidence++;
        continue;
      }

      const evidenceText = strong.map((e) => e.content).join(" \n ");
      const grade = gradeFromEvidence(evidenceText);
      if (!grade) {
        skippedNoEvidence++;
        continue;
      }

      // Persist the grade
      const outcomeNote = `Auto-graded ${grade} from ${strong.length} similar memories (max sim ${(1 - strong[0].distance).toFixed(2)}). Pattern matches: ${strong.map((e) => e.content.slice(0, 80)).join(" | ")}`;
      await prisma.masteryDecision
        .update({
          where: { id: c.id },
          data: { actualOutcome: outcomeNote.slice(0, 1000) },
        })
        .catch(() => {});

      // Mirror the grade into BrainMemory for the maturity score
      await prisma.brainMemory
        .upsert({
          where: {
            category_key: {
              category: "prediction_grade",
              key: `decision-${c.id}`,
            },
          },
          create: {
            category: "prediction_grade",
            key: `decision-${c.id}`,
            content: `Decision ${c.id} (${c.title}) graded ${grade} on ${ranAt.slice(0, 10)}`,
            confidence:
              grade === "A" ? 1.0 : grade === "B" ? 0.75 : grade === "C" ? 0.5 : 0.25,
            source: "lib:predictions-grader",
            metadata: {
              decisionId: c.id,
              grade,
              reviewDate: c.reviewDate,
              gradedAt: ranAt,
              evidenceCount: strong.length,
            },
          },
          update: {
            content: `Decision ${c.id} re-graded ${grade}`,
            metadata: {
              decisionId: c.id,
              grade,
              reviewDate: c.reviewDate,
              gradedAt: ranAt,
              evidenceCount: strong.length,
            },
          },
        })
        .catch(() => {});
      graded++;
    } catch (err) {
      errors++;
      log.warn("grade_failed", {
        decisionId: c.id,
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
  }

  return {
    ranAt,
    candidatesScanned: candidates.length,
    graded,
    skippedNoEvidence,
    errors,
  };
}
