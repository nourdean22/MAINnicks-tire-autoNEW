/**
 * lib/trpc/routers/system/prompts.ts
 *
 * Per-domain slice of the system router (mechanical split · 2026-05-31).
 * Exports a plain procedure-object that system.ts spreads back into
 * `systemRouter` — the client paths stay FLAT as `trpc.system.<proc>`.
 * Procedures moved VERBATIM · no behavior / input-schema / middleware
 * change. See system.ts for the recomposition.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { operatorProcedure } from "../../trpc";
import { buildJudgeEvalSummary } from "@/lib/services/judge-eval";
import { readGhostNourCandidates } from "@/lib/services/ghost-nour";
import { readRecentV2Samples } from "@/lib/ai/judge-eval/sampler";
import { listEvalResults } from "@/lib/services/eval-results";
import { readShadowTrend } from "@/lib/ai/prompt/v2/shadow-metrics";
import { listPrompts, getRegistryStats } from "@/lib/prompts/library";
import { PromptCategory } from "@/lib/prompts/library";
import { buildJudgeCalibration } from "@/lib/services/judge-calibration";
import { buildPromptDiagnostics } from "@/lib/services/system-pages-b";
import { hotFlushPromptCache } from "@/lib/ai/system-prompt-cache";
import {
  runGhostNourPredict,
  GhostNourPredictError,
  type GhostPrediction,
} from "@/lib/services/ghost-nour-predict";
import { compareReplies } from "@/lib/ai/judge-eval/comparator";
import { recordComparison } from "@/lib/ai/judge-eval/persistence";

export const promptsProcedures = {
  /**
   * Phase V (2026-05-18 PM) · owner-only · AGENT_V1 → AGENT_V2
   * judge-eval comparator summary. Aggregates the
   * PROMPT_COMPARISON_RUN BrainMemory rows into win-rate buckets +
   * per-intent breakdowns + a Phase 1 canary verdict (safe / watch /
   * regressing / insufficient-data).
   *
   * Unblocks the agent-v1-to-v2 migration's Phase 0 prerequisite ·
   * delegates to the shared `lib/services/judge-eval.ts` service so a
   * future cron / alert layer reads the same aggregation.
   */
  judgeEvalSummary: operatorProcedure.query(async () => {
    return buildJudgeEvalSummary();
  }),

  /**
   * Phase W (2026-05-18 PM) · owner-only · candidate V2 chat replies
   * the operator can use to seed comparisons. Pairs each assistant
   * reply with its immediately-preceding user prompt + filters out
   * samples that already have a comparison run recorded.
   *
   * Input · `{ take: 1-50, sinceDays: 1-30 }` · default 20 / 7d
   *
   * Returns: CandidateSample[] · the dashboard "Candidate prompts"
   * section renders these with copy-prompt + copy-v2-reply buttons
   * that feed into the /api/judge-eval/run workflow.
   */
  judgeEvalSamples: operatorProcedure
    .input(
      z.object({
        take: z.number().int().min(1).max(50).default(20),
        sinceDays: z.number().int().min(1).max(30).default(7),
      }),
    )
    .query(async ({ input }) => {
      return readRecentV2Samples({
        take: input.take,
        sinceDays: input.sinceDays,
        excludeAlreadyCompared: true,
      });
    }),

  /**
   * Phase VV · owner-only · latest N nightly eval-regression reports.
   * Replaces GET /api/system/eval-results · delegates to the shared
   * `eval-results.listEvalResults` service. `limit === 1` returns the
   * heavy `perQuestionResults` drill-down; larger limits omit it (the
   * trend payload stays tight). EvalRegressionCard calls this twice —
   * `{limit:7}` for the sparkline, `{limit:1}` for the failure drawer.
   */
  evalResults: operatorProcedure
    .input(z.object({ limit: z.number().int().min(1).max(90).default(14) }))
    .query(async ({ input }) => listEvalResults(input.limit)),

  // 2026-08-06 · REMOVED `promptCompare` (+ lib/services/prompt-compare.ts,
  // app/api/system/prompt-compare/route.ts, PromptComparisonView). It reported
  // FALSE PARITY: its "v1" arm called buildSystemPrompt("full"), which since the
  // 2026-06-29 Prompt V2 Prime Cutover delegates straight to buildSystemPromptV2()
  // (lib/ai/system-prompt.ts). Both arms were the SAME builder, so the surface
  // compared V2 against V2 — differing only by the serving-time 58K trim and the
  // business-knowledge append — and rendered the residual as "Parity achieved".
  // Anyone validating a prompt or context-assembly change through it got a false
  // green. There is no v1 builder to compare against; do NOT re-add this.
  // For "what is actually in the served prompt", use `promptDiagnostics` below.

  /**
   * Phase VV · owner-only · the shadow-mode v1/v2 char-delta trend.
   * Replaces GET /api/system/prompt-shadow-trend?days=N · delegates to
   * the same `readShadowTrend` helper every consumer uses. The 24h
   * summary (avgPct + sample count) is computed here exactly as the
   * REST route did.
   *
   * 2026-08-06 · reads REAL rows, so unlike the removed promptCompare it
   * cannot report a false parity — but it now has no UI consumer (its only
   * one was PromptComparisonView, deleted above) and no producer either:
   * `recordShadowDelta` has had zero production callers since the cutover.
   * Left in place because it is honest and cheap; retire it deliberately,
   * together with shadow-metrics, rather than as a side effect.
   */
  promptShadowTrend: operatorProcedure
    .input(z.object({ days: z.number().int().min(1).max(30).default(7) }))
    .query(async ({ input }) => {
      const series = await readShadowTrend(input.days);
      const last24Cutoff = Date.now() - 86_400_000;
      const last24 = series.charsDeltaPct.filter(
        (p) => new Date(p.createdAt).getTime() >= last24Cutoff,
      );
      const avgPct24h =
        last24.length === 0
          ? null
          : Math.round(
              (last24.reduce((acc, p) => acc + p.value, 0) / last24.length) *
                10,
            ) / 10;
      return {
        generatedAt: new Date().toISOString(),
        windowDays: input.days,
        summary: {
          sampleCount: series.charsDeltaPct.length,
          sampleCount24h: last24.length,
          avgPct24h,
          latestPct:
            series.charsDeltaPct[series.charsDeltaPct.length - 1]?.value ??
            null,
          latestAt:
            series.charsDeltaPct[series.charsDeltaPct.length - 1]
              ?.createdAt ?? null,
        },
        series,
      };
    }),

  /**
   * Phase VV · owner-only · the reusable-prompt registry from
   * lib/prompts/library.ts + stats. Replaces GET /api/system/prompts ·
   * delegates to the same `listPrompts` + `getRegistryStats` the route
   * calls. Optional category/tag filters mirror the legacy query
   * params. Returns `{ stats, filter, prompts }` so PromptLibraryView's
   * `data.*` access is unchanged (it read `json.data` off the legacy
   * envelope · the tRPC query hands the object back unwrapped).
   */
  promptLibrary: operatorProcedure
    .input(
      z
        .object({
          category: z.string().max(40).optional(),
          tag: z.string().max(60).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const prompts = listPrompts({
        category: (input?.category as PromptCategory | undefined) ?? undefined,
        tag: input?.tag ?? undefined,
      });
      return {
        stats: getRegistryStats(),
        filter: {
          category: (input?.category as PromptCategory | null) ?? null,
          tag: input?.tag ?? null,
        },
        prompts,
      };
    }),

  /**
   * Phase B.7b · owner-only · live system-prompt diagnostics · builds
   * the prompt that WOULD be served right now for a tier + sample
   * message and breaks it into sections / size / cache / providers.
   * Replaces GET /api/system/prompt · delegates to the shared
   * `system-pages-b.buildPromptDiagnostics` service. The legacy
   * `?tier` / `?msg` query params are mirrored as typed inputs ·
   * PromptDiagnosticsPage keys on the input so changing the tier or
   * sample message rebuilds. The legacy route returned the object at
   * the top level (no `{ data }` envelope) · the procedure does too.
   */
  promptDiagnostics: operatorProcedure
    .input(
      z.object({
        tier: z
          .enum(["core", "business", "personal", "strategy", "full"])
          .optional(),
        msg: z.string().max(2000).optional(),
      }),
    )
    .query(async ({ input }) =>
      buildPromptDiagnostics({ tier: input.tier, msg: input.msg }),
    ),

  /**
   * Phase B.7b · owner-only · hot-flush the system-prompt cache so the
   * next chat turn rebuilds from scratch. Replaces POST
   * /api/system/prompt-cache-flush · delegates to the same
   * `hotFlushPromptCache` helper the legacy route calls. The `reason`
   * is clamped to 200 chars (mirrors the route). Kept inline (a
   * single helper call · route-local · YAGNI · no other caller).
   * Returns the legacy `{ ok, reason, flushedAt }` shape.
   */
  flushPromptCache: operatorProcedure
    .input(
      z
        .object({ reason: z.string().max(2000).optional() })
        .optional(),
    )
    .mutation(async ({ input }) => {
      const reason = (input?.reason ?? "manual flush").slice(0, 200);
      hotFlushPromptCache(reason);
      return {
        ok: true as const,
        reason,
        flushedAt: new Date().toISOString(),
      };
    }),

  /**
   * straggler-pages slice · owner-only · run the AGENT_V1 → AGENT_V2
   * judge-eval comparator on an operator-supplied {prompt, v1Reply,
   * v2Reply} pair · runs the LLM judge + persists the row. Replaces
   * POST /api/judge-eval/run · delegates to the same `compareReplies`
   * + `recordComparison` helpers the legacy route calls · drift
   * impossible. The input mirrors the route's `InputSchema` verbatim.
   * `Judgment` is a flat shape (no Prisma) · `id` is the BrainMemory
   * key string (`null` on a persistence failure — best-effort, same
   * as the route). The /system/judge-eval AdHocCompareForm fires this.
   */
  judgeEvalRun: operatorProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        v1Reply: z.string().min(1).max(8000),
        v2Reply: z.string().min(1).max(8000),
        intentClass: z.string().max(80).optional(),
        sourceMessageId: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const judgment = await compareReplies({
        prompt: input.prompt,
        v1Reply: input.v1Reply,
        v2Reply: input.v2Reply,
        intentClass: input.intentClass,
      });
      const id = await recordComparison({
        prompt: input.prompt,
        v1Reply: input.v1Reply,
        v2Reply: input.v2Reply,
        judgment,
        intentClass: input.intentClass,
        sourceMessageId: input.sourceMessageId,
      });
      return { id, judgment };
    }),

  // ═══════════ hooks-lib REST→tRPC slice · system hooks ═══════════
  //
  // The final system-domain `authedFetch` call-sites — part of the
  // 12-hook + 4-lib slice that closes the REST→tRPC migration. Each
  // procedure delegates to a shared `lib/services/` function (or the
  // already-shared push helpers) the legacy REST route ALSO calls ·
  // drift structurally impossible. The pulse + diagnose reads return
  // explicit flat shapes (every Date stringified · no Prisma row) — the
  // TS2589 firewall.

  /**
   * task #22 slice 5.5 · judge-eval calibration metric.
   *
   * Returns agreement % between the LLM judge's verdicts and the
   * operator's real thumbs-up / -down on V2 replies. Closes the
   * LeCun ground-truth gap: a judge that's an LLM scoring an LLM
   * can share blind spots with V2 · operator reactions can't.
   *
   * Defaults to a 30d window · the dashboard can override.
   */
  judgeEvalCalibration: operatorProcedure
    .input(z.object({ sinceDays: z.number().int().min(1).max(365).optional() }).optional())
    .query(async ({ input }) => {
      return buildJudgeCalibration({ sinceDays: input?.sinceDays });
    }),

  /**
   * Phase Y.4 (2026-05-18 PM) · owner-only · recent MasteryDecision
   * rows with no actualOutcome yet · the /system/ghost-nour page
   * surfaces these as "run ghost on this" cards for pending decisions.
   *
   * The POST handler (similarity search + recommendation) stays on
   * REST for now · mutations + heavy result shape · separate phase
   * scope when needed.
   */
  ghostNourCandidates: operatorProcedure
    .input(z.object({ take: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ input }) => readGhostNourCandidates({ take: input.take })),

  /**
   * straggler-pages slice · owner-only · predict what past-Nour would
   * have done · similarity search over MasteryDecision history.
   * Replaces POST /api/system/ghost-nour · delegates to the shared
   * `ghost-nour-predict.runGhostNourPredict` the legacy route also
   * calls · drift impossible. `GhostNourPredictError` (situation
   * tokenized to nothing) maps to BAD_REQUEST so both transports
   * reject identically. The result is the explicit flat
   * `GhostPrediction` interface (Prisma rows projected to scalars
   * inside the service) — the TS2589 firewall. The /system/ghost-nour
   * page fires this from its "summon past-Nour" button.
   */
  ghostNourPredict: operatorProcedure
    .input(
      z.object({
        situation: z.string().min(3).max(2000),
        limit: z.number().int().min(1).max(20).default(5),
      }),
    )
    .mutation(async ({ input }): Promise<GhostPrediction> => {
      try {
        return await runGhostNourPredict(input);
      } catch (err) {
        if (err instanceof GhostNourPredictError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

};
