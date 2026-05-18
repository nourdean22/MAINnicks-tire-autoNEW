/**
 * lib/trpc/routers/system.ts · Phase S.2 (2026-05-18 PM)
 *
 * System telemetry procedures · per the J tRPC migration plan, this is
 * the third domain router (after `nick` for reasoning + `operator` for
 * forward-looking state). Lives separately so future /system/* surface
 * migrations have a natural home without ballooning the nick router.
 *
 * Replaces (coexistence · legacy REST stays mounted):
 *   · GET /api/system/health-report → healthReport
 *
 * Both call the same `buildHealthReport()` service so the legacy REST
 * consumers and the new tRPC consumers can't drift.
 */

import { z } from "zod";
import { router, operatorProcedure } from "../trpc";
import { buildHealthReport } from "@/lib/services/system-health";
import { buildLensStats } from "@/lib/services/lens-stats";
import { buildJudgeEvalSummary } from "@/lib/services/judge-eval";
import { buildAiCostFeed } from "@/lib/services/ai-cost";
import { readGhostNourCandidates } from "@/lib/services/ghost-nour";
import { readRecentV2Samples } from "@/lib/ai/judge-eval/sampler";
import { scanCronHealth } from "@/lib/system/cron-diagnostics";

const HealthRangeSchema = z.enum(["24h", "7d", "30d"]);

export const systemRouter = router({
  /**
   * Owner-only · returns the same HealthReport shape the legacy REST
   * endpoint returned. Default range = 7d to match prior behavior.
   */
  healthReport: operatorProcedure
    .input(z.object({ range: HealthRangeSchema.default("7d") }))
    .query(async ({ input }) => {
      return buildHealthReport({ range: input.range });
    }),

  /**
   * Phase T (2026-05-18 PM) · owner-only · cron health rollup with
   * prioritized diagnoses. Delegates to `lib/system/cron-diagnostics`
   * (the same module the legacy REST endpoint /api/system/cron-diagnostics
   * and the local diagnostic script both call · single source of truth ·
   * drift impossible).
   *
   * No input · always returns the full report. The page consumer
   * (Phase T.4) used to poll this on a 30s interval via authedFetch
   * · React Query now drives the refetch via refetchInterval.
   */
  cronDiagnostics: operatorProcedure.query(async () => {
    return scanCronHealth();
  }),

  /**
   * Phase U.3 (2026-05-18 PM) · owner-only · strategic-frameworks
   * lens-firing aggregates over a configurable window. Delegates to
   * the shared `lib/services/lens-stats.ts` service that the legacy
   * REST endpoint also calls · drift between consumers impossible.
   *
   * Input · `{ days: 1-90 }` default 7 · query param shape mirrors
   * the legacy `?days=N` REST URL.
   */
  lensStats: operatorProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(7) }))
    .query(async ({ input }) => {
      return buildLensStats({ days: input.days });
    }),

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
   * Phase Y.2 (2026-05-18 PM) · owner-only · AI cost/latency/volume
   * feed for `/system/ai-cost`. 3 windows (today/7d/30d) + 14-day
   * sparkline trend + per-feature/per-model breakdowns. Delegates to
   * `lib/services/ai-cost.ts` so the legacy REST endpoint and tRPC
   * procedure can't drift.
   */
  aiCost: operatorProcedure.query(async () => buildAiCostFeed()),

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
});
