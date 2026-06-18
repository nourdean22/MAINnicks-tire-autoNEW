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
          const { sendTelegram } = await import("../services/telegram");
          const mockPostId = `sandbox_carousel_${Date.now()}`;
          const slideCount = input.imageUrls.length;
          const charCount = input.caption.length;
          const hashtags = input.caption.match(/#[a-zA-Z0-9_]+/g) || [];
          const cleanCaption = input.caption.replace(/#[a-zA-Z0-9_]+/g, "").trim();

          const msg = [
            `🎨 <b>[SANDBOX INSTAGRAM CAROUSEL POST]</b>`,
            `────────────────────────────────`,
            `📱 <b>Placement:</b> Instagram Carousel Feed`,
            `🔢 <b>Slide Count:</b> ${slideCount} panels`,
            `📝 <b>Caption Length:</b> ${charCount} chars (${hashtags.length} hashtags)`,
            `🛡️ <b>Status:</b> SIMULATED / SANDBOX MODE`,
            `💡 <i>To publish this live, flip the <code>legacy_autopost_live</code> feature flag ON and configure Meta API credentials.</i>`,
            `────────────────────────────────`,
            `📖 <b>CAPTION BODY:</b>`,
            `"${cleanCaption}"`,
            `\n🏷️ <b>HASHTAGS:</b>`,
            hashtags.join(" ") || "None",
            `────────────────────────────────`,
            `🖼️ <b>SLIDES & ASSETS:</b>`,
            ...input.imageUrls.map((url, i) => `  • Panel ${i + 1}: <a href="${url}">Slide Image Link ${i + 1}</a>`),
            `────────────────────────────────`,
            `✨ <i>This is a mock sandbox transmission. Content has been logged to database with ID: <code>${mockPostId}</code></i>`
          ].join("\n");

          await sendTelegram(msg);
          return { success: true, postId: mockPostId, isSandbox: true };
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
          const { sendTelegram } = await import("../services/telegram");
          const mockPostId = `sandbox_reel_${Date.now()}`;
          const charCount = input.caption.length;
          const hashtags = input.caption.match(/#[a-zA-Z0-9_]+/g) || [];
          const cleanCaption = input.caption.replace(/#[a-zA-Z0-9_]+/g, "").trim();

          const msg = [
            `🎬 <b>[SANDBOX INSTAGRAM REEL POST]</b>`,
            `────────────────────────────────`,
            `📱 <b>Placement:</b> Instagram Reels Feed`,
            `📝 <b>Caption Length:</b> ${charCount} chars (${hashtags.length} hashtags)`,
            `🛡️ <b>Status:</b> SIMULATED / SANDBOX MODE`,
            `💡 <i>To publish this live, flip the <code>legacy_autopost_live</code> feature flag ON and configure Meta API credentials.</i>`,
            `────────────────────────────────`,
            `📖 <b>CAPTION BODY:</b>`,
            `"${cleanCaption}"`,
            `\n🏷️ <b>HASHTAGS:</b>`,
            hashtags.join(" ") || "None",
            `────────────────────────────────`,
            `📹 <b>VIDEO ASSET:</b>`,
            `  • Source URL: <a href="${input.videoUrl}">Watch Reel Video</a>`,
            `────────────────────────────────`,
            `✨ <i>This is a mock sandbox transmission. Content has been logged to database with ID: <code>${mockPostId}</code></i>`
          ].join("\n");

          await sendTelegram(msg);
          return { success: true, postId: mockPostId, isSandbox: true };
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
  generateCarouselImages: adminProcedure
    .input(z.object({
      briefId: z.string(),
      prompts: z.array(z.string()),
    }))
    .mutation(async ({ input }) => {
      let hgUrls: string[] = [];
      let isFallback = false;
      let fallbackWarning = "";

      try {
        const { generateCarouselSlideImage } = await import("../services/higgsfieldStudio");
        log.info(`Generating ${input.prompts.length} Carousel images via Higgsfield in parallel...`);
        hgUrls = await Promise.all(
          input.prompts.map((prompt) => generateCarouselSlideImage(prompt))
        );
      } catch (err) {
        log.warn("Higgsfield Carousel image generation failed, trying Gemini/OpenRouter fallback...", {
          err: err instanceof Error ? err.message : String(err)
        });
        isFallback = true;
        fallbackWarning = `Higgsfield CLI error: ${err instanceof Error ? err.message : String(err)}. Fell back to Gemini/OpenRouter.`;
      }

      try {
        const { storagePut } = await import("../storage");
        let imageUrls: string[];

        if (isFallback) {
          const { generateImage } = await import("../_core/imageGeneration");
          const pngUrls = await Promise.all(
            input.prompts.map(async (prompt) => {
              const res = await generateImage({ prompt });
              if (!res.url) throw new Error("Fallback image generation returned no URL");
              return res.url;
            })
          );

          log.info("Persisting fallback Gemini/OpenRouter images to S3/storage...");
          imageUrls = await Promise.all(
            pngUrls.map(async (url, i) => {
              const res = await fetch(url);
              if (!res.ok) throw new Error(`Failed to download slide ${i + 1} from fallback provider`);
              const buffer = Buffer.from(await res.arrayBuffer());
              
              const sharp = (await import("sharp")).default;
              const jpegBuf = await sharp(buffer)
                .flatten({ background: { r: 255, g: 255, b: 255 } })
                .jpeg({ quality: 90 })
                .toBuffer();

              const key = `carousel-studio/${Date.now()}-${i}.jpg`;
              const upload = await storagePut(key, jpegBuf, "image/jpeg");
              return upload.url;
            })
          );
        } else {
          log.info("Downloading and persisting generated Carousel images to S3/storage...");
          imageUrls = await Promise.all(
            hgUrls.map(async (url, i) => {
              const res = await fetch(url);
              if (!res.ok) throw new Error(`Failed to download slide ${i + 1} from Higgsfield`);
              const buffer = Buffer.from(await res.arrayBuffer());
              const key = `carousel-studio/${Date.now()}-${i}.jpg`;
              const upload = await storagePut(key, buffer, "image/jpeg");
              return upload.url;
            })
          );
        }

        return { success: true, imageUrls, warning: fallbackWarning || undefined };
      } catch (err) {
        log.error("Carousel image generation failed completely", { err: err instanceof Error ? err.message : String(err) });
        return {
          success: false,
          error: err instanceof Error ? err.message : "Carousel image generation failed",
          imageUrls: []
        };
      }
    }),
  /** One-click: generate a ready-to-review CarouselBrief via the Studio's own
   *  master prompt + the funded Gemini. Generation only — no posting. The
   *  existing generateCarouselImages/save/publish procs handle the rest. */
  generateCarouselBrief: adminProcedure
    .input(z.object({
      topic: z.string().max(300).optional(),
      campaignKeyword: z.string().max(40).optional(),
      territory: z.string().max(60).optional(),
      seasonLocalAngle: z.string().max(300).optional(),
      avoidTopics: z.array(z.string().max(200)).max(50).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { generateCarouselBriefAI } = await import("../services/carouselBriefGen");
        const { brief } = await generateCarouselBriefAI(input);
        return { success: true as const, brief };
      } catch (err) {
        log.error("generateCarouselBrief failed", { err: err instanceof Error ? err.message : String(err) });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Carousel brief generation failed",
        });
      }
    }),
  generateReelVideo: adminProcedure
    .input(z.object({
      briefId: z.string(),
      prompts: z.array(z.string()),
    }))
    .mutation(async ({ input }) => {
      try {
        const { generateReelClipVideo, stitchVideos } = await import("../services/higgsfieldStudio");
        const { storagePut } = await import("../storage");

        log.info(`Generating ${input.prompts.length} Reel clips in parallel...`);
        const hgUrls = await Promise.all(
          input.prompts.map((prompt) => generateReelClipVideo(prompt))
        );

        log.info("Stitching clips into single MP4...");
        const stitchedBuffer = await stitchVideos(hgUrls);

        log.info("Uploading final stitched MP4 to storage...");
        const key = `reels-studio/${Date.now()}-stitched.mp4`;
        const upload = await storagePut(key, stitchedBuffer, "video/mp4");

        return { success: true, videoUrl: upload.url };
      } catch (err) {
        log.error("Reel video generation failed", { err: err instanceof Error ? err.message : String(err) });
        return {
          success: false,
          error: err instanceof Error ? err.message : "Reel video generation failed",
          videoUrl: null
        };
      }
    }),
  /** One-click: generate a ready-to-review ReelBrief via the Studio's master
   *  prompt + the funded Gemini. Generation only — no video render, no posting. */
  generateReelBrief: adminProcedure
    .input(z.object({
      topic: z.string().max(300).optional(),
      campaignKeyword: z.string().max(40).optional(),
      factBucket: z.string().max(40).optional(),
      archetype: z.string().max(40).optional(),
      avoidTopics: z.array(z.string().max(200)).max(50).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const { generateReelBriefAI } = await import("../services/reelBriefGen");
        const { brief } = await generateReelBriefAI(input);
        return { success: true as const, brief };
      } catch (err) {
        log.error("generateReelBrief failed", { err: err instanceof Error ? err.message : String(err) });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Reel brief generation failed",
        });
      }
    }),
  getProprietaryEvidence: adminProcedure
    .input(z.object({ topicKeyword: z.string().optional() }).optional())
    .query(async ({ input }) => {
      try {
        const { getProprietaryEvidence } = await import("../services/evidenceEngine");
        return await getProprietaryEvidence(input?.topicKeyword);
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Failed to fetch proprietary evidence",
        });
      }
    }),
  runPromptEvals: adminProcedure.query(async () => {
    try {
      const { runPromptEvals } = await import("../../scripts/run-prompt-evals");
      return await runPromptEvals();
    } catch (err) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: err instanceof Error ? err.message : "Failed to run prompt evals",
      });
    }
  }),
});

