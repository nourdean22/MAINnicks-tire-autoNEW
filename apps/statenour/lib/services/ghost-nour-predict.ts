/**
 * lib/services/ghost-nour-predict.ts · straggler-pages REST→tRPC slice
 * (2026-05-22).
 *
 * Lifted verbatim from the POST handler in app/api/system/ghost-nour/
 * route.ts so the legacy REST endpoint AND the new
 * `system.ghostNourPredict` tRPC procedure call the same function ·
 * drift between consumers structurally impossible.
 *
 * `runGhostNourPredict` takes a situation/decision text, finds the
 * most similar past MasteryDecisions (keyword-tokenized Jaccard
 * similarity over title + chosen + stakes + context), and returns the
 * choice distribution + outcome stats + ghost recommendation.
 *
 * The candidate-list read stays in lib/services/ghost-nour.ts
 * (`readGhostNourCandidates`) · this module is the prediction side.
 */

import { prisma } from "@/lib/prisma";
import { tokenize, jaccard } from "@/lib/brain/similarity";

const GRADE_TO_NUM: Record<string, number> = {
  A: 4,
  "A+": 4,
  "A-": 3.7,
  B: 3,
  "B+": 3.3,
  "B-": 2.7,
  C: 2,
  "C+": 2.3,
  "C-": 1.7,
  D: 1,
  "D+": 1.3,
  "D-": 0.7,
  F: 0,
};

function gradeToNum(g: string | null | undefined): number | null {
  if (!g) return null;
  const n = GRADE_TO_NUM[g.toUpperCase()];
  return typeof n === "number" ? n : null;
}

/** Thrown when the situation text tokenizes to nothing · the route +
 *  the tRPC procedure both map this to a 400 / BAD_REQUEST. */
export class GhostNourPredictError extends Error {
  readonly code = "SITUATION_TOO_SHORT";
  constructor(message: string) {
    super(message);
    this.name = "GhostNourPredictError";
  }
}

export interface GhostMatch {
  id: number;
  date: string;
  title: string;
  chosen: string | null;
  domain: string | null;
  grade: string | null;
  similarity: number;
  actualOutcome: string | null;
}

export interface GhostChoice {
  choice: string;
  count: number;
  avgGrade: number | null;
  reviewedCount: number;
}

export interface GhostPrediction {
  situation: string;
  matchCount: number;
  confidence: "none" | "low" | "medium" | "high";
  avgGrade: number | null;
  matches: GhostMatch[];
  choices: GhostChoice[];
  ghostRecommendation: GhostChoice | null;
  generatedAt: string;
}

/** Predict what past-Nour would have done for a given situation. */
export async function runGhostNourPredict(args: {
  situation: string;
  limit: number;
}): Promise<GhostPrediction> {
  const queryTokens = tokenize(args.situation);

  if (queryTokens.size === 0) {
    throw new GhostNourPredictError(
      "situation too short after tokenization",
    );
  }

  // Pull a reasonable candidate pool — we score in-memory for simplicity.
  const pool = await prisma.masteryDecision.findMany({
    where: { deletedAt: null }, // v10.0.68
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      date: true,
      title: true,
      domain: true,
      stakes: true,
      context: true,
      chosen: true,
      predictedOutcome: true,
      actualOutcome: true,
      grade: true,
      createdAt: true,
    },
  });

  const scored = pool
    .map((r) => {
      const textBlob = `${r.title} ${r.chosen ?? ""} ${r.stakes ?? ""} ${r.context ?? ""}`;
      const similarity = jaccard(queryTokens, tokenize(textBlob));
      return { ...r, similarity };
    })
    .filter((r) => r.similarity > 0.05) // ignore near-zero matches
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, args.limit);

  // Choice distribution
  const choiceCounts = new Map<string, { count: number; grades: number[] }>();
  for (const r of scored) {
    const choice = (r.chosen ?? "(no chosen recorded)").trim();
    if (!choice) continue;
    const entry = choiceCounts.get(choice) ?? { count: 0, grades: [] };
    entry.count++;
    const g = gradeToNum(r.grade);
    if (g !== null) entry.grades.push(g);
    choiceCounts.set(choice, entry);
  }
  const choices: GhostChoice[] = [...choiceCounts.entries()]
    .map(([choice, data]) => ({
      choice,
      count: data.count,
      avgGrade:
        data.grades.length > 0
          ? Math.round(
              (data.grades.reduce((a, b) => a + b, 0) / data.grades.length) *
                100,
            ) / 100
          : null,
      reviewedCount: data.grades.length,
    }))
    .sort((a, b) => b.count - a.count);

  // Overall stats
  const allGrades = scored
    .map((r) => gradeToNum(r.grade))
    .filter((n): n is number => n !== null);
  const avgGrade =
    allGrades.length > 0
      ? Math.round(
          (allGrades.reduce((a, b) => a + b, 0) / allGrades.length) * 100,
        ) / 100
      : null;

  // Ghost recommendation — the highest-avg-grade choice with ≥2 samples.
  // Falls back to most-chosen if nothing has enough graded history.
  const rankedForRec = [...choices]
    .filter((c) => c.avgGrade !== null && c.reviewedCount >= 2)
    .sort((a, b) => (b.avgGrade ?? 0) - (a.avgGrade ?? 0));
  const ghostRecommendation = rankedForRec[0] ?? choices[0] ?? null;

  return {
    situation: args.situation,
    matchCount: scored.length,
    confidence:
      scored.length === 0
        ? "none"
        : scored.length < 3
          ? "low"
          : scored.length < 6
            ? "medium"
            : "high",
    avgGrade,
    matches: scored.map((r) => ({
      id: r.id,
      date: r.date,
      title: r.title,
      chosen: r.chosen,
      domain: r.domain,
      grade: r.grade,
      similarity: Math.round(r.similarity * 100) / 100,
      actualOutcome: r.actualOutcome?.slice(0, 200) ?? null,
    })),
    choices,
    ghostRecommendation,
    generatedAt: new Date().toISOString(),
  };
}
