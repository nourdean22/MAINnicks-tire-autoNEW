import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, adminProcedure, router } from "./_core/trpc";
import { createBooking, getBookings, updateBookingStatus } from "./db";
import { notifyOwner } from "./_core/notification";
import { getWeather, getWeatherAlert } from "./weather";
import { getGoogleReviews } from "./google-reviews";
import {
  generateArticle,
  generateNotifications,
  saveGeneratedArticle,
  saveGeneratedNotifications,
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
} from "./content-generator";
import { z } from "zod";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  weather: router({
    current: publicProcedure.query(async () => {
      const weather = await getWeather();
      if (!weather) return { alert: null, weather: null };
      const alert = getWeatherAlert(weather);
      return { alert, weather };
    }),
  }),

  reviews: router({
    google: publicProcedure.query(async () => {
      return getGoogleReviews();
    }),
  }),

  booking: router({
    create: publicProcedure
      .input(
        z.object({
          name: z.string().min(1, "Name is required"),
          phone: z.string().min(7, "Phone number is required"),
          email: z.string().email().optional().or(z.literal("")),
          service: z.string().min(1, "Service is required"),
          vehicle: z.string().optional(),
          preferredDate: z.string().optional(),
          preferredTime: z.enum(["morning", "afternoon", "no-preference"]).default("no-preference"),
          message: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const result = await createBooking({
          name: input.name,
          phone: input.phone,
          email: input.email || null,
          service: input.service,
          vehicle: input.vehicle || null,
          preferredDate: input.preferredDate || null,
          preferredTime: input.preferredTime,
          message: input.message || null,
        });

        // Notify shop owner
        await notifyOwner({
          title: `New Booking: ${input.service}`,
          content: `Name: ${input.name}\nPhone: ${input.phone}\nService: ${input.service}\nVehicle: ${input.vehicle || "Not specified"}\nPreferred Date: ${input.preferredDate || "Flexible"}\nPreferred Time: ${input.preferredTime}\nMessage: ${input.message || "None"}`,
        }).catch(() => {});

        return result;
      }),

    list: adminProcedure.query(async () => {
      return getBookings();
    }),

    updateStatus: adminProcedure
      .input(
        z.object({
          id: z.number(),
          status: z.enum(["new", "confirmed", "completed", "cancelled"]),
        })
      )
      .mutation(async ({ input }) => {
        return updateBookingStatus(input.id, input.status);
      }),
  }),

  // ─── DYNAMIC CONTENT (PUBLIC) ────────────────────────

  content: router({
    /** Get published dynamic articles for the blog page */
    publishedArticles: publicProcedure.query(async () => {
      return getPublishedArticles();
    }),

    /** Get a single dynamic article by slug */
    articleBySlug: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        return getDynamicArticleBySlug(input.slug);
      }),

    /** Get active notification messages for the notification bar */
    activeNotifications: publicProcedure.query(async () => {
      return getActiveNotifications();
    }),

    /** Get current season for frontend seasonal logic */
    currentSeason: publicProcedure.query(() => {
      return { season: getCurrentSeason() };
    }),
  }),

  // ─── CONTENT MANAGEMENT (ADMIN) ─────────────────────

  contentAdmin: router({
    /** List all dynamic articles (all statuses) */
    allArticles: adminProcedure.query(async () => {
      return getAllDynamicArticles();
    }),

    /** Update article status (publish, reject, draft) */
    updateArticleStatus: adminProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["draft", "published", "rejected"]),
      }))
      .mutation(async ({ input }) => {
        return updateArticleStatus(input.id, input.status);
      }),

    /** Edit article content */
    updateArticleContent: adminProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().optional(),
        excerpt: z.string().optional(),
        metaDescription: z.string().optional(),
        sectionsJson: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...updates } = input;
        return updateArticleContent(id, updates);
      }),

    /** List all notifications */
    allNotifications: adminProcedure.query(async () => {
      return getAllNotifications();
    }),

    /** Toggle notification active status */
    toggleNotification: adminProcedure
      .input(z.object({
        id: z.number(),
        isActive: z.number().min(0).max(1),
      }))
      .mutation(async ({ input }) => {
        return updateNotificationStatus(input.id, input.isActive);
      }),

    /** Delete a notification */
    deleteNotification: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return deleteNotification(input.id);
      }),

    /** Get generation log */
    generationLog: adminProcedure.query(async () => {
      return getGenerationLog();
    }),

    /** Manually trigger content generation */
    generateContent: adminProcedure
      .input(z.object({
        topic: z.string().optional(),
      }).optional())
      .mutation(async ({ input }) => {
        const result = await runContentGeneration();

        // Notify owner about new content
        if (result.article) {
          await notifyOwner({
            title: "New AI Content Generated",
            content: `Article: ${result.article.title}\nNotifications: ${result.notifications.length} generated\nErrors: ${result.errors.length > 0 ? result.errors.join(", ") : "None"}\n\nReview and publish at /admin/content`,
          }).catch(() => {});
        }

        return result;
      }),

    /** Generate a single article on a specific topic */
    generateArticle: adminProcedure
      .input(z.object({ topic: z.string() }))
      .mutation(async ({ input }) => {
        const article = await generateArticle(input.topic);
        const id = await saveGeneratedArticle(article);
        return { article, id };
      }),
  }),
});

export type AppRouter = typeof appRouter;
