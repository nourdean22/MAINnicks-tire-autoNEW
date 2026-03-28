/**
 * Review Requests router — automated Google review SMS system.
 *
 * Features:
 * - Auto-schedule review request when booking is marked "completed"
 * - Configurable delay (default 2 hours after completion)
 * - Duplicate prevention (cooldown per phone number)
 * - Click tracking via redirect endpoint
 * - Backfill blast for past year's completed bookings
 * - Admin settings (enable/disable, delay, daily cap, template)
 * - Processing queue that sends pending requests
 */
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { SITE_URL } from "@shared/business";
import {
  createReviewRequest,
  getReviewRequests,
  getPendingReviewRequests,
  markReviewRequestSent,
  markReviewRequestFailed,
  markReviewRequestClicked,
  isPhoneOnReviewCooldown,
  getReviewRequestsSentToday,
  getReviewRequestStats,
  getReviewSettings,
  updateReviewSettings,
  getCompletedBookingsWithoutReview,
  getDb,
} from "../db";
import { bookings } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { sendSms } from "../sms";
import { z } from "zod";
import crypto from "crypto";

import { GBP_REVIEW_URL as GOOGLE_REVIEW_URL, STORE_NAME } from "@shared/const";

/**
 * Build the personalized review request SMS message.
 * Supports custom templates with {firstName}, {service}, {reviewUrl} placeholders.
 */
function buildReviewMessage(name: string, service: string | null, trackingUrl: string, customTemplate?: string | null): string {
  const firstName = name.split(" ")[0];
  const serviceName = service || "service";

  if (customTemplate) {
    return customTemplate
      .replace(/\{firstName\}/g, firstName)
      .replace(/\{service\}/g, serviceName)
      .replace(/\{reviewUrl\}/g, trackingUrl);
  }

  return `Hi ${firstName}, thanks for trusting us with your ${serviceName.toLowerCase()}! If you have 30 seconds, a Google review helps other Cleveland drivers find honest repair:\n\n${trackingUrl}\n\nThank you! — ${STORE_NAME}`;
}

/**
 * Schedule a review request for a completed booking.
 * Returns { scheduled: true } or { scheduled: false, reason: string }.
 */
export async function scheduleReviewRequest(bookingId: number, name: string, phone: string, service: string | null) {
  try {
    const settings = await getReviewSettings();

    // Check if system is enabled
    if (!settings.enabled) {
      return { scheduled: false, reason: "Review request system is disabled" };
    }

    // Normalize phone
    const digits = phone.replace(/\D/g, "");
    const normalizedPhone = digits.slice(-10);
    if (normalizedPhone.length !== 10) {
      return { scheduled: false, reason: "Invalid phone number" };
    }

    // Check cooldown
    const onCooldown = await isPhoneOnReviewCooldown(normalizedPhone, settings.cooldownDays);
    if (onCooldown) {
      return { scheduled: false, reason: `Phone on cooldown (${settings.cooldownDays} days)` };
    }

    // Calculate scheduled time
    const scheduledAt = new Date();
    scheduledAt.setMinutes(scheduledAt.getMinutes() + settings.delayMinutes);

    // Generate tracking token
    const trackingToken = crypto.randomBytes(24).toString("hex");

    await createReviewRequest({
      bookingId,
      customerName: name,
      phone: normalizedPhone,
      service,
      status: "pending",
      scheduledAt,
      trackingToken,
    });

    // Review request scheduled
    return { scheduled: true };
  } catch (error: any) {
    console.error("[ReviewRequest] Failed to schedule:", error.message);
    return { scheduled: false, reason: error.message };
  }
}

/**
 * Process pending review requests — called periodically.
 * Sends SMS for requests past their scheduled time.
 */
export async function processReviewRequestQueue() {
  const settings = await getReviewSettings();
  if (!settings.enabled) return { processed: 0, sent: 0, failed: 0 };

  const sentToday = await getReviewRequestsSentToday();
  if (sentToday >= settings.maxPerDay) {
    // Daily cap reached
    return { processed: 0, sent: 0, failed: 0, reason: "Daily cap reached" };
  }

  const pending = await getPendingReviewRequests();
  const remaining = settings.maxPerDay - sentToday;
  const batch = pending.slice(0, remaining);

  let sent = 0;
  let failed = 0;

  for (const req of batch) {
    // Check SMS opt-out before sending review request
    const db = await getDb();
    if (db) {
      const { customers: custTable } = await import("../../drizzle/schema");
      const { like } = await import("drizzle-orm");
      const [cust] = await db.select({ smsOptOut: custTable.smsOptOut })
        .from(custTable).where(like(custTable.phone, `%${req.phone}`)).limit(1);
      if (cust?.smsOptOut) {
        await markReviewRequestFailed(req.id, "Customer opted out of SMS");
        failed++;
        continue;
      }
    }

    // Build tracking URL — uses the public redirect endpoint
    const trackingUrl = `${SITE_URL}/api/review-click/${req.trackingToken}`;
    const message = buildReviewMessage(req.customerName, req.service, trackingUrl, settings.messageTemplate);

    const result = await sendSms(`+1${req.phone}`, message);

    if (result.success) {
      await markReviewRequestSent(req.id, result.sid);
      sent++;
      // Review request sent
    } else {
      await markReviewRequestFailed(req.id, result.error || "Unknown error");
      failed++;
      console.error(`[ReviewRequest] Failed for ${req.customerName}: ${result.error}`);
    }

    // Small delay between sends to avoid Twilio rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return { processed: batch.length, sent, failed };
}

// ─── tRPC ROUTER ─────────────────────────────────────

export const reviewRequestsRouter = router({
  /** Get all review requests (admin) */
  list: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(500).default(100) }).optional())
    .query(async ({ input }) => {
      return getReviewRequests(input?.limit ?? 100);
    }),

  /** Get review request stats (admin) */
  stats: adminProcedure.query(async () => {
    return getReviewRequestStats();
  }),

  /** Get review settings (admin) */
  getSettings: adminProcedure.query(async () => {
    return getReviewSettings();
  }),

  /** Update review settings (admin) */
  updateSettings: adminProcedure
    .input(z.object({
      enabled: z.number().min(0).max(1).optional(),
      delayMinutes: z.number().min(0).max(10080).optional(), // max 7 days
      maxPerDay: z.number().min(1).max(100).optional(),
      cooldownDays: z.number().min(1).max(365).optional(),
      messageTemplate: z.string().max(500).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      return updateReviewSettings(input);
    }),

  /** Manually trigger processing of pending review requests (admin) */
  processQueue: adminProcedure.mutation(async () => {
    return processReviewRequestQueue();
  }),

  /** Resend a failed review request (admin) */
  resend: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { reviewRequests: rr } = await import("../../drizzle/schema");
      const [req] = await db.select().from(rr).where(eq(rr.id, input.id)).limit(1);
      if (!req) throw new Error("Review request not found");

      // Generate new tracking token
      const newToken = crypto.randomBytes(24).toString("hex");
      await db.update(rr).set({ status: "pending", trackingToken: newToken, errorMessage: null, scheduledAt: new Date() })
        .where(eq(rr.id, input.id));

      return { success: true };
    }),

  /** Get completed bookings eligible for backfill (admin) */
  backfillPreview: adminProcedure.query(async () => {
    const eligible = await getCompletedBookingsWithoutReview();
    return { count: eligible.length, bookings: eligible.slice(0, 50) };
  }),

  /** Execute backfill — schedule review requests for all eligible past bookings (admin) */
  backfillExecute: adminProcedure.mutation(async () => {
    const eligible = await getCompletedBookingsWithoutReview();
    const settings = await getReviewSettings();

    let scheduled = 0;
    let skipped = 0;

    for (const booking of eligible) {
      const digits = booking.phone.replace(/\D/g, "");
      const normalizedPhone = digits.slice(-10);
      if (normalizedPhone.length !== 10) {
        skipped++;
        continue;
      }

      // Check cooldown
      const onCooldown = await isPhoneOnReviewCooldown(normalizedPhone, settings.cooldownDays);
      if (onCooldown) {
        skipped++;
        continue;
      }

      // Schedule with staggered times (spread over next few hours to avoid blast)
      const scheduledAt = new Date();
      scheduledAt.setMinutes(scheduledAt.getMinutes() + (scheduled * 2)); // 2 min apart

      const trackingToken = crypto.randomBytes(24).toString("hex");

      await createReviewRequest({
        bookingId: booking.id,
        customerName: booking.name,
        phone: normalizedPhone,
        service: booking.service,
        status: "pending",
        scheduledAt,
        trackingToken,
      });

      scheduled++;
    }

    // Backfill complete
    return { scheduled, skipped, total: eligible.length };
  }),

  /** Track click — public endpoint for redirect */
  trackClick: publicProcedure
    .input(z.object({ token: z.string().max(64) }))
    .mutation(async ({ input }) => {
      await markReviewRequestClicked(input.token);
      return { redirectUrl: GOOGLE_REVIEW_URL };
    }),
});
