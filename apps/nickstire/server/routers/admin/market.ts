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
import { adminProcedure, router, dbAdminProcedure } from "../../_core/trpc";
import { db } from "../../lib/db-helper";
import { marketWindow } from "../../lib/marketWindow";

const RANGE = z
  .object({
    /** ISO date (YYYY-MM-DD, shop time). Default: the inclusive last-28-dates window. */
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .optional();

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
  /**
   * Clicks / impressions / CTR / position for the window.
   *
   * PREFERS Google's official NO-DIMENSION aggregate. The stored
   * search_performance rows are written only from a query-dimensioned request,
   * and Google omits anonymized-query rows from any query-grouped response —
   * so summing them is a strict SUBSET of the property total, and the CTR error
   * is not even sign-stable (it flips with whether the hidden tail converts
   * better or worse than the visible head). A worked case: property truth
   * 100 clicks / 4,000 impressions / 2.50% CTR renders as 62 / 2,300 / 2.70%.
   * Clicks -38%, impressions -43%, CTR wrong in the OPPOSITE direction.
   *
   * The dimensioned sum stays as a fallback because a summary is better than a
   * blank card — but it is LABELLED, never silently substituted. `source`
   * tells the UI which it got, so "partial" can never read as "the total".
   */
  summary: adminProcedure.input(RANGE).query(async ({ input }) => {
    await requireStore();
    const { getGscSummary, getGscReport } = await import("../../pipelines/gsc-data");
    const w = marketWindow();
    const startDate = input?.startDate ?? w.startDate;

    try {
      const official = await getGscReport({ startDate, endDate: w.endDate }, { totalsOnly: true });
      // No total row (inside GSC's data lag) is NOT an official zero -> fall back, labelled.
      if (official?.summaryHasData) {
        return {
          from: startDate,
          to: w.endDate,
          totalClicks: official.summary.clicks,
          totalImpressions: official.summary.impressions,
          // UNIT CONVERSION, load-bearing. Google returns ctr as a RATIO
          // (0.025); getGscSummary and the card both speak PERCENT (2.5).
          // Passing the ratio straight through renders 0.0% on a healthy site.
          avgCtr: Number((official.summary.ctr * 100).toFixed(2)),
          avgPosition: Number(official.summary.position.toFixed(2)),
          source: "gsc_official_no_dimension" as const,
        };
      }
    } catch {
      // Fall through to the stored rows. Deliberately swallowed: the fallback
      // is itself the error path, and it reports its own provenance.
    }

    const stored = await getGscSummary({ startDate, endDate: w.endDate });
    return {
      ...stored,
      // Anonymized queries are missing from this number by construction.
      source: "stored_query_rows_partial" as const,
    };
  }),

  topQueries: adminProcedure.input(RANGE).query(async ({ input }) => {
    await requireStore();
    const { getTopQueries } = await import("../../pipelines/gsc-data");
    return getTopQueries({ startDate: input?.startDate ?? marketWindow().startDate, limit: input?.limit ?? 10 });
  }),

  topPages: dbAdminProcedure.input(RANGE).query(async ({ input }) => {
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
