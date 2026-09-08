/**
 * server/routers/admin/market.ts · 2026-09-08
 *
 * The "Market" surface (Search Console summary, top queries, top pages, and
 * the synthesized master report) used to render inside StateNour at /market,
 * reading these same numbers over the nour-os bridge. The operator moved it
 * here — it is shop analytics, and it belongs beside the shop's other
 * admin sections. Every procedure delegates to the pipeline functions the
 * bridge already calls, so the two readers cannot drift.
 */
import { z } from "zod";
import { adminProcedure, router } from "../../_core/trpc";

const RANGE = z
  .object({
    /** ISO date (YYYY-MM-DD). Default: the pipeline's own window. */
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .optional();

function defaultStart(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Shape of the bridge's `master_report` handler result (nour-os-query.ts). */
export type MasterReportResult =
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
    const { getGscSummary } = await import("../../pipelines/gsc-data");
    return getGscSummary({ startDate: input?.startDate ?? defaultStart(28) });
  }),

  topQueries: adminProcedure.input(RANGE).query(async ({ input }) => {
    const { getTopQueries } = await import("../../pipelines/gsc-data");
    return getTopQueries({ startDate: input?.startDate, limit: input?.limit ?? 10 });
  }),

  topPages: adminProcedure.input(RANGE).query(async ({ input }) => {
    const { getPagePerformance } = await import("../../pipelines/gsc-data");
    return getPagePerformance({ startDate: input?.startDate, limit: input?.limit ?? 10 });
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
