/**
 * Booking router — handles appointment creation, admin management, and status tracking.
 */
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { SITE_URL, BUSINESS } from "@shared/business";
import {
  createBooking, getBookings, updateBookingStatus, updateBookingNotes, updateBookingPriority,
  updateBookingStage, getBookingByPhone, getBookingByRef,
  createCustomerNotification,
} from "../db";
import { storagePut } from "../storage";
import { notifyNewBooking, notifyInvoiceCreated } from "../email-notify";
import { syncBookingToSheet, syncInvoiceToSheet } from "../sheets-sync";
import { sendSms, bookingConfirmationSms, statusUpdateSms } from "../sms";
import { sendLeadEvent, sendScheduleEvent } from "../meta-capi";
import { scheduleReviewRequest } from "./reviewRequests";
import { scheduleRemindersForBooking, getNextInvoiceNumber, createInvoice } from "../db";
import { shopSettings } from "../../drizzle/schema";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { bookings, invoices } from "../../drizzle/schema";
import { sanitizeText, sanitizePhone, sanitizeEmail } from "../sanitize";
import { logIntegrationFailure } from "../integration-failures";
import { withRetry } from "../retry";
import { logAdminAction } from "../services/auditTrail";

import { db } from "../lib/db-helper";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:booking");
// ─── LABOR GUIDE REFERENCE (for auto-invoice labor estimation) ───
const SERVICE_LABOR_MAP: Record<string, { hours: number; description: string }> = {
  "oil change": { hours: 0.3, description: "Oil Change Service" },
  "brake": { hours: 1.5, description: "Brake Service" },
  "tire": { hours: 0.7, description: "Tire Service" },
  "diagnostic": { hours: 1.0, description: "Diagnostic Service" },
  "check engine": { hours: 1.0, description: "Check Engine Light Diagnosis" },
  "emission": { hours: 2.0, description: "Emissions / E-Check Repair" },
  "e-check": { hours: 2.0, description: "Ohio E-Check Repair" },
  "suspension": { hours: 2.5, description: "Suspension Repair" },
  "alignment": { hours: 1.0, description: "Wheel Alignment" },
  "ac": { hours: 1.5, description: "AC Service" },
  "cooling": { hours: 1.5, description: "Cooling System Service" },
  "exhaust": { hours: 1.5, description: "Exhaust Repair" },
  "electrical": { hours: 1.5, description: "Electrical Repair" },
  "starter": { hours: 2.0, description: "Starter Replacement" },
  "alternator": { hours: 1.5, description: "Alternator Replacement" },
  "transmission": { hours: 1.0, description: "Transmission Service" },
  "general": { hours: 1.5, description: "General Repair" },
};

function estimateLaborFromService(service: string): { hours: number; description: string } {
  const lower = service.toLowerCase();
  for (const [key, val] of Object.entries(SERVICE_LABOR_MAP)) {
    if (lower.includes(key)) return val;
  }
  return { hours: 1.0, description: service };
}

/** Auto-create an invoice when a booking is marked completed */
async function autoCreateInvoiceFromBooking(d: any, booking: any): Promise<void> {
  // forensic-audit HIGH · dedup. Re-marking a booking 'completed' (double-tap,
  // or confirmed→completed→confirmed→completed) re-ran this and created a
  // second pending invoice for the same job — invoices has no unique
  // bookingId. Skip if one already exists.
  const [existingInvoice] = await d.select({ id: invoices.id }).from(invoices).where(eq(invoices.bookingId, booking.id)).limit(1);
  if (existingInvoice) {
    log.info(`[Booking] Invoice already exists for booking #${booking.id} — skipping auto-create`);
    return;
  }
  const invoiceNumber = await getNextInvoiceNumber();
  const labor = estimateLaborFromService(booking.service || "General Repair");

  // Get labor rate from shop settings
  let laborRate = 115;
  try {
    const [setting] = await d.select().from(shopSettings).where(eq(shopSettings.key, "laborRate")).limit(1);
    if (setting) laborRate = parseFloat(setting.value);
  } catch (err) {
    log.error("[Booking] Failed to fetch labor rate, using default:", err instanceof Error ? err.message : err);
  }

  const laborCost = Math.round(labor.hours * laborRate * 100); // cents
  // Ohio does NOT tax auto repair labor — only parts/materials are taxable.
  // Parts are $0 on auto-generated invoices (added manually by shop later).
  // Tax will be recalculated when parts are added via the invoice editor.
  const taxAmount = 0;
  const totalAmount = laborCost + taxAmount;

  // Create invoice in database
  await createInvoice({
    bookingId: booking.id,
    customerName: booking.name,
    customerPhone: booking.phone,
    invoiceNumber,
    totalAmount,
    partsCost: 0, // Parts added manually by shop
    laborCost,
    taxAmount,
    serviceDescription: labor.description,
    vehicleInfo: booking.vehicle || null,
    paymentMethod: "card",
    paymentStatus: "pending",
    source: "manual",
    invoiceDate: new Date(),
  });

  // Sync to Google Sheets
  await withRetry(
    () => syncInvoiceToSheet({
      invoiceNumber,
      customerName: booking.name,
      customerPhone: booking.phone,
      vehicleInfo: booking.vehicle,
      serviceDescription: labor.description,
      laborHours: labor.hours,
      laborRate,
      laborCost: laborCost / 100,
      partsCost: 0,
      taxAmount: taxAmount / 100,
      totalAmount: totalAmount / 100,
      paymentMethod: "card",
      paymentStatus: "pending",
      source: "booking",
      orderRef: booking.referenceCode || null,
      notes: `Auto-generated from booking #${booking.id}`,
    }),
    { maxRetries: 3, baseDelayMs: 1000, label: "syncInvoiceToSheet" }
  );

  // Notify CEO about the auto-generated invoice
  withRetry(
    () => notifyInvoiceCreated({
      invoiceNumber,
      customerName: booking.name,
      totalAmount: totalAmount / 100,
      source: "booking",
      serviceDescription: labor.description,
    }),
    { maxRetries: 3, baseDelayMs: 1000, label: "notifyInvoiceCreated" }
  ).catch(e => log.warn("[booking:autoInvoice] invoice email notification failed:", e));

  // Dispatch to event bus — makes auto-invoices visible to NOUR OS, Nick AI, ShopDriver, Statenour
  import("../services/eventBus").then(({ emit }) =>
    emit.invoiceCreated({
      invoiceNumber,
      customerName: booking.name,
      totalAmount: totalAmount / 100,
      source: "booking",
    })
  ).catch(e => log.warn("[booking:autoInvoice] event bus invoice dispatch failed:", e));

  // Link invoice to matching work order (WO created from same booking)
  try {
    const { workOrders } = await import("../../drizzle/schema");
    const { eq: woEq, sql: woSql } = await import("drizzle-orm");
    const [matchingWo] = await d.select({ id: workOrders.id, internalNotes: workOrders.internalNotes })
      .from(workOrders)
      .where(woEq(workOrders.bookingId, booking.id))
      .limit(1);
    if (matchingWo) {
      const existingNotes = matchingWo.internalNotes || "";
      const linkNote = `[Invoice ${invoiceNumber} — $${(totalAmount / 100).toFixed(2)}]`;
      await d.update(workOrders).set({
        internalNotes: existingNotes ? `${existingNotes}\n${linkNote}` : linkNote,
      }).where(woEq(workOrders.id, matchingWo.id));
    }
  } catch (err) {
    log.error("[Invoice] WO linkage failed:", err instanceof Error ? err.message : err);
  }

  console.info(`[invoice:created] ${invoiceNumber} for booking #${booking.id} — $${(totalAmount / 100).toFixed(2)}`);
}

function generateRefCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "NT-";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export const bookingRouter = router({
  create: publicProcedure
    .input(
      // NULLISH on optional fields — same fix as callback.ts / lead.ts.
      // Frontend sends null for missing UTM/tracking; `.optional()` alone
      // rejected them with BAD_REQUEST and silently killed submissions.
      z.object({
        name: z.string().min(1, "Name is required").max(200),
        phone: z.string().min(7, "Phone number is required").max(20, "Phone number too long"),
        email: z.string().email().max(254).nullish().or(z.literal("")),
        service: z.string().min(1, "Service is required").max(500),
        vehicle: z.string().max(200).nullish(),
        vehicleYear: z.string().max(4).nullish(),
        vehicleMake: z.string().max(50).nullish(),
        vehicleModel: z.string().max(50).nullish(),
        preferredDate: z.string().max(30).nullish().refine(
          (val) => !val || /^\d{4}-\d{2}-\d{2}$/.test(val),
          { message: "preferredDate must be YYYY-MM-DD format" }
        ),
        preferredTime: z.enum(["morning", "afternoon", "no-preference"]).default("no-preference"),
        message: z.string().max(2000, "Message too long").nullish(),
        photoUrls: z.array(z.string().max(2048)).max(10).nullish(),
        urgency: z.enum(["emergency", "this-week", "whenever"]).default("whenever"),
        pixelEventIds: z.object({
          leadEventId: z.string().max(100),
          scheduleEventId: z.string().max(100),
        }).nullish(),
        pixelUserData: z.object({
          client_user_agent: z.string().max(500),
          fbc: z.string().max(500).nullish(),
          fbp: z.string().max(500).nullish(),
        }).nullish(),
        utmSource: z.string().max(100).nullish(),
        utmMedium: z.string().max(100).nullish(),
        utmCampaign: z.string().max(255).nullish(),
        utmTerm: z.string().max(255).nullish(),
        utmContent: z.string().max(255).nullish(),
        landingPage: z.string().max(500).nullish(),
        referrer: z.string().max(500).nullish(),
        gclid: z.string().max(255).optional(),
        // journey-join migration 0068 - localStorage visitor id
        sessionId: z.string().max(64).nullish(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
      // Sanitize all user inputs
      const name = sanitizeText(input.name);
      const phone = sanitizePhone(input.phone);
      const email = input.email ? sanitizeEmail(input.email) : null;
      const service = sanitizeText(input.service);
      const message = sanitizeText(input.message);

      // ─── Junk / spam validation ────────────────────
      // Reject keyboard-mash names, all-same-char, no-vowel gibberish,
      // obvious test entries, and phones that are all the same digit.
      // This is a polite 400 — tells the user their name looks invalid
      // rather than silently accepting spam.
      const nameClean = name?.trim().toLowerCase() || "";
      const isJunkName =
        nameClean.length < 3 ||
        new Set(nameClean).size === 1 ||
        (new Set(nameClean.replace(/[^a-z]/g, "")).size <= 3 && nameClean.length >= 4) ||
        !/[aeiouy]/.test(nameClean) ||
        /\btest\b/i.test(nameClean) ||
        ["hello", "hi", "hey", "asdf", "qwerty"].includes(nameClean);
      const phoneDigits = phone?.replace(/\D/g, "") || "";
      const isJunkPhone = phoneDigits.length > 0 && new Set(phoneDigits).size === 1;
      if (isJunkName || isJunkPhone) {
        return {
          success: false,
          error: "Please enter a valid name and phone number so we can confirm your booking.",
        };
      }
      const vehicleStr = input.vehicleYear && input.vehicleMake
        ? `${sanitizeText(input.vehicleYear)} ${sanitizeText(input.vehicleMake)} ${sanitizeText(input.vehicleModel)}`.trim()
        : sanitizeText(input.vehicle) || null;

      // Retry refCode generation on collision (unique index)
      let refCode = generateRefCode();
      let result!: { success: boolean; id: number };
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          result = await createBooking({
            name,
            phone,
            email,
            service,
            vehicle: vehicleStr,
            vehicleYear: input.vehicleYear || null,
            vehicleMake: input.vehicleMake || null,
            vehicleModel: input.vehicleModel || null,
            preferredDate: input.preferredDate || null,
            preferredTime: input.preferredTime,
            message: message || null,
            photoUrls: input.photoUrls?.length ? JSON.stringify(input.photoUrls) : null,
            urgency: input.urgency,
            referenceCode: refCode,
            priority: input.urgency === "emergency" ? 1 : input.urgency === "this-week" ? 5 : 10,
            utmSource: input.utmSource || null,
            utmMedium: input.utmMedium || null,
            utmCampaign: input.utmCampaign || null,
            utmTerm: input.utmTerm || null,
            utmContent: input.utmContent || null,
            landingPage: input.landingPage || null,
            referrer: input.referrer || null,
            gclid: input.gclid || null,
            sessionId: input.sessionId || null,
          });
          break; // Success — exit retry loop
        } catch (err: unknown) {
          const isDuplicate = (err as any)?.message?.includes("Duplicate") || (err as any)?.code === "ER_DUP_ENTRY";
          if (isDuplicate && attempt < 2) { refCode = generateRefCode(); continue; }
          throw err;
        }
      }

      // TCPA-defensible opt-in record (implicit consent via booking form)
      import("../services/complianceLog").then(({ logSmsOptIn }) =>
        logSmsOptIn({
          phone,
          source: "booking_form",
          ipAddress: ctx.req?.ip ?? null,
          userAgent: ctx.req?.headers?.["user-agent"]?.toString() ?? null,
          context: { bookingId: result.id, refCode },
        }),
      ).catch((err) => log.warn("[booking] compliance log failed:", err));

      // Unified event bus (→ NOUR OS + ShopDriver + Telegram + learning)
      import("../services/eventBus").then(({ emit }) =>
        emit.bookingCreated({
          id: result.id,
          name,
          phone,
          service,
          vehicle: vehicleStr || undefined,
          urgency: input.urgency,
          refCode,
        })
      ).catch(err => {
        log.error("[NourOS] Booking event dispatch failed:", err);
      });

      withRetry(
        () => syncBookingToSheet({
          name: input.name,
          phone: input.phone,
          email: input.email,
          service: input.service,
          vehicle: vehicleStr || input.vehicle,
          preferredDate: input.preferredDate,
          preferredTime: input.preferredTime,
          message: input.message,
          // sheets-attribution wave 2026-06 — same already-validated input
          // fields the DB insert stores; appended as the row's tail columns.
          utmSource: input.utmSource,
          utmMedium: input.utmMedium,
          utmCampaign: input.utmCampaign,
          landingPage: input.landingPage,
          referrer: input.referrer,
        }),
        { maxRetries: 3, baseDelayMs: 1000, label: "syncBookingToSheet" }
      ).catch(err => {
        log.error("[Sheets] Booking sync failed:", err);
        logIntegrationFailure({
          failureType: "sheets_sync",
          entityId: result.id,
          entityType: "booking",
          errorMessage: err instanceof Error ? err.message : String(err),
          errorDetails: err,
        });
      });

      withRetry(
        () => notifyNewBooking({
          name: input.name,
          phone: input.phone,
          service: input.service,
          vehicle: vehicleStr || undefined,
          date: input.preferredDate || undefined,
          time: input.preferredTime,
          notes: input.message || undefined,
          urgency: input.urgency,
          refCode,
        }),
        { maxRetries: 3, baseDelayMs: 1000, label: "notifyNewBooking" }
      ).catch(err => {
        log.error("[Booking] Email notification failed:", err);
        logIntegrationFailure({
          failureType: "email",
          entityId: result.id,
          entityType: "booking",
          errorMessage: err instanceof Error ? err.message : String(err),
          errorDetails: err,
        });
      });

      withRetry(
        // Wave-103 — booking confirm rides on the shop's real line
        // so customer recognizes the number on follow-up texts.
        () => sendSms(input.phone, bookingConfirmationSms(input.name, input.service, refCode), { via: "shop" }),
        { maxRetries: 3, baseDelayMs: 1000, label: "sendSms (booking confirmation)" }
      ).catch(err => {
        log.error("[SMS] Booking confirmation failed:", err);
        logIntegrationFailure({
          failureType: "sms",
          entityId: result.id,
          entityType: "booking",
          errorMessage: err instanceof Error ? err.message : String(err),
          errorDetails: err,
        });
      });

      // Meta Conversions API: Send server-side Lead + Schedule events
      if (input.pixelEventIds) {
        const pixelEventIds = input.pixelEventIds;
        const capiUserData = {
          phone: input.phone,
          email: input.email || undefined,
          name: input.name,
          userAgent: input.pixelUserData?.client_user_agent,
          fbc: input.pixelUserData?.fbc,
          fbp: input.pixelUserData?.fbp,
        };
        withRetry(
          () => sendLeadEvent({
            eventId: pixelEventIds.leadEventId,
            sourceUrl: SITE_URL,
            contentName: "Booking Form Submission",
            contentCategory: input.service,
            ...capiUserData,
          }),
          { maxRetries: 3, baseDelayMs: 1000, label: "sendLeadEvent (booking)" }
        ).catch(err => {
          log.error("[CAPI] Lead event failed:", err);
          logIntegrationFailure({
            failureType: "capi",
            entityId: result.id,
            entityType: "booking",
            errorMessage: err instanceof Error ? err.message : String(err),
            errorDetails: err,
          });
        });
        withRetry(
          () => sendScheduleEvent({
            eventId: pixelEventIds.scheduleEventId,
            sourceUrl: SITE_URL,
            service: input.service,
            vehicle: vehicleStr || undefined,
            ...capiUserData,
          }),
          { maxRetries: 3, baseDelayMs: 1000, label: "sendScheduleEvent (booking)" }
        ).catch(err => {
          log.error("[CAPI] Schedule event failed:", err);
          logIntegrationFailure({
            failureType: "capi",
            entityId: result.id,
            entityType: "booking",
            errorMessage: err instanceof Error ? err.message : String(err),
            errorDetails: err,
          });
        });
      }

      return { ...result, referenceCode: refCode };
      } catch (err) {
        log.error("[Booking] Create failed:", err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `We couldn't save your booking. Please call us directly at ${BUSINESS.phone.display}.` });
      }
    }),

  uploadPhoto: publicProcedure
    .input(z.object({
      base64: z.string().max(10_000_000, "File too large (max 7.5MB)"),
      filename: z.string().max(255),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]),
    }))
    .mutation(async ({ input }) => {
      const { randomInt } = await import("crypto");
      const buffer = Buffer.from(input.base64, "base64");
      // Strip path traversal and unsafe chars from filename
      const safeFilename = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const suffix = randomInt(100000, 999999).toString();
      const key = `booking-photos/${Date.now()}-${suffix}-${safeFilename}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      return { url };
    }),

  /**
   * wave-171: capture upsell-interest from the BookingForm success card.
   *
   * Previously the "Add to appointment" button on the post-submit upsell
   * suggestions was a dead UI element — zero onClick handler. Customers
   * tapping it at the highest-intent moment in the funnel got silence,
   * which destroyed trust right at the conversion peak.
   *
   * Now: appends the upsell suggestion to the booking's adminNotes so
   * staff sees the customer's interest when they pull up the booking +
   * fires a Telegram alert so the front desk knows to bring it up at
   * check-in. Public procedure (the customer's session has just created
   * the booking and owns its id).
   */
  addUpsellInterest: publicProcedure
    .input(z.object({
      bookingId: z.number().int().positive(),
      upsellTitle: z.string().min(1).max(200),
      upsellPrice: z.string().max(50).optional(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false, error: "DB unavailable" };
      const [booking] = await d.select().from(bookings).where(eq(bookings.id, input.bookingId)).limit(1);
      if (!booking) return { success: false, error: "Booking not found" };

      const noteLine = `[UPSELL INTEREST] ${input.upsellTitle}${input.upsellPrice ? ` (${input.upsellPrice})` : ""} — added by customer at confirmation`;
      const existing = booking.adminNotes ? booking.adminNotes + "\n" : "";
      // Don't duplicate — if note already contains this exact line, skip the append
      const newNotes = existing.includes(noteLine) ? booking.adminNotes : existing + noteLine;
      if (newNotes !== booking.adminNotes) {
        await d.update(bookings).set({ adminNotes: newNotes }).where(eq(bookings.id, input.bookingId));
      }

      // Fire-and-forget Telegram so front desk sees it before customer arrives
      import("../services/telegram")
        .then(({ sendTelegram }) =>
          sendTelegram(`🎯 UPSELL added by customer · booking #${booking.id} (${booking.name})\n${input.upsellTitle}${input.upsellPrice ? ` · ${input.upsellPrice}` : ""}`)
        )
        .catch((e) => log.warn("[booking:addUpsellInterest] telegram alert failed:", e));

      return { success: true };
    }),

  list: adminProcedure.query(async () => {
    return getBookings();
  }),

  updateStatus: adminProcedure
    .input(z.object({ id: z.number(), status: z.enum(["new", "confirmed", "completed", "cancelled"]) }))
    .mutation(async ({ input }) => {
      const result = await updateBookingStatus(input.id, input.status);

      // Audit trail — log booking status changes for Nick AI learning
      logAdminAction({
        action: "booking.status_changed",
        entityType: "booking",
        entityId: input.id,
        details: `Booking status changed to ${input.status}`,
        newValue: input.status,
      }).catch(e => log.warn("[booking:updateStatus] audit trail logging failed:", e));

      // Send confirmation SMS when booking is confirmed by admin
      if (input.status === "confirmed") {
        const d = await db();
        if (d) {
          const [booking] = await d.select().from(bookings).where(eq(bookings.id, input.id)).limit(1);
          if (booking) {
            // Track confirmation metadata
            await d.update(bookings)
              .set({
                confirmedAt: new Date(),
                confirmationMethod: "admin",
              })
              .where(eq(bookings.id, input.id));

            if (booking.phone) {
              const { isEnabled } = await import("../services/featureFlags");
              if (await isEnabled("sms_appointment_reminders")) {
                const { sendSms } = await import("../sms");
                const firstName = (booking.name || "").split(" ")[0] || "there";
                // Wave-108: appointment-confirmed reminder via shop gateway
                await sendSms(booking.phone, `Hi ${firstName}! Your booking at Nick's Tire & Auto is confirmed. Just drop off when you're ready — no appointment time needed. ${BUSINESS.phone.display}`, { via: "shop" });
              }
            }
          }
        }
      }

      // Auto-schedule Google review request when booking is completed
      if (input.status === "completed") {
        const d = await db();
        if (d) {
          const [booking] = await d.select().from(bookings).where(eq(bookings.id, input.id)).limit(1);
          if (booking && booking.phone) {
            scheduleReviewRequest(booking.id, booking.name, booking.phone, booking.service)
              .then(r => {
                // Review request handled
              })
              .catch(err => {
                log.error(`[ReviewRequest] Error scheduling for booking #${booking.id}:`, err);
                logIntegrationFailure({
                  failureType: "review_request",
                  entityId: booking.id,
                  entityType: "booking",
                  errorMessage: err instanceof Error ? err.message : String(err),
                  errorDetails: err,
                });
              });

            // Auto-schedule maintenance reminders based on service type
            scheduleRemindersForBooking({
              id: booking.id,
              name: booking.name,
              phone: booking.phone,
              service: booking.service,
              vehicle: booking.vehicle,
            })
              .then((ids: number[]) => {
                // Reminders scheduled
              })
              .catch((err: unknown) => {
                log.error(`[Reminders] Error scheduling for booking #${booking.id}:`, err);
                logIntegrationFailure({
                  failureType: "reminders",
                  entityId: booking.id,
                  entityType: "booking",
                  errorMessage: err instanceof Error ? err.message : String(err),
                  errorDetails: err,
                });
              });

            // Unified event bus (→ NOUR OS + learning)
            import("../services/eventBus").then(({ emit }) =>
              emit.bookingCompleted({
                id: booking.id,
                name: booking.name,
                service: booking.service,
              })
            ).catch(e => log.warn("[booking:updateStatus] event bus booking completed dispatch failed:", e));

            // Auto-create invoice from completed booking
            autoCreateInvoiceFromBooking(d, booking).catch(err => {
              log.error(`[Invoice] Error auto-creating for booking #${booking.id}:`, err);
              logIntegrationFailure({
                failureType: "invoice",
                entityId: booking.id,
                entityType: "booking",
                errorMessage: err instanceof Error ? err.message : String(err),
                errorDetails: err,
              });
            });
          }
        }
      }

      return result;
    }),

  updateNotes: adminProcedure
    .input(z.object({ id: z.number(), notes: z.string().max(10000) }))
    .mutation(async ({ input }) => {
      const result = await updateBookingNotes(input.id, input.notes);

      // Audit trail — log notes updates for Nick AI learning
      logAdminAction({
        action: "booking.notes_updated",
        entityType: "booking",
        entityId: input.id,
        details: "Booking notes updated",
        newValue: input.notes,
      }).catch(e => log.warn("[booking:updateNotes] audit trail logging failed:", e));

      return result;
    }),

  updatePriority: adminProcedure
    .input(z.object({ id: z.number(), priority: z.number() }))
    .mutation(async ({ input }) => {
      return updateBookingPriority(input.id, input.priority);
    }),

  updateStage: adminProcedure
    .input(z.object({
      id: z.number(),
      stage: z.enum(["received", "inspecting", "waiting-parts", "in-progress", "quality-check", "ready"]),
    }))
    .mutation(async ({ input }) => {
      const result = await updateBookingStage(input.id, input.stage);

      // Audit trail — log stage changes for Nick AI learning
      logAdminAction({
        action: "booking.stage_changed",
        entityType: "booking",
        entityId: input.id,
        details: `Booking stage changed to ${input.stage}`,
        newValue: input.stage,
      }).catch(e => log.warn("[booking:updateStage] audit trail logging failed:", e));

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
            message: `Hi ${booking.name.split(" ")[0]}, your vehicle is ${stageLabels[input.stage] || "being worked on"}. ${input.stage === "ready" ? `You can pick it up anytime during business hours. Call ${BUSINESS.phone.display} if you have questions.` : "We'll keep you updated. Ref: " + (booking.referenceCode || "")}`,
          });

          if (booking.phone) {
            withRetry(
              // Wave-108: status update via shop gateway (transactional)
              () => sendSms(booking.phone, statusUpdateSms(booking.name, input.stage, booking.referenceCode || undefined), { via: "shop" }),
              { maxRetries: 3, baseDelayMs: 1000, label: "sendSms (status update)" }
            ).catch(err => {
              log.error("[SMS] Status update failed:", err);
              logIntegrationFailure({
                failureType: "sms",
                entityId: booking.id,
                entityType: "booking",
                errorMessage: err instanceof Error ? err.message : String(err),
                errorDetails: err,
              });
            });
          }

          // Unified event bus
          import("../services/eventBus").then(({ dispatch }) =>
            dispatch("stage_changed", {
              bookingId: booking.id,
              phone: booking.phone,
              stage: input.stage,
              refCode: booking.referenceCode || null,
            })
          ).catch(err => {
            log.error("[EventBus] Stage change dispatch failed:", err);
          });
        }
      }
      return result;
    }),

  statusByPhone: publicProcedure
    .input(z.object({ phone: z.string().min(7).max(20), ref: z.string().min(3).optional() }))
    .query(async ({ input }) => {
      const booking = await getBookingByPhone(input.phone);
      // If ref code provided, verify it matches — prevents phone-only enumeration
      if (input.ref && booking && (booking as any).referenceCode !== input.ref) {
        return null;
      }
      return booking;
    }),

  statusByRef: publicProcedure
    .input(z.object({ ref: z.string().min(3).max(20) }))
    .query(async ({ input }) => {
      return getBookingByRef(input.ref);
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      await d.delete(bookings).where(eq(bookings.id, input.id));
      logAdminAction({
        action: "booking.deleted",
        entityType: "booking",
        entityId: input.id,
        details: `Booking #${input.id} deleted`,
      }).catch(e => log.warn("[booking:delete] audit trail logging failed:", e));
      return { success: true };
    }),
});
