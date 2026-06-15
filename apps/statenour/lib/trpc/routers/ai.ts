/**
 * lib/trpc/routers/ai.ts · actions-surface REST→tRPC slice
 * (2026-05-22 · legacy-modernizer · components/actions/* slice) ·
 * extended scattered-components slice (2026-05-22 · components/goals/*).
 *
 * AI-domain procedures · the 9th domain router (nick · operator ·
 * system · chat · browser · task · journal · brain · ai). The `ai`
 * domain — the /api/ai/* generation endpoints — had no tRPC home; the
 * components/actions/* surface (KommandoLearn · KommandoTrack ·
 * ProjectDetail · ProjectCard · MilestonesFlow) calls four of them, so
 * this router is their natural landing zone. The scattered-components
 * slice adds the GoalBoard pair — `ai.suggestGoals` (/api/ai/suggest-
 * goals) + `ai.coachGoal` (/api/ai/coach-goal).
 *
 * Every procedure delegates to a shared `lib/services/ai-*` function
 * the legacy REST route ALSO calls · drift between consumers
 * structurally impossible. Each service returns an explicit flat shape
 * (the AI payloads are heterogeneous JSON spread into known fields · no
 * Prisma row reaches the AppRouter) so the recursive Prisma `JsonValue`
 * type never enters the AppRouter — the TS2589 firewall.
 *
 * These are modeled as `.mutation()` even though `teach` / `research`
 * read no DB row — they each run a metered, non-idempotent LLM call
 * (genuine work · cost), which is the tRPC `mutation` contract.
 *
 * Rate-limiting · the REST routes check `checkAiRateLimit(req)` before
 * delegating · the tRPC path is owner-only + single-operator so
 * request-level rate-limiting is deferred (the `task.aiGenerate` /
 * `brain.captureThought` rationale · essentially zero abuse surface).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, operatorProcedure } from "../trpc";
import { runTeach } from "@/lib/services/ai-teach";
import { runResearch } from "@/lib/services/ai-research";
import { runTrackStory } from "@/lib/services/ai-track-story";
import {
  runPlanProject,
  PlanProjectError,
  type SuggestedMilestone,
} from "@/lib/services/ai-plan-project";
import {
  runSuggestGoals,
  SUGGEST_GOAL_HORIZONS,
} from "@/lib/services/ai-suggest-goals";
import { runCoachGoal, CoachGoalError } from "@/lib/services/ai-coach-goal";
import { runDeconstructTask } from "@/lib/services/ai-deconstruct";

/**
 * THE TS2589 FIREWALL · the shallow wire shape `ai.planProject` returns.
 *
 * `runPlanProject` resolves a rich `PlanProjectResult` whose `plan` /
 * `learn` / `guide` variants embed `ProjectPlanData` / `LearningPath` /
 * `CoachEntry` — deeply-nested interfaces (ProjectPlanData → phases →
 * steps, etc). Returning that union RAW leaks the deep instantiation
 * into the `AppRouter` type; once the router grew the `ai` domain it
 * tipped TS over the instantiation-depth limit and surfaced as TS2589
 * "Type instantiation is excessively deep" at UNRELATED `.useQuery`
 * call-sites (the first observed casualty was `task.goals` in
 * KommandoLearn).
 *
 * The fix — the same discipline as `brain.exportBrain` returning
 * `unknown` for its deep backup blob: the procedure's PUBLIC return
 * type projects every deep field (`plan` · `flatSteps` · `learning` ·
 * `entry`) to `unknown`. The AppRouter type stays shallow. The three
 * consumers (ProjectDetail · ProjectCard · MilestonesFlow) cast the
 * `unknown` fields back to their own local `ProjectPlanData` /
 * `LearningPath` / `CoachEntry` types — which is exactly what they did
 * with the untyped `authedFetch` JSON before this migration.
 *
 * The `milestones` + `clarify` variants stay fully typed — they carry
 * only flat scalar / string-array fields, no recursion to firewall.
 */
export type PlanProjectWireResult =
  | {
      mode: "clarify";
      questions?: unknown;
      initialThoughts?: string;
      redFlags?: string[];
      quickWin?: string;
      provider?: string;
    }
  | {
      mode: "milestones";
      milestones: SuggestedMilestone[];
      rationale: string;
      provider?: string;
      model?: string;
    }
  | {
      mode: "plan";
      /** ProjectPlanData · `unknown` to keep the AppRouter shallow. */
      plan: unknown;
      /** Array<Record<string,unknown>> · `unknown` · TS2589 firewall. */
      flatSteps: unknown;
      provider?: string;
      model?: string;
    }
  | {
      mode: "learn";
      /** LearningPath · `unknown` to keep the AppRouter shallow. */
      learning: unknown;
      provider?: string;
    }
  | {
      mode: "guide";
      /** CoachEntry · `unknown` to keep the AppRouter shallow. */
      entry: unknown;
      provider?: string;
    };

export const aiRouter = router({
  /**
   * Owner-only · generate an ad-hoc micro-course on a topic. Replaces
   * POST /api/ai/teach · delegates to the shared `ai-teach.runTeach`
   * service the REST route also calls · drift impossible. `depth`
   * mirrors the route's enum (default "standard"). KommandoLearn fires
   * this for the "teach" half of its smart-routed input.
   */
  teach: operatorProcedure
    .input(
      z.object({
        topic: z.string().min(2).max(500),
        depth: z.enum(["quick", "standard", "deep"]).default("standard"),
      }),
    )
    .mutation(async ({ input }) =>
      runTeach({ topic: input.topic, depth: input.depth }),
    ),

  /**
   * Owner-only · multi-model research query (Perplexity → Grok →
   * Venice). Replaces POST /api/integrations/research · delegates to
   * the shared `ai-research.runResearch` service the REST route also
   * calls · drift impossible. KommandoLearn fires this for the
   * "research" half of its smart-routed input. `taskType` mirrors the
   * route's `taskType` body field (default "research").
   */
  research: operatorProcedure
    .input(
      z.object({
        query: z.string().min(1).max(2000),
        taskType: z
          .enum(["research", "realtime", "fast", "analysis", "general"])
          .optional(),
        systemPrompt: z.string().max(8000).optional(),
      }),
    )
    .mutation(async ({ input }) =>
      runResearch({
        query: input.query,
        taskType: input.taskType,
        systemPrompt: input.systemPrompt,
      }),
    ),

  /**
   * Owner-only · the TRACK-page weekly-story narrator. Replaces POST
   * /api/ai/track-story · delegates to the shared
   * `ai-track-story.runTrackStory` service the REST route also calls ·
   * drift impossible. The input is the SHARED nine-counter snapshot the
   * REST route's `schema` validates verbatim (all non-negative ints) —
   * the typed-payload-mismatch guard. KommandoTrack fires this on first
   * load + the regen button.
   */
  trackStory: operatorProcedure
    .input(
      z.object({
        doneToday: z.number().int().nonnegative(),
        thisWkDone: z.number().int().nonnegative(),
        prevWkDone: z.number().int().nonnegative(),
        warningCount: z.number().int().nonnegative(),
        goalCount: z.number().int().nonnegative(),
        projectCount: z.number().int().nonnegative(),
        coldProjects: z.number().int().nonnegative(),
        behindGoals: z.number().int().nonnegative(),
        topStreak: z.number().int().nonnegative(),
      }),
    )
    .mutation(async ({ input }) => runTrackStory(input)),

  /**
   * Owner-only · the project-intelligence engine — five modes (clarify
   * · plan · milestones · learn · guide). Replaces POST
   * /api/ai/plan-project · delegates to the shared
   * `ai-plan-project.runPlanProject` service the REST route also calls
   * · drift impossible. The input mirrors the route's `schema`
   * verbatim. `PlanProjectError` carries a 404 (mission-not-found) or a
   * 400 (missing title · unknown mode · guide-without-mission) →
   * mapped to the matching tRPC code so both transports reject
   * identically. ProjectDetail / ProjectCard / MilestonesFlow fire
   * this from their plan / replan / learn / guide / milestones flows.
   */
  planProject: operatorProcedure
    .input(
      z.object({
        title: z.string().min(1).max(500).optional(),
        description: z.string().max(5000).optional(),
        domain: z.string().max(80).optional(),
        answers: z.string().max(5000).optional(),
        missionId: z.string().max(64).optional(),
        currentState: z.string().max(2000).optional(),
        mode: z
          .enum(["clarify", "plan", "learn", "guide", "milestones"])
          .default("plan"),
        milestones: z.array(z.string().min(1).max(200)).max(8).optional(),
        goalTarget: z.number().optional(),
        goalUnit: z.string().max(50).optional(),
        goalDeadline: z.string().max(64).optional(),
        goalMetric: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ input }): Promise<PlanProjectWireResult> => {
      try {
        // `runPlanProject` resolves the rich `PlanProjectResult`; the
        // explicit `Promise<PlanProjectWireResult>` annotation projects
        // its deep `plan` / `flatSteps` / `learning` / `entry` fields to
        // `unknown` at the router boundary — the TS2589 firewall. The
        // result is structurally assignable (the wire type only widens
        // those fields), so no runtime cast is needed.
        return await runPlanProject(input);
      } catch (err) {
        if (err instanceof PlanProjectError) {
          throw new TRPCError({
            code: err.status === 404 ? "NOT_FOUND" : "BAD_REQUEST",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  /**
   * scattered-components slice · owner-only · suggest 3-5 horizon-
   * appropriate goals. Replaces POST /api/ai/suggest-goals · delegates
   * to the shared `ai-suggest-goals.runSuggestGoals` service the REST
   * route also calls · drift impossible. The input mirrors the route's
   * `schema` verbatim (`horizon` defaults to "WEEK"). GoalBoard fires
   * this from its "AI suggest" button. The `goals` field of the result
   * is `unknown` at the router boundary (the LLM JSON is heterogeneous
   * · GoalBoard already `Array.isArray`-guards it · TS2589 firewall).
   */
  suggestGoals: operatorProcedure
    .input(
      z.object({
        horizon: z.enum(SUGGEST_GOAL_HORIZONS).default("WEEK"),
        domain: z.string().max(80).optional(),
        context: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input }) => runSuggestGoals(input)),

  /**
   * scattered-components slice · owner-only · the goal-level coach —
   * one-line read + next action + blocker + risks, appended to
   * LifeGoal.coachLog. Replaces POST /api/ai/coach-goal · delegates to
   * the shared `ai-coach-goal.runCoachGoal` service the REST route also
   * calls · drift impossible. `CoachGoalError` carries a 404
   * (goal-not-found) → mapped to NOT_FOUND so both transports reject
   * identically. GoalBoard fires this from each goal card's "Ask Nick
   * to analyze" / "refresh" affordance.
   */
  coachGoal: operatorProcedure
    .input(
      z.object({
        goalId: z.string().min(1).max(64),
        currentState: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await runCoachGoal(input);
      } catch (err) {
        if (err instanceof CoachGoalError) {
          throw new TRPCError({ code: "NOT_FOUND", message: err.message });
        }
        throw err;
      }
    }),

  deconstructTask: operatorProcedure
    .input(
      z.object({
        taskTitle: z.string().min(1).max(500),
        goalTitle: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return runDeconstructTask(input);
    }),
});
