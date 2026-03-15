import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, adminProcedure, router } from "./_core/trpc";
import { createBooking, getBookings, updateBookingStatus } from "./db";
import { notifyOwner } from "./_core/notification";
import { getWeather, getWeatherAlert } from "./weather";
import { getGoogleReviews } from "./google-reviews";
import { scoreLead, chatWithAssistant } from "./gemini";
import { syncLeadToSheet, syncBookingToSheet, getSpreadsheetUrl, isSheetConfigured } from "./sheets-sync";
import { getInstagramPosts, getInstagramAccount } from "./instagram";
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
import { eq, desc } from "drizzle-orm";
import { leads, chatSessions } from "../drizzle/schema";

// Lazy db import
async function db() {
  const { getDb } = await import("./db");
  return getDb();
}

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

  // ─── INSTAGRAM ────────────────────────────────────────
  instagram: router({
    posts: publicProcedure
      .input(z.object({ limit: z.number().min(1).max(20).default(6) }).optional())
      .query(async ({ input }) => {
        return getInstagramPosts(input?.limit ?? 6);
      }),

    account: publicProcedure.query(async () => {
      return getInstagramAccount();
    }),
  }),

  // ─── BOOKING ──────────────────────────────────────────
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

        // Sync to Google Sheets
        syncBookingToSheet({
          name: input.name,
          phone: input.phone,
          email: input.email,
          service: input.service,
          vehicle: input.vehicle,
          preferredDate: input.preferredDate,
          preferredTime: input.preferredTime,
          message: input.message,
        }).catch(err => console.error("[Sheets] Booking sync failed:", err));

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

  // ─── LEAD CAPTURE ─────────────────────────────────────
  lead: router({
    /** Submit a new lead from the popup or chat */
    submit: publicProcedure
      .input(
        z.object({
          name: z.string().min(1),
          phone: z.string().min(7),
          email: z.string().email().optional().or(z.literal("")),
          vehicle: z.string().optional(),
          problem: z.string().optional(),
          source: z.enum(["popup", "chat", "booking", "manual"]).default("popup"),
        })
      )
      .mutation(async ({ input }) => {
        const d = await db();
        if (!d) throw new Error("Database not available");

        // Score the lead with Gemini AI
        let scoring = { score: 3, reason: "Manual review recommended", recommendedService: "General Repair" };
        if (input.problem) {
          scoring = await scoreLead(input.problem, input.vehicle);
        }

        // Insert into database
        await d.insert(leads).values({
          name: input.name,
          phone: input.phone,
          email: input.email || null,
          vehicle: input.vehicle || null,
          problem: input.problem || null,
          source: input.source,
          urgencyScore: scoring.score,
          urgencyReason: scoring.reason,
          recommendedService: scoring.recommendedService,
        });

        // Sync to Google Sheets (fire and forget)
        syncLeadToSheet({
          name: input.name,
          phone: input.phone,
          email: input.email,
          vehicle: input.vehicle,
          problem: input.problem,
          source: input.source,
          urgencyScore: scoring.score,
          urgencyReason: scoring.reason,
          recommendedService: scoring.recommendedService,
        }).catch(err => console.error("[Sheets] Lead sync failed:", err));

        // Notify owner for high-urgency leads
        if (scoring.score >= 4) {
          notifyOwner({
            title: `URGENT Lead (${scoring.score}/5): ${input.name}`,
            content: `Phone: ${input.phone}\nVehicle: ${input.vehicle || "Not specified"}\nProblem: ${input.problem || "Not specified"}\nUrgency: ${scoring.reason}\nRecommended: ${scoring.recommendedService}`,
          }).catch(() => {});
        }

        return {
          success: true,
          urgencyScore: scoring.score,
          recommendedService: scoring.recommendedService,
        };
      }),

    /** Admin: list all leads */
    list: adminProcedure.query(async () => {
      const d = await db();
      if (!d) return [];
      return d.select().from(leads).orderBy(desc(leads.createdAt));
    }),

    /** Admin: update lead status and contact info */
    update: adminProcedure
      .input(
        z.object({
          id: z.number(),
          status: z.enum(["new", "contacted", "booked", "closed", "lost"]).optional(),
          contacted: z.number().min(0).max(1).optional(),
          contactedBy: z.string().optional(),
          contactNotes: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const d = await db();
        if (!d) throw new Error("Database not available");
        const { id, ...updates } = input;
        const setObj: Record<string, unknown> = {};
        if (updates.status !== undefined) setObj.status = updates.status;
        if (updates.contacted !== undefined) {
          setObj.contacted = updates.contacted;
          if (updates.contacted === 1) setObj.contactedAt = new Date();
        }
        if (updates.contactedBy !== undefined) setObj.contactedBy = updates.contactedBy;
        if (updates.contactNotes !== undefined) setObj.contactNotes = updates.contactNotes;
        await d.update(leads).set(setObj).where(eq(leads.id, id));
        return { success: true };
      }),

    /** Admin: get CRM sheet URL */
    sheetUrl: adminProcedure.query(() => {
      return { url: getSpreadsheetUrl(), configured: isSheetConfigured() };
    }),
  }),

  // ─── AI CHAT ASSISTANT ────────────────────────────────
  chat: router({
    /** Start or continue a chat session */
    message: publicProcedure
      .input(
        z.object({
          sessionId: z.number().optional(),
          message: z.string().min(1),
        })
      )
      .mutation(async ({ input }) => {
        const d = await db();

        // Load or create session
        let sessionMessages: Array<{ role: string; content: string }> = [];
        let sessionId = input.sessionId;

        if (sessionId && d) {
          const existing = await d.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).limit(1);
          if (existing.length > 0) {
            try {
              sessionMessages = JSON.parse(existing[0].messagesJson);
            } catch {}
          }
        }

        // Add user message
        sessionMessages.push({ role: "user", content: input.message });

        // Get AI response
        const { reply, extractedInfo } = await chatWithAssistant(sessionMessages);

        // Add assistant reply
        sessionMessages.push({ role: "assistant", content: reply });

        // Save session
        if (d) {
          if (sessionId) {
            await d.update(chatSessions).set({
              messagesJson: JSON.stringify(sessionMessages),
              vehicleInfo: extractedInfo?.vehicle || undefined,
              problemSummary: extractedInfo?.problem || undefined,
            }).where(eq(chatSessions.id, sessionId));
          } else {
            const result = await d.insert(chatSessions).values({
              messagesJson: JSON.stringify(sessionMessages),
              vehicleInfo: extractedInfo?.vehicle || null,
              problemSummary: extractedInfo?.problem || null,
            });
            sessionId = Number(result[0].insertId);
          }
        }

        return {
          sessionId,
          reply,
          extractedInfo,
        };
      }),
  }),

  // ─── DYNAMIC CONTENT (PUBLIC) ────────────────────────
  content: router({
    publishedArticles: publicProcedure.query(async () => {
      return getPublishedArticles();
    }),
    articleBySlug: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        return getDynamicArticleBySlug(input.slug);
      }),
    activeNotifications: publicProcedure.query(async () => {
      return getActiveNotifications();
    }),
    currentSeason: publicProcedure.query(() => {
      return { season: getCurrentSeason() };
    }),
  }),

  // ─── CONTENT MANAGEMENT (ADMIN) ─────────────────────
  contentAdmin: router({
    allArticles: adminProcedure.query(async () => {
      return getAllDynamicArticles();
    }),
    updateArticleStatus: adminProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["draft", "published", "rejected"]),
      }))
      .mutation(async ({ input }) => {
        return updateArticleStatus(input.id, input.status);
      }),
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
    allNotifications: adminProcedure.query(async () => {
      return getAllNotifications();
    }),
    toggleNotification: adminProcedure
      .input(z.object({
        id: z.number(),
        isActive: z.number().min(0).max(1),
      }))
      .mutation(async ({ input }) => {
        return updateNotificationStatus(input.id, input.isActive);
      }),
    deleteNotification: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return deleteNotification(input.id);
      }),
    generationLog: adminProcedure.query(async () => {
      return getGenerationLog();
    }),
    generateContent: adminProcedure
      .input(z.object({ topic: z.string().optional() }).optional())
      .mutation(async ({ input }) => {
        const result = await runContentGeneration();
        if (result.article) {
          await notifyOwner({
            title: "New AI Content Generated",
            content: `Article: ${result.article.title}\nNotifications: ${result.notifications.length} generated\nErrors: ${result.errors.length > 0 ? result.errors.join(", ") : "None"}\n\nReview and publish at /admin/content`,
          }).catch(() => {});
        }
        return result;
      }),
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
