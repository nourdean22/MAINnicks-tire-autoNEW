/**
 * Task action services · Phase RR (2026-05-19 AM).
 *
 * Single source of truth for the 3 specialized task-write actions that
 * historically lived as inline logic in /api/tasks/[id]/{check,start,
 * break-promise} route handlers. Now both the legacy REST endpoints
 * AND the new `trpc.task.{check,start,breakPromise}` mutations call
 * the same functions · drift between consumers structurally impossible.
 *
 * Why these are separate from `services/tasks.updateTask`:
 *   · checkTask owns the 3-branch DAILY/PROMISE/ONCE completion logic
 *     + the cross-engine auto-learn fanout (mastery + knowledge +
 *     learn) + reality-gap writeback + skill reinforcement. The plain
 *     status PATCH path through updateTask only handles the bare
 *     status transition.
 *   · startTask is idempotent (refreshes a null startedAt without
 *     resetting a live one) and emits TaskEvent.started in cases the
 *     PATCH path missed in pre-Wave-52.
 *   · breakPromise has its own pattern-detection + BrainMemory write
 *     for the per-cause breakage analytics.
 *
 * NOT extracted in this phase:
 *   · The 300-line check-route body INCLUDING auto-learn, reality-gap,
 *     skill-reinforce, ghost-Nick outcome blocks · those stay coupled
 *     here so the migration doesn't accidentally tear the logic apart.
 *     If a future phase wants to break this up, the tests will catch
 *     drift.
 */

import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { emitTaskCompleted } from "@/lib/db/brain-bus-emit";
import { logger as rootLogger } from "@/lib/logger";
import { runAutoLearn, type AutoLearnReport } from "@/lib/services/auto-learn";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { auditUpdate } from "@/lib/db/actor";
import { logUpdate, stripNoise } from "@/lib/db/entity-audit";
import { emitTaskEventAsync } from "@/lib/brain/task-events";
import { createTask as createTaskService, liftGoalOnTaskComplete } from "@/lib/services/tasks";
import { creditTaskStats } from "@/lib/mastery/goal-stats";
import type { TaskReward } from "@/lib/mastery/task-reward";
import { resolveInboxMissionId } from "@/lib/services/missions";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { nextWeekdayOccurrence } from "@/lib/loops/weekday";

const log = rootLogger.withSurface("services/task-actions");

export type CheckAction = "complete" | "break";

export interface CheckTaskResult {
  ok: true;
  task?: {
    id: string;
    status?: string;
    loopKind?: string;
    streakCount?: number;
    lastCompletedAt?: Date | null;
    actualMinutes?: number | null;
    effort?: string | null;
  };
  idempotent?: boolean;
  streakCount?: number;
  lastCompletedAt?: Date | null;
  broken?: boolean;
  timeAdded?: number;
  autoLearn?: AutoLearnReport | null;
  /** 2026-05-23 · task #22 · count of subtasks marked DONE via the
   *  cascade · 0 when cascadeChildren was false or no open children
   *  existed. Client uses this for toast messaging ("completed parent
   *  + 3 subtasks"). */
  childrenCascaded?: number;
  /** 2026-06-09 · Wire #2 · the reward signal the /missions toast renders
   *  (real XP credited, goal-lift, streak). Only set on a completion. */
  reward?: TaskReward;
}

/**
 * Unified check / break-promise / daily-completion endpoint.
 *
 *   ONCE    → status = DONE
 *   PROMISE → status = DONE (success) or ARCHIVED (broken via action=break)
 *   DAILY   → lastCompletedAt = now · streakCount bumped
 *             Status stays READY so the loop keeps reappearing.
 *             Streak resets to 1 if the gap since last check > 1 day.
 *
 * Lifted verbatim from /api/tasks/[id]/check/route.ts · same effects,
 * same shape, same idempotency. Throws ServiceError on 404.
 */
export async function checkTask(args: {
  id: string;
  action?: string;
  /** 2026-05-23 · task #22 · ADR-0017 Rule 1 Option A · when the
   *  operator completes a parent task with open children, the UI
   *  prompts "complete N subtasks too?" and passes cascadeChildren
   *  on yes. The cascade happens AFTER the parent is marked DONE ·
   *  finds all children where parentTaskId === id and status NOT IN
   *  [DONE, ARCHIVED] and marks them DONE atomically (TaskStatus
   *  enum has no CANCELLED · DONE + ARCHIVED are the terminal states).
   *  When undefined or false, the legacy behavior holds (parent only ·
   *  children stay open · half-state allowed). Skipped for DAILY
   *  (DAILY just bumps streak · cascade semantics don't apply). */
  cascadeChildren?: boolean;
  completionNote?: string | null;
  outcomeScore?: number | null;
}): Promise<CheckTaskResult> {
  const { id } = args;
  const action: CheckAction = args.action === "break" ? "break" : "complete";
  const cascadeChildren = args.cascadeChildren === true;

  const task = await prisma.task.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      finishCondition: true,
      missionId: true,
      loopKind: true,
      status: true,
      lastCompletedAt: true,
      streakCount: true,
      startedAt: true,
      actualMinutes: true,
      context: true,
      effort: true,
      autoPriority: true,
      roiScore: true,
      goalId: true,
      mission: { select: { title: true, domain: true } },
      goal: { select: { domain: true } },
    },
  });

  if (!task) throw new ServiceError("Task not found", 404);

  const now = new Date();

  // Time-tracking diff
  let timeBump = 0;
  if (task.startedAt) {
    const deltaMs = now.getTime() - new Date(task.startedAt).getTime();
    timeBump = Math.max(1, Math.round(deltaMs / 60_000));
  }

  // ── DAILY ──
  if ((task.loopKind === "DAILY" || task.loopKind === "WEEKLY") && action === "complete") {
    void timeBump;
    const isWeekly = task.loopKind === "WEEKLY";
    let nextStreak = 1;
    if (task.lastCompletedAt) {
      const last = new Date(task.lastCompletedAt);
      const lastDayStart = new Date(last.getFullYear(), last.getMonth(), last.getDate());
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const gapDays = Math.round((todayStart.getTime() - lastDayStart.getTime()) / 86_400_000);
      if (gapDays === 0) {
        return {
          ok: true,
          idempotent: true,
          streakCount: task.streakCount,
          lastCompletedAt: task.lastCompletedAt,
        };
      }
      // DAILY = consecutive-day streak; WEEKLY = simple completion count
      // (a ~7-day gap would otherwise reset the streak every week).
      nextStreak = isWeekly
        ? task.streakCount + 1
        : gapDays === 1
          ? task.streakCount + 1
          : 1;
    }

    // WEEKLY → compute the next scheduled weekday and hide the task until
    // then (status WAITING + snoozedUntil · the task-resurface cron flips it
    // back to READY on that day). DAILY stays READY so it reappears tomorrow.
    let nextStatus: "READY" | "WAITING" = "READY";
    let nextSnoozedUntil: Date | null = null;
    if (isWeekly) {
      // Lazy-load recurringDays ONLY for WEEKLY tasks · keeps the main select
      // (every DAILY/ONCE/PROMISE completion) off the new column.
      const cfg = await prisma.task.findUnique({
        where: { id },
        select: { recurringDays: true },
      });
      const next = nextWeekdayOccurrence(cfg?.recurringDays ?? [], now);
      if (next) {
        nextStatus = "WAITING";
        nextSnoozedUntil = next;
      }
    }

    const updated = await prisma.task.update({
      where: { id },
      data: {
        lastCompletedAt: now,
        lastTouchedAt: now,
        streakCount: nextStreak,
        status: nextStatus,
        ...(isWeekly ? { snoozedUntil: nextSnoozedUntil } : {}),
        completionNote: args.completionNote ?? undefined,
        outcomeScore: args.outcomeScore ?? undefined,
      },
      select: { id: true, streakCount: true, lastCompletedAt: true, loopKind: true, title: true },
    });

    void emitTaskCompleted({
      taskId: id,
      title: updated.title ?? task.title ?? "(untitled)",
      missionId: task.missionId ?? null,
      domain: task.mission?.domain ?? null,
      loopKind: task.loopKind,
      completedAt: now.toISOString(),
    });

    // 2026-06-01 · DAILY now credits character-sheet stat XP (review #3:
    // a daily habit tied to a fitness goal used to credit NOTHING). Per-day
    // keyed so each day's check-off credits once. Goal `currentValue` is NOT
    // incremented for DAILY (a daily habit would inflate concrete progress).
    // Await so the real credited XP can ride back on the response for the
    // /missions reward toast (idempotent per-day; .catch keeps it non-fatal —
    // 0 ⇒ no XP claimed). Wire #2.
    const dailyCredit = await creditTaskStats(id, { perDay: true }).catch(() => ({ statsCredited: 0, xpCredited: 0 }));

    let dailyAutoLearn: AutoLearnReport | null = null;
    try {
      dailyAutoLearn = await runAutoLearn({
        taskId: id,
        task: {
          title: updated.title ?? task.title ?? "",
          finishCondition: task.finishCondition,
          mission: task.mission
            ? { title: task.mission.title ?? null, domain: task.mission.domain ?? null }
            : null,
          goal: null,
          roiScore: task.roiScore,
          effort: task.effort,
          loopKind: task.loopKind,
          streakCount: updated.streakCount,
          hasGoalId: !!task.goalId,
        },
      });
    } catch (e) {
      log.warn("auto_learn_daily_failed", {
        taskId: id,
        err: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }

    return {
      ok: true,
      task: updated,
      autoLearn: dailyAutoLearn,
      reward: {
        xpCredited: dailyCredit.xpCredited,
        statsCredited: dailyCredit.statsCredited,
        goalLifted: false,
        streak: updated.streakCount,
      },
    };
  }

  // ── PROMISE broken ──
  if (task.loopKind === "PROMISE" && action === "break") {
    const updated = await prisma.task.update({
      where: { id },
      data: { status: "ARCHIVED", lastTouchedAt: now },
      select: { id: true, status: true, loopKind: true },
    });

    void (async () => {
      try {
        const { matchSkillsForTask, reinforceSkill } = await import(
          "@/lib/brain/skill-extractor"
        );
        const matchedKeys = await matchSkillsForTask({
          context: task.context,
          effort: task.effort,
          autoPriority: task.autoPriority,
          missionDomain: task.mission?.domain ?? null,
        });
        for (const key of matchedKeys) {
          await reinforceSkill(key, false).catch(() => {});
        }
      } catch (e) {
        log.warn("skill_reinforce_break_failed", {
          taskId: id,
          err: e instanceof Error ? e.message.slice(0, 200) : String(e),
        });
      }
    })();

    return { ok: true, task: updated, broken: true };
  }

  // ── ONCE + PROMISE complete ──
  const updated = await prisma.task.update({
    where: { id },
    data: {
      status: "DONE",
      lastTouchedAt: now,
      lastCompletedAt: now,
      actualMinutes: (task.actualMinutes ?? 0) + timeBump,
      startedAt: null,
      completionNote: args.completionNote ?? undefined,
      outcomeScore: args.outcomeScore ?? undefined,
    },
    select: { id: true, status: true, loopKind: true, actualMinutes: true, effort: true },
  });

  // 2026-05-23 · task #22 · ADR-0017 Rule 1 Option A · cascade
  // children when the operator opted in via UI prompt. Single
  // updateMany so all open subtasks transition to DONE in one query
  // (atomic · idempotent · re-running with already-DONE children is
  // a no-op because the WHERE clause excludes them).
  //
  // NOT cascading: status="ARCHIVED" + soft-deleted rows · operator
  // may have already chosen those terminal states intentionally ·
  // cascade respects that. (TaskStatus has no CANCELLED · DONE +
  // ARCHIVED are the only terminal states in the enum.)
  let childrenCascaded = 0;
  if (cascadeChildren) {
    try {
      // Capture the child ids BEFORE the bulk update so each cascaded
      // completion can credit stats + lift its goal (2026-06-01 — the bulk
      // updateMany otherwise bypasses every completion hook).
      const cascadedChildren = await prisma.task.findMany({
        where: { parentTaskId: id, status: { notIn: ["DONE", "ARCHIVED"] }, deletedAt: null },
        select: { id: true, goalId: true },
      });
      const cascadeResult = await prisma.task.updateMany({
        where: {
          parentTaskId: id,
          status: { notIn: ["DONE", "ARCHIVED"] },
          deletedAt: null,
        },
        data: {
          status: "DONE",
          lastTouchedAt: now,
          lastCompletedAt: now,
        },
      });
      childrenCascaded = cascadeResult.count;
      for (const child of cascadedChildren) {
        void creditTaskStats(child.id).catch(() => {});
        if (child.goalId) void liftGoalOnTaskComplete(child.goalId, child.id).catch(() => {});
      }
    } catch (e) {
      // Cascade failure shouldn't fail the parent completion · the
      // operator clicked "complete parent" first, "cascade subtasks"
      // is the bonus. Log + degrade.
      log.warn("subtask_cascade_failed", {
        parentId: id,
        err: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  }
  void childrenCascaded; // surfaced via return below

  void emitTaskCompleted({
    taskId: id,
    title: task.title ?? "(untitled)",
    missionId: task.missionId ?? null,
    domain: task.mission?.domain ?? null,
    loopKind: task.loopKind,
    completedAt: now.toISOString(),
  });

  // 2026-06-01 · credit character-sheet stat XP for every ONCE/PROMISE
  // completion via /check (goal → goal stats · else statHints · else domain).
  // Await so the real credited XP rides back for the /missions reward toast
  // (.catch ⇒ 0, never a fake claim). Wire #2.
  const onceCredit = await creditTaskStats(id).catch(() => ({ statsCredited: 0, xpCredited: 0 }));
  // CRITICAL pre-existing gap fixed: the /check route (the UI checkbox, the
  // dominant completion path) never lifted the linked goal's currentValue —
  // only the updateTask PATCH path did. So a goal-tagged task completed by
  // checkbox left its goal frozen. Now it lifts here too. Idempotent on the
  // goal side; stat XP already credited above (liftGoal is currentValue-only).
  if (task.goalId) {
    void liftGoalOnTaskComplete(task.goalId, id).catch(() => {});
  }

  let autoLearnReport: AutoLearnReport | null = null;
  try {
    autoLearnReport = await runAutoLearn({
      taskId: id,
      task: {
        title: task.title ?? "",
        finishCondition: task.finishCondition,
        mission: task.mission
          ? { title: task.mission.title ?? null, domain: task.mission.domain ?? null }
          : null,
        goal: task.goal ? { domain: task.goal.domain ?? null } : null,
        roiScore: task.roiScore,
        effort: task.effort,
        loopKind: task.loopKind,
        streakCount: task.streakCount,
        hasGoalId: !!task.goalId,
      },
    });
  } catch (e) {
    log.warn("auto_learn_failed", {
      taskId: id,
      err: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
  }

  // Reality-gap writeback · sql-pro flag · this scan benefits from a
  // composite index (status, effort, updatedAt) · current schema has
  // separate (status), (updatedAt) indexes which forces Postgres to
  // pick one and filter. At >5k DONE tasks this is the dominant cost
  // of a completion. SHADOW LOG · don't add the migration in this
  // phase · documented in J-trpc-migration.md as a follow-up.
  if (updated.actualMinutes != null && updated.actualMinutes > 0) {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
      const recent = await prisma.task.findMany({
        where: {
          status: "DONE",
          effort: updated.effort,
          actualMinutes: { gt: 0 },
          updatedAt: { gte: thirtyDaysAgo },
          deletedAt: null,
        },
        select: { actualMinutes: true },
        take: 50,
        orderBy: { updatedAt: "desc" },
      });
      if (recent.length > 0) {
        const total = recent.reduce((a, r) => a + (r.actualMinutes ?? 0), 0);
        const avg = Math.round((total / recent.length) * 10) / 10;
        await prisma.brainMemory.upsert({
          where: {
            category_key: {
              category: BRAIN_CATEGORIES.EFFORT_BAND_AVG,
              key: updated.effort ?? "unknown",
            },
          },
          create: {
            category: BRAIN_CATEGORIES.EFFORT_BAND_AVG,
            key: updated.effort ?? "unknown",
            content: JSON.stringify({
              avgMinutes: avg,
              sampleSize: recent.length,
              lastUpdatedAt: now.toISOString(),
            }),
            confidence: Math.min(0.9, 0.5 + recent.length / 40),
            source: "reality_gap_writeback",
          },
          update: {
            content: JSON.stringify({
              avgMinutes: avg,
              sampleSize: recent.length,
              lastUpdatedAt: now.toISOString(),
            }),
            confidence: Math.min(0.9, 0.5 + recent.length / 40),
            lastSeen: now,
            seenCount: { increment: 1 },
          },
        });
      }
    } catch (e) {
      log.warn("reality_gap_writeback_failed", {
        taskId: id,
        err: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  }

  void (async () => {
    try {
      const { matchSkillsForTask, reinforceSkill } = await import(
        "@/lib/brain/skill-extractor"
      );
      const matchedKeys = await matchSkillsForTask({
        context: task.context,
        effort: task.effort,
        autoPriority: task.autoPriority,
        missionDomain: task.mission?.domain ?? null,
      });
      for (const key of matchedKeys) {
        await reinforceSkill(key, true).catch(() => {});
      }
    } catch (e) {
      log.warn("skill_reinforce_failed", {
        taskId: id,
        err: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  })();

  return {
    ok: true,
    task: updated,
    timeAdded: timeBump,
    autoLearn: autoLearnReport,
    childrenCascaded,
    reward: {
      xpCredited: onceCredit.xpCredited,
      statsCredited: onceCredit.statsCredited,
      goalLifted: !!task.goalId,
      streak: null,
    },
  };
}

// ─── startTask ─────────────────────────────────────────────────

export interface StartTaskResult {
  ok: true;
  task: {
    id: string;
    status: string;
    startedAt: Date | null;
    lastTouchedAt: Date | null;
  };
}

/**
 * Idempotent start · if task is already DOING and startedAt is set
 * we don't reset the timer. If startedAt is null, refresh it.
 */
export async function startTask(id: string): Promise<StartTaskResult> {
  const task = await prisma.task.findUnique({
    where: { id },
    select: { id: true, status: true, startedAt: true, lastTouchedAt: true },
  });
  if (!task) throw new ServiceError("Task not found", 404);

  const now = new Date();
  const updated = await prisma.task.update({
    where: { id },
    data: {
      status: "DOING",
      startedAt: task.startedAt && task.status === "DOING" ? undefined : now,
      lastTouchedAt: now,
      ...auditUpdate(),
    },
    select: { id: true, status: true, startedAt: true, lastTouchedAt: true },
  });

  void logUpdate(
    "task",
    id,
    stripNoise(task as unknown as Record<string, unknown>),
    stripNoise(updated as unknown as Record<string, unknown>),
    { source: "service:task-actions.startTask", reason: "timer started" },
  );

  // Wave-52 fix · the start-button path used to bypass the TaskEvent
  // emit · keep this emit so the brain-bus + history view see the
  // start. Skip when already DOING to avoid double-recording.
  if (task.status !== "DOING") {
    emitTaskEventAsync({
      taskId: id,
      kind: "started",
      source: "service:task-actions.startTask",
    });
  }

  return { ok: true, task: updated };
}

// ─── breakPromise ──────────────────────────────────────────────

const PATTERN_RULES: Array<{ pattern: string; regex: RegExp }> = [
  { pattern: "overcommitted", regex: /\b(too much|overwhelm|no time|busy|swamped|too many)\b/i },
  { pattern: "low-energy", regex: /\b(tired|exhausted|drained|low energy|burned out|sick)\b/i },
  { pattern: "forgot", regex: /\b(forgot|slipped|missed|didn'?t remember|forgot to)\b/i },
  { pattern: "external-blocker", regex: /\b(waiting|blocked|didn'?t show|canceled|postponed)\b/i },
  { pattern: "priority-shift", regex: /\b(priority|more important|urgent|something came up)\b/i },
  { pattern: "avoidance", regex: /\b(didn'?t want|procrastinat|avoid|dread|afraid|anxious)\b/i },
  { pattern: "scope-creep", regex: /\b(bigger than|more complicated|harder than|scope|underestimat)\b/i },
];

function detectPattern(reason: string): string {
  for (const rule of PATTERN_RULES) {
    if (rule.regex.test(reason)) return rule.pattern;
  }
  return "uncategorized";
}

export interface BreakPromiseResult {
  ok: true;
  task: { id: string; status: string };
  log: { id: string } | null;
}

export class WrongLoopKindError extends Error {
  constructor(public readonly loopKind: string) {
    super(`Cannot break a ${loopKind} loop — only PROMISE`);
    this.name = "WrongLoopKindError";
  }
}

/**
 * Mark a PROMISE loop as broken with optional reason. Pattern-tags
 * the reason via cheap keyword match + writes a BrainMemory row
 * (category="promise_break") so the decision-pattern learning loop
 * sees the breakage cause.
 *
 * Throws WrongLoopKindError when called on a non-PROMISE task.
 */
export async function breakPromise(args: {
  id: string;
  reason?: string;
}): Promise<BreakPromiseResult> {
  const { id } = args;
  const reason = (args.reason || "").trim();

  const task = await prisma.task.findUnique({
    where: { id },
    select: { id: true, title: true, promiseTo: true, loopKind: true },
  });
  if (!task) throw new ServiceError("Task not found", 404);
  if (task.loopKind !== "PROMISE") {
    throw new WrongLoopKindError(task.loopKind);
  }

  const pattern = reason ? detectPattern(reason) : null;

  const [updated, logRow] = await Promise.all([
    prisma.task.update({
      where: { id },
      data: { status: "ARCHIVED", lastTouchedAt: new Date() },
      select: { id: true, status: true },
    }),
    prisma.brainMemory
      .create({
        data: {
          category: "promise_break",
          key: `task_${id}_${Date.now()}`,
          content: JSON.stringify({
            taskId: id,
            reason: reason ?? "(no reason)",
            pattern,
            brokenAt: new Date().toISOString(),
          }),
          confidence: 1.0,
          source: "task:break-promise",
        },
      })
      .catch(() => null),
  ]);

  return { ok: true, task: updated, log: logRow };
}

// ─── scoreTaskWithAI (Phase SS.2 · 2026-05-19 AM) ────────────

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    roiScore: {
      type: "number",
      minimum: 0,
      maximum: 100,
      description:
        "0-100 estimate of return-on-investment for this task. " +
        "Higher = more leverage per minute spent. Anchor at 50 = average. " +
        "Reserve 80+ for clear high-leverage moves, 20- for chores.",
    },
    reasoning: {
      type: "string",
      description: "1 sentence · why this score · plain English · lowercase.",
    },
  },
  required: ["roiScore"],
};

export interface ScoreTaskResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  roiScore?: number;
  reasoning?: string | null;
  error?: string;
}

/**
 * Phase SS.2 · AI-grade a task's roiScore. The quick-add path
 * hardcodes roiScore=50 · this asks Nick to read the task title +
 * finish condition + mission domain and return a 0-100 score.
 *
 * Idempotent: only updates when current roiScore is the default 50
 * (i.e. operator hasn't manually graded yet) or when explicitly
 * overridden via `force=true`.
 *
 * Called by BOTH the legacy POST /api/tasks/[id]/score AND the new
 * `trpc.task.score` mutation · drift impossible.
 */
export async function scoreTaskWithAI(args: {
  id: string;
  force?: boolean;
}): Promise<ScoreTaskResult> {
  // Lazy-import the AI module · keeps cold-start fast for callers
  // that never invoke this path.
  const { createStructuredAiResponse, AiUnavailableError } = await import(
    "@/lib/ai/structured"
  );

  const task = await prisma.task.findUnique({
    where: { id: args.id },
    select: {
      id: true,
      title: true,
      finishCondition: true,
      roiScore: true,
      mission: { select: { title: true, domain: true } },
    },
  });
  if (!task) return { ok: false, error: "task not found" };

  if (task.roiScore !== 50 && !args.force) {
    return { ok: true, skipped: true, reason: "operator-graded" };
  }

  const systemPrompt =
    `You score tasks for an operator who runs a tire shop + builds his own personal OS. ` +
    `Return a roiScore 0-100 where higher = more leverage per minute. ` +
    `Anchor: 50 = average. Reserve 80+ for clear leverage moves. ` +
    `Lowercase reasoning · plain English · no AI clichés.`;

  const userPrompt = `Task title: ${task.title}
Finish condition: ${task.finishCondition ?? "(none)"}
Mission: ${task.mission?.title ?? "(none)"}
Mission domain: ${task.mission?.domain ?? "(none)"}`;

  try {
    const result = await createStructuredAiResponse<{
      roiScore: number;
      reasoning?: string;
    }>({
      systemPrompt,
      userPrompt,
      schemaName: "task_roi_score",
      schema: SCORE_SCHEMA,
    });

    const next = Math.max(
      0,
      Math.min(100, Math.round(Number(result.roiScore) || 50)),
    );
    await prisma.task.update({
      where: { id: args.id },
      data: {
        roiScore: next,
        autoPriorityExplanation: result.reasoning
          ? `roi · ${result.reasoning}`.slice(0, 240)
          : undefined,
      },
    });

    return {
      ok: true,
      roiScore: next,
      reasoning: result.reasoning ?? null,
    };
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      log.warn("ai_unavailable", { taskId: args.id, code: err.code });
      return { ok: false, error: "ai_unavailable" };
    }
    log.warn("score_failed", {
      taskId: args.id,
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return { ok: false, error: "internal" };
  }
}

// ─── createTaskFromAPI (Phase SS · 2026-05-19 AM) ────────────

interface CreateTaskAPIPayload {
  title?: string;
  missionId?: string;
  priority?: string;
  [key: string]: unknown;
}

/**
 * Phase SS · the API-level task-creation wrapper. Encapsulates the
 * inbox-default-on-missing-missionId logic, the createTask service
 * call, AND the post-create Telegram notification so both the legacy
 * POST /api/tasks REST route and the new `trpc.task.create` mutation
 * call the same function · drift impossible.
 *
 * The route-handler version was just an inline body; this lifts it
 * to the service layer so the tRPC mutation gets the same behavior.
 *
 * Telegram failures are logged-not-thrown · creating a task must
 * NEVER block on the notification path.
 */
export async function createTaskFromAPI(
  payload: CreateTaskAPIPayload,
): Promise<unknown> {
  // Inbox-default · pre-Wave-43 the chat long-press onCreateTask +
  // omni-capture /task fast-path POSTed without missionId and silently
  // failed the taskCreateSchema validation (required field). Operator
  // saw a haptic error toast and lost the capture. Now we backfill
  // server-side so every caller that omits missionId still lands in
  // the Inbox cleanly.
  if (!payload.missionId || typeof payload.missionId !== "string") {
    try {
      payload.missionId = await resolveInboxMissionId();
    } catch (err) {
      log.warn("missionId_default_failed", {
        title: payload.title?.slice(0, 60),
        error: sanitizeError(err),
      });
    }
  }

  const result = await createTaskService(payload);

  // Telegram notification · fire-and-forget · errors surfaced via
  // structured logger so /system/errors picks them up if the token
  // rotated / chat deleted / network blip.
  try {
    const { sendTelegram } = await import("@/lib/services/telegram");
    await sendTelegram(
      `📋 NEW TASK CREATED\n\n` +
        `${payload.title || "Untitled"}\n` +
        `Mission: ${payload.missionId || "Inbox"}\n` +
        `Priority: ${payload.priority || "normal"}`,
    );
  } catch (err) {
    log.warn("telegram_notify_failed", {
      action: "task_created",
      title: payload.title?.slice(0, 60),
      error: sanitizeError(err),
    });
  }

  return result;
}
