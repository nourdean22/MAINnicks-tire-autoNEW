/**
 * server/routers/admin/market.ts · 2026-09-08
 *
 * The "Market" surface (Search Console summary, top queries, top pages, and
 * the synthesized master report) used to render inside StateNour at /market,
 * reading these same numbers over the nour-os bridge. The operator moved it
 * here — it is shop analytics, and it belongs beside the shop's other
 * admin sections. Every procedure delegates to the pipeline functions the
 * bridge already calls, so the two readers cannot drift.
 *
 * Honesty rules (PROTECTED-CORE):
 *   · the GSC helpers resolve to zeros / empty arrays when the DB is down —
 *     here that is SERVICE_UNAVAILABLE, so the UI shows "unknown", not 0;
 *   · the window is built in shop time (America/New_York) and is an
 *     INCLUSIVE 28-date window (27-day subtraction), never a UTC-midnight
 *     guess that flips a day early in the evening;
 *   · RBAC: `market.*` maps to `marketing.manage` (owner + manager) in
 *     shared/adminPermissions.ts — the registry gate alone would leave the
 *     procedures on the permissive admin.view default.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../../_core/trpc";
import { db } from "../../lib/db-helper";
import { getBusinessDateKey } from "../../lib/timezoneAssert";

const RANGE = z
  .object({
    /** ISO date (YYYY-MM-DD, shop time). Default: the inclusive last-28-dates window. */
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .optional();

/** Inclusive 28-date window ending today, in shop time. */
export function marketWindow(now: Date = new Date()): { startDate: string; endDate: string } {
  return {
    startDate: getBusinessDateKey(new Date(now.getTime() - 27 * 86_400_000)),
    endDate: getBusinessDateKey(now),
  };
}

async function requireStore(): Promise<void> {
  const d = await db();
  if (!d) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Search Console store unavailable — the figures are unknown, not zero.",
    });
  }
}

/** Shape of the bridge's `master_report` handler result (nour-os-query.ts). */
type MasterReportResult =
  | {
      ok: true;
      timestamp: string;
      summary: unknown;
      marginNote: string | null;
      revenue: unknown;
      customers: unknown;
      operations: unknown;
      marketing: unknown;
      growth: unknown;
      competitive: unknown;
    }
  | { ok: false; error: string };

export const marketAdminRouter = router({
  /** Clicks / impressions / CTR / position for the window. */
  summary: adminProcedure.input(RANGE).query(async ({ input }) => {
    await requireStore();
    const { getGscSummary } = await import("../../pipelines/gsc-data");
    const w = marketWindow();
    return getGscSummary({ startDate: input?.startDate ?? w.startDate, endDate: w.endDate });
  }),

  topQueries: adminProcedure.input(RANGE).query(async ({ input }) => {
    await requireStore();
    const { getTopQueries } = await import("../../pipelines/gsc-data");
    return getTopQueries({ startDate: input?.startDate ?? marketWindow().startDate, limit: input?.limit ?? 10 });
  }),

  topPages: adminProcedure.input(RANGE).query(async ({ input }) => {
    await requireStore();
    const { getPagePerformance } = await import("../../pipelines/gsc-data");
    return getPagePerformance({ startDate: input?.startDate ?? marketWindow().startDate, limit: input?.limit ?? 10 });
  }),

  /**
   * The synthesized master intelligence report — the same handler the
   * bridge serves as `master_report`, so StateNour's Nick and this page
   * read one report.
   */
  report: adminProcedure.query(async (): Promise<MasterReportResult> => {
    const { QUERY_HANDLERS } = await import("../../routes/nour-os-query");
    return (await QUERY_HANDLERS.master_report({})) as MasterReportResult;
  }),
});
