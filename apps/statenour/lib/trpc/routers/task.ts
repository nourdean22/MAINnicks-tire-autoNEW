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
import { listTasks, deleteTask } from "@/lib/services/tasks";
import { listMissions, createMission } from "@/lib/services/missions";
import { getGoals } from "@/lib/services/goals";
import { buildActionsBrain } from "@/lib/services/actions-brain";
import {
  checkTask,
  startTask,
  breakPromise,
  createTaskFromAPI,
  WrongLoopKindError,
} from "@/lib/services/task-actions";
import { ServiceError } from "@/lib/utils/service-error";
import { prisma } from "@/lib/prisma";
import { emitTaskEvent, type TaskEventKind } from "@/lib/brain/task-events";

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
      return { taskId: input.taskId, events: rows };
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
        events: rows,
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
});
