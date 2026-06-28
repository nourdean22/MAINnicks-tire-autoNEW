/**
 * lib/trpc/routers/task.ts · Phase PP (2026-05-19 AM).
 *
 * Task-domain procedures · the 6th domain router (nick · operator ·
 * system · chat · browser · task). Wraps the 4 read endpoints the
 * /tasks page polls together (list + missions + goals + actions-brain)
 * so the page can swap its `Promise.all([authedFetch, authedFetch,
 * authedFetch])` for 4 typed useQueries.
 *
 * Scope · READS ONLY in PP. Mutations (createTask · score · check ·
 * start · break-promise · delete) stay on REST until Phase QQ/RR
 * lands the TaskEvent shadow log (event-sourcing-architect tier-2
 * decision · we want the event log to land alongside the mutation
 * migration so every transition gets audited from day one).
 *
 * Delegates to existing shared services:
 *   · listTasks         → @/lib/services/tasks
 *   · listMissions      → @/lib/services/missions
 *   · getGoals          → @/lib/services/goals
 *   · buildActionsBrain → @/lib/services/actions-brain (new in PP)
 *
 * Drift between legacy REST and tRPC structurally impossible.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, operatorProcedure } from "../trpc";
import { powerAtlasProcedures } from "./task/power-atlas";
import { listTasks, deleteTask, updateTask, getTaskById } from "@/lib/services/tasks";
import {
  listMissions,
  createMission,
  updateMission,
} from "@/lib/services/missions";
import {
  getGoals,
  createGoal,
  updateGoal,
  createGoalSchema,
  updateGoalSchema,
} from "@/lib/services/goals";
import { buildActionsBrain } from "@/lib/services/actions-brain";
import {
  checkTask,
  startTask,
  breakPromise,
  createTaskFromAPI,
  scoreTaskWithAI,
  WrongLoopKindError,
} from "@/lib/services/task-actions";
import { generateAiTasks, decomposeTaskWithAi } from "@/lib/services/ai-tasks";
import { backfillProjectTasks } from "@/lib/services/backfill-tasks";
import { buildTodayCompound } from "@/lib/services/today-compound";
import { buildNextMove } from "@/lib/services/next-move";
import { buildGoalNextActions } from "@/lib/services/goal-next-actions";
import { buildTaskRescue, buildDomainAnchors } from "@/lib/services/task-rescue";
import { spawnProjectTasks } from "@/lib/services/spawn-tasks";
import {
  createMissionLink,
  getLinksFor,
  deleteMissionLink,
} from "@/lib/services/mission-links";
import { ServiceError } from "@/lib/utils/service-error";
import { prisma } from "@/lib/prisma";
import { emitTaskEvent, type TaskEventKind } from "@/lib/brain/task-events";
import { taskUpdateSchema } from "@/lib/validators/tasks";
import { getTaskSession, logSessionEvent } from "@/lib/services/task-session";
// Cross-domain residuals slice (2026-05-22) · the one-shot undo-token
// consumer the chat ToolResultCard's undo affordance fires. The shared
// service is also called by the legacy POST /api/undo/[token] route —
// drift structurally impossible.
import { consumeUndoToken } from "@/lib/services/undo-token";
// actions-surface REST→tRPC slice (2026-05-22) · the "leave the current
// project" operation · moves a task to the Inbox mission. The shared
// service is also called by the legacy PATCH /api/tasks/[id] route —
// drift structurally impossible.
import { leaveMission } from "@/lib/services/task-mission";

const pendingInboxCreations = new Map<
  string,
  Promise<{ id: string; title: string; domain: string }>
>();

const TaskEventKindSchema = z.enum([
  "created",
  "started",
  "completed",
  "abandoned",
  "reframed",
  "priority_changed",
  "linked",
  "unlinked",
  "nudged",
  "snoozed",
  "stale_flagged",
  "revived",
  "killed",
]);

// Client-side `emitEvent` mutation restricts what kinds can be emitted
// directly · all other kinds are server-derived from state diffs in
// `services/tasks.updateTask`. Matches the legacy
// /api/tasks/[id]/event allowlist verbatim · drift impossible.
const CLIENT_EMIT_KINDS = [
  "killed",
  "nudged",
  "stale_flagged",
  "linked",
  "unlinked",
] as const satisfies readonly TaskEventKind[];

/**
 * Shallow, explicit row shape for the task-event read procedures
 * (`events` + `eventsByKind`). Returning the raw
 * `prisma.taskEvent.findMany({ select })` type leaks Prisma's
 * recursive `JsonValue` machinery (the `payload` Json column) into the
 * AppRouter type. Past a certain total router size that surfaces as
 * TS2589 ("excessively deep") at consumer `.useQuery` call-sites — the
 * B.6a operator-router growth tipped it over. Casting the rows to this
 * flat interface keeps the deep Prisma instantiation contained to this
 * file; the public procedure type stays shallow. Read components cast
 * to their own local row type regardless.
 */
interface TaskEventRow {
  id: string;
  payload: unknown;
  source: string | null;
  createdAt: Date;
  /** selected by `events`; absent on `eventsByKind` rows. */
  kind?: string;
  /** selected by `eventsByKind`; absent on `events` rows. */
  taskId?: string;
}

/**
 * THE TS2589 FIREWALL · the shallow, explicit row shape `task.goals`
 * returns.
 *
 * `getGoals` (lib/services/goals.ts) does `prisma.lifeGoal.findMany()`
 * with NO `select` and spreads the full row (`...g`) into its enriched
 * result. The `LifeGoal` model carries TWO `Json` columns — `planData`
 * + `coachLog` — so the raw `getGoals` return leaks Prisma's recursive
 * `JsonValue` machinery into the `AppRouter` type. Once the router grew
 * (the actions-surface REST→tRPC slice added the `ai` domain + ~7
 * procedures) the total instantiation depth crossed TS's limit and
 * surfaced as TS2589 "Type instantiation is excessively deep" at the
 * `task.goals` `.useQuery` call-site in KommandoLearn.
 *
 * The fix is the same discipline as `TaskEventRow` above: an explicit,
 * flat interface — the two `Json` columns projected to `unknown`, the
 * `Date` columns kept as `Date` (tRPC superjson-serialises them; the
 * consumers' local `GoalRow` types already read them as strings). The
 * procedure body casts the `getGoals` result to `GoalCacheRow[]`, which
 * contains the deep Prisma instantiation to this file — the public
 * procedure type stays shallow. Read components cast to their own local
 * goal shape regardless (KommandoTrack's `GoalRow`, KommandoLearn's
 * inline filter, the /tasks page `GoalCacheEntry`).
 */
interface GoalCacheRow {
  id: string;
  domain: string;
  title: string;
  metric: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  deadline: Date | null;
  status: string;
  progress: number;
  achievedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  horizon: string | null;
  why: string | null;
  /** LifeGoal.planData Json · `unknown` to keep the AppRouter shallow. */
  planData: unknown;
  estimatedHours: number | null;
  /** LifeGoal.coachLog Json · `unknown` to keep the AppRouter shallow. */
  coachLog: unknown;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // ── getGoals enrichment fields ──
  linkedTaskCount: number;
  linkedDoneCount: number;
  linkedActiveCount: number;
  minutesInvested: number;
  nextMove: { id: string; title: string; status: string } | null;
  loopsThisWeek: number;
  /** Ambition Engine P1 · resolved mastery stats this goal levels (a
   *  rep on a task tagged with this goal credits XP to these). */
  stats: { statKey: string; weight: number }[];
}

export const taskRouter = router({
  /**
   * Phase PP · owner-only · list tasks with optional filters from URL
   * query (status / sort / missionId / goalId). React Query keys on
   * the input object so changing the goalId filter triggers a refetch
   * without manual `await load()` calls.
   */
  list: operatorProcedure
    .input(
      z
        .object({
          status: z.string().max(40).optional(),
          sort: z.string().max(40).optional(),
          missionId: z.string().max(64).optional(),
          goalId: z.string().max(64).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      listTasks({
        status: input?.status,
        sort: input?.sort,
        missionId: input?.missionId,
        goalId: input?.goalId,
      }),
    ),

  inboxCount: operatorProcedure.query(async () => {
    return prisma.task.count({
      where: {
        status: "INBOX",
        deletedAt: null,
      },
    });
  }),

  /**
   * /missions?taskId= deep-link support · owner-only · fetch a single task
   * with its view model properties by ID.
   */
  byId: operatorProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const task = await getTaskById(input.id);
      if (!task) return null;
      return task;
    }),

  /**
   * Phase PP · owner-only · list missions (active + archived). The
   * /tasks page filters to ACTIVE + user-owned downstream · keeping
   * the procedure broad means /missions or future surfaces can reuse
   * it without a separate procedure.
   */
  missions: operatorProcedure.query(async () => listMissions()),

  /**
   * Wire 2 · /missions hygiene: read-only task-rescue suggestions + GENERAL
   * domain-anchor open-counts (so anchors aren't invisible inboxes). Both
   * return flat shapes (no Prisma Json) — TS2589-safe. No mutation.
   */
  missionsHygiene: operatorProcedure.query(async () => {
    const [rescue, anchors] = await Promise.all([buildTaskRescue(), buildDomainAnchors()]);
    return { rescue, anchors };
  }),

  /**
   * Phase PP · owner-only · list goals with optional horizon / domain
   * filter + soft-deleted toggle. Matches the legacy REST query
   * params verbatim. Goal-cache shape returned at `{goals: [...]}` to
   * mirror the legacy envelope · keeps the page's unwrap() helper
   * working without a shape change.
   */
  goals: operatorProcedure
    .input(
      z
        .object({
          horizon: z.string().max(40).nullable().optional(),
          domain: z.string().max(40).nullable().optional(),
          includeDeleted: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const goals = await getGoals({
        horizon: input?.horizon ?? null,
        domain: input?.domain ?? null,
        includeDeleted: input?.includeDeleted ?? false,
      });
      // TS2589 firewall · cast the raw `getGoals` result (which spreads
      // the full LifeGoal Prisma row, Json columns and all) to the flat
      // `GoalCacheRow[]` so the recursive `JsonValue` type never reaches
      // the AppRouter. See the `GoalCacheRow` doc-comment above.
      return { goals: goals as unknown as GoalCacheRow[] };
    }),

  /**
   * Phase PP · owner-only · pattern-detection summary feeding the
   * /tasks page brain panel (daily-focus line · insight chips ·
   * streak map · weak-axis flag). Pure rules over Prisma data · no
   * LLM cost · safe to refetch on 30s interval.
   *
   * Delegates to `lib/services/actions-brain.buildActionsBrain`
   * (newly extracted from the route handler in PP).
   */
  actionsBrain: operatorProcedure.query(async () => buildActionsBrain()),

  /**
   * Phase QQ (2026-05-19 AM) · owner-only · read the full event
   * trail for one task · used by the brain layer for "did Nour
   * abandon then revive then abandon again?" pattern detection +
   * by the UI for the "this task's history" drill-in.
   *
   * The TaskEvent table is append-only · indexed on (taskId,
   * createdAt) · pulls newest-first by default · capped at 100
   * entries per call (typical task has 3-8 events · the cap is
   * for safety, not a real constraint).
   *
   * Per the event-sourcing-architect tier-2 decision, the write
   * side is ALREADY wired across all task mutation paths (see
   * `lib/services/tasks.ts` line 519+ for the state-diff emits +
   * `lib/brain/task-events.ts` for the helper). This procedure
   * gives the read surface a typed shape so consumers don't have
   * to mirror the Prisma schema by hand.
   */
  events: operatorProcedure
    .input(
      z.object({
        taskId: z.string().min(1).max(64),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ input }) => {
      const rows = await prisma.taskEvent.findMany({
        where: { taskId: input.taskId },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        select: {
          id: true,
          kind: true,
          payload: true,
          source: true,
          createdAt: true,
        },
      });
      return { taskId: input.taskId, events: rows as TaskEventRow[] };
    }),

  /**
   * Phase QQ · owner-only · cross-task pattern queries. "How many
   * tasks have I abandoned in the last 14 days?" / "Which kinds
   * fired most this week?" Powers the brain layer's pattern-
   * detection cron + future admin/diagnostic tiles.
   *
   * Uses the (kind, createdAt) index so the lookback scan stays
   * cheap even as the event log grows. groupBy by taskId returns
   * 1 row per task with its event count · use that to spot
   * repeat-offender tasks ("abandoned 3+ times").
   */
  eventsByKind: operatorProcedure
    .input(
      z.object({
        kind: TaskEventKindSchema,
        sinceDays: z.number().int().min(1).max(90).default(14),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.sinceDays * 86_400_000);
      const rows = await prisma.taskEvent.findMany({
        where: {
          kind: input.kind,
          createdAt: { gte: since },
        },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        select: {
          id: true,
          taskId: true,
          payload: true,
          source: true,
          createdAt: true,
        },
      });
      return {
        kind: input.kind,
        sinceDays: input.sinceDays,
        windowStart: since,
        events: rows as TaskEventRow[],
      };
    }),

  /**
   * Phase QQ · owner-only · client-driven event emission. Replaces
   * the legacy POST /api/tasks/[id]/event endpoint. Same allowlist
   * (killed · nudged · stale_flagged · linked · unlinked) · all
   * other kinds are server-emitted only from state diffs in
   * services/tasks.ts.
   *
   * Delegates to `emitTaskEvent` shared helper · idempotent via
   * 60-second collision bucket · fire-and-forget on failure
   * (telemetry can't break a user action).
   */
  emitEvent: operatorProcedure
    .input(
      z.object({
        taskId: z.string().min(1).max(64),
        kind: z.enum(CLIENT_EMIT_KINDS),
        source: z.string().max(40).optional(),
        payload: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      await emitTaskEvent({
        taskId: input.taskId,
        kind: input.kind,
        source: input.source ?? "client",
        payload: input.payload,
      });
      return { ok: true };
    }),

  /**
   * Phase RR (2026-05-19 AM) · owner-only · unified loop completion
   * mutation · ONCE/PROMISE → DONE · DAILY → streak+lastCompletedAt
   * · PROMISE+action=break → ARCHIVED + skill reinforcement.
   *
   * Delegates to `lib/services/task-actions.checkTask` shared service ·
   * legacy POST /api/tasks/[id]/check calls the same function ·
   * drift impossible. Returns the full result envelope including
   * `autoLearn` cross-engine report so the UI can toast wins.
   */
  check: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(64),
        action: z.enum(["complete", "break"]).optional(),
        // 2026-05-23 · task #22 · ADR-0017 Rule 1 Option A · the UI
        // prompts the operator when completing a parent with open
        // children · this flag carries the operator's yes. False or
        // undefined preserves the legacy behavior (parent-only).
        cascadeChildren: z.boolean().optional(),
        completionNote: z.string().nullable().optional(),
        outcomeScore: z.number().int().min(1).max(100).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await checkTask({
          id: input.id,
          action: input.action,
          cascadeChildren: input.cascadeChildren,
          completionNote: input.completionNote,
          outcomeScore: input.outcomeScore,
        });
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code: err.status === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Phase RR · owner-only · start the DOING timer on a task ·
   * idempotent (re-start of an already-running timer doesn't reset
   * startedAt). Emits TaskEvent.started when transitioning into
   * DOING so the history view + drift detector see the start.
   */
  start: operatorProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      try {
        return await startTask(input.id);
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code: err.status === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Phase RR · owner-only · mark a PROMISE loop as broken with
   * optional reason. Pattern-tags via cheap keyword match + writes
   * a BrainMemory promise_break row for the decision-pattern loop.
   * Throws BAD_REQUEST on non-PROMISE tasks.
   */
  breakPromise: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(64),
        reason: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await breakPromise({ id: input.id, reason: input.reason });
      } catch (err) {
        if (err instanceof WrongLoopKindError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code: err.status === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Phase RR · owner-only · soft-delete a task. Delegates to the
   * existing `deleteTask` service in `lib/services/tasks.ts` which
   * handles the soft-delete flag + emits the audit event.
   */
  delete: operatorProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => deleteTask(input.id)),

  /**
   * Phase SS (2026-05-19 AM) · owner-only · create a task with the
   * full API-level wrapper (inbox-default on missing missionId ·
   * post-create Telegram notify · the auto-priority scoring is
   * still triggered separately via the score mutation on the
   * client side).
   *
   * Delegates to `lib/services/task-actions.createTaskFromAPI` ·
   * legacy POST /api/tasks calls the same function · drift
   * impossible. The createTask service it wraps does its own zod
   * validation · we use a permissive z.record here to forward the
   * client's payload without duplicating the schema.
   */
  create: operatorProcedure
    .input(z.record(z.string(), z.unknown()))
    .mutation(async ({ input }) => createTaskFromAPI(input)),

  /**
   * Phase SS · owner-only · create a mission (the Inbox auto-create
   * path uses this when no mission exists yet). Delegates to
   * `lib/services/missions.createMission` · legacy POST /api/missions
   * calls the same function · drift impossible.
   *
   * The createMission service does its own zod validation on the
   * input shape.
   */
  createMission: operatorProcedure
    .input(z.record(z.string(), z.unknown()))
    .mutation(async ({ input }) => createMission(input)),

  /**
   * Phase SS.2 (2026-05-19 AM) · owner-only · AI-grade a task's
   * roiScore. The quick-add path hardcodes roiScore=50 · this
   * fire-and-forget mutation asks Nick to read the task and grade
   * 0-100 in the background so the auto-priority sort gets
   * meaningful signal from the moment the task lands.
   *
   * Idempotent · skips when operator has already graded (roiScore
   * != 50) unless force=true.
   *
   * Delegates to `lib/services/task-actions.scoreTaskWithAI` · legacy
   * POST /api/tasks/[id]/score calls the same function · drift
   * impossible. Returns `{ok, roiScore?, reasoning?, skipped?}` shape.
   */
  score: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(64),
        force: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) =>
      scoreTaskWithAI({ id: input.id, force: input.force }),
    ),

  /**
   * Phase SS.3 (2026-05-19 AM) · owner-only · Nick generates 3-5
   * grounded daily tasks. Uses tracedAiChat with the "extract"
   * profile for deterministic JSON output · validates each result
   * against the Zod taskShape · drops invalid rows + reports
   * droppedInvalid count for partial-success surfaces.
   *
   * Delegates to `lib/services/ai-tasks.generateAiTasks` shared
   * service · legacy POST /api/ai/tasks calls the same function ·
   * drift impossible.
   *
   * The service returns a discriminated union:
   *   - ok: true            · tasks generated
   *   - providers_failed    · all AI providers exhausted (503-class)
   *   - parse_failed        · model returned non-JSON (502-class)
   *
   * Rate-limiting · the REST route checks via checkAiRateLimit(req)
   * before delegating · the tRPC path is owner-only + single-operator
   * so request-level rate-limiting is deferred (essentially zero
   * abuse surface).
   */
  aiGenerate: operatorProcedure
    .input(
      z.object({
        existingTasks: z.array(z.string().min(1).max(500)).max(200).optional(),
      }),
    )
    .mutation(async ({ input }) =>
      generateAiTasks({ existingTasks: input.existingTasks }),
    ),

  /**
   * Phase SS.4 (2026-05-19 AM) · owner-only · bulk-spawn NOW tasks
   * from every active project plan that has un-spawned phases.
   *
   * Walks every ACTIVE mission · for each phase step lacking a
   * taskId, calls the canonical createTask service · idempotent via
   * planData.steps[].taskId flag. Default firstPhaseOnly=true so
   * NOW doesn't get flooded with 50 tasks.
   *
   * Staleness gates preserved: plan>90d skipped · all-goals-stale
   * skipped · orphan-no-goal still allowed.
   *
   * Delegates to `lib/services/backfill-tasks.backfillProjectTasks`
   * shared service · legacy POST /api/projects/backfill-tasks calls
   * the same function · drift impossible.
   */
  backfill: operatorProcedure
    .input(
      z.object({ firstPhaseOnly: z.boolean().optional() }).optional(),
    )
    .mutation(async ({ input }) =>
      backfillProjectTasks({ firstPhaseOnly: input?.firstPhaseOnly }),
    ),

  /**
   * Phase WW (2026-05-22 · legacy-modernizer REST→tRPC actions slice)
   * · owner-only · partial-update a task. Replaces the legacy PATCH
   * /api/tasks/[id] · the most-called mutation in the actions domain
   * (link/unlink goal · link/unlink project · status switch · rename
   * · bulk archive · snooze · domain-inbox moves).
   *
   * Input is the SHARED `taskUpdateSchema` from @/lib/validators/tasks
   * — the exact schema `services/tasks.updateTask` parses internally.
   * Sharing it makes the typed-payload-mismatch class structurally
   * impossible (the /tasks quick-add bug, 2026-05-21): the procedure
   * boundary and the downstream `.parse()` validate the SAME object.
   * `id` is a separate scalar arg · everything else is `fields`.
   *
   * Delegates to `services/tasks.updateTask` · legacy PATCH calls the
   * same function · drift impossible. ServiceError(404) → NOT_FOUND.
   */
  update: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(64),
        fields: taskUpdateSchema,
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await updateTask(input.id, input.fields);
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code: err.status === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Phase B.6b (2026-05-22 · legacy-modernizer REST→tRPC ultron slice ·
   * task-domain sub-slice) · owner-only · read a task's working-session
   * event trail (notes · photos · voice · progress logs), oldest-first,
   * capped at 100. Replaces GET /api/tasks/[id]/session · powers the
   * ActiveTaskCompanion running-log strip on the HQ DESK.
   *
   * Delegates to `lib/services/task-session.getTaskSession` shared
   * service · legacy GET calls the same function · drift impossible.
   * The service returns the explicit shallow `TaskSessionView` shape
   * (the BrainMemory Json `metadata` column is projected to scalar
   * fields inside the service) so the procedure's public type stays
   * shallow — the same TS2589-prevention discipline as `TaskEventRow`.
   */
  session: operatorProcedure
    .input(z.object({ taskId: z.string().min(1).max(64) }))
    .query(async ({ input }) => getTaskSession(input.taskId)),

  /**
   * Phase B.6b · owner-only · log one working-session event against a
   * task. Replaces POST /api/tasks/[id]/session · the ActiveTaskCompanion
   * quick-action row (note · photo · voice · log) fires this.
   *
   * Delegates to `lib/services/task-session.logSessionEvent` shared
   * service · legacy POST calls the same function · drift impossible.
   * The `kind` enum is strict (the route's `["note","photo","voice",
   * "log"].includes` check, hoisted to the tRPC boundary) so a bad
   * kind is rejected at `.input()` rather than reaching the service's
   * `ServiceError(400)`. ServiceError(404) for a missing task →
   * NOT_FOUND so both transports reject identically.
   */
  logSessionEvent: operatorProcedure
    .input(
      z.object({
        taskId: z.string().min(1).max(64),
        kind: z.enum(["note", "photo", "voice", "log"]),
        text: z.string().max(20_000).optional(),
        photoUrl: z.string().max(2_500_000).optional(),
        audioUrl: z.string().max(2_500_000).optional(),
        durationMs: z.number().int().min(0).max(86_400_000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await logSessionEvent(input);
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code: err.status === 404 ? "NOT_FOUND" : "BAD_REQUEST",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Phase WW · owner-only · move a task to a domain's Inbox mission.
   * Replaces POST /api/tasks/[id]/domain. Since `domain` lives on
   * Mission (not Task), this is implemented as a mission swap: find
   * (or lazily create) the per-domain Inbox mission, then re-point
   * the task's missionId.
   *
   * The REST route's `bodySchema` was `{ domain: string.min(1).max(50) }`
   * declared inline · re-declared verbatim here. The normalize +
   * inbox-create logic is small and route-local · kept inline rather
   * than extracting a one-caller service (YAGNI).
   */
  domainSwap: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(64),
        domain: z.string().min(1).max(50),
      }),
    )
    .mutation(async ({ input }) => {
      const DOMAIN_MAP: Record<
        string,
        "BUSINESS" | "PERSONAL" | "HEALTH" | "CONTENT" | "FINANCE"
      > = {
        business: "BUSINESS",
        work: "BUSINESS",
        personal: "PERSONAL",
        health: "HEALTH",
        fitness: "HEALTH",
        content: "CONTENT",
        creative: "CONTENT",
        finance: "FINANCE",
        money: "FINANCE",
      };
      const targetDomain =
        DOMAIN_MAP[input.domain.trim().toLowerCase()] ?? "PERSONAL";
      const inboxTitle = `Inbox - ${targetDomain.toLowerCase()}`;

      // Reuse the OLDEST matching inbox if more than one exists. There is no
      // @@unique on Mission(title, domain) yet (adding it is a gated prod
      // migration — needs a dedup-first pass), so this keeps domainSwap routing
      // to a single mission instead of scattering tasks across accidental dupes.
      //
      // To serialize database checks and inserts under concurrent races,
      // we utilize an in-memory pendingInboxCreations map.
      let inboxPromise = pendingInboxCreations.get(inboxTitle);
      if (!inboxPromise) {
        inboxPromise = (async () => {
          let ib = await prisma.mission.findFirst({
            where: { title: inboxTitle, status: "ACTIVE", deletedAt: null },
            orderBy: { createdAt: "asc" },
            select: { id: true, title: true, domain: true },
          });
          if (!ib) {
            ib = await prisma.mission.create({
              data: {
                title: inboxTitle,
                domain: targetDomain,
                status: "ACTIVE",
                priority: 50,
                roiScore: 50,
                neglectCost: 30,
              },
              select: { id: true, title: true, domain: true },
            });
          }
          return ib;
        })();
        pendingInboxCreations.set(inboxTitle, inboxPromise);
        inboxPromise.finally(() => {
          pendingInboxCreations.delete(inboxTitle);
        });
      }

      const inbox = await inboxPromise;

      const task = await prisma.task.update({
        where: { id: input.id },
        data: { missionId: inbox.id, lastTouchedAt: new Date() },
        include: { mission: true },
      });

      return {
        task: {
          id: task.id,
          missionId: task.missionId,
          mission: task.mission
            ? {
                id: task.mission.id,
                title: task.mission.title,
                domain: task.mission.domain,
              }
            : null,
        },
      };
    }),

  /**
   * Phase WW · owner-only · today's compounded auto-learn signal ·
   * the 1-row "today's growth" strip above /tasks (TodaysCompound).
   * Replaces GET /api/tasks/today-compound · delegates to the
   * `today-compound.buildTodayCompound` shared service the REST route
   * also calls · drift impossible. Pure read · safe to poll on 60s.
   */
  todayCompound: operatorProcedure.query(async () => buildTodayCompound()),

  /**
   * Phase WW · owner-only · Nick's "what to do now" read · weakest
   * mastery axis + rationale + up to 3 candidate moves (NextMoveCard
   * at the top of NOW mode). Replaces GET /api/tasks/next-move ·
   * delegates to `next-move.buildNextMove` · drift impossible.
   */
  nextMove: operatorProcedure.query(async () => buildNextMove()),

  /**
   * Phase WW · owner-only · behind-pace goal nudges feeding
   * GoalNextActionsCard on /plan. Replaces GET /api/goals/next-actions
   * · delegates to `goal-next-actions.buildGoalNextActions`. The
   * legacy route's `?limit=` query param (clamped 1..20, default 5)
   * is mirrored as a typed optional input.
   */
  goalNextActions: operatorProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(20).optional() })
        .optional(),
    )
    .query(async ({ input }) => buildGoalNextActions(input?.limit ?? 5)),

  /**
   * Phase WW · owner-only · create a LifeGoal. Replaces POST
   * /api/goals. Input is the SHARED `createGoalSchema` exported from
   * @/lib/services/goals — the exact schema the REST route parses
   * before calling `createGoal` · the schema IS the contract · drift
   * impossible. `createGoal` takes already-parsed input, so the tRPC
   * `.input()` IS the validation boundary.
   */
  goalsCreate: operatorProcedure
    .input(createGoalSchema)
    .mutation(async ({ input }) => createGoal(input)),

  /**
   * Phase WW · owner-only · update a LifeGoal (rename · re-pace ·
   * pause · log progress via `progressDelta`). Replaces PATCH
   * /api/goals. Input is the SHARED `updateGoalSchema` from
   * @/lib/services/goals · same contract as the REST route.
   */
  goalsUpdate: operatorProcedure
    .input(updateGoalSchema)
    .mutation(async ({ input }) => updateGoal(input)),

  /**
   * Phase WW · owner-only · partial-update a Mission (pause a project
   * · reorder phases via `planData`). Replaces PATCH /api/missions/[id]
   * · delegates to `services/missions.updateMission` · the same
   * function the REST route calls · drift impossible.
   *
   * `updateMission` does its own zod validation on the payload shape;
   * the call-sites send a small heterogeneous set ({ status } ·
   * { planData } · { status, ...meta }) so the `fields` arg stays a
   * genuine dynamic map. NOT a `z.record(z.unknown())` blanket —
   * `z.unknown()` values are the minimum needed for `planData` (an
   * arbitrarily-nested plan object the service re-validates).
   */
  missionUpdate: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(64),
        fields: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await updateMission(input.id, input.fields);
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code: err.status === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * 2026-05-27 · weekly review persist · operator-driven addition of
   * Tim Challies' "Serve and Surprise" lane to the ReviewWizard.
   *
   * Writes a single BrainMemory(category="weekly_review", key=ISO-week)
   * row per week. Idempotent · re-saving the same week's review
   * overwrites (operator can finish + tweak without duplicate rows).
   *
   * The review is the operator's pre-commitment for the week ahead ·
   * Monday morning the brain can pull it back via standard recall to
   * remind Nick what the operator said they'd do.
   */
  saveWeeklyReview: operatorProcedure
    .input(
      z.object({
        weekKey: z.string().min(8).max(20), // YYYY-WNN
        warningsActioned: z.number().int().min(0).default(0),
        pickedTaskIds: z.array(z.string().min(1).max(64)).max(10).default([]),
        serveText: z.string().max(500).default(""),
        surpriseText: z.string().max(500).default(""),
      }),
    )
    .mutation(async ({ input }) => {
      const { prisma } = await import("@/lib/prisma");
      const { BRAIN_CATEGORIES } = await import("@/lib/brain/categories");
      const summary = [
        input.serveText && `serve · ${input.serveText.slice(0, 120)}`,
        input.surpriseText && `surprise · ${input.surpriseText.slice(0, 120)}`,
        `${input.warningsActioned} warnings actioned`,
        `${input.pickedTaskIds.length} pinned`,
      ]
        .filter(Boolean)
        .join(" · ");
      const row = await prisma.brainMemory.upsert({
        where: {
          category_key: {
            category: BRAIN_CATEGORIES.WEEKLY_REVIEW ?? "weekly_review",
            key: input.weekKey,
          },
        },
        create: {
          category: BRAIN_CATEGORIES.WEEKLY_REVIEW ?? "weekly_review",
          key: input.weekKey,
          content: summary.slice(0, 500) || `Weekly review · ${input.weekKey}`,
          confidence: 1.0,
          source: "review-wizard",
          metadata: {
            weekKey: input.weekKey,
            warningsActioned: input.warningsActioned,
            pickedTaskIds: input.pickedTaskIds,
            serveText: input.serveText,
            surpriseText: input.surpriseText,
            savedAt: new Date().toISOString(),
          } as never,
        },
        update: {
          content: summary.slice(0, 500) || `Weekly review · ${input.weekKey}`,
          metadata: {
            weekKey: input.weekKey,
            warningsActioned: input.warningsActioned,
            pickedTaskIds: input.pickedTaskIds,
            serveText: input.serveText,
            surpriseText: input.surpriseText,
            savedAt: new Date().toISOString(),
          } as never,
        },
      });
      return { ok: true, id: row.id };
    }),

  /**
   * Phase WW · owner-only · all mission-to-mission links touching one
   * mission (outbound + inbound). Replaces GET /api/missions/[id]/links
   * · delegates to `mission-links.getLinksFor`. Returns `{ links }` to
   * mirror the legacy REST envelope.
   */
  missionLinks: operatorProcedure
    .input(z.object({ missionId: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const links = await getLinksFor(input.missionId);
      return { links };
    }),

  /**
   * Phase WW · owner-only · create a mission-to-mission link.
   * Replaces POST /api/missions/[id]/links · delegates to
   * `mission-links.createMissionLink` (idempotent upsert). The
   * service throws plain Errors for self-link / missing-mission ·
   * mapped to BAD_REQUEST so the component's error toast is
   * preserved. Returns `{ link }` mirroring the REST envelope.
   */
  missionLinkCreate: operatorProcedure
    .input(
      z.object({
        sourceId: z.string().min(1).max(64),
        targetId: z.string().min(1).max(64),
        relation: z.string().max(40).nullable().optional(),
        note: z.string().max(500).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const link = await createMissionLink({
          sourceId: input.sourceId,
          targetId: input.targetId,
          relation: input.relation,
          note: input.note,
          createdBy: "user",
        });
        return { link };
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "could not link",
        });
      }
    }),

  /**
   * Phase WW · owner-only · remove a mission-to-mission link by id.
   * Replaces DELETE /api/missions/[id]/links/[linkId] · delegates to
   * `mission-links.deleteMissionLink` (idempotent · returns
   * `{ ok: true }` even if the link is already gone).
   */
  missionLinkDelete: operatorProcedure
    .input(z.object({ linkId: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => deleteMissionLink(input.linkId)),

  /**
   * Phase WW · owner-only · auto-create NOW tasks from a project
   * plan's phases. Replaces POST /api/projects/[id]/spawn-tasks ·
   * delegates to `spawn-tasks.spawnProjectTasks` · the same function
   * the REST route calls · drift impossible.
   *
   * Idempotent · re-running only spawns un-spawned steps. The route's
   * SpawnRequest body fields ({ phase?, phaseIndex?, all?, goalId? })
   * are mirrored as a typed input. ServiceError(404/400) → the
   * matching tRPC code so both transports reject identically.
   */
  spawnTasks: operatorProcedure
    .input(
      z.object({
        missionId: z.string().min(1).max(64),
        phase: z.string().max(200).optional(),
        phaseIndex: z.number().int().min(0).max(200).optional(),
        all: z.boolean().optional(),
        goalId: z.string().max(64).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await spawnProjectTasks({
          missionId: input.missionId,
          phase: input.phase,
          phaseIndex: input.phaseIndex,
          all: input.all,
          goalId: input.goalId,
        });
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code: err.status === 404 ? "NOT_FOUND" : "BAD_REQUEST",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * Cross-domain residuals slice (2026-05-22) · owner-only · consume a
   * single-use undo token (the chat ToolResultCard's 30s undo
   * affordance). Replaces POST /api/undo/[token] · delegates to the
   * shared `undo-token.consumeUndoToken` service the REST route also
   * calls · drift impossible.
   *
   * Routed to the `task` domain · the undo-able tools are snoozeTask +
   * archiveGoal (a goal is a task-domain sibling · the `task` router
   * already owns the related mutations). Idempotent · a second consume
   * resolves to `{ ok, alreadyUndone }`. The route carried the token as
   * a path param; tRPC has no path, so it rides in the input. A
   * malformed token → ServiceError(400) → BAD_REQUEST; a not-found /
   * expired token → ServiceError(404) → NOT_FOUND · both transports
   * reject identically.
   */
  undo: operatorProcedure
    .input(z.object({ token: z.string().min(8).max(128) }))
    .mutation(async ({ input }) => {
      try {
        return await consumeUndoToken(input.token);
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code: err.status === 404 ? "NOT_FOUND" : "BAD_REQUEST",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * actions-surface REST→tRPC slice (2026-05-22) · owner-only · move a
   * task off its current project. The legacy call-sites (ProjectDetail
   * clear-inbox + remove-from-project · LinkProjectPicker "leave
   * mission") PATCH'd /api/tasks/[id] with `{ missionId: null }` — a
   * payload that was STRUCTURALLY DEAD: `Task.missionId` is a
   * non-nullable FK (prisma/schema.prisma:295) AND the shared
   * `taskUpdateSchema` types it as a required string, so the write
   * failed on both layers and surfaced a generic error toast every
   * time.
   *
   * Delegates to the shared `task-mission.leaveMission` service · the
   * DB-valid interpretation of "leave a project" on a non-nullable FK
   * is to re-point the task at the catch-all Inbox mission (the same
   * move `domainSwap` makes · the UI copy already promises "keeps the
   * task, clears the link"). ServiceError(404) → NOT_FOUND so both
   * transports reject identically.
   */
  leaveMission: operatorProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      try {
        return await leaveMission(input.id);
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code: err.status === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * 2026-06-01 · task confirm-chip · accept the parked LOW-confidence
   * mission/goal classification from enrichTaskLinkage: apply the proposal
   * to the real fields, then clear it. The operator's explicit yes is the
   * only thing that attaches a low-confidence mission (mirrors people's
   * acceptClassification). goalId/statHints only fill if still unset.
   */
  acceptTaskClassification: operatorProcedure
    .input(z.object({ taskId: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      const task = await prisma.task.findUnique({
        where: { id: input.taskId },
        select: {
          goalId: true,
          statHints: true,
          pendingClassification: true,
        },
      });
      if (!task) throw new Error("Task not found");
      const pc = (task.pendingClassification ?? null) as {
        missionId?: string | null;
        goalId?: string | null;
        statHints?: string[] | null;
      } | null;
      if (!pc) return { ok: true, noop: true };

      const data: Record<string, unknown> = { pendingClassification: null };
      if (pc.missionId) data.missionId = pc.missionId; // explicit accept
      if (pc.goalId && !task.goalId) data.goalId = pc.goalId;
      if (
        Array.isArray(pc.statHints) &&
        pc.statHints.length > 0 &&
        task.statHints.length === 0
      ) {
        data.statHints = pc.statHints;
      }
      await prisma.task.update({ where: { id: input.taskId }, data });
      return {
        ok: true,
        applied: {
          missionId: (data.missionId as string | undefined) ?? null,
          goalId: (data.goalId as string | undefined) ?? null,
        },
      };
    }),

  /**
   * 2026-06-01 · task confirm-chip · dismiss the parked classification
   * without applying anything (clears the suggestion only).
   */
  dismissTaskClassification: operatorProcedure
    .input(z.object({ taskId: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      const data: Record<string, unknown> = { pendingClassification: null };
      await prisma.task
        .update({ where: { id: input.taskId }, data })
        .catch(() => null);
      return { ok: true };
    }),

  /**
   * 2026-05-28 · Wave AJ · operator-grade swap-by-direction on /missions.
   *
   * Per operator complaint 2026-05-28 PM: "how come i cant resort or
   * change the orders of the missions or the tasks?" — manualRank
   * existed in schema since v6 but no UI ever shipped. This + the
   * ↑/↓ buttons in MissionCard close the loop.
   *
   * Server-side swap · the client just sends `(missionId, direction)`
   * and the server resolves the current order + swaps `manualRankOverride`
   * with the neighbor. Keeps the client dumb · all sort math + null-rank
   * synthesis lives in one place. Lower rank = higher in the list ·
   * nulls fall back to their current display index × 1000.
   */
  reorderMission: operatorProcedure
    .input(
      z.object({
        missionId: z.string().min(1).max(64),
        direction: z.enum(["up", "down"]),
      }),
    )
    .mutation(async ({ input }) => {
      const all = await prisma.mission.findMany({
        where: { status: "ACTIVE", deletedAt: null },
        orderBy: [
          { manualRankOverride: { sort: "asc", nulls: "last" } },
          { deadline: "asc" },
          { title: "asc" },
        ],
        select: { id: true, manualRankOverride: true },
      });
      const idx = all.findIndex((m) => m.id === input.missionId);
      if (idx === -1) return { ok: false as const, reason: "not_found" };
      const targetIdx = input.direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= all.length) {
        return { ok: false as const, reason: "at_boundary" };
      }
      const a = all[idx];
      const b = all[targetIdx];
      const aRank = a.manualRankOverride ?? idx * 1000;
      const bRank = b.manualRankOverride ?? targetIdx * 1000;
      await Promise.all([
        prisma.mission.update({
          where: { id: a.id },
          data: { manualRankOverride: bRank, updatedBy: "user" },
        }),
        prisma.mission.update({
          where: { id: b.id },
          data: { manualRankOverride: aRank, updatedBy: "user" },
        }),
      ]);
      return { ok: true as const, swapped: [a.id, b.id] };
    }),

  /**
   * 2026-05-28 · Wave AJ · operator-grade swap-by-direction for TASKS
   * WITHIN A MISSION. Task model has no manualRankOverride column ·
   * we overload `autoPriority` (lower = top). The autopriority cron is
   * aware via `autoPriorityExplanation = "manual reorder ..."` · honors
   * operator's manual signal for 7 days before re-running its AI sort.
   *
   * Client sends `(taskId, direction)` and the SERVER finds the task's
   * mission + the next task in the SAME mission's current sort order ·
   * swaps their `autoPriority` values · stamps the explanation marker.
   */
  reorderTask: operatorProcedure
    .input(
      z.object({
        taskId: z.string().min(1).max(64),
        direction: z.enum(["up", "down"]),
      }),
    )
    .mutation(async ({ input }) => {
      const me = await prisma.task.findUnique({
        where: { id: input.taskId },
        select: { id: true, missionId: true, autoPriority: true },
      });
      if (!me?.missionId) return { ok: false as const, reason: "not_found" };
      const all = await prisma.task.findMany({
        where: {
          missionId: me.missionId,
          deletedAt: null,
          status: { notIn: ["DONE", "ARCHIVED"] },
        },
        orderBy: [
          { autoPriority: { sort: "asc", nulls: "last" } },
          { createdAt: "asc" },
        ],
        select: { id: true, autoPriority: true },
      });
      const idx = all.findIndex((t) => t.id === input.taskId);
      if (idx === -1) return { ok: false as const, reason: "not_found" };
      const targetIdx = input.direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= all.length) {
        return { ok: false as const, reason: "at_boundary" };
      }
      const a = all[idx];
      const b = all[targetIdx];
      const aRank = a.autoPriority ?? idx * 1000;
      const bRank = b.autoPriority ?? targetIdx * 1000;
      const today = new Date().toISOString().slice(0, 10);
      const marker = `manual reorder by operator · ${today} · honor 7d`;
      await Promise.all([
        prisma.task.update({
          where: { id: a.id },
          data: {
            autoPriority: bRank,
            autoPriorityExplanation: marker,
            updatedBy: "user",
          },
        }),
        prisma.task.update({
          where: { id: b.id },
          data: {
            autoPriority: aRank,
            autoPriorityExplanation: marker,
            updatedBy: "user",
          },
        }),
      ]);
      return { ok: true as const, swapped: [a.id, b.id] };
    }),

  decompose: operatorProcedure
    .input(z.object({ taskId: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      try {
        return await decomposeTaskWithAi(input.taskId);
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "could not decompose task",
        });
      }
    }),

  /**
   * Task Inbox Triage Flow (P0) · triage
   *
   * Triages a task from the Inbox using a Things-style workflow decision.
   * Supports today, schedule, anytime, someday, snooze, and kill.
   */
  triage: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(64),
        decision: z.enum(["today", "schedule", "anytime", "someday", "kill", "snooze"]),
        date: z.string().optional(),
        snoozeDays: z.number().int().min(1).max(365).optional(),
        missionId: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { prisma } = await import("@/lib/prisma");
      const { deleteTask, syncTaskPriorities } = await import("@/lib/services/tasks");
      const { emitTaskEvent } = await import("@/lib/brain/task-events");

      const task = await prisma.task.findUnique({
        where: { id: input.id },
      });

      if (!task) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Task not found",
        });
      }

      if (input.decision === "kill") {
        await deleteTask(input.id);
        return { ok: true };
      }

      let data: Record<string, any> = {};

      if (input.decision === "today") {
        let targetDate = new Date();
        if (input.date) {
          targetDate = new Date(input.date);
        } else {
          targetDate.setHours(0, 0, 0, 0);
        }
        data = {
          status: "READY",
          dueDate: targetDate,
          snoozedUntil: null,
          lastTouchedAt: new Date(),
        };
      } else if (input.decision === "schedule") {
        if (!input.date) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Scheduling requires a date",
          });
        }
        data = {
          status: "READY",
          dueDate: new Date(input.date),
          snoozedUntil: null,
          lastTouchedAt: new Date(),
        };
      } else if (input.decision === "anytime") {
        let finalMissionId = input.missionId;
        if (!finalMissionId && task.pendingClassification) {
          try {
            const pc = task.pendingClassification as any;
            if (pc && typeof pc.missionId === "string") {
              finalMissionId = pc.missionId;
            }
          } catch {}
        }

        data = {
          status: "READY",
          dueDate: null,
          snoozedUntil: null,
          pendingClassification: null,
          lastTouchedAt: new Date(),
          ...(finalMissionId ? { missionId: finalMissionId } : {}),
        };
      } else if (input.decision === "someday") {
        data = {
          status: "WAITING",
          dueDate: null,
          snoozedUntil: null,
          manualPriorityOverride: 70,
          lastTouchedAt: new Date(),
        };
      } else if (input.decision === "snooze") {
        let snoozedUntil: Date;
        if (input.date) {
          snoozedUntil = new Date(input.date);
        } else if (input.snoozeDays) {
          const d = new Date();
          d.setDate(d.getDate() + input.snoozeDays);
          d.setHours(0, 0, 0, 0);
          snoozedUntil = d;
        } else {
          const d = new Date();
          d.setDate(d.getDate() + 1);
          d.setHours(0, 0, 0, 0);
          snoozedUntil = d;
        }

        data = {
          status: "WAITING",
          snoozedUntil,
          dueDate: null,
          lastTouchedAt: new Date(),
        };
      }

      const updatedTask = await prisma.task.update({
        where: { id: input.id },
        data,
      });

      await syncTaskPriorities();

      if (task.status === "WAITING" && data.status && data.status !== "WAITING") {
        const { awardPatienceXP } = await import("@/lib/system/patience-xp");
        await awardPatienceXP(task.id, task.updatedAt).catch(console.error);
      }

      const { invalidate } = await import("@/lib/utils/cache");
      invalidate("dashboard_brief");
      invalidate("ultron_command_center_state_v1");

      if (input.decision === "snooze") {
        await emitTaskEvent({
          taskId: input.id,
          kind: "snoozed",
          source: "triage:snooze",
          payload: { snoozedUntil: data.snoozedUntil?.toISOString() },
        });
      } else {
        await emitTaskEvent({
          taskId: input.id,
          kind: "reframed",
          source: `triage:${input.decision}`,
        });
      }

      return { ok: true, taskId: updatedTask.id };
    }),

  // ─── Power Atlas (people / relationship / ledger / power-balance /
  // alpha-moment / power-play) · moved VERBATIM to ./task/power-atlas.ts
  // (2026-06-04 mechanical split) · spread keeps paths FLAT as
  // `trpc.task.<proc>`. See power-atlas.ts.
  ...powerAtlasProcedures,
});
