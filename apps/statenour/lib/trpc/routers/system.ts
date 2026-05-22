/**
 * lib/trpc/routers/system.ts · Phase S.2 (2026-05-18 PM) · extended
 * Phase UU.2 (2026-05-22 · legacy-modernizer REST→tRPC settings slice).
 *
 * System telemetry procedures · per the J tRPC migration plan, this is
 * the third domain router (after `nick` for reasoning + `operator` for
 * forward-looking state). Lives separately so future /system/* surface
 * migrations have a natural home without ballooning the nick router.
 *
 * Replaces (coexistence · legacy REST stays mounted):
 *   · GET /api/system/health-report → healthReport
 *
 * Phase UU.2 folds the /settings system-ops surfaces in here (rather
 * than spawning a thin `settings` router): cron control catalog +
 * path-trigger, auto-pilot flags, tools health, and the three
 * SystemDataCards endpoints (health-trend · error-rate · quotas). All
 * are config / system-ops flavoured → `system` is their natural home.
 *
 * Every procedure delegates to a shared service so the legacy REST
 * consumers and the new tRPC consumers can't drift.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, operatorProcedure } from "../trpc";
import { buildHealthReport } from "@/lib/services/system-health";
import { buildLensStats } from "@/lib/services/lens-stats";
import { buildJudgeEvalSummary } from "@/lib/services/judge-eval";
import { buildAiCostFeed } from "@/lib/services/ai-cost";
import { readGhostNourCandidates } from "@/lib/services/ghost-nour";
import { readRecentV2Samples } from "@/lib/ai/judge-eval/sampler";
import { scanCronHealth } from "@/lib/system/cron-diagnostics";
import {
  triggerCronByName,
  triggerCronByPath,
  setCronEnabled as setCronEnabledService,
  listScheduledCrons,
  listCronControls,
  getCronStats,
} from "@/lib/services/cron-control";
import {
  getAutopilotFlags,
  setAutopilotFlags,
} from "@/lib/services/autopilot-flags";
import { buildToolsHealth } from "@/lib/services/tools-health";
import {
  buildHealthTrend,
  buildErrorRateByRoute,
  buildIntegrationQuotas,
} from "@/lib/services/system-data";

const HealthRangeSchema = z.enum(["24h", "7d", "30d"]);

// CronControlPanel's `/api/settings/crons` GET assembles scheduled crons
// + mega-fanout virtual crons + control state + 14d stats. The MEGA
// fanout list is duplicated from `app/api/settings/crons/route.ts`
// verbatim (the route keeps its copy as the rollback path).
const MEGA_FANOUT = [
  "device-sync",
  "learn",
  "stale-tasks",
  "device-health",
  "brain-cycle",
  "notification-sender",
  "journal-checkin",
  "embed-backfill",
  "reflect",
  "predict",
  "think",
  "consolidate",
  "drift-check",
  "daily-report",
  "data-cleanup",
  "intelligence",
];

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

  /**
   * Phase NN (2026-05-19 AM) · owner-only · manually fire a cron by
   * its jobName. Closes the T.4 coexistence carve-out where the
   * cron-diagnostics page's `runNow` + `enableCron` actions stayed
   * on REST after the read-side was migrated.
   *
   * Pre-fix the page was sending `{jobName}` to a route that
   * expected `{path}` · button was silently broken since wave-181.4.
   * New tRPC takes the operator-natural `{jobName}` and derives the
   * path internally via `triggerCronByName` · drift-proof against
   * the catalog logic.
   *
   * Caller invalidates `system.cronDiagnostics` after success to
   * refresh the per-job stats table.
   */
  runCron: operatorProcedure
    .input(z.object({ jobName: z.string().min(1).max(80) }))
    .mutation(async ({ input }) => triggerCronByName(input.jobName)),

  /**
   * Phase NN · owner-only · toggle a cron's enabled flag (kill-switch
   * + re-enable from the diagnostics page). `enabled: false` means
   * the kill-switch is engaged · the cron router skips fanout for
   * that job until re-enabled.
   *
   * Caller invalidates `system.cronDiagnostics` after success.
   */
  setCronEnabled: operatorProcedure
    .input(
      z.object({
        jobName: z.string().min(1).max(80),
        enabled: z.boolean(),
        note: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const next = await setCronEnabledService(
        input.jobName,
        input.enabled,
        input.note,
      );
      return { jobName: input.jobName, enabled: next };
    }),

  // ───────────────── Settings · cron control panel (UU.2) ─────────────────

  /**
   * Phase UU.2 · owner-only · the CronControlPanel catalog. Replaces
   * GET /api/settings/crons · scheduled crons (from vercel.json) PLUS
   * the mega-fanout virtual crons, each joined to its kill-switch
   * control state + 14-day success/fail stats.
   *
   * Assembles from the SAME three `cron-control` service functions the
   * REST route calls (`listScheduledCrons` · `listCronControls` ·
   * `getCronStats`) · the mega-fanout merge logic mirrors the route
   * verbatim · drift impossible. Returns the row array directly (the
   * panel reads `raw.data` off the legacy envelope · the tRPC query
   * gives it the array unwrapped).
   */
  cronCatalog: operatorProcedure.query(async () => {
    const [scheduled, controls, stats] = await Promise.all([
      listScheduledCrons(),
      listCronControls(),
      getCronStats(),
    ]);
    const controlsMap = new Map(controls.map((c) => [c.jobName, c]));
    const scheduledNames = new Set(scheduled.map((c) => c.jobName));
    const virtualCrons = MEGA_FANOUT.filter(
      (name) => !scheduledNames.has(name),
    ).map((name) => ({
      jobName: name,
      path: `/api/cron/${name}`,
      schedule: "(mega fanout)",
    }));
    const all = [...scheduled, ...virtualCrons];
    return all.map((c) => {
      const control = controlsMap.get(c.jobName);
      const stat = stats[c.jobName] ?? {
        lastSuccessAt: null,
        lastFailAt: null,
        success14d: 0,
        fail14d: 0,
      };
      return {
        ...c,
        enabled: control?.enabled ?? true,
        note: control?.note ?? null,
        controlUpdatedAt: control?.updatedAt ?? null,
        ...stat,
      };
    });
  }),

  /**
   * Phase UU.2 · owner-only · manually fire a cron by its path (e.g.
   * `/api/cron/drift-check` or `/api/cron/mega?slot=morning`). Replaces
   * POST /api/settings/crons/trigger · delegates to the same
   * `triggerCronByPath` the REST route calls · drift impossible.
   *
   * The CronControlPanel already knows each cron's path (from
   * `cronCatalog`), so a path-keyed trigger maps the panel's existing
   * `trigger(path, jobName)` signature 1:1 · this is deliberately
   * distinct from the jobName-keyed `runCron` (NN) which the cron-
   * diagnostics page uses. The path guard mirrors the REST route.
   */
  triggerCron: operatorProcedure
    .input(z.object({ path: z.string().min(1).max(200) }))
    .mutation(async ({ input }) => {
      if (!input.path.startsWith("/api/cron/")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid cron path",
        });
      }
      return triggerCronByPath(input.path);
    }),

  // ──────────────── Settings · auto-pilot flags (UU.2) ────────────────

  /**
   * Phase UU.2 · owner-only · read the persisted auto-pilot flag map.
   * Replaces GET /api/settings/autopilot · delegates to the shared
   * `autopilot-flags` service · drift impossible. Returns
   * `{ flags }` matching the legacy envelope so the page's
   * `data.flags` access is unchanged.
   */
  autopilotFlags: operatorProcedure.query(async () => {
    return { flags: await getAutopilotFlags() };
  }),

  /**
   * Phase UU.2 · owner-only · persist the auto-pilot flag map. Replaces
   * POST /api/settings/autopilot · the service merges over DEFAULTS so
   * every known key is present. Input is a typed string→boolean record
   * (the panel builds the map from its flag list · the keys are
   * operator-defined flag names so a `z.record` of `z.boolean()` is the
   * correct shape — the *values* are strictly typed, which is the guard
   * that matters here).
   */
  setAutopilotFlags: operatorProcedure
    .input(z.object({ flags: z.record(z.string(), z.boolean()) }))
    .mutation(async ({ input }) => {
      return { flags: await setAutopilotFlags(input.flags) };
    }),

  // ─────────────── Settings · tools health + data cards (UU.2) ───────────────

  /**
   * Phase UU.2 · owner-only · runtime dependency check for every tool
   * category (DB latency · env-var presence · per-category rollup).
   * Replaces GET /api/tools/health · delegates to the shared
   * `tools-health` service · drift impossible.
   */
  toolsHealth: operatorProcedure.query(async () => buildToolsHealth()),

  /**
   * Phase UU.2 · owner-only · 7/14/30-day SystemHealthDigest trend for
   * the SystemDataCards sparkline. Replaces GET /api/system/health-trend
   * · delegates to the shared `system-data.buildHealthTrend` service.
   * Returns the report at the top level — the legacy route wrapped it
   * in `{ data }`, the component reads `j?.data`; the tRPC query hands
   * it back unwrapped and the call-site reads the object directly.
   */
  healthTrend: operatorProcedure
    .input(
      z
        .object({ range: z.enum(["7d", "14d", "30d"]).default("7d") })
        .optional(),
    )
    .query(async ({ input }) => buildHealthTrend(input?.range ?? "7d")),

  /**
   * Phase UU.2 · owner-only · per-route reliability metrics over a
   * window, scored "fix-first". Replaces GET
   * /api/system/error-rate-by-route · delegates to the shared
   * `system-data.buildErrorRateByRoute` service.
   */
  errorRateByRoute: operatorProcedure
    .input(
      z
        .object({
          range: z.enum(["1h", "24h", "7d"]).default("24h"),
          minRequests: z.number().int().min(1).max(1000).default(5),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      buildErrorRateByRoute(input?.range ?? "24h", input?.minRequests ?? 5),
    ),

  /**
   * Phase UU.2 · owner-only · real-time cost/quota state per provider
   * (Twilio · Resend · Stripe · Vercel · Venice). Replaces GET
   * /api/system/integration-quotas · delegates to the shared
   * `system-data.buildIntegrationQuotas` service. No input · always
   * probes every configured provider.
   */
  integrationQuotas: operatorProcedure.query(async () =>
    buildIntegrationQuotas(),
  ),
});
