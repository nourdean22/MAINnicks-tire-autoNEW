/**
 * W8c · the goal an unlinked mission most likely belongs under, for the edit drawer's "Suggested: <goal> · Use"
 * (Sunsama S1 at the mission level; 0 of 13 prod missions carried a goal).
 *
 * Embedding basis: the linker's cosine (lib/db/conversation-mission-linker.ts) between the mission's stored vector
 * (sourceType "mission") and each active goal's (sourceType "life_goal", written by the same nightly cron), used
 * only when EVERY active goal has a vector in the mission's model; a cross-model cosine is not a match. Otherwise
 * the whole rank falls back to a word-overlap score and says so (basis "words"). Never both, never title words when
 * the vectors exist. The result is keyed by the goal's id from the server's own active list.
 *
 * A failed read throws (the drawer says "couldn't suggest"); null is a measured no-match.
 */
import { prisma } from "@/lib/prisma";
import { cosineSimilarity } from "@/lib/db/conversation-mission-linker";
import { GOAL_EMBED_SOURCE_TYPE, SUGGEST_GOAL_MAX_GOALS, goalEmbedText } from "@/lib/missions/goal-embedding";

export { SUGGEST_GOAL_MAX_GOALS };
/** The linker's own noise floor (its reviewThreshold): below it a pair is noise, not a suggestion. */
export const SUGGEST_GOAL_MIN_COSINE = 0.45;
/** Dice overlap of content words for the fallback; 0.25 is about one shared word in four. */
export const SUGGEST_GOAL_MIN_WORDS = 0.25;

export interface GoalSuggestion {
  goalId: string;
  title: string;
  score: number;
  basis: "embedding" | "words";
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "onto", "your", "our", "out", "get", "got", "make",
  "more", "than", "then", "have", "has", "had", "was", "are", "were", "will", "can", "all", "any", "not", "but",
  "each", "every", "per", "via", "about", "over", "under", "just", "new", "one", "off",
]);

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

/** Dice coefficient over content words: 0 shares nothing, 1 is the same word set. */
export function wordOverlapScore(a: string, b: string): number {
  const wa = contentWords(a);
  const wb = contentWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return (2 * shared) / (wa.size + wb.size);
}

function parseVector(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

/**
 * Which answer the drawer shows: four different states, never one null for all of them (manager round 1 P2-9).
 * "no_match" is the only measured no-match; a failed read throws.
 */
export type GoalSuggestionStatus =
  | { status: "linked" }
  | { status: "no_active_goals" }
  | { status: "no_match"; basis: GoalSuggestion["basis"] }
  | { status: "suggested"; suggestion: GoalSuggestion };

/** The suggestion alone (null for every non-suggestion state); W13's backfill imports this signature. */
export async function suggestGoalForMission(missionId: string): Promise<GoalSuggestion | null> {
  const r = await suggestGoalStatusForMission(missionId);
  return r.status === "suggested" ? r.suggestion : null;
}

export async function suggestGoalStatusForMission(missionId: string): Promise<GoalSuggestionStatus> {
  const mission = await prisma.mission.findFirst({
    where: { id: missionId, deletedAt: null },
    select: { id: true, title: true, successMetric: true, completionCriteria: true, lifeGoalId: true },
  });
  if (!mission) throw new Error("Mission not found.");
  if (mission.lifeGoalId) return { status: "linked" };

  const goals = await prisma.lifeGoal.findMany({
    where: { status: "active", deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: SUGGEST_GOAL_MAX_GOALS,
    select: { id: true, title: true, why: true },
  });
  if (goals.length === 0) return { status: "no_active_goals" };

  const rows = await prisma.vectorEmbedding.findMany({
    where: {
      OR: [
        { sourceType: "mission", sourceId: mission.id },
        { sourceType: GOAL_EMBED_SOURCE_TYPE, sourceId: { in: goals.map((g) => g.id) } },
      ],
    },
    select: { sourceType: true, sourceId: true, embedding: true, model: true },
  });
  const missionRow = rows.find((r) => r.sourceType === "mission");
  const missionVec = missionRow ? parseVector(missionRow.embedding) : [];
  const space = missionRow?.model ?? null;
  const goalVecs = new Map<string, number[]>();
  for (const r of rows) {
    if (r.sourceType !== GOAL_EMBED_SOURCE_TYPE || !space || r.model !== space) continue;
    const v = parseVector(r.embedding);
    if (v.length > 0) goalVecs.set(r.sourceId, v);
  }

  let best: GoalSuggestion | null = null;
  if (missionVec.length > 0 && goals.every((g) => goalVecs.has(g.id))) {
    for (const g of goals) {
      const score = cosineSimilarity(missionVec, goalVecs.get(g.id)!);
      if (score >= SUGGEST_GOAL_MIN_COSINE && (!best || score > best.score)) best = { goalId: g.id, title: g.title, score, basis: "embedding" };
    }
    return best ? { status: "suggested", suggestion: best } : { status: "no_match", basis: "embedding" };
  }

  // shortcut: word overlap until every active goal has a same-model vector (the nightly cron writes them).
  const criteria = typeof mission.completionCriteria === "string" ? mission.completionCriteria : "";
  const missionText = [mission.title, mission.successMetric ?? "", criteria].join("\n");
  for (const g of goals) {
    const score = wordOverlapScore(missionText, goalEmbedText(g));
    if (score >= SUGGEST_GOAL_MIN_WORDS && (!best || score > best.score)) best = { goalId: g.id, title: g.title, score, basis: "words" };
  }
  return best ? { status: "suggested", suggestion: best } : { status: "no_match", basis: "words" };
}
