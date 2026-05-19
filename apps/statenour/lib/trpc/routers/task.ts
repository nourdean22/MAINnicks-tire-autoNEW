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
import { router, operatorProcedure } from "../trpc";
import { listTasks } from "@/lib/services/tasks";
import { listMissions } from "@/lib/services/missions";
import { getGoals } from "@/lib/services/goals";
import { buildActionsBrain } from "@/lib/services/actions-brain";

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
});
