/**
 * Admin router — dashboard stats, analytics, weekly reports, follow-ups.
 */
import { adminProcedure, publicProcedure, router } from "../../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { desc } from "drizzle-orm";
import { callEvents } from "../../../drizzle/schema";

import { db } from "../../lib/db-helper";
import { BoundedTtlMap } from "../../lib/boundedTtlMap";

import { createLogger } from "../../lib/logger";

const log = createLogger("routers:admin");

// ─── CALL REVIEW REQUEST (auto-SMS after call CTA) ────
/**
 * Schedule a review request SMS 2 hours after someone clicks a Call CTA.
 * Uses the existing review request infrastructure (createReviewRequest + processQueue cron).
 * Gated behind the `sms_review_requests` feature flag.
 */
async function scheduleCallReviewRequest(phoneNumber: string): Promise<void> {
  const { isEnabled } = await import("../../services/featureFlags");
  if (!(await isEnabled("sms_review_requests"))) return;

  const { isPhoneOnReviewCooldown, createReviewRequest, getReviewSettings } = await import("../../db");
  const crypto = await import("crypto");

  const digits = phoneNumber.replace(/\D/g, "");
  const normalizedPhone = digits.slice(-10);
  if (normalizedPhone.length !== 10) return;

  const settings = await getReviewSettings();
  if (!settings.enabled) return;

  // Check cooldown — don't spam people who already got a review request
  const onCooldown = await isPhoneOnReviewCooldown(normalizedPhone, settings.cooldownDays);
  if (onCooldown) return;

  // Schedule 2 hours from now
  const scheduledAt = new Date();
  scheduledAt.setMinutes(scheduledAt.getMinutes() + 120);

  const trackingToken = crypto.randomBytes(24).toString("hex");

  await createReviewRequest({
    bookingId: 0, // no booking — triggered by call CTA
    customerName: "Caller",
    phone: normalizedPhone,
    service: "Phone Inquiry",
    status: "pending",
    scheduledAt,
    trackingToken,
  });

  // wave-165: redact phone PII in Railway stdout. console.info bypasses
  // the createLogger redaction layer, so full customer phones were
  // landing in retained dyno logs visible to anyone with project access.
  const phoneTail = normalizedPhone.slice(-4);
  console.info(`[calltracking:review] Scheduled for phone ending ***${phoneTail} at ${scheduledAt.toISOString()}`);
}

// ─── CALL TRACKING ─────────────────────────────────────

// wave-141b — IP rate limit on logCall (15 events/min/IP). The procedure
// is publicProcedure because legit phone-click tracking fires from the
// public site, but the SMS-scheduling side-effect (scheduleCallReviewRequest)
// made it an SMS-spam vector — any actor could POST arbitrary phone
// numbers + trigger review-request SMS to them. Combined with the
// per-phone cooldown already inside scheduleCallReviewRequest, this
// prevents both burst-spray attacks and same-target floods.
const logCallIpLimit = new BoundedTtlMap<number>({ ttlMs: 60_000, maxEntries: 10_000 });
const LOG_CALL_MAX_PER_MIN = 15;

export const callTrackingRouter = router({
  /** Log a phone click event from the frontend */
  logCall: publicProcedure
    // NULLISH fields — frontend sends `null` when UTM is absent.
    // Previous `.optional()` only allowed missing keys, not `null` values,
    // which made the whole payload fail validation and meant we had
    // ZERO rows in call_events despite active phone-click instrumentation.
    .input(z.object({
      phoneNumber: z.string().max(20),
      sourcePage: z.string().max(500).nullish(),
      clickElement: z.string().max(200).nullish(),
      utmSource: z.string().max(100).nullish(),
      utmMedium: z.string().max(100).nullish(),
      utmCampaign: z.string().max(255).nullish(),
      landingPage: z.string().max(500).nullish(),
      referrer: z.string().max(500).nullish(),
      userAgent: z.string().max(500).nullish(),
      // journey-join migration 0068 — localStorage visitor id + the Meta
      // pixel event_id the client's Contact event fired with.
      sessionId: z.string().max(64).nullish(),
      eventId: z.string().max(64).nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      // wave-141b — per-IP rate limit guards the SMS side-effect.
      const ip = ctx.req?.ip || ctx.req?.socket?.remoteAddress || "unknown";
      const count = (logCallIpLimit.get(ip) ?? 0) + 1;
      logCallIpLimit.set(ip, count);
      if (count > LOG_CALL_MAX_PER_MIN) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many call-tracking events from this client" });
      }

      const d = await db();
      if (!d) return { success: false };
      try {
        await d.insert(callEvents).values({
          phoneNumber: input.phoneNumber,
          sourcePage: input.sourcePage || null,
          clickElement: input.clickElement || null,
          utmSource: input.utmSource || null,
          utmMedium: input.utmMedium || null,
          utmCampaign: input.utmCampaign || null,
          landingPage: input.landingPage || null,
          referrer: input.referrer || null,
          userAgent: input.userAgent || null,
          sessionId: input.sessionId || null,
          eventId: input.eventId || null,
        });

        // Schedule review request SMS 2 hours after call CTA click
        // Gated behind sms_review_requests feature flag
        scheduleCallReviewRequest(input.phoneNumber).catch((err) => {
          log.error("[CallTracking] Review request scheduling failed:", err);
        });

        return { success: true };
      } catch (err) {
        log.error("[CallTracking] Error logging call:", err);
        return { success: false };
      }
    }),

  /** Get all call events (admin) */
  list: adminProcedure
    .input(z.object({ limit: z.number().default(100) }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return [];
      return d.select().from(callEvents)
        .orderBy(desc(callEvents.createdAt))
        .limit(input?.limit ?? 100);
    }),
});
