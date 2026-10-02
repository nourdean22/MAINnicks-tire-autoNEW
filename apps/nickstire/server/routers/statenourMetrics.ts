import { timingSafeEqual } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getGscReport } from "../pipelines/gsc-data";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export const statenourMetricsRouter = router({
  gscExecutiveSummary: publicProcedure.input(z.object({
    syncKey: z.string().min(1),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).mutation(async ({ input }) => {
    const expected = process.env.STATENOUR_SYNC_KEY;
    if (!expected || !safeCompare(input.syncKey, expected)) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid sync key" });
    }
    if (input.startDate > input.endDate) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "startDate must not be after endDate" });
    }

    const report = await getGscReport({
      startDate: input.startDate,
      endDate: input.endDate,
    });
    // No total row from Google (a window inside GSC's 2-3 day lag) is NOT an official zero.
    // StateNour's queryCanonicalGscSummary already turns a non-OK response into { error },
    // so failing here is the honest, contract-safe answer (2026-10-02).
    if (!report.summaryHasData) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `No official GSC data for ${input.startDate}..${input.endDate} yet (Search Console lags 2-3 days) — not a zero.`,
      });
    }

    return {
      metricDefinitionVersion: "gsc-revenue-ops-v1" as const,
      from: input.startDate,
      to: input.endDate,
      totalClicks: report.summary.clicks,
      totalImpressions: report.summary.impressions,
      avgCtr: report.summary.ctr,
      avgPosition: report.summary.position,
      ctrUnit: "ratio" as const,
      source: "gsc_official_no_dimension" as const,
      fetchedAt: new Date().toISOString(),
      topQueries: report.topQueries,
      topPages: report.topPages,
    };
  }),
});
