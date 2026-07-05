/**
 * System + integration health: stats, siteHealth, bundles, diagnostics, sync, review-stats, smoke test, integration log.
 *
 * Carved from admin/dashboard.ts (1,133 lines, one router object holding
 * 17 procedures) in the 2026-07-05 polish wave. Grouped by reason-to-change.
 * Each group is a plain procedure record; ./index.ts spread-merges them into
 * one flat router, so every adminDashboard.<proc> client call path is
 * byte-identical. Pure mechanical move — no procedure body was modified.
 */
/**
 * Admin router — dashboard stats, analytics, weekly reports, follow-ups.
 */
import { adminProcedure } from "../../../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDeliveryLog } from "../../../email-notify";
import { getDashboardStats, getSiteHealth } from "../../../admin-stats";
import { z } from "zod";
import { saveReviewStatsToDb } from "../../../google-reviews";





export const healthProcedures = {
  stats: adminProcedure.query(async () => {
    return getDashboardStats();
  }),
  siteHealth: adminProcedure.query(async () => {
    return getSiteHealth();
  }),

  /**
   * Medium-tier OverviewSection bundle — closes admin audit §1.
   * Combines 5 useQuery calls (stats, bookings, leads, callbacks,
   * siteHealth) into a single 30s-cadence query. Each field is
   * nullable so one slow/failing subquery does not break the
   * dashboard. See server/services/adminBundle.ts.
   */
  overviewMediumBundle: adminProcedure.query(async () => {
    const { getOverviewMediumBundle } = await import("../../../services/adminBundle");
    return getOverviewMediumBundle();
  }),

  /** Full system diagnostics — predictive health, trends, anomalies, recovery history */
  systemDiagnostics: adminProcedure.query(async () => {
    const { generateDiagnosticReport } = await import("../../../lib/self-healing");
    return generateDiagnosticReport();
  }),

  /**
   * Recent integration failures (read-only) — sheets_sync / email / sms / capi /
   * review_request / reminders / invoice. Surfaces silent breakage that can lose
   * leads. Returns SAFE fields only: the raw errorDetails payload is never
   * exposed and the message is scrubbed of key/token text.
   * See server/integration-failures.ts:getRecentIntegrationFailures.
   */
  integrationFailures: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).optional())
    .query(async ({ input }) => {
      const { getRecentIntegrationFailures } = await import("../../../integration-failures");
      return getRecentIntegrationFailures(input?.limit ?? 30);
    }),

  /**
   * Meta CAPI configuration status (read-only, booleans ONLY — env values
   * are never returned). Lets the owner see dormant-vs-active on Site
   * Health instead of asking. Activation runbook:
   * docs/runbooks/CAPI-ACTIVATION.md.
   */
  capiStatus: adminProcedure.query(() => ({
    tokenConfigured: Boolean(process.env.META_CAPI_ACCESS_TOKEN),
    pixelIdOverridden: Boolean(process.env.META_CAPI_PIXEL_ID),
  })),

  /** Get recent notification delivery log */
  notificationLog: adminProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ input }) => {
      return getDeliveryLog(input?.limit ?? 50);
    }),

  /** Unified sync health check — real API probes for every vendor */
  syncHealth: adminProcedure.query(async () => {
    const { getVendorHealthReport } = await import("../../../services/vendorHealth");
    const report = await getVendorHealthReport();

    // Map to legacy shape for backward compat with existing UI
    const checks = report.results.map(r => ({
      name: r.vendor,
      status: r.status === "healthy" ? "connected" as const
        : r.status === "not_configured" ? "disconnected" as const
        : r.status === "down" ? "disconnected" as const
        : "degraded" as const,
      details: r.checks.map(c =>
        c.passed ? `${c.name}: OK${c.latencyMs ? ` (${c.latencyMs}ms)` : ""}`
        : `${c.name}: FAIL${c.error ? ` — ${c.error}` : ""}`
      ).join(" | "),
      lastActivity: r.checkedAt,
    }));

    return {
      overallStatus: report.overallStatus,
      checks,
      checkedAt: report.checkedAt,
    };
  }),

  /** Force re-check all vendor health (clears cache) */
  refreshHealth: adminProcedure.mutation(async () => {
    const { clearHealthCache, getVendorHealthReport } = await import("../../../services/vendorHealth");
    clearHealthCache();
    return getVendorHealthReport();
  }),

  /** Update Google review stats (count/rating) from the admin dashboard */
  updateReviewStats: adminProcedure
    .input(z.object({
      count: z.number().int().min(0).max(100000).optional(),
      rating: z.number().min(1).max(5).optional(),
    }))
    .mutation(async ({ input }) => {
      if (input.count === undefined && input.rating === undefined) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Provide at least count or rating" });
      }
      await saveReviewStatsToDb({ count: input.count, rating: input.rating });
      return { success: true, count: input.count, rating: input.rating };
    }),

  /** Run smoke tests on all integrations */
  smokeTest: adminProcedure.mutation(async () => {
    const { runSmokeTests } = await import("../../../services/integrationLogger");
    return runSmokeTests();
  }),

  /** Get integration event log */
  integrationLog: adminProcedure
    .input(z.object({
      vendor: z.string().max(100).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input }) => {
      const { getRecentEvents, getEventSummary } = await import("../../../services/integrationLogger");
      return {
        events: getRecentEvents({ vendor: input?.vendor, limit: input?.limit }),
        summary: getEventSummary(),
      };
    }),

  /**
   * Drilldown — clicking any KPI on the dashboard opens this.
   * Returns the underlying rows that produced the metric so admins
   * can act on the data, not just stare at it.
   *
   * Each `kind` returns a normalized shape:
   *   { title, subtitle?, rows: Array<{ id, primary, secondary, meta?, value? }> }
   * The drawer renders these uniformly + the rows can deep-link.
   */
};
