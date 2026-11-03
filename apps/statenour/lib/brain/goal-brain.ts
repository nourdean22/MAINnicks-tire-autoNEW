/**
 * Goal moments into the brain (job 2026-11-02-nour-os-interconnect W6; research map gap 7: the brain was keyed by
 * chat topic, not by goals).
 *
 * A check-in, an achieved goal and a missed goal each write ONE BrainMemory row, category goal, key
 * `goal_event:<GoalEvent.id>`, metadata { goalId, kind, goalEventId }. The (category, key) unique index is the
 * claim: a second call for the same event hits P2002 and writes nothing (claim-before-act rule 4). The goal is
 * matched by id only; the note is never parsed for a target. Task completions are not written (too many).
 *
 * Called fire-and-forget after the GoalEvent commits: logGoalCheckIn (lib/services/goal-checkin.ts) and
 * emitGoalEvent for achieved/missed (lib/brain/goal-events.ts, which holds the event id). Never throws. A failed
 * embed keeps the row: the embed-backfill cron's brain_memory lane picks up any row with no vector.
 */
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { storeMemoryEmbedding } from "@/lib/brain/embedding-utils";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/goal-brain");

export const GOAL_BRAIN_KINDS = ["check_in", "achieved", "missed"] as const;
type GoalBrainKind = (typeof GOAL_BRAIN_KINDS)[number];
const isGoalBrainKind = (k: string): k is GoalBrainKind => (GOAL_BRAIN_KINDS as readonly string[]).includes(k);

export interface GoalMomentInput {
  goalEventId: string;
  goalId: string;
  kind: string;
  /** The check-in note. */
  text?: string;
  /** The check-in health. */
  health?: string;
}

export type GoalMomentResult = { written: true; id: string } | { written: false; reason: string };

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function afterGoalMoment(m: GoalMomentInput): Promise<GoalMomentResult> {
  if (!isGoalBrainKind(m.kind)) return { written: false, reason: `kind ${m.kind} is not written to the brain` };
  try {
    const goal = await prisma.lifeGoal.findFirst({ where: { id: m.goalId }, select: { id: true, title: true } });
    if (!goal) return { written: false, reason: "goal not found" };
    const content =
      m.kind === "check_in"
        ? `Check-in on "${goal.title}" (${m.health ?? "unknown"}): ${m.text?.trim() || "no note"}`
        : `${m.kind === "achieved" ? "Achieved" : "Missed"} "${goal.title}"`;
    let row: { id: string };
    try {
      row = await prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.GOAL,
          key: `goal_event:${m.goalEventId}`,
          content,
          confidence: 0.85,
          source: "goal-moment",
          createdBy: "system",
          metadata: { goalId: goal.id, kind: m.kind, goalEventId: m.goalEventId },
        },
        select: { id: true },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") return { written: false, reason: "duplicate" };
      throw err;
    }
    try {
      await storeMemoryEmbedding(row.id, `[goal] ${content}`);
    } catch (err) {
      log.warn("goal_memory_embed_failed", { goalEventId: m.goalEventId, memoryId: row.id, err: errMsg(err) });
    }
    return { written: true, id: row.id };
  } catch (err) {
    log.warn("goal_memory_write_failed", { goalEventId: m.goalEventId, goalId: m.goalId, err: errMsg(err) });
    return { written: false, reason: errMsg(err) };
  }
}
