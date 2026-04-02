/**
 * Pipelines router — Admin endpoints for GBP reviews, GSC data, Instagram, and orchestrator.
 */
import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { reviewPipeline } from "../../drizzle/schema";

// ─── Lazy imports to keep cold starts fast ──────────────

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

export const pipelinesRouter = router({
  // ═══════════════════════════════════════════════════════
  // GBP REVIEWS
  // ═══════════════════════════════════════════════════════

  /** Trigger a review fetch + analysis run */
  fetchReviews: adminProcedure.mutation(async () => {
    const { runReviewPipeline } = await import("../pipelines/gbp-reviews");
    return runReviewPipeline();
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
      const { getPipelineReviews } = await import("../pipelines/gbp-reviews");
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

  /** Get urgent reviews (1-2 stars, unreviewed) */
  urgentReviews: adminProcedure.query(async () => {
    const { getUrgentReviews } = await import("../pipelines/gbp-reviews");
    return getUrgentReviews();
  }),

  /** Extract top keywords from all reviews */
  reviewKeywords: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20) }).optional())
    .query(async ({ input }) => {
      const { extractKeywords } = await import("../pipelines/gbp-reviews");
      return extractKeywords({ limit: input?.limit ?? 20 });
    }),

  /** Detect review trends (rating shifts, volume changes) */
  reviewTrends: adminProcedure.mutation(async () => {
    const { detectTrends } = await import("../pipelines/gbp-reviews");
    return detectTrends();
  }),

  /** Get historical trend snapshots */
  reviewTrendHistory: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(52).default(12) }).optional())
    .query(async ({ input }) => {
      const { getTrendHistory } = await import("../pipelines/gbp-reviews");
      return getTrendHistory({ limit: input?.limit ?? 12 });
    }),

  /** Check review volume / pace */
  reviewVolume: adminProcedure.query(async () => {
    const { checkReviewVolume } = await import("../pipelines/gbp-reviews");
    return checkReviewVolume();
  }),

  /** Monitor competitor reviews */
  competitorIntel: adminProcedure.mutation(async () => {
    const { monitorCompetitors } = await import("../pipelines/gbp-reviews");
    return monitorCompetitors();
  }),

  // ═══════════════════════════════════════════════════════
  // GSC DATA
  // ═══════════════════════════════════════════════════════

  /** Sync GSC search performance data for a date range */
  syncGsc: adminProcedure
    .input(
      z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(async ({ input }) => {
      const { syncSearchPerformance } = await import("../pipelines/gsc-data");
      return syncSearchPerformance(input);
    }),

  /** Run full GSC pipeline (sync + insights) */
  runGsc: adminProcedure.mutation(async () => {
    const { runGscPipeline } = await import("../pipelines/gsc-data");
    return runGscPipeline();
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
      const { getTopQueries } = await import("../pipelines/gsc-data");
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
      const { getPagePerformance } = await import("../pipelines/gsc-data");
      return getPagePerformance({
        startDate: input?.startDate,
        limit: input?.limit ?? 20,
      });
    }),

  /** Cluster queries into themes */
  queryClusters: adminProcedure
    .input(z.object({ startDate: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const { clusterQueries } = await import("../pipelines/gsc-data");
      return clusterQueries({ startDate: input?.startDate });
    }),

  /** Detect ranking changes (position jumps/drops) */
  rankingChanges: adminProcedure
    .input(
      z.object({
        minDelta: z.number().optional(),
        limit: z.number().min(1).max(100).default(30),
      }).optional(),
    )
    .query(async ({ input }) => {
      const { detectRankingChanges } = await import("../pipelines/gsc-data");
      return detectRankingChanges({
        minDelta: input?.minDelta,
        limit: input?.limit ?? 30,
      });
    }),

  /** Find CTR optimization opportunities */
  ctrOpportunities: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        minImpressions: z.number().optional(),
        limit: z.number().min(1).max(50).default(15),
      }).optional(),
    )
    .query(async ({ input }) => {
      const { findCtrOpportunities } = await import("../pipelines/gsc-data");
      return findCtrOpportunities({
        startDate: input?.startDate,
        minImpressions: input?.minImpressions,
        limit: input?.limit ?? 15,
      });
    }),

  /** Detect keyword cannibalization */
  cannibalization: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        limit: z.number().min(1).max(50).default(15),
      }).optional(),
    )
    .query(async ({ input }) => {
      const { detectCannibalization } = await import("../pipelines/gsc-data");
      return detectCannibalization({
        startDate: input?.startDate,
        limit: input?.limit ?? 15,
      });
    }),

  /** Seasonal pattern comparison */
  seasonalPatterns: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      const { detectSeasonalPatterns } = await import("../pipelines/gsc-data");
      return detectSeasonalPatterns({ limit: input?.limit ?? 20 });
    }),

  // ═══════════════════════════════════════════════════════
  // INSTAGRAM
  // ═══════════════════════════════════════════════════════

  /** Run Instagram analytics pipeline */
  runInstagram: adminProcedure.mutation(async () => {
    const { runInstagramPipeline } = await import("../pipelines/instagram-data");
    return runInstagramPipeline();
  }),

  /** Get engagement broken down by post type */
  igEngagementByType: adminProcedure.query(async () => {
    const { getEngagementByType } = await import("../pipelines/instagram-data");
    return getEngagementByType();
  }),

  /** Get best posting times */
  igBestTimes: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(20).default(10) }).optional())
    .query(async ({ input }) => {
      const { getBestPostingTimes } = await import("../pipelines/instagram-data");
      return getBestPostingTimes({ limit: input?.limit ?? 10 });
    }),

  /** Get follower growth data */
  igFollowerGrowth: adminProcedure.query(async () => {
    const { getFollowerGrowth } = await import("../pipelines/instagram-data");
    return getFollowerGrowth();
  }),

  /** Get top-performing posts */
  igTopPosts: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }).optional())
    .query(async ({ input }) => {
      const { getTopPosts } = await import("../pipelines/instagram-data");
      return getTopPosts({ limit: input?.limit ?? 10 });
    }),

  /** Full Instagram performance report with AI recommendations */
  igPerformanceReport: adminProcedure.mutation(async () => {
    const { generatePerformanceReport } = await import("../pipelines/instagram-data");
    return generatePerformanceReport();
  }),

  // ═══════════════════════════════════════════════════════
  // ORCHESTRATOR
  // ═══════════════════════════════════════════════════════

  /** Run a specific pipeline by name */
  runPipeline: adminProcedure
    .input(z.object({ name: z.enum(["gbp-reviews", "gsc-data", "instagram"]) }))
    .mutation(async ({ input }) => {
      const { runPipeline } = await import("../pipelines/orchestrator");
      return runPipeline(input.name);
    }),

  /** Run all pipelines */
  runAllPipelines: adminProcedure.mutation(async () => {
    const { runAllPipelines } = await import("../pipelines/orchestrator");
    return runAllPipelines();
  }),

  /** Smart run — only pipelines that are due */
  runDuePipelines: adminProcedure.mutation(async () => {
    const { runDuePipelines } = await import("../pipelines/orchestrator");
    return runDuePipelines();
  }),

  /** Pipeline dashboard — status, health, last results */
  dashboard: adminProcedure.query(async () => {
    const { getDashboard } = await import("../pipelines/orchestrator");
    return getDashboard();
  }),

  /** Pipeline run history */
  pipelineHistory: adminProcedure
    .input(z.object({
      name: z.string(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const { getPipelineHistory } = await import("../pipelines/orchestrator");
      return getPipelineHistory(input.name, { limit: input.limit });
    }),

  /** Recent runs across all pipelines */
  recentRuns: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }).optional())
    .query(async ({ input }) => {
      const { getRecentRuns } = await import("../pipelines/orchestrator");
      return getRecentRuns({ limit: input?.limit ?? 50 });
    }),
});
