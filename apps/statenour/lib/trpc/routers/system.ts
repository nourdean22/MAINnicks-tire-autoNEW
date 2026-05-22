/**
 * lib/trpc/routers/system.ts · Phase S.2 (2026-05-18 PM) · extended
 * Phase UU.2 (2026-05-22 · legacy-modernizer REST→tRPC settings slice)
 * · extended Phase VV (2026-05-22 · REST→tRPC system-widgets sub-slice).
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
 * Phase VV folds the 15 components/system/* dashboard widgets in here
 * (the system domain is genuinely large — one router, no sub-routers):
 *   evalResults · promptCompare · promptShadowTrend · promptLibrary ·
 *   decisionDrift · antiPatterns + createAntiPattern + revisitAntiPattern
 *   + deleteAntiPattern · quality · schemaDrift · errorsGrouped +
 *   errorsRecent · staleData + purgeStaleData · schemaCoverage · gaps ·
 *   embeddingCoverage · cronTree · entityHistory · hub.
 *
 * Every procedure delegates to a shared service so the legacy REST
 * consumers and the new tRPC consumers can't drift.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, operatorProcedure } from "../trpc";
import { prisma } from "@/lib/prisma";
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
import { ServiceError } from "@/lib/utils/service-error";
import { listEvalResults } from "@/lib/services/eval-results";
import { buildPromptCompare } from "@/lib/services/prompt-compare";
import { readShadowTrend } from "@/lib/ai/prompt/v2/shadow-metrics";
import { listPrompts, getRegistryStats } from "@/lib/prompts/library";
import type { PromptCategory } from "@/lib/prompts/library";
import { buildDecisionDriftFeed } from "@/lib/services/decision-drift";
import {
  listAntiPatterns,
  upsertAntiPattern,
  revisitAntiPattern,
  deleteAntiPattern,
} from "@/lib/services/anti-patterns";
import { buildNickQualityFeed } from "@/lib/services/nick-quality";
import { getSchemaDrift } from "@/lib/services/schema-drift";
import { listGroupedErrors, listRecentErrors } from "@/lib/services/error-log";
import { scanStaleData } from "@/lib/system/stale-data-scanner";
import type { StaleCategoryId } from "@/lib/system/stale-data-scanner";
import {
  purgeStaleCategory,
  purgeAllStale,
} from "@/lib/system/stale-data-purger";
import { buildSchemaCoverageReport } from "@/lib/db/schema-coverage";
import { getTopSlowQueries } from "@/lib/db/slow-query-tracker";
import { scanSystemGaps } from "@/lib/services/system-gaps";
import { buildEmbeddingCoverage } from "@/lib/services/embedding-coverage";
import { buildCronTree } from "@/lib/services/cron-tree";
import { getEntityHistory } from "@/lib/db/entity-audit";
import { buildSystemHub } from "@/lib/services/system-hub";
import {
  antiPatternCreateSchema,
  preferenceVectorSaveSchema,
  personaDriftResolveSchema,
  contradictionResolveSchema,
  decisionReplayMarkSchema,
} from "@/lib/validators/system";
// Phase B.6c · ultron system-domain sub-slice · the 5 shared services
// the migrated components/ultron/* cards delegate to (the legacy REST
// routes call the same functions · drift impossible).
import {
  buildPreferenceVectorView,
  savePreferenceVectorOverride,
} from "@/lib/services/preference-vector";
import { buildDeployInfo } from "@/lib/services/deploy-info";
import {
  listPersonaDrifts,
  resolvePersonaDrift,
} from "@/lib/services/persona-drift";
import {
  listContradictions,
  resolveContradictionEntry,
} from "@/lib/services/contradictions";
import {
  buildDecisionReplaysView,
  markDecisionReplay,
} from "@/lib/services/decision-replays";
// Phase B.7a · system-pages sub-slice · the shared services the
// migrated app/(mastery)/system/* page surfaces delegate to. Each is
// also called by the matching legacy REST route — drift structurally
// impossible. All return explicit shallow shapes (Prisma Json columns
// projected to `unknown` inside the service) so the recursive
// `JsonValue` type never reaches the AppRouter — the TS2589 firewall.
import {
  buildDiagnostics,
  buildSystemHealth,
  buildAutonomousActionsFeed,
  buildAgentTracesFeed,
  buildAgentTraceDetail,
  buildChatHealth,
  buildSystemCosts,
  buildCronRunHistory,
  buildCronCommandDeck,
  buildDeploymentTruth,
  buildDeviceFleet,
} from "@/lib/services/system-pages";
import { runManifestCron } from "@/lib/services/cron-control";
import {
  listPendingActions,
  summarizeQueue,
  decidePendingAction,
} from "@/lib/automation/approval-queue";
import { tailEvents } from "@/lib/db/brain-bus-tail";

const HealthRangeSchema = z.enum(["24h", "7d", "30d"]);

/** Phase B.7a · the seven TraceSource values · mirrors the
 *  VALID_SOURCES whitelist in app/api/system/agent-traces/route.ts.
 *  The `agentTraces` procedure's `source` input is strict to this
 *  enum so a bad value is rejected at the boundary. */
const TraceSourceSchema = z.enum([
  "chat",
  "cron",
  "autonomous",
  "tool",
  "journal",
  "brain",
  "other",
]);

/**
 * Phase B.7a · flat brain-bus tail event shape for the `brainBusEvents`
 * procedure. The `tailEvents` service returns `Date` fields; the
 * procedure stringifies them (mirroring the legacy REST route's map) so
 * the public type matches the /system/brain-bus page's `TailEvent`
 * interface exactly. No Prisma Json reaches the wire — `payloadPreview`
 * is already a string projection inside the service.
 */
interface BrainBusTailView {
  generatedAt: string;
  cursor: string | null;
  windowCounts: {
    pending: number;
    processing: number;
    done: number;
    failed: number;
    dead: number;
  };
  events: Array<{
    id: string;
    topic: string;
    eventType: string;
    status: string;
    attempts: number;
    payloadPreview: string | null;
    lastError: string | null;
    createdAt: string;
    processedAt: string | null;
    availableAt: string;
  }>;
}

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

/**
 * Phase VV · the stale-data category whitelist · mirrors the `KNOWN`
 * set in app/api/system/stale-data/purge/route.ts verbatim. The
 * `purgeStaleData` mutation rejects any id outside this set so a typo
 * can't reach the purger.
 */
const STALE_CATEGORIES: ReadonlySet<StaleCategoryId> =
  new Set<StaleCategoryId>([
    "drift_alerts_unresolved_14d",
    "pending_actions_7d",
    "skill_candidates_30d",
    "open_contradictions_60d",
    "abandoned_tasks_30d",
    "orphan_conversations",
    "overdue_decisions_reviews",
    "ancient_device_events",
  ]);

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

  // ════════════════ Phase VV · system dashboard widgets ════════════════

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

  /**
   * Phase VV · owner-only · the v1↔v2 system-prompt shadow comparison.
   * Replaces GET /api/system/prompt-compare · delegates to the shared
   * `prompt-compare.buildPromptCompare` service. Returns the full
   * payload (both prompts + section-coverage delta) at the top level —
   * the legacy route returned the object directly, so the call-site
   * reads it unwrapped.
   */
  promptCompare: operatorProcedure.query(async () => buildPromptCompare()),

  /**
   * Phase VV · owner-only · the shadow-mode v1/v2 char-delta trend.
   * Replaces GET /api/system/prompt-shadow-trend?days=N · delegates to
   * the same `readShadowTrend` helper every consumer uses. The 24h
   * summary (avgPct + sample count) is computed here exactly as the
   * REST route did so PromptComparisonView's trend strip is unchanged.
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
   * Phase VV · owner-only · the decision follow-through pulse (W12.2).
   * Replaces GET /api/system/decision-drift · delegates to the shared
   * `decision-drift.buildDecisionDriftFeed` service. QualityDecisionsView
   * polls this on a 2-minute interval — the page now drives the refetch
   * via refetchInterval rather than a manual setInterval.
   */
  decisionDrift: operatorProcedure.query(async () =>
    buildDecisionDriftFeed(),
  ),

  /**
   * Phase VV · owner-only · the anti-pattern library (W12.4) listing.
   * Replaces GET /api/system/anti-patterns · delegates to the shared
   * `anti-patterns.listAntiPatterns` service. Returns `{ items,
   * summary }` mirroring the legacy `data` envelope.
   */
  antiPatterns: operatorProcedure.query(async () => listAntiPatterns()),

  /**
   * Phase VV · owner-only · create (or merge-by-key) an anti-pattern.
   * Replaces POST /api/system/anti-patterns · delegates to the shared
   * `anti-patterns.upsertAntiPattern` service.
   *
   * Input uses the SHARED `antiPatternCreateSchema` from
   * @/lib/validators/system — the exact schema the REST route's
   * `CreateSchema.parse()` uses. NOT a permissive z.record at the
   * procedure boundary · this is the typed-payload-mismatch guard (the
   * /tasks quick-add bug class). Returns `{ item, action }` where
   * action is "created" | "updated".
   */
  createAntiPattern: operatorProcedure
    .input(antiPatternCreateSchema)
    .mutation(async ({ input }) => upsertAntiPattern(input)),

  /**
   * Phase VV · owner-only · bump an anti-pattern's revisit counter.
   * Replaces POST /api/system/anti-patterns/revisit · delegates to the
   * shared `anti-patterns.revisitAntiPattern` service. A missing key
   * throws ServiceError(404) → mapped to NOT_FOUND so both transports
   * reject identically.
   */
  revisitAntiPattern: operatorProcedure
    .input(z.object({ key: z.string().min(1).max(60) }))
    .mutation(async ({ input }) => {
      try {
        return await revisitAntiPattern(input.key);
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
   * Phase VV · owner-only · soft-delete an anti-pattern (recoverable).
   * Replaces DELETE /api/system/anti-patterns?key=... · delegates to
   * the shared `anti-patterns.deleteAntiPattern` service.
   */
  deleteAntiPattern: operatorProcedure
    .input(z.object({ key: z.string().min(1).max(60) }))
    .mutation(async ({ input }) => deleteAntiPattern(input.key)),

  /**
   * Phase VV · owner-only · the Nick-quality trend (W12.1). Replaces
   * GET /api/system/quality · delegates to the shared
   * `nick-quality.buildNickQualityFeed` service. QualityNickView polls
   * this on a 60s interval — now driven by refetchInterval.
   */
  quality: operatorProcedure.query(async () => buildNickQualityFeed()),

  /**
   * Phase VV · owner-only · the 30s-cached schema-drift check. Replaces
   * GET /api/system/schema-drift · delegates to the shared
   * `schema-drift.getSchemaDrift` service (which now owns the cache the
   * route used to hold as a module closure). `force` skips the cache —
   * the SchemaDriftCard's reload button passes `{force:true}`.
   */
  schemaDrift: operatorProcedure
    .input(
      z.object({ force: z.boolean().optional() }).optional(),
    )
    .query(async ({ input }) => getSchemaDrift(input?.force ?? false)),

  /**
   * Phase VV · owner-only · top-20 error fingerprints grouped by
   * message. Replaces the `?grouped=true` branch of GET
   * /api/system/errors · delegates to the shared
   * `error-log.listGroupedErrors` service. Optional level filter
   * mirrors the legacy `?level=` param.
   *
   * Phase B.6c · `sinceHours` added for the ultron HQErrorsCard, which
   * needs a true 24h window for its rose/amber severity threshold (the
   * legacy card sent `?from=<24h-ago ISO>`). The procedure converts the
   * hours to a `from` Date before delegating. Omitting it scans the
   * whole log — the components/system/* ErrorsFingerprints behavior,
   * unchanged.
   */
  errorsGrouped: operatorProcedure
    .input(
      z
        .object({
          level: z.enum(["fatal", "error", "warn"]).optional(),
          sinceHours: z.number().int().min(1).max(8760).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      listGroupedErrors({
        level: input?.level,
        from: input?.sinceHours
          ? new Date(Date.now() - input.sinceHours * 3_600_000)
          : undefined,
      }),
    ),

  /**
   * Phase VV · owner-only · paginated recent-errors feed. Replaces the
   * paginated branch of GET /api/system/errors · delegates to the
   * shared `error-log.listRecentErrors` service. ErrorsFingerprints
   * calls this with `{pageSize:50}`.
   */
  errorsRecent: operatorProcedure
    .input(
      z
        .object({
          level: z.enum(["fatal", "error", "warn"]).optional(),
          page: z.number().int().min(1).max(1000).optional(),
          pageSize: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      listRecentErrors({
        level: input?.level,
        page: input?.page,
        pageSize: input?.pageSize,
      }),
    ),

  /**
   * Phase VV · owner-only · scan for "looks-live-but-stale" rows across
   * 8 categories. Replaces GET /api/system/stale-data · delegates to
   * the same `scanStaleData` scanner the route + cron use. No writes.
   */
  staleData: operatorProcedure.query(async () => scanStaleData()),

  /**
   * Phase VV · owner-only · purge stale data. Replaces POST
   * /api/system/stale-data/purge · delegates to the same
   * `purgeStaleCategory` / `purgeAllStale` the route calls.
   *
   * Omitting `category` purges EVERY category (the big-red-button);
   * passing one purges only that category. The category whitelist
   * mirrors the REST route's `KNOWN` set verbatim — an unknown id
   * throws BAD_REQUEST so both transports reject identically. Returns
   * the legacy `{ ok, mode, ... }` envelope so CoverageStaleView's
   * `data.result` / `data.totalPurged` reads are unchanged.
   */
  purgeStaleData: operatorProcedure
    .input(
      z
        .object({ category: z.string().max(80).optional() })
        .optional(),
    )
    .mutation(async ({ input }) => {
      if (input?.category) {
        if (!STALE_CATEGORIES.has(input.category as StaleCategoryId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Unknown category: ${input.category}. Valid: ${[
              ...STALE_CATEGORIES,
            ].join(", ")}`,
          });
        }
        const result = await purgeStaleCategory(
          input.category as StaleCategoryId,
        );
        return { ok: true, mode: "single" as const, result };
      }
      const all = await purgeAllStale();
      return { ok: true, mode: "all" as const, ...all };
    }),

  /**
   * Phase VV · owner-only · the index-coverage audit (every tracked
   * model with row + index counts + under-indexed-hot-table flag).
   * Replaces GET /api/system/schema-coverage · delegates to the same
   * `buildSchemaCoverageReport` the route calls, cross-referenced with
   * the slow-query tracker exactly as the route did.
   */
  schemaCoverage: operatorProcedure.query(async () => {
    const slowQueryShapes = getTopSlowQueries(20).map((q) => q.shape);
    return buildSchemaCoverageReport({ slowQueryShapes });
  }),

  /**
   * Phase VV · owner-only · the "nothing missing" detector (W11.4) —
   * scans for unscheduled crons, empty API shells, tool-catalog drift,
   * stale models, unset env vars. Replaces GET /api/system/gaps ·
   * delegates to the shared `system-gaps.scanSystemGaps` service.
   */
  gaps: operatorProcedure.query(async () => scanSystemGaps()),

  /**
   * Phase VV · owner-only · the pgvector-migration coverage rollup.
   * Replaces GET /api/system/embedding-coverage · delegates to the
   * shared `embedding-coverage.buildEmbeddingCoverage` service.
   */
  embeddingCoverage: operatorProcedure.query(async () =>
    buildEmbeddingCoverage(),
  ),

  /**
   * Phase VV · owner-only · the full cron manifest + live stats + the
   * fold/retire lineage (mode + foldedInto per row). Replaces GET
   * /api/system/crons · delegates to the shared `cron-tree.buildCronTree`
   * service. Distinct from `cronCatalog` (UU.2 · the /settings panel) —
   * this carries the FULL manifest so the CronFoldTree lineage view can
   * render folded + retired crons, which the scheduled-only catalog
   * cannot.
   */
  cronTree: operatorProcedure.query(async () => buildCronTree()),

  /**
   * Phase VV · owner-only · the field-level provenance log for one
   * entity. Replaces the per-entity-history branch of GET
   * /api/audit/entity · delegates to the same `getEntityHistory` the
   * route calls. The actor-firehose / global-firehose modes stay
   * REST-only · no tRPC consumer in this slice (EntityHistoryDrawer
   * only ever uses the per-entity mode).
   */
  entityHistory: operatorProcedure
    .input(
      z.object({
        entityType: z.string().min(1).max(60),
        entityId: z.string().min(1).max(128),
        limit: z.number().int().min(1).max(500).default(50),
      }),
    )
    .query(async ({ input }) => {
      const entries = await getEntityHistory(
        input.entityType,
        input.entityId,
        { limit: input.limit },
      );
      return { count: entries.length, entries, mode: "entity" as const };
    }),

  /**
   * Phase VV · owner-only · the /system hub landing-page rollup — one
   * compact payload feeding every subsurface card's live chip.
   * Replaces GET /api/system/hub · delegates to the shared
   * `system-hub.buildSystemHub` service. SystemHubGrid polls this on a
   * 60s interval — now driven by refetchInterval. The legacy route
   * wrapped the payload in `{ data }`; the procedure returns it
   * unwrapped and the call-site reads it directly.
   */
  hub: operatorProcedure.query(async () => buildSystemHub()),

  // ════════════ Phase B.6c · ultron system-domain sub-slice ════════════
  //
  // The 6 components/ultron/* cards targeting /api/system/* endpoints.
  // Each procedure delegates to a shared lib/services/ function the
  // legacy REST route ALSO calls · drift structurally impossible. The
  // 4 structured-write inputs use SHARED z.object schemas from
  // @/lib/validators/system (NOT permissive z.record · the
  // typed-payload-mismatch guard). Read procedures return the explicit
  // shallow service shapes — the Prisma Json columns the services touch
  // are projected to scalar / `unknown` inside the service, so the
  // public AppRouter type stays shallow (TS2589 firewall).

  /**
   * Phase B.6c · owner-only · the 8-axis preference-vector view ·
   * current vector + system-prompt addendum + last-tune metadata +
   * 12-week per-axis trace. Replaces GET /api/system/preference-vector
   * · delegates to the shared `preference-vector.buildPreferenceVectorView`
   * service. PreferencesCard polls this on a 5-min interval — React
   * Query now drives the refetch via refetchInterval. Returns the view
   * at the top level (the legacy route returned the object directly · no
   * envelope change).
   */
  preferenceVector: operatorProcedure.query(async () =>
    buildPreferenceVectorView(),
  ),

  /**
   * Phase B.6c · owner-only · persist a preference-vector override.
   * Replaces POST /api/system/preference-vector · delegates to the
   * shared `preference-vector.savePreferenceVectorOverride` service
   * (which zeros every axis on `reset`, else merges the partial patch ·
   * invalidates the style-adapter cache · writes the audit event).
   *
   * Input is the SHARED `preferenceVectorSaveSchema` from
   * @/lib/validators/system — the EXACT schema the REST route's
   * `overrideSchema.safeParse` uses. The inner `vector` object is
   * `.strict()` so an unknown axis key is rejected at the boundary,
   * not silently dropped — the typed-payload-mismatch guard.
   */
  savePreferenceVector: operatorProcedure
    .input(preferenceVectorSaveSchema)
    .mutation(async ({ input }) =>
      savePreferenceVectorOverride({
        vector: input.vector,
        reset: input.reset,
      }),
    ),

  /**
   * Phase B.6c · owner-only · the current deployment identity (build
   * SHA · branch · deploy timestamp). Replaces GET
   * /api/system/deploy-info · delegates to the shared
   * `deploy-info.buildDeployInfo` service (a pure env-var read). The
   * DeployChip fetches this once on mount via `utils.system.deployInfo
   * .fetch()`. The legacy route wrapped the payload in `{ data }`; the
   * procedure returns it unwrapped and the call-site reads it directly.
   *
   * Public on the REST side (build SHA is non-sensitive), but the tRPC
   * surface is operator-gated like every other procedure here · the
   * chip only renders inside the authed HQ shell anyway.
   */
  deployInfo: operatorProcedure.query(async () => buildDeployInfo()),

  /**
   * Phase B.6c · owner-only · active persona-drift events for the
   * PersonaDriftCard (7d window · dismissed + snoozed-not-expired
   * filtered out). Replaces GET /api/system/persona-drift · delegates
   * to the shared `persona-drift.listPersonaDrifts` service.
   * PersonaDriftCard polls this on a 5-min interval — now driven by
   * refetchInterval.
   */
  personaDrift: operatorProcedure.query(async () => listPersonaDrifts()),

  /**
   * Phase B.6c · owner-only · resolve a persona-drift event (dismiss ·
   * snooze · acknowledge). Replaces POST
   * /api/system/persona-drift/[key]/resolve · delegates to the shared
   * `persona-drift.resolvePersonaDrift` service.
   *
   * Input is the SHARED `personaDriftResolveSchema` from
   * @/lib/validators/system (the EXACT schema the REST route's
   * `bodySchema` uses) PLUS a `key` scalar — the route carried `key`
   * as a path param; tRPC has no path, so it rides in the input object.
   * A missing key throws ServiceError(404) → mapped to NOT_FOUND so
   * both transports reject identically.
   */
  resolvePersonaDrift: operatorProcedure
    .input(personaDriftResolveSchema.extend({ key: z.string().min(1).max(128) }))
    .mutation(async ({ input }) => {
      try {
        return await resolvePersonaDrift({
          key: input.key,
          resolution: input.resolution,
          note: input.note,
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
   * Phase B.6c · owner-only · unresolved (+ optionally resolved)
   * contradictions for the ContradictionsCard, grouped by status with
   * an unresolved-count badge. Replaces GET /api/system/contradictions
   * · delegates to the shared `contradictions.listContradictions`
   * service. ContradictionsCard polls this on a 5-min interval — now
   * driven by refetchInterval.
   *
   * The legacy URL was `?days=14&includeResolved=true`; the typed input
   * mirrors those two params (`days` clamped 1-180 · default 30, the
   * route's QuerySchema defaults verbatim).
   */
  contradictions: operatorProcedure
    .input(
      z
        .object({
          days: z.number().int().min(1).max(180).default(30),
          includeResolved: z.boolean().default(false),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      listContradictions({
        days: input?.days ?? 30,
        includeResolved: input?.includeResolved ?? false,
      }),
    ),

  /**
   * Phase B.6c · owner-only · resolve a contradiction (current_wins ·
   * old_wins · both_valid · dismissed) with an optional note. Replaces
   * POST /api/system/contradictions/[key]/resolve · delegates to the
   * shared `contradictions.resolveContradictionEntry` service.
   *
   * Input is the SHARED `contradictionResolveSchema` from
   * @/lib/validators/system (the EXACT schema the REST route's
   * `resolveSchema` uses) PLUS a `key` scalar (the route's path param).
   * A missing-or-corrupt row throws ServiceError(404) → NOT_FOUND so
   * both transports reject identically.
   */
  resolveContradiction: operatorProcedure
    .input(
      contradictionResolveSchema.extend({ key: z.string().min(1).max(128) }),
    )
    .mutation(async ({ input }) => {
      try {
        return await resolveContradictionEntry({
          key: input.key,
          status: input.status,
          note: input.note,
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
   * Phase B.6c · owner-only · the decision-replay backlog for the
   * DecisionReplayCard · `due` (queued, split unconsumed / consumed-
   * today) + `recent` (last 10 reviewed). Replaces GET
   * /api/system/decision-replays · delegates to the shared
   * `decision-replays.buildDecisionReplaysView` service.
   * DecisionReplayCard polls this on a 5-min interval — now driven by
   * refetchInterval.
   */
  decisionReplays: operatorProcedure.query(async () =>
    buildDecisionReplaysView(),
  ),

  /**
   * Phase B.6c · owner-only · mark a decision-replay row. Replaces POST
   * /api/system/decision-replays/[id]/mark · delegates to the shared
   * `decision-replays.markDecisionReplay` service. Dual-mode (matching
   * the legacy route): omitting `outcome` stamps consumedAt only (the
   * tap-to-chat row click); supplying it ALSO dual-writes the
   * DecisionReplay outcome row (the inline lesson form).
   *
   * Input is the SHARED `decisionReplayMarkSchema` from
   * @/lib/validators/system PLUS an `id` scalar (the route's path
   * param). `outcome` is optional at this layer so the empty-body mark
   * path validates. A missing row → ServiceError(404) → NOT_FOUND; a
   * wrong-category row → ServiceError(400) → BAD_REQUEST · both
   * transports reject identically.
   */
  markDecisionReplay: operatorProcedure
    .input(
      decisionReplayMarkSchema.extend({ id: z.string().min(1).max(128) }),
    )
    .mutation(async ({ input }) => {
      try {
        return await markDecisionReplay({
          id: input.id,
          outcome: input.outcome,
          outcomeScore: input.outcomeScore,
          lesson: input.lesson,
        });
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code:
              err.status === 404
                ? "NOT_FOUND"
                : err.status === 400
                  ? "BAD_REQUEST"
                  : "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        throw err;
      }
    }),

  // ═════════════ Phase B.7a · system-pages sub-slice A ═════════════
  //
  // The authedFetch call-sites in the first ~13 app/(mastery)/system/*
  // page files migrated onto trpc.system.*. Every procedure delegates
  // to a shared lib/services/ function the legacy REST route ALSO calls
  // · drift structurally impossible. Read procedures return the explicit
  // shallow service shapes (Prisma Json columns projected to `unknown`
  // inside the service · the public AppRouter type stays shallow ·
  // TS2589 firewall).

  /**
   * Phase B.7a · owner-only · the /system landing-page diagnostics
   * rollup · DB health + KPIs + row counts + device counts +
   * integrations. Replaces GET /api/system/diagnostics · delegates to
   * the shared `system-pages.buildDiagnostics` service. SystemPage
   * polls this on a 60s interval · React Query drives the refetch.
   * Returns the view at the top level (the legacy route's apiHandler
   * wrapped it in `{ data }`; the call-site read `r.data ?? r` · the
   * tRPC query hands it back unwrapped).
   */
  diagnostics: operatorProcedure.query(async () => buildDiagnostics()),

  /**
   * Phase B.7a · owner-only · the composite health probe — DB + task /
   * commitment / device / radar counts + morning-brief readiness +
   * Inngest + Braintrust visibility. Replaces GET /api/health ·
   * delegates to the shared `system-pages.buildSystemHealth` service
   * (which owns the 30s cache). SystemPage reads `alerts.unresolved` +
   * `commitments.active` off this.
   */
  healthSummary: operatorProcedure.query(async () => buildSystemHealth()),

  /**
   * Phase B.7a · owner-only · Nick's autonomous-action audit feed ·
   * grouped-by-rule leaderboard + latest 100 rows + approval breakdown.
   * Replaces GET /api/system/actions · delegates to the shared
   * `system-pages.buildAutonomousActionsFeed` service. The legacy
   * `?since` / `?rule` / `?approval` query params are mirrored as typed
   * optional inputs. ActionsPage polls this on a 30s interval · React
   * Query drives the refetch · the input object is the query key so
   * changing a filter triggers a refetch without a manual `load()`.
   */
  autonomousActions: operatorProcedure
    .input(
      z
        .object({
          since: z.enum(["24h", "7d", "30d"]).optional(),
          rule: z.string().max(200).optional(),
          approval: z
            .enum(["auto", "pending", "approved", "rejected"])
            .optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      buildAutonomousActionsFeed({
        since: input?.since,
        rule: input?.rule,
        approval: input?.approval,
      }),
    ),

  /**
   * Phase B.7a · owner-only · recent agent-trace chains + roll-ups + a
   * prior-24h baseline for the TrendCounter deltas. Replaces GET
   * /api/system/agent-traces · delegates to the shared
   * `system-pages.buildAgentTracesFeed` service. The legacy `?limit`
   * (clamped 1-100) / `?source` query params are mirrored as typed
   * inputs · `source` is strict to the TraceSource enum. AgentTracesPage
   * keys on the input object so switching the source filter refetches.
   */
  agentTraces: operatorProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
          source: TraceSourceSchema.optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      buildAgentTracesFeed({
        limit: input?.limit,
        source: input?.source,
      }),
    ),

  /**
   * Phase B.7a · owner-only · the full chain for one trace + per-row +
   * consolidated explainability envelope. Replaces GET
   * /api/system/agent-traces/[traceId] · delegates to the shared
   * `system-pages.buildAgentTraceDetail` service. An unknown traceId
   * throws ServiceError(404) → NOT_FOUND so both transports reject
   * identically (the page branches on the 404 to show a "stale link"
   * message).
   */
  agentTraceDetail: operatorProcedure
    .input(z.object({ traceId: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      try {
        return await buildAgentTraceDetail(input.traceId);
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
   * Phase B.7a · owner-only · the chat-route operator rollup — latency,
   * cost, volume, error rate, quality, tool health, provider mix.
   * Replaces GET /api/system/chat-health · delegates to the shared
   * `system-pages.buildChatHealth` service. ChatHealthPage polls this
   * on a 60s interval. The legacy route wrapped the payload in
   * `{ data }`; the procedure returns it unwrapped.
   */
  chatHealth: operatorProcedure.query(async () => buildChatHealth()),

  /**
   * Phase B.7a · owner-only · the operator-grade cost + latency +
   * provider-health rollup over a configurable window. Replaces GET
   * /api/system/costs · delegates to the shared
   * `system-pages.buildSystemCosts` service. The legacy `?days` query
   * param (clamped 1-90 · default 7) is mirrored as a typed input ·
   * SystemCostsPage polls this on a 30s interval and keys on the input
   * so switching the window refetches.
   */
  costs: operatorProcedure
    .input(
      z
        .object({ days: z.number().int().min(1).max(90).optional() })
        .optional(),
    )
    .query(async ({ input }) => buildSystemCosts({ days: input?.days })),

  /**
   * Phase B.7a · owner-only · per-job cron-run history · last N rows +
   * success-rate / median / p95. Replaces GET
   * /api/system/cron-runs/[jobName] · delegates to the shared
   * `system-pages.buildCronRunHistory` service. The legacy `?sinceDays`
   * (clamped 1-180) / `?limit` (clamped 1-500) query params are
   * mirrored as typed inputs · CronRunsPage keys on the input so
   * switching the window refetches.
   */
  cronRunHistory: operatorProcedure
    .input(
      z.object({
        jobName: z.string().min(1).max(120),
        sinceDays: z.number().int().min(1).max(180).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
    )
    .query(async ({ input }) =>
      buildCronRunHistory({
        jobName: input.jobName,
        sinceDays: input.sinceDays,
        limit: input.limit,
      }),
    ),

  /**
   * Phase B.7a · owner-only · the live cron command-deck feed · manifest
   * + per-job stats + drift + next-run countdown. Replaces GET
   * /api/system/crons · delegates to the shared
   * `system-pages.buildCronCommandDeck` service. CronsPage polls this on
   * a 30s interval. Distinct from `cronTree` (the fold-lineage view) —
   * this carries the per-row `nextRunAt` + `drift` the control deck
   * renders.
   */
  cronDeck: operatorProcedure.query(async () => buildCronCommandDeck()),

  /**
   * Phase B.7a · owner-only · fire a cron by jobName, validated against
   * the `config/crons.ts` manifest. Replaces POST /api/system/crons/run
   * · delegates to the shared `cron-control.runManifestCron` service.
   * An unknown jobName throws ServiceError(404) → NOT_FOUND; a retired
   * one ServiceError(410) → the tRPC code has no 410, so retired maps to
   * BAD_REQUEST (the page surfaces the message verbatim either way).
   *
   * Distinct from `runCron` (NN · the cron-diagnostics page · jobName →
   * vercel.json catalog via `triggerCronByName`) — this is the
   * `/system/crons` deck + `/system/cron-runs` drill-down path which
   * validates the typed CronDef manifest.
   */
  runManifestCron: operatorProcedure
    .input(z.object({ jobName: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      try {
        return await runManifestCron(input.jobName);
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
   * Phase B.7a · owner-only · the live deployment-agreement check —
   * code SHA + schema drift + env-secret presence + prompt mode + 24h
   * cron health. Replaces GET /api/system/deployment-truth · delegates
   * to the shared `system-pages.buildDeploymentTruth` service (which
   * owns the 30s cache). DeploymentTruthPage polls this on a 60s
   * interval.
   */
  deploymentTruth: operatorProcedure.query(async () =>
    buildDeploymentTruth(),
  ),

  /**
   * Phase B.7a · owner-only · the fleet-level device health feed —
   * SmartDevice + DeviceCommand + DeviceEvent composite + agent
   * liveness. Replaces GET /api/system/devices · delegates to the
   * shared `system-pages.buildDeviceFleet` service. DevicesPage polls
   * this on a 30s interval.
   */
  deviceFleet: operatorProcedure.query(async () => buildDeviceFleet()),

  /**
   * Phase B.7a · owner-only · retire every stale SmartDevice (status in
   * the filter set + lastSeenAt older than `olderThanDays`). Replaces
   * POST /api/devices/retire-stale · delegates to the same prisma
   * cleanup the route runs (FK-cascade DeviceCommand + DeviceEvent, then
   * delete the rows). `dryRun` returns the candidate list without
   * deleting — the DevicesPage retire button fires a dryRun first to
   * populate its confirm dialog count, then the real call.
   *
   * The route's `RetireBody` shape ({ olderThanDays?, statuses?,
   * dryRun? }) is mirrored as a strict typed input. Kept inline (small,
   * route-local · YAGNI · no other caller).
   */
  retireStaleDevices: operatorProcedure
    .input(
      z
        .object({
          olderThanDays: z.number().int().min(1).max(365).optional(),
          statuses: z.array(z.string().min(1).max(40)).max(10).optional(),
          dryRun: z.boolean().optional(),
        })
        .optional(),
    )
    .mutation(async ({ input }) => {
      const olderThanDays = input?.olderThanDays ?? 7;
      const statuses = input?.statuses ?? ["OFFLINE", "UNKNOWN", "ERROR"];
      const cutoff = new Date(
        Date.now() - olderThanDays * 24 * 60 * 60 * 1000,
      );

      const candidates = await prisma.smartDevice.findMany({
        where: {
          status: { in: statuses },
          OR: [{ lastSeenAt: { lt: cutoff } }, { lastSeenAt: null }],
        },
        select: {
          id: true,
          name: true,
          platform: true,
          lastSeenAt: true,
          status: true,
        },
      });

      if (input?.dryRun) {
        return {
          ok: true as const,
          dryRun: true as const,
          count: candidates.length,
          candidates,
        };
      }

      if (candidates.length === 0) {
        return { ok: true as const, retired: 0, candidates: [] };
      }

      const ids = candidates.map((c) => c.id);
      await prisma.deviceCommand
        .deleteMany({ where: { deviceId: { in: ids } } })
        .catch(() => ({ count: 0 }));
      await prisma.deviceEvent
        .deleteMany({ where: { deviceId: { in: ids } } })
        .catch(() => ({ count: 0 }));
      const deleted = await prisma.smartDevice.deleteMany({
        where: { id: { in: ids } },
      });

      return {
        ok: true as const,
        retired: deleted.count,
        candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
      };
    }),

  /**
   * Phase B.7a · owner-only · the durable brain-bus event tail · cursor-
   * based incremental fetch + 24h status counts. Replaces GET
   * /api/system/brain-bus-events · delegates to the shared
   * `brain-bus-tail.tailEvents` service the legacy route also calls.
   * The legacy `?sinceId` / `?limit` / `?topic` query params are
   * mirrored as typed inputs. The procedure stringifies the service's
   * `Date` fields (mirroring the route's map) so the public type
   * matches the page's `TailEvent` interface. BrainBusPage polls this
   * on a 3s cursor loop.
   */
  brainBusEvents: operatorProcedure
    .input(
      z
        .object({
          sinceId: z.string().max(128).optional(),
          limit: z.number().int().min(1).max(200).optional(),
          topic: z.string().max(120).optional(),
        })
        .optional(),
    )
    .query(async ({ input }): Promise<BrainBusTailView> => {
      const result = await tailEvents({
        sinceId: input?.sinceId,
        limit: input?.limit,
        topic: input?.topic,
      });
      return {
        generatedAt: new Date().toISOString(),
        cursor: result.cursor,
        windowCounts: result.windowCounts,
        events: result.events.map((e) => ({
          id: e.id,
          topic: e.topic,
          eventType: e.eventType,
          status: e.status,
          attempts: e.attempts,
          payloadPreview: e.payloadPreview,
          lastError: e.lastError,
          createdAt: e.createdAt.toISOString(),
          processedAt: e.processedAt?.toISOString() ?? null,
          availableAt: e.availableAt.toISOString(),
        })),
      };
    }),

  /**
   * Phase B.7a · owner-only · the pending-autonomous-action approval
   * queue · every approval="pending" AutonomousAction row + policy
   * hints + a summary. Replaces GET /api/system/approvals · delegates
   * to the shared `approval-queue.{listPendingActions,summarizeQueue}`
   * the legacy route also calls. Returns `{ summary, rows }` mirroring
   * the legacy `data` envelope so ApprovalsPage's `data.rows` /
   * `data.summary` reads are unchanged.
   */
  approvals: operatorProcedure.query(async () => {
    const rowsPromise = listPendingActions();
    const summaryPromise = summarizeQueue();
    const rows = await rowsPromise;
    const summary = await summaryPromise;
    return { summary, rows };
  }),

  /**
   * Phase B.7a · owner-only · decide one pending AutonomousAction row
   * (approve · reject) with optional notes. Replaces POST
   * /api/system/approvals/[id] · delegates to the shared
   * `approval-queue.decidePendingAction` service (which on approve also
   * replays the deferred side effect). The route carried the row id as
   * a path param; tRPC has no path, so it rides in the input object.
   * A missing id throws ServiceError(404) → NOT_FOUND; a non-pending
   * row ServiceError(409) → CONFLICT · both transports reject
   * identically.
   */
  decideApproval: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(128),
        decision: z.enum(["approved", "rejected"]),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await decidePendingAction(
          input.id,
          input.decision,
          "nour",
          input.notes,
        );
      } catch (err) {
        if (err instanceof ServiceError) {
          throw new TRPCError({
            code:
              err.status === 404
                ? "NOT_FOUND"
                : err.status === 409
                  ? "CONFLICT"
                  : "INTERNAL_SERVER_ERROR",
            message: err.message,
          });
        }
        throw err;
      }
    }),
});
