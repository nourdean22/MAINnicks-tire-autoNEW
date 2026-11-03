/**
 * Goal moments into the brain (job 2026-11-02-nour-os-interconnect W6; research map gap 7: the brain was keyed by
 * chat topic, not by goals).
 *
 * A check-in, an achieved goal and a missed goal each write ONE BrainMemory row, category goal_moment (a one-shot
 * record: no probation, no TTL, never merged or swept; categories.ts), key
 * `goal_event:<GoalEvent.id>`, metadata { goalId, kind, goalEventId }. The (category, key) unique index is the
 * claim: a second call for the same event finds the row and writes nothing; two racing calls both reach
 * brainMemory.remember, which reinforces the one row (or the loser's create hits P2002, read as a duplicate). The
 * goal is matched by id only; the note is never parsed for a target. Task completions are not written (too many).
 *
 * Called fire-and-forget after the GoalEvent commits: logGoalCheckIn (lib/services/goal-checkin.ts) and
 * emitGoalEvent for achieved/missed (lib/brain/goal-events.ts, which holds the event id). Never throws. The row goes
 * through brainMemory.remember (the admission gate; check:memory-admission), which embeds it on create; a failed
 * embed keeps the row and the embed-backfill cron's brain_memory lane picks it up.
 */
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/goal-brain");

export const GOAL_MOMENT_SOURCE = "goal-moment";
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

/** Every no-write except a duplicate is logged: a moment that never reaches the brain must leave a trace. */
export async function afterGoalMoment(m: GoalMomentInput): Promise<GoalMomentResult> {
  let r: GoalMomentResult;
  try {
    r = await writeGoalMoment(m);
  } catch (err) {
    log.warn("goal_memory_write_failed", { goalEventId: m.goalEventId, goalId: m.goalId, err: errMsg(err) });
    return { written: false, reason: errMsg(err) };
  }
  if (!r.written && r.reason !== "duplicate") {
    log.warn("goal_memory_not_written", { goalEventId: m.goalEventId, goalId: m.goalId, kind: m.kind, reason: r.reason });
  }
  return r;
}

async function writeGoalMoment(m: GoalMomentInput): Promise<GoalMomentResult> {
  if (!isGoalBrainKind(m.kind)) return { written: false, reason: `kind ${m.kind} is not written to the brain` };
  const goal = await prisma.lifeGoal.findFirst({ where: { id: m.goalId }, select: { id: true, title: true } });
  if (!goal) return { written: false, reason: "goal not found" };
  const content =
    m.kind === "check_in"
      ? `Check-in on "${goal.title}" (${m.health ?? "unknown"}): ${m.text?.trim() || "no note"}`
      : `${m.kind === "achieved" ? "Achieved" : "Missed"} "${goal.title}"`;
  const key = `goal_event:${m.goalEventId}`;
  const prior = await prisma.brainMemory.findUnique({
    where: { category_key: { category: BRAIN_CATEGORIES.GOAL_MOMENT, key } },
    select: { id: true },
  });
  if (prior) return { written: false, reason: "duplicate" };
  try {
    const { brainMemory } = await import("@/lib/brain/memory-manager");
    const row = await brainMemory.remember(BRAIN_CATEGORIES.GOAL_MOMENT, key, content, GOAL_MOMENT_SOURCE, {
      goalId: goal.id,
      kind: m.kind,
      goalEventId: m.goalEventId,
    });
    return { written: true, id: row.id };
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return { written: false, reason: "duplicate" };
    throw err;
  }
}
