import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import {
  createBooking, getBookings, updateBookingStatus, updateBookingNotes, updateBookingPriority,
  createCoupon, getActiveCoupons, getAllCoupons, updateCoupon, deleteCoupon,
  getCustomerVehicles, addCustomerVehicle, updateCustomerVehicle, deleteCustomerVehicle,
  getServiceHistoryForUser, addServiceRecord,
  createReferral, getReferrals, updateReferralStatus,
  createQuestion, getPublishedQuestions, getAllQuestions, answerQuestion,
  saveAnalyticsSnapshot, getAnalyticsSnapshots,
  createCustomerNotification, getPendingNotifications, markNotificationSent,
  getBookingServiceBreakdown,
} from "./db";
import { storagePut } from "./storage";
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
import { keywordSearch, aiSearch } from "./search";
import { getDashboardStats, getSiteHealth } from "./admin-stats";
import { runDiagnosis } from "./diagnose";
import { z } from "zod";
import { eq, desc, sql } from "drizzle-orm";
import { leads, chatSessions, bookings } from "../drizzle/schema";

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
          vehicleYear: z.string().optional(),
          vehicleMake: z.string().optional(),
          vehicleModel: z.string().optional(),
          preferredDate: z.string().optional(),
          preferredTime: z.enum(["morning", "afternoon", "no-preference"]).default("no-preference"),
          message: z.string().optional(),
          photoUrls: z.array(z.string()).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const vehicleStr = input.vehicleYear && input.vehicleMake
          ? `${input.vehicleYear} ${input.vehicleMake} ${input.vehicleModel || ""}`.trim()
          : input.vehicle || null;

        const result = await createBooking({
          name: input.name,
          phone: input.phone,
          email: input.email || null,
          service: input.service,
          vehicle: vehicleStr,
          vehicleYear: input.vehicleYear || null,
          vehicleMake: input.vehicleMake || null,
          vehicleModel: input.vehicleModel || null,
          preferredDate: input.preferredDate || null,
          preferredTime: input.preferredTime,
          message: input.message || null,
          photoUrls: input.photoUrls?.length ? JSON.stringify(input.photoUrls) : null,
        });

        // Sync to Google Sheets
        syncBookingToSheet({
          name: input.name,
          phone: input.phone,
          email: input.email,
          service: input.service,
          vehicle: vehicleStr || input.vehicle,
          preferredDate: input.preferredDate,
          preferredTime: input.preferredTime,
          message: input.message,
        }).catch(err => console.error("[Sheets] Booking sync failed:", err));

        // Notify shop owner
        const photoNote = input.photoUrls?.length ? `\nPhotos: ${input.photoUrls.length} attached` : "";
        await notifyOwner({
          title: `New Booking: ${input.service}`,
          content: `Name: ${input.name}\nPhone: ${input.phone}\nService: ${input.service}\nVehicle: ${vehicleStr || "Not specified"}\nPreferred Date: ${input.preferredDate || "Flexible"}\nPreferred Time: ${input.preferredTime}\nMessage: ${input.message || "None"}${photoNote}`,
        }).catch(() => {});

        return result;
      }),

    /** Upload a photo for a booking request */
    uploadPhoto: publicProcedure
      .input(z.object({
        base64: z.string(),
        filename: z.string(),
        mimeType: z.string(),
      }))
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.base64, "base64");
        const suffix = Math.random().toString(36).substring(2, 8);
        const key = `booking-photos/${Date.now()}-${suffix}-${input.filename}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        return { url };
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

    updateNotes: adminProcedure
      .input(z.object({ id: z.number(), notes: z.string() }))
      .mutation(async ({ input }) => {
        return updateBookingNotes(input.id, input.notes);
      }),

    updatePriority: adminProcedure
      .input(z.object({ id: z.number(), priority: z.number() }))
      .mutation(async ({ input }) => {
        return updateBookingPriority(input.id, input.priority);
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

  // ─── SEARCH ───────────────────────────────────────────
  search: router({
    /** Instant keyword search — no AI, fast */
    instant: publicProcedure
      .input(z.object({ query: z.string().min(1).max(200) }))
      .query(({ input }) => {
        return { results: keywordSearch(input.query) };
      }),

    /** AI-powered natural language search */
    ai: publicProcedure
      .input(z.object({ query: z.string().min(2).max(500) }))
      .mutation(async ({ input }) => {
        return aiSearch(input.query);
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

  // ─── ADMIN DASHBOARD ────────────────────────────────
  adminDashboard: router({
    stats: adminProcedure.query(async () => {
      return getDashboardStats();
    }),
    siteHealth: adminProcedure.query(async () => {
      return getSiteHealth();
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

  // ─── VEHICLE DIAGNOSTIC TOOL ─────────────────────────
  diagnose: router({
    analyze: publicProcedure
      .input(
        z.object({
          vehicleYear: z.string().optional(),
          vehicleMake: z.string().optional(),
          vehicleModel: z.string().optional(),
          mileage: z.string().optional(),
          symptoms: z.array(z.string()).min(1),
          additionalInfo: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        return runDiagnosis(input);
      }),
  }),

  // ─── COUPONS & SPECIALS ───────────────────────────
  coupons: router({
    active: publicProcedure.query(async () => {
      return getActiveCoupons();
    }),
    all: adminProcedure.query(async () => {
      return getAllCoupons();
    }),
    create: adminProcedure
      .input(z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        discountType: z.enum(["dollar", "percent", "free"]),
        discountValue: z.number().min(0),
        code: z.string().optional(),
        applicableServices: z.string().default("all"),
        terms: z.string().optional(),
        maxRedemptions: z.number().default(0),
        isFeatured: z.number().default(0),
        expiresAt: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return createCoupon({
          ...input,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        });
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().optional(),
        description: z.string().optional(),
        discountType: z.enum(["dollar", "percent", "free"]).optional(),
        discountValue: z.number().optional(),
        code: z.string().optional(),
        applicableServices: z.string().optional(),
        terms: z.string().optional(),
        isActive: z.number().optional(),
        isFeatured: z.number().optional(),
        expiresAt: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, expiresAt, ...rest } = input;
        return updateCoupon(id, {
          ...rest,
          ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
        });
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return deleteCoupon(input.id);
      }),
  }),

  // ─── MY GARAGE (CUSTOMER VEHICLES) ─────────────────
  garage: router({
    vehicles: protectedProcedure.query(async ({ ctx }) => {
      return getCustomerVehicles(ctx.user.id);
    }),
    addVehicle: protectedProcedure
      .input(z.object({
        year: z.string().min(4),
        make: z.string().min(1),
        model: z.string().min(1),
        mileage: z.number().optional(),
        nickname: z.string().optional(),
        vin: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return addCustomerVehicle({ ...input, userId: ctx.user.id });
      }),
    updateVehicle: protectedProcedure
      .input(z.object({
        id: z.number(),
        year: z.string().optional(),
        make: z.string().optional(),
        model: z.string().optional(),
        mileage: z.number().optional(),
        nickname: z.string().optional(),
        vin: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        return updateCustomerVehicle(id, ctx.user.id, data);
      }),
    deleteVehicle: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        return deleteCustomerVehicle(input.id, ctx.user.id);
      }),
    serviceHistory: protectedProcedure.query(async ({ ctx }) => {
      return getServiceHistoryForUser(ctx.user.id);
    }),
  }),

  // ─── REFERRAL PROGRAM ────────────────────────────
  referrals: router({
    submit: publicProcedure
      .input(z.object({
        referrerName: z.string().min(1),
        referrerPhone: z.string().min(7),
        referrerEmail: z.string().email().optional(),
        refereeName: z.string().min(1),
        refereePhone: z.string().min(7),
        refereeEmail: z.string().email().optional(),
      }))
      .mutation(async ({ input }) => {
        return createReferral(input);
      }),
    all: adminProcedure.query(async () => {
      return getReferrals();
    }),
    updateStatus: adminProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pending", "visited", "redeemed", "expired"]),
      }))
      .mutation(async ({ input }) => {
        return updateReferralStatus(input.id, input.status);
      }),
  }),

  // ─── ASK A MECHANIC Q&A ──────────────────────────
  qa: router({
    published: publicProcedure.query(async () => {
      return getPublishedQuestions();
    }),
    ask: publicProcedure
      .input(z.object({
        questionerName: z.string().min(1),
        questionerEmail: z.string().email().optional(),
        question: z.string().min(10),
        vehicleInfo: z.string().optional(),
        category: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return createQuestion(input);
      }),
    all: adminProcedure.query(async () => {
      return getAllQuestions();
    }),
    answer: adminProcedure
      .input(z.object({
        id: z.number(),
        answer: z.string().min(1),
        answeredBy: z.string().default("Nick's Tire & Auto"),
      }))
      .mutation(async ({ input }) => {
        return answerQuestion(input.id, input.answer, input.answeredBy);
      }),
  }),

  // ─── BUSINESS ANALYTICS ──────────────────────────
  analytics: router({
    snapshots: adminProcedure
      .input(z.object({ days: z.number().default(30) }).optional())
      .query(async ({ input }) => {
        return getAnalyticsSnapshots(input?.days ?? 30);
      }),
    serviceBreakdown: adminProcedure.query(async () => {
      return getBookingServiceBreakdown();
    }),
    funnel: adminProcedure.query(async () => {
      const d = await db();
      if (!d) return { bookings: 0, leads: 0, completed: 0, converted: 0 };
      const [bookingCount] = await d.select({ count: sql<number>`count(*)` }).from(bookings);
      const [leadCount] = await d.select({ count: sql<number>`count(*)` }).from(leads);
      const [completedCount] = await d.select({ count: sql<number>`count(*)` }).from(bookings).where(eq(bookings.status, "completed"));
      const [convertedCount] = await d.select({ count: sql<number>`count(*)` }).from(leads).where(eq(leads.status, "booked"));
      return {
        bookings: bookingCount?.count ?? 0,
        leads: leadCount?.count ?? 0,
        completed: completedCount?.count ?? 0,
        converted: convertedCount?.count ?? 0,
      };
    }),
  }),

  // ─── CUSTOMER NOTIFICATIONS ──────────────────────
  customerNotifications: router({
    pending: adminProcedure.query(async () => {
      return getPendingNotifications();
    }),
    send: adminProcedure
      .input(z.object({
        bookingId: z.number().optional(),
        recipientName: z.string().min(1),
        recipientPhone: z.string().optional(),
        recipientEmail: z.string().email().optional(),
        notificationType: z.enum(["booking_confirmed", "booking_inprogress", "booking_completed", "follow_up", "review_request", "maintenance_reminder", "special_offer"]),
        subject: z.string().optional(),
        message: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        return createCustomerNotification(input);
      }),
    markSent: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return markNotificationSent(input.id);
      }),
  }),
});

export type AppRouter = typeof appRouter;
