import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import {
  createBooking, getBookings, updateBookingStatus, updateBookingNotes, updateBookingPriority,
  createCoupon, getActiveCoupons, getAllCoupons, updateCoupon, deleteCoupon,
  getCustomerVehicles, addCustomerVehicle, updateCustomerVehicle, deleteCustomerVehicle,
  getServiceHistoryForUser,
  createReferral, getReferrals, updateReferralStatus,
  createQuestion, getPublishedQuestions, getAllQuestions, answerQuestion,
  getAnalyticsSnapshots,
  createCustomerNotification, getPendingNotifications, markNotificationSent,
  getBookingServiceBreakdown,
  // New Phase 25 imports
  createCallbackRequest, getCallbackRequests, updateCallbackStatus,
  updateBookingStage, getBookingByPhone, getBookingByRef,
  getServicePricingByCategory, getAllServicePricing, upsertServicePricing, seedDefaultPricing,
  createInspection, getInspection, getInspectionByToken, getInspections, addInspectionItem, updateInspectionItem, deleteInspectionItem, publishInspection,
  getLoyaltyRewards, createLoyaltyReward, updateLoyaltyReward,
  getLoyaltyTransactions, awardPoints, redeemReward,
  getUserLoyaltySummary,
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
} from "./content-generator";
import { keywordSearch, aiSearch } from "./search";
import { getDashboardStats, getSiteHealth } from "./admin-stats";
import { runDiagnosis } from "./diagnose";
import { sendSms, bookingConfirmationSms, statusUpdateSms, callbackConfirmationSms } from "./sms";
import { z } from "zod";
import { eq, desc, sql, gte } from "drizzle-orm";
import { leads, chatSessions, bookings, callbackRequests, customerNotifications } from "../drizzle/schema";

// Lazy db import
async function db() {
  const { getDb } = await import("./db");
  return getDb();
}

// Generate a short reference code for bookings
function generateRefCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "NT-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
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
          phone: z.string().min(7, "Phone number is required").max(20, "Phone number too long"),
          email: z.string().email().optional().or(z.literal("")),
          service: z.string().min(1, "Service is required"),
          vehicle: z.string().optional(),
          vehicleYear: z.string().optional(),
          vehicleMake: z.string().optional(),
          vehicleModel: z.string().optional(),
          preferredDate: z.string().optional(),
          preferredTime: z.enum(["morning", "afternoon", "no-preference"]).default("no-preference"),
          message: z.string().max(2000, "Message too long").optional(),
          photoUrls: z.array(z.string()).optional(),
          urgency: z.enum(["emergency", "this-week", "whenever"]).default("whenever"),
        })
      )
      .mutation(async ({ input }) => {
        const vehicleStr = input.vehicleYear && input.vehicleMake
          ? `${input.vehicleYear} ${input.vehicleMake} ${input.vehicleModel || ""}`.trim()
          : input.vehicle || null;

        const refCode = generateRefCode();
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
          urgency: input.urgency,
          referenceCode: refCode,
          priority: input.urgency === "emergency" ? 1 : input.urgency === "this-week" ? 5 : 10,
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

        // Notify shop owner — urgent bookings get special treatment
        const urgencyLabel = input.urgency === "emergency" ? "🔴 EMERGENCY" : input.urgency === "this-week" ? "🟡 This Week" : "Routine";
        const photoNote = input.photoUrls?.length ? `\nPhotos: ${input.photoUrls.length} attached` : "";
        await notifyOwner({
          title: `${urgencyLabel} Booking: ${input.service}`,
          content: `Name: ${input.name}\nPhone: ${input.phone}\nService: ${input.service}\nVehicle: ${vehicleStr || "Not specified"}\nUrgency: ${urgencyLabel}\nRef: ${refCode}\nPreferred Date: ${input.preferredDate || "Flexible"}\nPreferred Time: ${input.preferredTime}\nMessage: ${input.message || "None"}${photoNote}`,
        }).catch(() => {});

        // Send SMS booking confirmation to customer
        sendSms(input.phone, bookingConfirmationSms(input.name, input.service, refCode)).catch(err =>
          console.error("[SMS] Booking confirmation failed:", err)
        );

        return { ...result, referenceCode: refCode };
      }),

    /** Upload a photo for a booking request */
    uploadPhoto: publicProcedure
      .input(z.object({
        base64: z.string().max(10_000_000, "File too large (max 7.5MB)"),
        filename: z.string().max(255),
        mimeType: z.string().max(100),
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

    /** Update job stage for status tracker */
    updateStage: adminProcedure
      .input(z.object({
        id: z.number(),
        stage: z.enum(["received", "inspecting", "waiting-parts", "in-progress", "quality-check", "ready"]),
      }))
      .mutation(async ({ input }) => {
        const result = await updateBookingStage(input.id, input.stage);
        // Auto-queue a status update notification
        const d = await db();
        if (d) {
          const [booking] = await d.select().from(bookings).where(eq(bookings.id, input.id)).limit(1);
          if (booking) {
            const stageLabels: Record<string, string> = {
              "received": "received and is in our queue",
              "inspecting": "being inspected by our technicians",
              "waiting-parts": "waiting for parts to arrive",
              "in-progress": "actively being repaired",
              "quality-check": "going through our quality check",
              "ready": "ready for pickup",
            };
            await createCustomerNotification({
              bookingId: input.id,
              recipientName: booking.name,
              recipientPhone: booking.phone,
              recipientEmail: booking.email,
              notificationType: "status_update",
              subject: `Vehicle Status Update — ${input.stage === "ready" ? "Ready for Pickup!" : "In Progress"}`,
              message: `Hi ${booking.name.split(" ")[0]}, your vehicle is ${stageLabels[input.stage] || "being worked on"}. ${input.stage === "ready" ? "You can pick it up anytime during business hours. Call (216) 862-0005 if you have questions." : "We'll keep you updated. Ref: " + (booking.referenceCode || "")}`,
            });

            // Send SMS status update to customer
            if (booking.phone) {
              sendSms(booking.phone, statusUpdateSms(booking.name, input.stage, booking.referenceCode || undefined)).catch(err =>
                console.error("[SMS] Status update failed:", err)
              );
            }
          }
        }
        return result;
      }),

    /** Public: check booking status by phone */
    statusByPhone: publicProcedure
      .input(z.object({ phone: z.string().min(7).max(20) }))
      .query(async ({ input }) => {
        return getBookingByPhone(input.phone);
      }),

    /** Public: check booking status by reference code */
    statusByRef: publicProcedure
      .input(z.object({ ref: z.string().min(3) }))
      .query(async ({ input }) => {
        return getBookingByRef(input.ref);
      }),
  }),

  // ─── CALLBACK REQUESTS ────────────────────────────────
  callback: router({
    submit: publicProcedure
      .input(z.object({
        name: z.string().min(1),
        phone: z.string().min(7).max(20),
        context: z.string().optional(),
        sourcePage: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const result = await createCallbackRequest({
          name: input.name,
          phone: input.phone,
          context: input.context || null,
          sourcePage: input.sourcePage || null,
        });

        // Also create a lead for CRM tracking
        const d = await db();
        if (d) {
          await d.insert(leads).values({
            name: input.name,
            phone: input.phone,
            source: "callback",
            problem: input.context || "Callback request from " + (input.sourcePage || "website"),
            urgencyScore: 4,
            urgencyReason: "Customer requested immediate callback",
          }).catch(() => {});
        }

        // Notify owner immediately
        await notifyOwner({
          title: `Callback Request: ${input.name}`,
          content: `Phone: ${input.phone}\nPage: ${input.sourcePage || "Unknown"}\nContext: ${input.context || "None"}\n\nPlease call back ASAP.`,
        }).catch(() => {});

        // Send SMS confirmation to customer that callback was received
        sendSms(input.phone, callbackConfirmationSms(input.name)).catch(err =>
          console.error("[SMS] Callback confirmation failed:", err)
        );

        // Sync to sheets
        syncLeadToSheet({
          name: input.name,
          phone: input.phone,
          source: "callback",
          problem: "Callback request",
          urgencyScore: 4,
          urgencyReason: "Customer requested callback",
        }).catch(() => {});

        return result;
      }),

    list: adminProcedure.query(async () => {
      return getCallbackRequests();
    }),

    updateStatus: adminProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["new", "called", "no-answer", "completed"]),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return updateCallbackStatus(input.id, input.status, input.notes);
      }),
  }),

  // ─── LEAD CAPTURE ─────────────────────────────────────
  lead: router({
    /** Submit a new lead from the popup or chat */
    submit: publicProcedure
      .input(
        z.object({
          name: z.string().min(1),
          phone: z.string().min(7).max(20),
          email: z.string().email().optional().or(z.literal("")),
          vehicle: z.string().optional(),
          problem: z.string().optional(),
          source: z.enum(["popup", "chat", "booking", "manual", "callback", "fleet"]).default("popup"),
          // Fleet-specific fields
          companyName: z.string().optional(),
          fleetSize: z.number().optional(),
          vehicleTypes: z.string().optional(),
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
        // Fleet leads are always high priority
        if (input.source === "fleet") {
          scoring.score = 5;
          scoring.reason = "Fleet/commercial account inquiry";
          scoring.recommendedService = "Fleet Services";
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
          companyName: input.companyName || null,
          fleetSize: input.fleetSize || null,
          vehicleTypes: input.vehicleTypes || null,
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
          const fleetInfo = input.source === "fleet" ? `\nCompany: ${input.companyName || "N/A"}\nFleet Size: ${input.fleetSize || "N/A"}\nVehicle Types: ${input.vehicleTypes || "N/A"}` : "";
          notifyOwner({
            title: `URGENT Lead (${scoring.score}/5): ${input.name}`,
            content: `Phone: ${input.phone}\nVehicle: ${input.vehicle || "Not specified"}\nProblem: ${input.problem || "Not specified"}\nUrgency: ${scoring.reason}\nRecommended: ${scoring.recommendedService}${fleetInfo}`,
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
    instant: publicProcedure
      .input(z.object({ query: z.string().min(1).max(200) }))
      .query(({ input }) => {
        return { results: keywordSearch(input.query) };
      }),
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
      .mutation(async ({ input: _input }) => {
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
        notificationType: z.enum(["booking_confirmed", "booking_inprogress", "booking_completed", "follow_up", "review_request", "maintenance_reminder", "special_offer", "status_update"]),
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

  // ─── PRICE ESTIMATOR ────────────────────────────
  pricing: router({
    estimate: publicProcedure
      .input(z.object({
        serviceType: z.string().min(1),
        vehicleCategory: z.enum(["compact", "midsize", "full-size", "truck-suv"]),
      }))
      .query(async ({ input }) => {
        return getServicePricingByCategory(input.serviceType, input.vehicleCategory);
      }),
    allServices: publicProcedure.query(async () => {
      return getAllServicePricing();
    }),
    /** Admin: update pricing */
    upsert: adminProcedure
      .input(z.object({
        serviceType: z.string(),
        serviceLabel: z.string(),
        vehicleCategory: z.enum(["compact", "midsize", "full-size", "truck-suv"]),
        lowEstimate: z.number(),
        highEstimate: z.number(),
        typicalHours: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return upsertServicePricing(input);
      }),
    /** Admin: seed default pricing data */
    seedDefaults: adminProcedure.mutation(async () => {
      return seedDefaultPricing();
    }),
  }),

  // ─── VEHICLE INSPECTIONS ────────────────────────
  inspection: router({
    /** Public: view inspection by share token */
    byToken: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        return getInspectionByToken(input.token);
      }),

    /** Admin: list all inspections */
    list: adminProcedure.query(async () => {
      return getInspections();
    }),

    /** Admin: get single inspection with items */
    get: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return getInspection(input.id);
      }),

    /** Admin: create inspection */
    create: adminProcedure
      .input(z.object({
        bookingId: z.number().optional(),
        customerName: z.string().min(1),
        customerPhone: z.string().optional(),
        customerEmail: z.string().optional(),
        vehicleInfo: z.string().min(1),
        vehicleYear: z.string().optional(),
        vehicleMake: z.string().optional(),
        vehicleModel: z.string().optional(),
        mileage: z.number().optional(),
        technicianName: z.string().min(1),
        overallCondition: z.enum(["good", "fair", "needs-attention"]).default("fair"),
        summaryNotes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return createInspection(input);
      }),

    /** Admin: add item to inspection */
    addItem: adminProcedure
      .input(z.object({
        inspectionId: z.number(),
        component: z.string().min(1),
        category: z.enum(["brakes", "tires", "engine", "suspension", "electrical", "fluids", "body", "other"]),
        condition: z.enum(["green", "yellow", "red"]),
        notes: z.string().optional(),
        photoUrl: z.string().optional(),
        recommendedAction: z.string().optional(),
        estimatedCost: z.number().optional(),
        sortOrder: z.number().default(0),
      }))
      .mutation(async ({ input }) => {
        return addInspectionItem(input);
      }),

    /** Admin: update inspection item */
    updateItem: adminProcedure
      .input(z.object({
        id: z.number(),
        component: z.string().optional(),
        category: z.enum(["brakes", "tires", "engine", "suspension", "electrical", "fluids", "body", "other"]).optional(),
        condition: z.enum(["green", "yellow", "red"]).optional(),
        notes: z.string().optional(),
        photoUrl: z.string().optional(),
        recommendedAction: z.string().optional(),
        estimatedCost: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return updateInspectionItem(id, data);
      }),

    /** Admin: delete inspection item */
    deleteItem: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return deleteInspectionItem(input.id);
      }),

    /** Admin: publish inspection (makes it viewable via share link) */
    publish: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return publishInspection(input.id);
      }),

    /** Admin: upload inspection photo */
    uploadPhoto: adminProcedure
      .input(z.object({
        base64: z.string().max(10_000_000, "File too large (max 7.5MB)"),
        filename: z.string().max(255),
        mimeType: z.string().max(100),
      }))
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.base64, "base64");
        const suffix = Math.random().toString(36).substring(2, 8);
        const key = `inspection-photos/${Date.now()}-${suffix}-${input.filename}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        return { url };
      }),
  }),

  // ─── FOLLOW-UPS & WEEKLY REPORT ─────────────────
  followUps: router({
    /** Admin: manually trigger follow-up processing */
    run: adminProcedure.mutation(async () => {
      const { runFollowUps } = await import("./follow-ups");
      return runFollowUps();
    }),
  }),

  weeklyReport: router({
    /** Admin: generate weekly intelligence report */
    generate: adminProcedure.mutation(async () => {
      const d = await db();
      if (!d) return { error: "Database not available" };

      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Bookings this week
      const weekBookings = await d.select().from(bookings)
        .where(gte(bookings.createdAt, weekAgo))
        .orderBy(desc(bookings.createdAt));

      // Leads this week
      const weekLeads = await d.select().from(leads)
        .where(gte(leads.createdAt, weekAgo))
        .orderBy(desc(leads.createdAt));

      // Callbacks this week
      const weekCallbacks = await d.select().from(callbackRequests)
        .where(gte(callbackRequests.createdAt, weekAgo))
        .orderBy(desc(callbackRequests.createdAt));

      // Notifications this week
      const weekNotifs = await d.select().from(customerNotifications)
        .where(gte(customerNotifications.createdAt, weekAgo));

      // Service breakdown
      const serviceBreakdown: Record<string, number> = {};
      weekBookings.forEach(b => {
        serviceBreakdown[b.service] = (serviceBreakdown[b.service] || 0) + 1;
      });

      // Urgency breakdown
      const urgencyBreakdown: Record<string, number> = {};
      weekBookings.forEach(b => {
        const u = b.urgency || "whenever";
        urgencyBreakdown[u] = (urgencyBreakdown[u] || 0) + 1;
      });

      const report = {
        period: { start: weekAgo.toISOString(), end: now.toISOString() },
        bookings: {
          total: weekBookings.length,
          completed: weekBookings.filter(b => b.status === "completed").length,
          cancelled: weekBookings.filter(b => b.status === "cancelled").length,
          emergency: weekBookings.filter(b => b.urgency === "emergency").length,
          serviceBreakdown,
          urgencyBreakdown,
        },
        leads: {
          total: weekLeads.length,
          highUrgency: weekLeads.filter(l => l.urgencyScore >= 4).length,
          converted: weekLeads.filter(l => l.status === "booked").length,
          sources: weekLeads.reduce((acc, l) => { acc[l.source] = (acc[l.source] || 0) + 1; return acc; }, {} as Record<string, number>),
        },
        callbacks: {
          total: weekCallbacks.length,
          completed: weekCallbacks.filter(c => c.status === "completed").length,
          pending: weekCallbacks.filter(c => c.status === "new").length,
        },
        notifications: {
          sent: weekNotifs.filter(n => n.status === "sent").length,
          pending: weekNotifs.filter(n => n.status === "pending").length,
        },
      };

      // Send to owner
      const topServices = Object.entries(serviceBreakdown)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([s, c]) => `  ${s}: ${c}`)
        .join("\n");

      await notifyOwner({
        title: `Weekly Report: ${weekBookings.length} bookings, ${weekLeads.length} leads`,
        content: `NICK'S TIRE & AUTO — WEEKLY INTELLIGENCE REPORT\n${"-".repeat(50)}\nPeriod: ${weekAgo.toLocaleDateString()} — ${now.toLocaleDateString()}\n\nBOOKINGS: ${report.bookings.total} total\n  Completed: ${report.bookings.completed}\n  Emergency: ${report.bookings.emergency}\n  Cancelled: ${report.bookings.cancelled}\n\nTop Services:\n${topServices || "  No bookings this week"}\n\nLEADS: ${report.leads.total} total\n  High Urgency: ${report.leads.highUrgency}\n  Converted to Booking: ${report.leads.converted}\n\nCALLBACKS: ${report.callbacks.total} total\n  Completed: ${report.callbacks.completed}\n  Still Pending: ${report.callbacks.pending}\n\nFOLLOW-UPS SENT: ${report.notifications.sent}\nFOLLOW-UPS PENDING: ${report.notifications.pending}`,
      }).catch(() => {});

      return report;
    }),
  }),

  // ─── LOYALTY PROGRAM ────────────────────────────
  loyalty: router({
    /** Public: get available rewards */
    rewards: publicProcedure.query(async () => {
      return getLoyaltyRewards();
    }),

    /** Protected: get user's loyalty summary */
    summary: protectedProcedure.query(async ({ ctx }) => {
      return getUserLoyaltySummary(ctx.user.id);
    }),

    /** Protected: get user's transaction history */
    transactions: protectedProcedure
      .input(z.object({ limit: z.number().default(20) }).optional())
      .query(async ({ ctx, input }) => {
        return getLoyaltyTransactions(ctx.user.id, input?.limit ?? 20);
      }),

    /** Protected: redeem a reward */
    redeem: protectedProcedure
      .input(z.object({ rewardId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        return redeemReward(ctx.user.id, input.rewardId);
      }),

    /** Admin: award points to a user */
    awardPoints: adminProcedure
      .input(z.object({
        userId: z.number(),
        points: z.number().min(1),
        description: z.string(),
        serviceHistoryId: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        return awardPoints(input.userId, input.points, input.description, input.serviceHistoryId);
      }),

    /** Admin: manage rewards */
    createReward: adminProcedure
      .input(z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        pointsCost: z.number().min(1),
        rewardValue: z.number().min(1),
        rewardType: z.enum(["dollar-off", "percent-off", "free-service"]).default("dollar-off"),
        applicableService: z.string().default("all"),
      }))
      .mutation(async ({ input }) => {
        return createLoyaltyReward(input);
      }),

    updateReward: adminProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().optional(),
        description: z.string().optional(),
        pointsCost: z.number().optional(),
        rewardValue: z.number().optional(),
        isActive: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return updateLoyaltyReward(id, data);
      }),
  }),

  // ─── SMS ADMIN ────────────────────────────────────────
  sms: router({
    /** Admin: send a test SMS to verify Twilio is working */
    sendTest: adminProcedure
      .input(z.object({ phone: z.string().min(7).max(20) }))
      .mutation(async ({ input }) => {
        const result = await sendSms(input.phone, "This is a test message from Nick's Tire & Auto. If you received this, SMS notifications are working correctly. — Nick's Team");
        return result;
      }),

    /** Admin: send a manual SMS to any number */
    sendManual: adminProcedure
      .input(z.object({
        phone: z.string().min(7).max(20),
        message: z.string().min(1).max(1600),
      }))
      .mutation(async ({ input }) => {
        return sendSms(input.phone, input.message);
      }),

    /** Admin: get Twilio configuration status */
    status: adminProcedure.query(() => {
      const configured = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
      return {
        configured,
        fromNumber: configured ? process.env.TWILIO_PHONE_NUMBER : null,
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
