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
import { listTasks, deleteTask, updateTask } from "@/lib/services/tasks";
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
import { generateAiTasks } from "@/lib/services/ai-tasks";
import { backfillProjectTasks } from "@/lib/services/backfill-tasks";
import { buildTodayCompound } from "@/lib/services/today-compound";
import { buildNextMove } from "@/lib/services/next-move";
import { buildGoalNextActions } from "@/lib/services/goal-next-actions";
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

  /**
   * Phase PP · owner-only · list missions (active + archived). The
   * /tasks page filters to ACTIVE + user-owned downstream · keeping
   * the procedure broad means /missions or future surfaces can reuse
   * it without a separate procedure.
   */
  missions: operatorProcedure.query(async () => listMissions()),

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
      return { goals };
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
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await checkTask({ id: input.id, action: input.action });
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

      let inbox = await prisma.mission.findFirst({
        where: { title: inboxTitle, status: "ACTIVE", deletedAt: null },
        select: { id: true, title: true, domain: true },
      });
      if (!inbox) {
        inbox = await prisma.mission.create({
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
});
