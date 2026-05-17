import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { tokenize, jaccard } from "@/lib/brain/similarity";

/**
 * POST /api/system/ghost-nour — predict what past-Nour would have done.
 *
 * Given a situation/decision text, find the most similar past decisions
 * and surface:
 *   · top N matches (MasteryDecision rows ranked by keyword similarity)
 *   · frequency breakdown: "you've faced something like this N times"
 *   · choice distribution: what past-Nour picked in those
 *   · outcome summary: avg grade on past choices
 *   · ghost recommendation: the highest-rated historical choice
 *
 * Also GET /api/system/ghost-nour?list=recent — returns recent
 * decisions that have no actualOutcome (candidates for review) so the
 * UI can offer "run ghost on this" for pending decisions.
 *
 * Matching is keyword-based tokenization on title + chosen + stakes +
 * context. Good-enough first version; upgrade to embedding similarity
 * when we want cross-language paraphrase detection.
 */

const GRADE_TO_NUM: Record<string, number> = {
  A: 4, "A+": 4, "A-": 3.7,
  B: 3, "B+": 3.3, "B-": 2.7,
  C: 2, "C+": 2.3, "C-": 1.7,
  D: 1, "D+": 1.3, "D-": 0.7,
  F: 0,
};

function gradeToNum(g: string | null | undefined): number | null {
  if (!g) return null;
  const n = GRADE_TO_NUM[g.toUpperCase()];
  return typeof n === "number" ? n : null;
}

const PostSchema = z.object({
  situation: z.string().min(3).max(2000),
  limit: z.number().int().min(1).max(20).default(5),
});

export const POST = apiHandler(async (req) => {
  const body = PostSchema.parse(await req.json());
  const queryTokens = tokenize(body.situation);

  if (queryTokens.size === 0) {
    throw Object.assign(new Error("situation too short after tokenization"), {
      status: 400,
      code: "SITUATION_TOO_SHORT",
    });
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
    .slice(0, body.limit);

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
  const choices = [...choiceCounts.entries()]
    .map(([choice, data]) => ({
      choice,
      count: data.count,
      avgGrade: data.grades.length > 0
        ? Math.round((data.grades.reduce((a, b) => a + b, 0) / data.grades.length) * 100) / 100
        : null,
      reviewedCount: data.grades.length,
    }))
    .sort((a, b) => b.count - a.count);

  // Overall stats
  const allGrades = scored.map((r) => gradeToNum(r.grade)).filter((n): n is number => n !== null);
  const avgGrade = allGrades.length > 0
    ? Math.round((allGrades.reduce((a, b) => a + b, 0) / allGrades.length) * 100) / 100
    : null;

  // Ghost recommendation — the highest-avg-grade choice with ≥2 samples.
  // Falls back to most-chosen if nothing has enough graded history.
  const rankedForRec = [...choices]
    .filter((c) => c.avgGrade !== null && c.reviewedCount >= 2)
    .sort((a, b) => (b.avgGrade ?? 0) - (a.avgGrade ?? 0));
  const ghostRecommendation = rankedForRec[0] ?? choices[0] ?? null;

  return {
    situation: body.situation,
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
}, { auth: "owner" }); // v9.1.14 · POST runs analysis on decision history

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const mode = url.searchParams.get("list") ?? "recent";

  if (mode === "recent") {
    // Recent decisions with no review yet — candidates to run ghost on.
    const rows = await prisma.masteryDecision.findMany({
      where: { actualOutcome: null, deletedAt: null }, // v10.0.68
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        date: true,
        title: true,
        domain: true,
        chosen: true,
        stakes: true,
        createdAt: true,
      },
    });
    return { mode: "recent", candidates: rows };
  }

  throw Object.assign(new Error(`unknown list mode: ${mode}`), { status: 400 });
}, { auth: "owner" }); // v9.1.14 · was leaking decision history
