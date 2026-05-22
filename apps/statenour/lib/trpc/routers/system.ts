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
import { router, operatorProcedure, publicProcedure } from "../trpc";
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
// scattered-components REST→tRPC slice (2026-05-22) · shared functions
// the migrated components/{ultron/today,hud,ui}/* surfaces delegate to
// for their /api/{drift,auth/expires,errors} calls. Each is also called
// by the matching legacy REST route — drift structurally impossible.
import { resolveAlert } from "@/lib/mastery/drift-engine";
import { getSessionExpiry } from "@/lib/services/session-expiry";
import { recordClientError } from "@/lib/services/client-error";
import { checkBudget } from "@/lib/ai/budget";
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
// Phase B.7b · system-pages sub-slice B · the shared services the
// REMAINING app/(mastery)/system/* page surfaces delegate to (sub-slice
// A covered the first ~13 files). Each is also called by the matching
// legacy REST route — drift structurally impossible. All return
// explicit shallow shapes (Prisma Json columns projected to `unknown`
// or scalars inside the service · every Date stringified) so the
// recursive `JsonValue` type never reaches the AppRouter — TS2589
// firewall.
import {
  buildVapiCallStats,
  buildToolStats,
  buildRoutePerformance,
  listPoliciesView,
  updatePolicyFields,
  listPolicyFiresView,
  applyPowerSetting,
  buildPromptDiagnostics,
  buildReposOverview,
  buildSchemaHistory,
  buildTireStockRequests,
  buildActorActivity,
  buildSystemLogs,
} from "@/lib/services/system-pages-b";
import { getPowerSettings } from "@/lib/services/power-panel";
import { getEcosystemDigest } from "@/lib/system/repo-briefing";
import { hotFlushPromptCache } from "@/lib/ai/system-prompt-cache";
import { cached } from "@/lib/utils/cache";
import type { PowerSettings } from "@/lib/services/power-panel";
// Cross-domain residuals slice (2026-05-22) · the 3 shared services the
// migrated components/chat/* cards delegate to for their /api/ai/* +
// /api/system/* cross-domain calls. Each is also called by the matching
// legacy REST route — drift structurally impossible. Read procedures
// return the explicit shallow service shapes (the trace `metadata` Json
// is dropped inside the service · the AppRouter type stays shallow ·
// TS2589 firewall).
import { probeVeniceStatus } from "@/lib/services/venice-status";
import { buildAgentTraceByMessage } from "@/lib/services/agent-trace-by-message";
import { getProviderHealth } from "@/lib/ai/provider-health";
// straggler-pages REST→tRPC slice (2026-05-22) · the shared services
// the migrated /system/{features,migrations,ghost-nour,judge-eval}
// page surfaces delegate to. Each is also called by the matching
// legacy REST route — drift structurally impossible. feature-status +
// the migrations tracker return plain registries / scalars; ghost-nour
// + judge-eval return explicit flat interfaces declared here (Prisma
// Json columns projected to `unknown`, Dates stringified) — the TS2589
// firewall.
import { FEATURE_REGISTRY, summarize } from "@/lib/system/feature-status";
import type { FeatureMeta } from "@/lib/system/feature-status";
import {
  buildMigrationsTracker,
  type MigrationsPayload,
} from "@/lib/services/migrations-tracker";
import {
  runGhostNourPredict,
  GhostNourPredictError,
  type GhostPrediction,
} from "@/lib/services/ghost-nour-predict";
import { compareReplies } from "@/lib/ai/judge-eval/comparator";
import { recordComparison } from "@/lib/ai/judge-eval/persistence";
// hooks-lib REST→tRPC slice (2026-05-22) · the shared services /
// helpers the migrated system-domain hooks delegate to. Each is also
// called by the matching legacy REST route — drift structurally
// impossible. `buildSystemPulse` + `runChatDiagnostic` return explicit
// flat shapes (every Date stringified · no Prisma row) — the TS2589
// firewall. The push helpers are already a clean shared layer.
import {
  buildSystemPulse,
  type SystemPulseView,
} from "@/lib/services/system-pulse";
import {
  runChatDiagnostic,
  type DiagnoseChatResult,
} from "@/lib/services/diagnose-chat";
import {
  saveSubscription,
  removeSubscription,
  VAPID_PUBLIC_KEY,
} from "@/lib/notifications/push";

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

  // ═════════════ Phase B.7b · system-pages sub-slice B ═════════════
  //
  // The authedFetch call-sites in the REMAINING app/(mastery)/system/*
  // page files migrated onto trpc.system.*. Every procedure delegates
  // to a shared lib/services/system-pages-b.ts function the legacy REST
  // route ALSO calls · drift structurally impossible. Read procedures
  // return the explicit shallow service shapes (Prisma Json columns
  // projected to `unknown` / scalars · every Date stringified inside
  // the service · the public AppRouter type stays shallow · TS2589
  // firewall).

  /**
   * Phase B.7b · owner-only · VAPI call analytics · status / endReason
   * breakdown + avg duration + spend + most-recent call. Replaces GET
   * /api/system/vapi-calls · delegates to the shared
   * `system-pages-b.buildVapiCallStats` service (the VAPI key stays
   * server-side). The legacy `?days` query param (clamped 1-90) is
   * mirrored as a typed input · VapiCallsPage polls this on a 60s
   * interval and keys on the input so switching the window refetches.
   * The legacy route's apiHandler wrapped the payload in `{ data }`;
   * the procedure returns it unwrapped.
   */
  vapiCalls: operatorProcedure
    .input(
      z
        .object({ days: z.number().int().min(1).max(90).optional() })
        .optional(),
    )
    .query(async ({ input }) => buildVapiCallStats({ days: input?.days })),

  /**
   * Phase B.7b · owner-only · tool registry + family rollup · joins
   * the static TOOL_FAMILIES metadata with live availability +
   * BrainMemory-backed telemetry + a registry-drift report. Replaces
   * GET /api/system/tools/stats · delegates to the shared
   * `system-pages-b.buildToolStats` service. No input. The legacy
   * route wrapped the payload in `{ data }`; the procedure returns it
   * unwrapped and ToolsPage reads the object directly.
   */
  toolStats: operatorProcedure.query(async () => buildToolStats()),

  /**
   * Phase B.7b · owner-only · per-route latency percentiles
   * (p50/p95/p99 + error rate) over a configurable window. Replaces
   * GET /api/system/performance · delegates to the shared
   * `system-pages-b.buildRoutePerformance` service. The legacy
   * `?hours` (clamped 1-720) / `?minRequests` (floored at 1) query
   * params are mirrored as typed inputs · PerformancePage keys on the
   * input so switching the window refetches.
   */
  routePerformance: operatorProcedure
    .input(
      z
        .object({
          hours: z.number().int().min(1).max(720).optional(),
          minRequests: z.number().int().min(1).max(1000).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      buildRoutePerformance({
        hours: input?.hours,
        minRequests: input?.minRequests,
      }),
    ),

  /**
   * Phase B.7b · owner-only · the AutomationPolicy registry feed ·
   * every cron / tool / slash / webhook with its six governance
   * fields. Replaces GET /api/system/policies · delegates to the
   * shared `system-pages-b.listPoliciesView` (which wraps the
   * `listPolicies` service the legacy route also calls and projects
   * every `Date` to an ISO string). Returns `{ count, policies }`
   * mirroring the legacy `data` envelope. The legacy `?surface` /
   * `?approvalClass` / `?enabledOnly` params are mirrored as typed
   * optional inputs (PoliciesPage currently sends none · the filters
   * are client-side · the typed input keeps future server-filtering
   * cheap).
   */
  policies: operatorProcedure
    .input(
      z
        .object({
          surface: z
            .enum(["cron", "tool", "slash", "autonomous-action", "webhook"])
            .optional(),
          approvalClass: z
            .enum(["auto", "pending", "forbidden"])
            .optional(),
          enabledOnly: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      listPoliciesView({
        surface: input?.surface,
        approvalClass: input?.approvalClass,
        enabledOnly: input?.enabledOnly,
      }),
    ),

  /**
   * Phase B.7b · owner-only · operator-facing policy edit · the
   * multi-field PATCH (approval-class flip · kill-switch toggle ·
   * notes edit). Replaces PATCH /api/system/policies/[id] · delegates
   * to the shared `system-pages-b.updatePolicyFields` service (each
   * field applied sequentially through the policy setters so the
   * audit log captures separate events · mirrors the route). The
   * route carried the id as a path param; tRPC has no path, so it
   * rides in the input object. A missing id throws ServiceError(404)
   * → NOT_FOUND so both transports reject identically.
   */
  updatePolicy: operatorProcedure
    .input(
      z.object({
        id: z.string().min(1).max(160),
        approvalClass: z
          .enum(["auto", "pending", "forbidden"])
          .optional(),
        enabled: z.boolean().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await updatePolicyFields({
          id: input.id,
          approvalClass: input.approvalClass,
          enabled: input.enabled,
          notes: input.notes,
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
   * Phase B.7b · owner-only · chronological fire history for one
   * policy. Replaces GET /api/system/policies/[id]/fires · delegates
   * to the shared `system-pages-b.listPolicyFiresView` (which wraps
   * `getPolicyFireHistory` and stringifies the `firedAt` Date). The
   * legacy `?limit` / `?offset` query params + the route's `id` path
   * param are mirrored as typed inputs. PoliciesPage's PolicyRow
   * lazy-loads this when the operator opens the fire-history panel.
   */
  policyFires: operatorProcedure
    .input(
      z.object({
        policyId: z.string().min(1).max(160),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).max(100000).optional(),
      }),
    )
    .query(async ({ input }) =>
      listPolicyFiresView({
        policyId: input.policyId,
        limit: input.limit,
        offset: input.offset,
      }),
    ),

  /**
   * Phase B.7b · owner-only · the full power-panel settings snapshot.
   * Replaces GET /api/system/power · delegates to the shared
   * `getPowerSettings` service (which already returns string-typed
   * fields). Returns `{ settings }` mirroring the legacy envelope so
   * PowerPanel's `data.settings` access is unchanged.
   */
  powerSettings: operatorProcedure.query(async () => {
    return { settings: await getPowerSettings() };
  }),

  /**
   * Phase B.7b · owner-only · patch a single power-panel setting.
   * Replaces POST /api/system/power · delegates to the shared
   * `system-pages-b.applyPowerSetting` service (the `pauseAllCrons`
   * pseudo-setting also fans out to every active cron's kill-switch ·
   * mirrors the route). The `key` enum is strict to the 6 mutable
   * PowerSettings keys (`updatedAt`/`updatedBy` are server-derived,
   * never client-settable) — the route's `PatchSchema` enum verbatim.
   * The route's extra `providerPin` / `quietMode` value guards are
   * hoisted here so a bad value is rejected at the boundary, not
   * silently persisted. Returns `{ settings }` mirroring the legacy
   * envelope.
   */
  setPowerSetting: operatorProcedure
    .input(
      z.object({
        key: z.enum([
          "quietMode",
          "providerPin",
          "strictMode",
          "dailyCostCapCents",
          "pauseAllCrons",
          "shadowMode",
        ]),
        value: z.union([z.string(), z.number(), z.boolean()]),
        note: z.string().max(280).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.key === "providerPin") {
        if (
          !["venice", "openai", "anthropic", "gemini", "auto"].includes(
            String(input.value),
          )
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "invalid providerPin",
          });
        }
      }
      if (input.key === "quietMode") {
        if (!["off", "nudges", "all"].includes(String(input.value))) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "invalid quietMode",
          });
        }
      }
      return applyPowerSetting({
        key: input.key as keyof PowerSettings,
        value: input.value,
        note: input.note,
      });
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
   * Phase B.7b · owner-only · the live REPO-MAP · every repo grouped
   * by ring with health color + last-commit age + deploy target.
   * Replaces GET /api/system/repos · delegates to the shared
   * `system-pages-b.buildReposOverview` service (60s-cached · reads
   * config/repos.ts + augments monitored repos with live GitHub
   * state). No input. ReposPage polls this on a 5-min interval.
   */
  reposOverview: operatorProcedure.query(async () => buildReposOverview()),

  /**
   * Phase B.7b · owner-only · the ecosystem briefing · week/month
   * commit totals + Nick-readable narrative + flag list. Replaces GET
   * /api/system/repo-briefing · delegates to the same
   * `getEcosystemDigest` the legacy route calls, 5-min-cached exactly
   * as the route did. No input. ReposPage fetches this alongside
   * `reposOverview`; a failure here must never blank the dashboard,
   * so the page treats this query's error as non-fatal.
   */
  repoBriefing: operatorProcedure.query(async () =>
    cached("system_repo_briefing", 300, getEcosystemDigest),
  ),

  /**
   * Phase B.7b · owner-only · the SchemaChangeLedger operator feed ·
   * 6-axis summary + recent ledger entries with destructive flag +
   * rollback plan. Replaces GET /api/system/schema-history ·
   * delegates to the shared `system-pages-b.buildSchemaHistory`
   * service (which projects every `Date` to an ISO string). The
   * legacy `?limit` (clamped 1-200) / `?env` query params are
   * mirrored as typed inputs · SchemaHistoryPage keys on the input so
   * switching the env filter refetches.
   */
  schemaHistory: operatorProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).optional(),
          env: z.enum(["local", "preview", "production"]).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      buildSchemaHistory({
        limit: input?.limit,
        environment: input?.env,
      }),
    ),

  /**
   * Phase B.7b · owner-only · the used-tire stock-check log · top-
   * asked sizes + urgency mix + daily histogram + recent calls.
   * Replaces GET /api/system/tire-stock-requests · delegates to the
   * shared `system-pages-b.buildTireStockRequests` service (the
   * BrainMemory Json `content` column is JSON.parsed + projected to
   * scalar fields inside the service). The legacy `?days` query param
   * (clamped 1-365) is mirrored as a typed input · TireStockRequests
   * Page polls this on a 60s interval and keys on the input so
   * switching the window refetches.
   */
  tireStockRequests: operatorProcedure
    .input(
      z
        .object({ days: z.number().int().min(1).max(365).optional() })
        .optional(),
    )
    .query(async ({ input }) =>
      buildTireStockRequests({ days: input?.days }),
    ),

  /**
   * Phase B.7b · owner-only · recent entity-audit activity by one
   * actor across all entities · the /system/history firehose mode.
   * Replaces the `?firehose=1&actor=` branch of GET /api/audit/entity
   * · delegates to the shared `system-pages-b.buildActorActivity`
   * (which wraps the `getActorActivity` service the legacy route also
   * calls, drops the `before`/`after` Json columns, and stringifies
   * `createdAt`). The per-entity + global-firehose modes stay
   * REST-only · no tRPC consumer in this slice (the history page only
   * uses the actor-firehose mode here · the per-entity mode is served
   * by the existing `entityHistory` procedure via EntityHistoryDrawer).
   *
   * `since` rides as an ISO string (tRPC has no Date wire type) ·
   * converted to a Date in the procedure. `action` is accepted for
   * call-shape parity but, like the legacy firehose, not applied —
   * `getActorActivity` never took an action filter.
   */
  actorActivity: operatorProcedure
    .input(
      z.object({
        actor: z.string().min(1).max(120),
        action: z
          .enum(["created", "updated", "soft_deleted", "restored", "purged"])
          .optional(),
        since: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
    )
    .query(async ({ input }) =>
      buildActorActivity({
        actor: input.actor,
        action: input.action,
        since: input.since ? new Date(input.since) : undefined,
        limit: input.limit,
      }),
    ),

  /**
   * Phase B.7b · owner-only · the unified live log tail · merges
   * ErrorLog + CronJobLog + SystemMetric + AutonomousAction +
   * ApiRequestLog into one reverse-chron stream. Replaces GET
   * /api/system/logs · delegates to the shared
   * `system-pages-b.buildSystemLogs` service (the SystemMetric `tags`
   * / ErrorLog `context` Json columns are nested under each entry's
   * `meta` bag typed `unknown` · TS2589 firewall). The legacy
   * `?limit` (clamped 10-500) / `?since` (ms · clamped 60s-24h) /
   * `?level` / `?source` (comma-list) query params are mirrored as
   * typed inputs — `sinceMs` is a number, `sources` an array. LogsPage
   * keys on the input + polls on a 10s interval.
   */
  systemLogs: operatorProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(10).max(500).optional(),
          sinceMs: z.number().int().min(60_000).max(86_400_000).optional(),
          level: z
            .enum(["error", "warn", "info", "success", "metric"])
            .optional(),
          sources: z
            .array(
              z.enum(["errors", "crons", "metrics", "actions", "requests"]),
            )
            .max(5)
            .optional(),
        })
        .optional(),
    )
    .query(async ({ input }) =>
      buildSystemLogs({
        limit: input?.limit,
        sinceMs: input?.sinceMs,
        level: input?.level,
        sources: input?.sources,
      }),
    ),

  // ═══════════ Cross-domain residuals slice · chat→system ═══════════
  //
  // The components/chat/* cards that hit /api/ai/* + /api/system/*
  // cross-domain endpoints. Each procedure delegates to a shared
  // lib/services/ function the legacy REST route ALSO calls · drift
  // structurally impossible. No input takes a permissive z.record —
  // veniceStatus + providerHealth take no input; agentTraceByMessage
  // takes a strict z.object.

  /**
   * Cross-domain residuals slice · owner-only · the live Venice API
   * status + balance probe. Replaces GET /api/ai/venice-status ·
   * delegates to the shared `venice-status.probeVeniceStatus` service
   * the REST route also calls. No input · the probe is a single bounded
   * fetch (10s timeout). `useVeniceHealth` polls this on a 30s interval
   * · React Query now drives the refetch via refetchInterval. Never
   * throws — a missing key / network failure resolves to
   * `{ ok: false, error }` so the consumer's health dot just goes amber.
   */
  veniceStatus: operatorProcedure.query(async () => probeVeniceStatus()),

  /**
   * Cross-domain residuals slice · owner-only · the full multi-provider
   * health snapshot (per-provider availability + cooldown + recent
   * errors + overall tone). Replaces GET /api/system/provider-health ·
   * delegates to the same `provider-health.getProviderHealth` the REST
   * route calls · drift impossible. No input. ProviderDegradationBanner
   * polls this on a 60s interval · React Query drives the refetch. The
   * legacy route returned the snapshot at the top level; the procedure
   * returns it unwrapped and the call-site reads it directly.
   */
  providerHealth: operatorProcedure.query(async () => getProviderHealth()),

  /**
   * Cross-domain residuals slice · owner-only · resolve a ChatMessage
   * to its agent-trace chain (the "why this answer" panel under each
   * Nick reply). Replaces GET /api/system/agent-traces/by-message/
   * [messageId] · delegates to the shared
   * `agent-trace-by-message.buildAgentTraceByMessage` service. Distinct
   * from `agentTraceDetail` (the /system page · keyed by traceId) — this
   * is keyed by messageId and carries the fresh-stream fallbacks.
   *
   * The route's path param + optional `?conversationId` query param are
   * mirrored as a strict typed input. The ReasoningTrace card lazy-
   * fetches this via `utils.system.agentTraceByMessage.fetch()` only on
   * expand. A missing-and-unresolvable message throws ServiceError(404)
   * → NOT_FOUND so both transports reject identically.
   */
  agentTraceByMessage: operatorProcedure
    .input(
      z.object({
        messageId: z.string().min(1).max(128),
        conversationId: z.string().min(1).max(64).optional(),
      }),
    )
    .query(async ({ input }) => {
      try {
        return await buildAgentTraceByMessage(
          input.messageId,
          input.conversationId,
        );
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

  // ═══════════ scattered-components REST→tRPC slice · system/* ═══════════
  //
  // The drift / session-expiry / client-error endpoints the migrated
  // components/{ultron/today,hud,ui}/* surfaces hit. Each procedure
  // delegates to a shared function the legacy REST route ALSO calls ·
  // drift structurally impossible. None returns a Prisma row · the
  // AppRouter stays trivially shallow.

  /**
   * scattered-components slice · owner-only · resolve a drift alert
   * (the TodoDesk aging-backlog "resolve" button). Replaces the
   * `action: "resolve"` branch of POST /api/drift · delegates to the
   * shared `drift-engine.resolveAlert` the REST route also calls. The
   * route's `action` discriminator is dropped (the procedure name IS
   * the action). DriftAlert.id is `Int @id` but stale localStorage ids
   * arrive stringified (`drift-42` → `42`) — the input accepts both and
   * coerces. A stale id whose row was already resolved / auto-archived
   * resolves `{ ok: true, note: "already gone" }` rather than throwing
   * (the legacy route's swallow-on-not-found behaviour).
   */
  resolveDrift: operatorProcedure
    .input(z.object({ id: z.union([z.string().max(64), z.number()]) }))
    .mutation(async ({ input }) => {
      const parsedId =
        typeof input.id === "number" ? input.id : Number(input.id);
      if (!Number.isFinite(parsedId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid id" });
      }
      try {
        await resolveAlert(parsedId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/Record to update not found|not found/i.test(msg)) {
          return { ok: true as const, note: "already gone" };
        }
        throw err;
      }
      return { ok: true as const };
    }),

  /**
   * scattered-components slice · the lightweight session-expiry probe ·
   * decodes the NextAuth JWT cookie + returns `{ expires }`. Replaces
   * GET /api/auth/expires · delegates to the shared
   * `session-expiry.getSessionExpiry` the REST route also calls · drift
   * impossible. The SessionExpiryBanner polls this on a 30-120s
   * interval. PUBLIC procedure — the legacy route is ungated (it just
   * decodes the cookie · a missing / expired / tampered token resolves
   * `{ expires: null }` and the banner stays silent · real 401
   * enforcement lives in middleware). Reads the cookie off
   * `ctx.headers`.
   */
  sessionExpiry: publicProcedure.query(async ({ ctx }) => {
    // ctx.headers is populated by createTRPCContext (the App Router
    // fetch handler) · absent only from createServerContext callers,
    // which never hit this probe. Fall back to empty headers → the
    // service resolves `{ expires: null }`, never throws.
    return getSessionExpiry(ctx.headers ?? new Headers());
  }),

  /**
   * scattered-components slice · owner-only · ingest one client-side
   * error (unhandled error / promise rejection / error-boundary trip)
   * into ErrorLog. Replaces POST /api/errors · delegates to the shared
   * `client-error.recordClientError` the REST route also calls · drift
   * impossible. ClientErrorTelemetry fires this fire-and-forget. The
   * write is best-effort · the service swallows write failures and
   * always resolves `{ ok: true }` (telemetry must never surface its
   * own failure). The route's `kind` whitelist is hoisted to a strict
   * `z.enum` at the `.input()` boundary.
   */
  recordClientError: operatorProcedure
    .input(
      z.object({
        kind: z.enum(["error", "unhandledrejection", "boundary"]),
        message: z.string().min(1).max(4000),
        stack: z.string().max(20_000).optional(),
        url: z.string().max(2000).optional(),
        userAgent: z.string().max(1000).optional(),
        timestamp: z.number().finite().optional(),
        componentStack: z.string().max(10_000).optional(),
        errorBoundary: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ input }) => recordClientError(input)),

  /**
   * scattered-components slice · owner-only · today's AI spend vs the
   * configured daily budget (cents · percentUsed · overBudget flag).
   * Delegates to the shared `budget.checkBudget` the /api/system/ai-
   * analytics route also calls. The CommandPalette "AI Spend Today"
   * probe reads only the budget summary off the legacy ai-analytics
   * payload — this procedure returns just that `BudgetStatus` slice
   * (the 6-way ai-analytics aggregate is overkill for a one-line
   * toast). Flat scalar shape · no TS2589 firewall needed.
   */
  aiSpend: operatorProcedure.query(async () => checkBudget()),

  /**
   * straggler-pages slice · owner-only · the honest feature-status
   * registry (LIVE / PARTIAL / DORMANT + activation triggers).
   * Replaces GET /api/system/feature-status · reads the same
   * `FEATURE_REGISTRY` + `summarize()` the legacy route returns ·
   * drift impossible. Both are plain serializable data (no Prisma) ·
   * no TS2589 firewall needed. The /system/features page polls this.
   */
  featureStatus: operatorProcedure.query(
    (): {
      generatedAt: string;
      summary: ReturnType<typeof summarize>;
      features: FeatureMeta[];
    } => ({
      generatedAt: new Date().toISOString(),
      summary: summarize(),
      features: FEATURE_REGISTRY,
    }),
  ),

  /**
   * straggler-pages slice · owner-only · the live migration tracker ·
   * static registry + scanned source-tree progress + the feature-flag
   * board. Replaces GET /api/system/migrations · delegates to the
   * shared `migrations-tracker.buildMigrationsTracker` the legacy
   * route also calls · drift impossible. The payload is fully typed
   * (`MigrationsPayload`) — flag list + summary are scalars, no Prisma
   * Json reaches the wire. The /system/migrations page polls this.
   */
  migrationsTracker: operatorProcedure.query(
    async (): Promise<MigrationsPayload> => buildMigrationsTracker(),
  ),

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
   * hooks-lib slice · owner-only · the FloatingHome orb-badge pulse
   * rollup (cron fails · errors · AI error rate · pending actions ·
   * device fleet · Nick-quality trend). Replaces GET /api/system/pulse
   * · delegates to the shared `system-pulse.buildSystemPulse` the
   * legacy route also calls · drift impossible (the 30s cache moved
   * into the service · one cache shared across both transports).
   *
   * `useSystemPulse` is a module-level de-duped poller, NOT a React
   * hook itself — it uses the vanilla tRPC client (`trpcVanilla.system
   * .pulse.query()`), the same imperative non-hook path
   * `ClientErrorTelemetry` uses. The procedure returns the explicit
   * flat `SystemPulseView` — every field a scalar, no Prisma row.
   */
  pulse: operatorProcedure.query(
    async (): Promise<SystemPulseView> => buildSystemPulse(),
  ),

  /**
   * hooks-lib slice · owner-only · the "Diagnose with Nick" health
   * probe · Venice reachability + Neon latency + recent chat errors /
   * slow requests / ai_error audit events → a markdown report.
   * Replaces GET /api/ai/diagnose-chat · delegates to the shared
   * `diagnose-chat.runChatDiagnostic` the legacy route also calls ·
   * drift impossible. The probe deliberately does NOT touch the chat
   * pipeline — the point is to diagnose a broken chat route WITHOUT
   * going through it.
   *
   * `useChatDiagnose` is a React hook inside <TRPCProvider> · it fires
   * this imperatively via `utils.system.diagnoseChat.fetch()` from the
   * error-card "Diagnose" button. Returns the explicit flat
   * `DiagnoseChatResult` (every Date stringified · no Prisma row).
   */
  diagnoseChat: operatorProcedure.query(
    async (): Promise<DiagnoseChatResult> => runChatDiagnostic(),
  ),

  /**
   * hooks-lib slice · the Web-Push VAPID public key (so the client can
   * subscribe). Replaces the GET branch of /api/notifications/subscribe
   * · returns the same `VAPID_PUBLIC_KEY` from `lib/notifications/push`
   * the legacy route returned · drift impossible.
   *
   * PUBLIC procedure — the VAPID public key is non-sensitive by
   * design (it's meant to ship to every browser); the legacy GET was
   * ungated for the same reason. `usePushNotifications` reads
   * `{ publicKey }` off this before calling `pushSubscribe`.
   */
  pushVapidKey: publicProcedure.query(() => ({
    publicKey: VAPID_PUBLIC_KEY,
  })),

  /**
   * hooks-lib slice · owner-only · register a Web-Push subscription.
   * Replaces the POST branch of /api/notifications/subscribe ·
   * delegates to the same `saveSubscription` helper the legacy route
   * calls · drift impossible. The `subscription` shape is strict
   * (endpoint + p256dh + auth keys) — the route's manual
   * `!subscription?.endpoint || !subscription?.keys?.p256dh` guard
   * hoisted to the typed `.input()`. Returns `{ success: true }`
   * mirroring the legacy envelope.
   */
  pushSubscribe: operatorProcedure
    .input(
      z.object({
        subscription: z.object({
          endpoint: z.string().min(1).max(2000),
          keys: z.object({
            p256dh: z.string().min(1).max(500),
            auth: z.string().min(1).max(500),
          }),
        }),
      }),
    )
    .mutation(async ({ input }) => {
      await saveSubscription(input.subscription);
      return { success: true as const };
    }),

  /**
   * hooks-lib slice · owner-only · remove a Web-Push subscription.
   * Replaces the DELETE branch of /api/notifications/subscribe ·
   * delegates to the same `removeSubscription` helper the legacy route
   * calls · drift impossible. Returns `{ success: true }` mirroring the
   * legacy envelope.
   */
  pushUnsubscribe: operatorProcedure
    .input(z.object({ endpoint: z.string().min(1).max(2000) }))
    .mutation(async ({ input }) => {
      await removeSubscription(input.endpoint);
      return { success: true as const };
    }),
});
