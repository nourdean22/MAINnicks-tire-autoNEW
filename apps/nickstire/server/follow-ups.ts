/**
 * Automated Post-Service Follow-Up System
 *
 * Runs from the admin "RUN FOLLOW-UPS" button (routers/admin/followUps.ts —
 * it is NOT on a cron) to:
 * 1. Send 24-hour thank-you messages for completed bookings
 * 2. Send 7-day review request messages for completed bookings
 *
 * Uses the customerNotifications table for tracking.
 *
 * 2026-09-01 · receipts now come from OUTCOMES, not intent (audit F-1). The
 * previous version claimed every eligible booking (followUp24hSent = 1) and
 * incremented `processed` whether or not a text went out — with the
 * sms_review_requests flag OFF, every press permanently consumed up to 20
 * customers, sent nothing, and toasted "Processed 20 follow-ups" in green.
 * Now: the flag is checked BEFORE any claim (flag off = nothing touched), the
 * counters are sent / queued / failed / skipped, and a notification that
 * never went out is marked `failed` instead of sitting `pending` forever.
 */
import { eq, and, lte } from "drizzle-orm";
import { bookings } from "../drizzle/schema";
import { createCustomerNotification, markNotificationSent, markNotificationFailed } from "./db";
import { notifyOwner } from "./_core/notification";
import { sendSms, thankYouSms, reviewRequestSms } from "./sms";
import { smsOutcome } from "./lib/smsOutcome";

import { createLogger } from "./lib/logger";

const log = createLogger("follow-ups");
async function getDb() {
  const { getDb: _getDb } = await import("./db");
  return _getDb();
}

/** Honest per-lane receipt. `sent` is texts the gateway accepted NOW. */
export interface FollowUpLaneResult {
  sent: number;
  queued: number;
  failed: number;
  skipped: number;
  /** Set only when the whole lane was skipped without touching any booking. */
  skipReason?: string;
}

const EMPTY: FollowUpLaneResult = { sent: 0, queued: 0, failed: 0, skipped: 0 };

async function smsReviewRequestsEnabled(): Promise<boolean> {
  const { isEnabled } = await import("./services/featureFlags");
  return isEnabled("sms_review_requests");
}

type EligibleBooking = typeof bookings.$inferSelect;

/**
 * Shared send-and-record step. The booking is already claimed by the caller.
 * Returns the outcome so the caller can count it; never throws.
 */
async function sendAndRecord(
  booking: EligibleBooking,
  smsBody: string,
  notificationType: "follow_up" | "review_request",
  subject: string,
  counts: FollowUpLaneResult,
): Promise<void> {
  const notification = await createCustomerNotification({
    bookingId: booking.id,
    recipientName: booking.name,
    recipientPhone: booking.phone,
    recipientEmail: booking.email,
    notificationType,
    subject,
    message: smsBody,
  });

  if (!booking.phone) {
    // Nothing to text. The claim stays (there will never be a phone to retry
    // with) but the receipt says so instead of "sent".
    counts.skipped++;
    if (notification.id) await markNotificationFailed(notification.id).catch((e) => log.warn("[follow-ups] mark failed:", e));
    return;
  }

  // wave-181.58 · route through F25e gateway (Twilio dead per operator).
  const smsResult = await sendSms(booking.phone, smsBody, { via: "shop" }).catch(() => ({ success: false }));
  const outcome = smsOutcome(smsResult);
  if (outcome === "sent") {
    counts.sent++;
    if (notification.id) await markNotificationSent(notification.id).catch((e) => log.warn("[follow-ups] fire-and-forget failed:", e));
  } else if (outcome === "queued") {
    // Parked for the 8 AM window by the durable queue: it WILL go out, so the
    // claim is correct, but it has not been sent yet — leave the notification
    // pending and count it as queued.
    counts.queued++;
  } else {
    // Failed or uncertain. The claim is kept on purpose (documented at-most-once
    // trade-off: an acceptable miss for a thank-you, never a double-text) — but
    // the receipt must say failed, not sent.
    counts.failed++;
    if (notification.id) await markNotificationFailed(notification.id).catch((e) => log.warn("[follow-ups] mark failed:", e));
  }
}

/**
 * Process 24-hour thank-you follow-ups for completed bookings
 */
export async function process24hFollowUps(): Promise<FollowUpLaneResult> {
  const db = await getDb();
  if (!db) return { ...EMPTY, skipReason: "no db" };

  // Find completed bookings from ~24 hours ago that haven't had a 24h follow-up
  const cutoffEnd = new Date(Date.now() - 20 * 60 * 60 * 1000);   // 20h ago (buffer)

  const eligibleBookings = await db.select().from(bookings)
    .where(and(
      eq(bookings.status, "completed"),
      eq(bookings.followUp24hSent, 0),
      lte(bookings.updatedAt, cutoffEnd),
    ))
    .limit(20);

  // Flag check BEFORE any claim. With the flag off nothing is texted, so
  // nothing may be consumed — the old order (claim, then check) burned bookings.
  if (!(await smsReviewRequestsEnabled())) {
    return {
      ...EMPTY,
      skipped: eligibleBookings.length,
      skipReason: `sms_review_requests is off — ${eligibleBookings.length} eligible booking(s) left unclaimed, nothing sent`,
    };
  }

  const counts: FollowUpLaneResult = { ...EMPTY };
  for (const booking of eligibleBookings) {
    // At-most-once claim — set followUp24hSent BEFORE any send. If the run
    // crashes after the text goes out, the booking is already marked, so
    // the next run won't re-text. Conditional WHERE makes overlapping runs safe.
    const claimRes = await db.update(bookings)
      .set({ followUp24hSent: 1 })
      .where(and(eq(bookings.id, booking.id), eq(bookings.followUp24hSent, 0)));
    if (((claimRes as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0) === 0) {
      continue; // already claimed by an overlapping run
    }

    await sendAndRecord(
      booking,
      thankYouSms(booking.name, booking.service),
      "follow_up",
      `Thank you for visiting Nick's Tire & Auto`,
      counts,
    );
  }

  return counts;
}

/**
 * Process 7-day review request follow-ups
 */
export async function process7dReviewRequests(): Promise<FollowUpLaneResult> {
  const db = await getDb();
  if (!db) return { ...EMPTY, skipReason: "no db" };

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const eligibleBookings = await db.select().from(bookings)
    .where(and(
      eq(bookings.status, "completed"),
      eq(bookings.followUp24hSent, 1),
      eq(bookings.followUp7dSent, 0),
      lte(bookings.updatedAt, cutoff),
    ))
    .limit(20);

  if (!(await smsReviewRequestsEnabled())) {
    return {
      ...EMPTY,
      skipped: eligibleBookings.length,
      skipReason: `sms_review_requests is off — ${eligibleBookings.length} eligible booking(s) left unclaimed, nothing sent`,
    };
  }

  const counts: FollowUpLaneResult = { ...EMPTY };
  for (const booking of eligibleBookings) {
    // At-most-once claim — set followUp7dSent BEFORE any send (see the 24h
    // thank-you above for rationale).
    const claimRes = await db.update(bookings)
      .set({ followUp7dSent: 1 })
      .where(and(eq(bookings.id, booking.id), eq(bookings.followUp7dSent, 0)));
    if (((claimRes as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0) === 0) {
      continue; // already claimed by an overlapping run
    }

    await sendAndRecord(
      booking,
      reviewRequestSms(booking.name),
      "review_request",
      `How was your experience at Nick's Tire & Auto?`,
      counts,
    );
  }

  return counts;
}

export interface FollowUpRunResult {
  thankYou: FollowUpLaneResult;
  reviews: FollowUpLaneResult;
  /** Texts the gateway accepted now, across both lanes. */
  sent: number;
  queued: number;
  failed: number;
  skipped: number;
  /** Kept for the existing client contract: equals `sent`. */
  total: number;
  skipReason?: string;
  error?: string;
}

/**
 * Run all follow-up processes
 */
export async function runFollowUps(): Promise<FollowUpRunResult> {
  try {
    const thankYou = await process24hFollowUps();
    const reviews = await process7dReviewRequests();

    const sent = thankYou.sent + reviews.sent;
    const queued = thankYou.queued + reviews.queued;
    const failed = thankYou.failed + reviews.failed;
    const skipped = thankYou.skipped + reviews.skipped;
    const skipReason = thankYou.skipReason ?? reviews.skipReason;

    if (sent + queued + failed > 0) {
      const title = `Follow-Up Report: ${sent} sent · ${queued} queued · ${failed} failed`;
      const content =
        `24h Thank-You: ${thankYou.sent} sent, ${thankYou.queued} queued, ${thankYou.failed} failed, ${thankYou.skipped} skipped\n` +
        `7-Day Review Request: ${reviews.sent} sent, ${reviews.queued} queued, ${reviews.failed} failed, ${reviews.skipped} skipped\n\n` +
        `Review in the admin under Outreach → Follow-Ups.`;
      // notifyOwner is email to CEO_EMAIL, which may be unset (it logs and
      // skips). Telegram is the channel that demonstrably reaches the owner
      // (weekly digest), so the report goes there too. Both fire-and-forget.
      await notifyOwner({ title, content }).catch((e) => { log.warn("[follow-ups] fire-and-forget failed:", e); });
      import("./services/telegram")
        .then(({ sendTelegram }) => sendTelegram(`📨 ${title}\n${content}`))
        .catch((e) => { log.warn("[follow-ups] telegram report failed:", e); });
    }

    return { thankYou, reviews, sent, queued, failed, skipped, total: sent, skipReason };
  } catch (error) {
    log.error("[Follow-Ups] Error:", error);
    return { thankYou: { ...EMPTY }, reviews: { ...EMPTY }, sent: 0, queued: 0, failed: 0, skipped: 0, total: 0, error: String(error) };
  }
}
