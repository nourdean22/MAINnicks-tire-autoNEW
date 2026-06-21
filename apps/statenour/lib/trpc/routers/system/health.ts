/**
 * lib/trpc/routers/system/health.ts
 *
 * Per-domain slice of the system router (mechanical split · 2026-05-31).
 * Exports a plain procedure-object that system.ts spreads back into
 * `systemRouter` — the client paths stay FLAT as `trpc.system.<proc>`.
 * Procedures moved VERBATIM · no behavior / input-schema / middleware
 * change. See system.ts for the recomposition.
 */

import { z } from "zod";
import { operatorProcedure } from "../../trpc";
import { buildHealthReport } from "@/lib/services/system-health";
import { buildAiCostFeed } from "@/lib/services/ai-cost";
import { scanCronHealth } from "@/lib/system/cron-diagnostics";
import { buildToolsHealth } from "@/lib/services/tools-health";
import {
  buildHealthTrend,
  buildErrorRateByRoute,
  buildIntegrationQuotas,
} from "@/lib/services/system-data";
import { checkBudget } from "@/lib/ai/budget";
import { buildDeployInfo } from "@/lib/services/deploy-info";
import {
  buildDiagnostics,
  buildSystemHealth,
  buildChatHealth,
  buildSystemCosts,
  buildDeploymentTruth,
} from "@/lib/services/system-pages";

import { getProviderHealth } from "@/lib/ai/provider-health";
import {
  buildSystemPulse,
  type SystemPulseView,
} from "@/lib/services/system-pulse";
import {
  runChatDiagnostic,
  type DiagnoseChatResult,
} from "@/lib/services/diagnose-chat";
import { runAutonomicOrchestrator } from "@/lib/services/autonomic-orchestrator";
const HealthRangeSchema = z.enum(["24h", "7d", "30d"]);

export const healthProcedures = {
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
   * probe · AI provider fleet + Neon latency + recent chat errors /
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
   * Phase Y.2 (2026-05-18 PM) · owner-only · AI cost/latency/volume
   * feed for `/system/ai-cost`. 3 windows (today/7d/30d) + 14-day
   * sparkline trend + per-feature/per-model breakdowns. Delegates to
   * `lib/services/ai-cost.ts` so the legacy REST endpoint and tRPC
   * procedure can't drift.
   */
  aiCost: operatorProcedure.query(async () => buildAiCostFeed()),

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
   * (Twilio · Resend · Stripe · Vercel). Replaces GET
   * /api/system/integration-quotas · delegates to the shared
   * `system-data.buildIntegrationQuotas` service. No input · always
   * probes every configured provider.
   */
  integrationQuotas: operatorProcedure.query(async () =>
    buildIntegrationQuotas(),
  ),

  // ════════════════ Phase VV · system dashboard widgets ════════════════

  /**
   * Mutation to manually trigger the full Autonomic Healer pipeline (cron healing,
   * DB vacuum, work item rescue, logs pruning).
   */
  runMaintenance: operatorProcedure.mutation(async () => {
    return runAutonomicOrchestrator();
  }),
};
