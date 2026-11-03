/**
 * The weekly review (job 2026-11-02-nour-os-interconnect W7, Sunsama S3/S4): per active goal, the tasks done and
 * the journal entries written since the last review; extend or close a WEEK goal; the reflection is saved as
 * journal entries already grounded to their goal.
 *
 * No second store: a review IS journal entries (brain_dumps, entryType REVIEW_ENTRY_TYPE), and the newest one is
 * "the last review". No AI call: his words are the reflection, and the grounding columns are set directly
 * (confidence 1, confirmed, enrichedAt stamped so the journal-brain sweep never re-grounds them). One entry per
 * goal note because an entry carries one goalId; the week note is ungrounded.
 *
 * GUARD: extend/close and note grounding match goal ids against the server's own active-goal list. Free text is
 * stored, never parsed for ids (tests/services/weekly-review.test.tsx carries the canary).
 */
import { prisma } from "@/lib/prisma";
import { goalDue } from "@/lib/brain/goal-pace";
import { updateGoal } from "@/lib/services/goals";
import { TASK_GOAL_SELECT, taskGoalServer } from "@/lib/services/task-goal-server";
import { logGoalCheckIn } from "@/lib/services/goal-checkin";
import type { CheckInHealth } from "@/lib/brain/goal-pace";
import { clip } from "@/lib/utils/clip";
import { REVIEW_ENTRY_TYPE } from "@/lib/brain/journal-review-marker";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/weekly-review");

/** CONTROLS RULE: the review window with no past review, its cap, the extension, and the marker, named once. */
export const REVIEW_WINDOW_DAYS = 7;
export const REVIEW_MAX_DAYS = 28;
export const REVIEW_EXTEND_DAYS = 7;
// The marker is shared with the journal brain, whose sweeps leave review rows alone (journal-review-marker.ts).
export { REVIEW_ENTRY_TYPE };
const REVIEW_GOALS_CAP = 20;
export const REVIEW_ROWS_CAP = 500;

const DAY_MS = 86_400_000;

export interface ReviewGoal {
  goal: { id: string; title: string; horizon: string | null; due: string | null; canExtendOrClose: boolean };
  doneTasks: { taskId: string; title: string; at: string }[];
  entries: { id: string; excerpt: string; at: string }[];
}

export interface WeeklyReviewRead {
  since: string;
  lastReviewAt: string | null;
  goals: ReviewGoal[];
  /** Side reads that threw ("last review" | "done tasks" | "entries"); their rows are missing, not zero. */
  failed: string[];
  /** A side read filled REVIEW_ROWS_CAP: older rows in the window are not shown. */
  truncated: boolean;
}

async function activeGoals() {
  return prisma.lifeGoal.findMany({
    where: { deletedAt: null, status: "active" },
    orderBy: [{ deadline: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: REVIEW_GOALS_CAP,
    select: { id: true, title: true, horizon: true, deadline: true, createdAt: true },
  });
}

export async function readWeeklyReview(now: Date = new Date()): Promise<WeeklyReviewRead> {
  const failed: string[] = [];
  const warn = (read: string, err: unknown) => {
    log.warn("review_read_failed", { read, err: err instanceof Error ? err.message : String(err) });
    failed.push(read);
  };

  let lastReviewAt: Date | null = null;
  try {
    const last = await prisma.brainDump.findFirst({
      where: { entryType: REVIEW_ENTRY_TYPE, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    lastReviewAt = last?.createdAt ?? null;
  } catch (err) {
    warn("last review", err);
  }
  const floor = new Date(now.getTime() - REVIEW_MAX_DAYS * DAY_MS);
  const since = lastReviewAt ? (lastReviewAt > floor ? lastReviewAt : floor) : new Date(now.getTime() - REVIEW_WINDOW_DAYS * DAY_MS);

  // No goals list, no review: this one throws to the page.
  const goals = await activeGoals();
  const rows = new Map<string, ReviewGoal>(
    goals.map((g) => {
      const horizon = g.horizon?.toUpperCase() ?? null;
      return [
        g.id,
        {
          goal: { id: g.id, title: g.title, horizon, due: goalDue(g).at, canExtendOrClose: horizon === "WEEK" },
          doneTasks: [],
          entries: [],
        },
      ];
    }),
  );
  if (rows.size === 0) {
    return { since: since.toISOString(), lastReviewAt: lastReviewAt?.toISOString() ?? null, goals: [], failed, truncated: false };
  }

  const ids = [...rows.keys()];
  const [events, dumps] = await Promise.allSettled([
    prisma.taskEvent.findMany({
      // gt, not gte: the last review's own rows sit exactly at `since` and are not this week's work.
      // Only completions that can land on a reviewed goal, so the cap is spent on them (own goal, else the mission's).
      where: {
        kind: "completed",
        createdAt: { gt: since },
        task: { OR: [{ goalId: { in: ids } }, { goalId: null, mission: { lifeGoalId: { in: ids } } }] },
      },
      orderBy: { createdAt: "desc" },
      take: REVIEW_ROWS_CAP,
      select: { createdAt: true, task: { select: { id: true, title: true, ...TASK_GOAL_SELECT } } },
    }),
    prisma.brainDump.findMany({
      where: { goalId: { in: ids }, deletedAt: null, createdAt: { gt: since } },
      orderBy: { createdAt: "desc" },
      take: REVIEW_ROWS_CAP,
      select: { id: true, goalId: true, rawThoughts: true, createdAt: true },
    }),
  ]);

  let truncated = false;
  if (events.status === "fulfilled") {
    if (events.value.length >= REVIEW_ROWS_CAP) truncated = true;
    for (const e of events.value) {
      // The ONE task-goal rule (lib/services/task-goal-server.ts): own live goal, else the mission's.
      const gid = e.task ? (taskGoalServer(e.task)?.id ?? null) : null;
      const row = gid ? rows.get(gid) : undefined;
      if (!row || !e.task || row.doneTasks.some((t) => t.taskId === e.task!.id)) continue;
      row.doneTasks.push({ taskId: e.task.id, title: e.task.title, at: e.createdAt.toISOString() });
    }
  } else warn("done tasks", events.reason);

  if (dumps.status === "fulfilled") {
    if (dumps.value.length >= REVIEW_ROWS_CAP) truncated = true;
    for (const d of dumps.value) {
      const row = d.goalId ? rows.get(d.goalId) : undefined;
      if (row) row.entries.push({ id: d.id, excerpt: clip(d.rawThoughts, 160), at: d.createdAt.toISOString() });
    }
  } else warn("entries", dumps.reason);

  return { since: since.toISOString(), lastReviewAt: lastReviewAt?.toISOString() ?? null, goals: [...rows.values()], failed, truncated };
}

export interface SaveWeeklyReviewInput {
  /** Minted once per review form; a retry with the same id returns the rows already saved (claim-before-act). */
  reviewId: string;
  /** The week's reflection; saved ungrounded. */
  week: string;
  /** One note per goal; each is saved grounded to its goal. With a health chip it is also that goal's check-in (W8a, S3). */
  notes: { goalId: string; text: string; health?: CheckInHealth }[];
  extend: string[];
  /** W8a (S4): "Close" split in two. Each sets the goal's status, so updateGoal emits the event and the brain moment. */
  achieved: string[];
  missed: string[];
}

export interface SaveWeeklyReviewResult {
  saved: string[];
  extended: string[];
  achieved: string[];
  missed: string[];
  /** Goals whose note landed as a check-in (logGoalCheckIn, source weekly-review); a same-day duplicate counts. */
  checkedIn: string[];
  /** Ids that are not active goals (or not WEEK goals, for extend/close): never acted on. */
  skipped: string[];
  /** Goal actions that threw; the entries were already saved. */
  failed: string[];
  /** Goals whose note was saved WITHOUT a goal: the goal left the active list between the read and the save. */
  ungrounded: string[];
  /** This reviewId was already saved: its rows are returned and nothing is written or acted on again. */
  replayed: boolean;
}

export async function saveWeeklyReview(input: SaveWeeklyReviewInput, now: Date = new Date()): Promise<SaveWeeklyReviewResult> {
  const week = input.week.trim();
  const notes = input.notes.map((n) => ({ goalId: n.goalId, text: n.text.trim(), health: n.health })).filter((n) => n.text);
  if (!week && notes.length === 0) throw new Error("Write one line before saving the review.");

  const goals = new Map((await activeGoals()).map((g) => [g.id, g]));
  const isWeek = (id: string) => goals.get(id)?.horizon?.toUpperCase() === "WEEK";
  const skipped: string[] = [];

  const date = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  // A note whose goal left the active list is saved ungrounded, never dropped: his words outlive the goal.
  const ungrounded = notes.filter((n) => !goals.has(n.goalId)).map((n) => n.goalId);
  const rows = [...notes.map((n) => [n.text, goals.has(n.goalId) ? n.goalId : null] as const), ...(week ? [[week, null] as const] : [])];
  if (rows.length === 0) throw new Error("Write one line before saving the review.");

  // One serializable transaction keyed by the form's reviewId: a failure saves nothing, and a retry after a commit
  // whose response was lost (a phone dropping signal) finds its own rows and writes nothing twice. Two concurrent
  // saves of one id conflict under SERIALIZABLE and one fails, so they cannot both write. Each row gets its own
  // instant, the week entry last, so the newest review row (the next review's `since`) is never one of its notes.
  const marker = JSON.stringify({ reviewId: input.reviewId });
  const { ids: saved, replayed } = await prisma.$transaction(
    async (tx) => {
      const prior = await tx.brainDump.findMany({
        where: { entryType: REVIEW_ENTRY_TYPE, extractedItems: marker },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (prior.length > 0) return { ids: prior.map((p) => p.id), replayed: true };
      const ids: string[] = [];
      for (const [i, [rawThoughts, goalId]] of rows.entries()) {
        const row = await tx.brainDump.create({
          data: {
            date,
            rawThoughts,
            actionsTaken: 0,
            entryType: REVIEW_ENTRY_TYPE,
            extractedItems: marker,
            goalId,
            linkConfidence: goalId ? 1 : null,
            linkStatus: goalId ? "confirmed" : null,
            enrichedAt: now,
            createdAt: new Date(now.getTime() + i),
          },
          select: { id: true },
        });
        ids.push(row.id);
      }
      return { ids, replayed: false };
    },
    { isolationLevel: "Serializable" },
  );
  if (replayed) return { saved, extended: [], achieved: [], missed: [], checkedIn: [], skipped, failed: [], ungrounded, replayed };

  const extended: string[] = [];
  const achieved: string[] = [];
  const missed: string[] = [];
  const checkedIn: string[] = [];
  const failed: string[] = [];
  const act = async (id: string, run: () => Promise<unknown>, done: string[]) => {
    try {
      await run();
      done.push(id);
    } catch (err) {
      log.warn("review_goal_action_failed", { goalId: id, err: err instanceof Error ? err.message : String(err) });
      failed.push(id);
    }
  };
  // W8a (S3): a grounded note with a health chip IS the goal's check-in (one per goal per day; the goal card and
  // Nick's tool write the same row). The note is already saved above, so a failed check-in loses nothing written.
  for (const n of notes) {
    if (!n.health || !goals.has(n.goalId)) continue;
    await act(n.goalId, () => logGoalCheckIn({ goalId: n.goalId, health: n.health!, note: n.text, source: "weekly-review" }), checkedIn);
  }
  // W8a (S4): "Close" is two words now. Achieved and missed set the status, so updateGoal emits the GoalEvent
  // (achieved / missed) and the brain moment; the old "completed" wrote neither. Achieved wins over missed.
  const achievedIds = new Set(input.achieved);
  const missedIds = new Set(input.missed.filter((id) => !achievedIds.has(id)));
  for (const id of achievedIds) {
    if (!isWeek(id)) skipped.push(id);
    else await act(id, () => updateGoal({ id, status: "achieved" }), achieved);
  }
  for (const id of missedIds) {
    if (!isWeek(id)) skipped.push(id);
    else await act(id, () => updateGoal({ id, status: "missed" }), missed);
  }
  const close = new Set([...achievedIds, ...missedIds]);
  for (const id of new Set(input.extend)) {
    if (close.has(id) && isWeek(id)) continue;
    if (!isWeek(id)) {
      skipped.push(id);
      continue;
    }
    const due = goalDue(goals.get(id)!).at;
    const base = due && Date.parse(due) >= now.getTime() ? Date.parse(due) : now.getTime();
    const deadline = new Date(base + REVIEW_EXTEND_DAYS * DAY_MS).toISOString();
    await act(id, () => updateGoal({ id, deadline }), extended);
  }

  return { saved, extended, achieved, missed, checkedIn, skipped, failed, ungrounded, replayed: false };
}
