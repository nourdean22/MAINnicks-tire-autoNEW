/**
 * Content router — public content access and admin content management.
 */
import { TRPCError } from "@trpc/server";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { sendNotification } from "../email-notify";
import {
  generateArticle,
  saveGeneratedArticle,
  getPublishedArticles,
  getAllDynamicArticles,
  getDynamicArticleBySlug,
  updateArticleStatus,
  updateArticleContent,
  getActiveNotifications,
  getAllNotifications,
  updateNotificationStatus,
  deleteNotification,
  getGenerationLog,
  runContentGeneration,
  getCurrentSeason,
} from "../content-generator";
import { z } from "zod";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:content");
export const contentRouter = router({
  publishedArticles: publicProcedure.query(async () => {
    return getPublishedArticles();
  }),
  articleBySlug: publicProcedure
    .input(z.object({ slug: z.string().max(200) }))
    .query(async ({ input }) => {
      return getDynamicArticleBySlug(input.slug);
    }),
  activeNotifications: publicProcedure.query(async () => {
    return getActiveNotifications();
  }),
  currentSeason: publicProcedure.query(() => {
    return { season: getCurrentSeason() };
  }),
});

export const contentAdminRouter = router({
  allArticles: adminProcedure.query(async () => {
    return getAllDynamicArticles();
  }),
  updateArticleStatus: adminProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["draft", "published", "rejected"]),
    }))
    .mutation(async ({ input }) => {
      try {
        return updateArticleStatus(input.id, input.status);
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),
  updateArticleContent: adminProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().max(500).optional(),
      excerpt: z.string().max(2000).optional(),
      metaDescription: z.string().max(500).optional(),
      sectionsJson: z.string().max(100000).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { id, ...updates } = input;
        return updateArticleContent(id, updates);
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),
  allNotifications: adminProcedure.query(async () => {
    return getAllNotifications();
  }),
  toggleNotification: adminProcedure
    .input(z.object({
      id: z.number(),
      isActive: z.number().min(0).max(1),
    }))
    .mutation(async ({ input }) => {
      try {
        return updateNotificationStatus(input.id, input.isActive);
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),
  deleteNotification: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        return deleteNotification(input.id);
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),
  generationLog: adminProcedure.query(async () => {
    return getGenerationLog();
  }),
  generateContent: adminProcedure
    .input(z.object({ topic: z.string().max(500).optional() }).optional())
    .mutation(async ({ input: _input }) => {
      try {
        const result = await runContentGeneration();
        if (result.article) {
          sendNotification({
            category: "content",
            subject: "New AI Content Generated",
            body: `Article: ${result.article.title}\nNotifications: ${result.notifications.length} generated\nErrors: ${result.errors.length > 0 ? result.errors.join(", ") : "None"}\n\nReview and publish at /admin?tab=content`,
          }).catch((e) => { log.warn("[routers/content] fire-and-forget failed:", e); });
        }
        return result;
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),
  generateArticle: adminProcedure
    .input(z.object({ topic: z.string().max(500) }))
    .mutation(async ({ input }) => {
      try {
        const article = await generateArticle(input.topic);
        const id = await saveGeneratedArticle(article);
        return { article, id };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),
  // GBP one-off post generator — admin clicks "Generate GBP Post" button.
  // Returns the post text + CTA + image hint (no auto-send). Nour pastes
  // into business.google.com manually because GBP Posts API is deprecated.
  generateGBPPost: adminProcedure
    .input(z.object({
      forceArchetype: z.enum(["proof", "anti", "math", "seasonal"]).optional(),
      dryRun: z.boolean().optional(),
      requiresReview: z.boolean().optional(),
    }).optional())
    .mutation(async ({ input }) => {
      try {
        const { generateOneOffGBPPost } = await import("../services/gbpAutoPost");
        return await generateOneOffGBPPost(input?.forceArchetype, {
          dryRun: input?.dryRun,
          requiresReview: input?.requiresReview,
        });
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "GBP post generation failed" });
      }
    }),
  // GBP post history — last 14 posts (variety guard window). Lets Nour
  // see what's been queued and confirm playbook ratio is being respected.
  gbpPostHistory: adminProcedure.query(async () => {
    try {
      const { db: dbHelper } = await import("../lib/db-helper");
      const { gbpPostLog } = await import("../../drizzle/schema");
      const { desc } = await import("drizzle-orm");
      const d = await dbHelper();
      if (!d) return [];
      const rows = await d
        .select({
          id: gbpPostLog.id,
          archetype: gbpPostLog.archetype,
          postBody: gbpPostLog.postBody,
          ctaType: gbpPostLog.ctaType,
          source: gbpPostLog.source,
          postedAt: gbpPostLog.postedAt,
        })
        .from(gbpPostLog)
        .orderBy(desc(gbpPostLog.postedAt))
        .limit(14);
      return rows;
    } catch (err) {
      log.warn("[content] gbpPostHistory failed", { err: err instanceof Error ? err.message : err });
      return [];
    }
  }),
  saveReelDraft: adminProcedure
    .input(z.object({
      id: z.string(),
      topic: z.string(),
      brief: z.any(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { syncReelDraftToSheet } = await import("../sheets-sync");
        const ok = await syncReelDraftToSheet(input.id, input.topic, JSON.stringify(input.brief));
        return { success: ok };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Save Reel draft failed" });
      }
    }),
  saveCarouselDraft: adminProcedure
    .input(z.object({
      id: z.string(),
      topic: z.string(),
      brief: z.any(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { syncCarouselDraftToSheet } = await import("../sheets-sync");
        const ok = await syncCarouselDraftToSheet(input.id, input.topic, JSON.stringify(input.brief));
        return { success: ok };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Save Carousel draft failed" });
      }
    }),
  allReelDrafts: adminProcedure.query(async () => {
    try {
      const { fetchReelDraftsFromSheet } = await import("../sheets-sync");
      return await fetchReelDraftsFromSheet();
    } catch (err) {
      log.warn("allReelDrafts failed", err);
      return [];
    }
  }),
  allCarouselDrafts: adminProcedure.query(async () => {
    try {
      const { fetchCarouselDraftsFromSheet } = await import("../sheets-sync");
      return await fetchCarouselDraftsFromSheet();
    } catch (err) {
      log.warn("allCarouselDrafts failed", err);
      return [];
    }
  }),
  logReel: adminProcedure
    .input(z.object({
      topic: z.string(),
      verifiedFact: z.string(),
      sources: z.string(),
      driverConfusion: z.string(),
      clevelandAngle: z.string(),
      campaignKeyword: z.string(),
      creativeTerritory: z.string(),
      usefulAbsurdity: z.string(),
      storyboardOutline: z.string(),
      captionHook: z.string(),
      instagramUrl: z.string(),
      assetPaths: z.string(),
      score: z.string(),
      hashtags: z.string(),
      avoidedRepeats: z.string(),
      issues: z.string(),
      insightsChecked: z.string(),
      facebookCrossPostOff: z.string(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { syncReelLogToSheet } = await import("../sheets-sync");
        const ok = await syncReelLogToSheet(input);
        return { success: ok };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Log Reel failed" });
      }
    }),
  logCarousel: adminProcedure
    .input(z.object({
      topic: z.string(),
      verifiedFact: z.string(),
      sources: z.string(),
      driverConfusion: z.string(),
      clevelandAngle: z.string(),
      campaignKeyword: z.string(),
      creativeTerritory: z.string(),
      usefulAbsurdity: z.string(),
      storyboardOutline: z.string(),
      captionHook: z.string(),
      instagramUrl: z.string(),
      assetPaths: z.string(),
      score: z.string(),
      hashtags: z.string(),
      avoidedRepeats: z.string(),
      issues: z.string(),
      insightsChecked: z.string(),
      facebookCrossPostOff: z.string(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { syncCarouselLogToSheet } = await import("../sheets-sync");
        const ok = await syncCarouselLogToSheet(input);
        return { success: ok };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Log Carousel failed" });
      }
    }),
  allReelLogs: adminProcedure.query(async () => {
    try {
      const { fetchReelLogsFromSheet } = await import("../sheets-sync");
      return await fetchReelLogsFromSheet();
    } catch (err) {
      log.warn("allReelLogs failed", err);
      return [];
    }
  }),
  allCarouselLogs: adminProcedure.query(async () => {
    try {
      const { fetchCarouselLogsFromSheet } = await import("../sheets-sync");
      return await fetchCarouselLogsFromSheet();
    } catch (err) {
      log.warn("allCarouselLogs failed", err);
      return [];
    }
  }),
  publishCarousel: adminProcedure
    .input(z.object({
      imageUrls: z.array(z.string()),
      caption: z.string(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { getMetaSocialStatus, postInstagramCarousel } = await import("../services/metaSocial");
        const status = await getMetaSocialStatus();
        if (!status.configured || !status.instagramReady) {
          return { success: false, error: "Meta API credentials are not configured in your .env file.", isSandbox: true };
        }
        const res = await postInstagramCarousel({
          imageUrls: input.imageUrls,
          caption: input.caption,
        });
        return { success: res.success, postId: res.postId, error: res.error, isSandbox: false };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Carousel publishing failed" });
      }
    }),
  publishReel: adminProcedure
    .input(z.object({
      videoUrl: z.string(),
      caption: z.string(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { getMetaSocialStatus, postInstagramReel } = await import("../services/metaSocial");
        const status = await getMetaSocialStatus();
        if (!status.configured || !status.instagramReady) {
          return { success: false, error: "Meta API credentials are not configured in your .env file.", isSandbox: true };
        }
        const res = await postInstagramReel({
          videoUrl: input.videoUrl,
          caption: input.caption,
        });
        return { success: res.success, postId: res.postId, error: res.error, isSandbox: false };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Reel publishing failed" });
      }
    }),
});

