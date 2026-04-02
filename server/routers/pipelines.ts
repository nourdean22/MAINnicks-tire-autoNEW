/**
 * Pipelines router — Admin triggers for GBP reviews and GSC data pipelines.
 */
import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { reviewPipeline, searchPerformance } from "../../drizzle/schema";
import { runReviewPipeline, getPipelineReviews } from "../pipelines/gbp-reviews";
import { syncSearchPerformance, getTopQueries, getPagePerformance } from "../pipelines/gsc-data";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

export const pipelinesRouter = router({
  // ─── GBP REVIEWS ─────────────────────────────────────

  /** Trigger a review fetch + analysis run */
  fetchReviews: adminProcedure.mutation(async () => {
    const result = await runReviewPipeline();
    return result;
  }),

  /** List pipeline review entries for admin dashboard */
  listReviews: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        onlyUnreviewed: z.boolean().default(false),
      }).optional(),
    )
    .query(async ({ input }) => {
      return getPipelineReviews({
        limit: input?.limit ?? 50,
        onlyUnreviewed: input?.onlyUnreviewed ?? false,
      });
    }),

  /** Mark a review as reviewed (with optional admin notes) */
  markReviewed: adminProcedure
    .input(
      z.object({
        id: z.number(),
        adminNotes: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");

      await d
        .update(reviewPipeline)
        .set({
          reviewed: 1,
          adminNotes: input.adminNotes ?? null,
        })
        .where(eq(reviewPipeline.id, input.id));

      return { success: true };
    }),

  // ─── GSC DATA ────────────────────────────────────────

  /** Sync GSC search performance data for a date range */
  syncGsc: adminProcedure
    .input(
      z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await syncSearchPerformance(input);
      return result;
    }),

  /** Get top search queries */
  topQueries: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
      }).optional(),
    )
    .query(async ({ input }) => {
      return getTopQueries({
        startDate: input?.startDate,
        limit: input?.limit ?? 20,
      });
    }),

  /** Get page-level search performance */
  pagePerformance: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
      }).optional(),
    )
    .query(async ({ input }) => {
      return getPagePerformance({
        startDate: input?.startDate,
        limit: input?.limit ?? 20,
      });
    }),
});
