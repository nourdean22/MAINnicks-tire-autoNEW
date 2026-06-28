/**
 * Automated Post-Service Follow-Up System
 * 
 * Runs on a schedule to:
 * 1. Send 24-hour thank-you messages for completed bookings
 * 2. Send 7-day review request messages for completed bookings
 * 3. Queue maintenance reminders based on service history
 * 
 * Uses the customerNotifications table for tracking.
 */
import { eq, and, lte } from "drizzle-orm";
import { bookings } from "../drizzle/schema";
import { createCustomerNotification, markNotificationSent } from "./db";
import { notifyOwner } from "./_core/notification";
import { sendSms, thankYouSms, reviewRequestSms } from "./sms";

import { createLogger } from "./lib/logger";

const log = createLogger("follow-ups");
async function getDb() {
  const { getDb: _getDb } = await import("./db");
  return _getDb();
}

// Short URL saves ~50 chars → keeps 7d review message at 2 segments instead of 3
const REVIEW_URL = "nickstire.org/review";

/**
 * Process 24-hour thank-you follow-ups for completed bookings
 */
export async function process24hFollowUps() {
  const db = await getDb();
  if (!db) return { processed: 0 };

  // Find completed bookings from ~24 hours ago that haven't had a 24h follow-up
  const cutoffEnd = new Date(Date.now() - 20 * 60 * 60 * 1000);   // 20h ago (buffer)

  const eligibleBookings = await db.select().from(bookings)
    .where(and(
      eq(bookings.status, "completed"),
      eq(bookings.followUp24hSent, 0),
      lte(bookings.updatedAt, cutoffEnd),
    ))
    .limit(20);

  let processed = 0;
  for (const booking of eligibleBookings) {
    // At-most-once claim — set followUp24hSent BEFORE any send. If the run
    // crashes after the text goes out, the booking is already marked, so
    // the next cron run won't re-text. Conditional WHERE makes overlapping
    // runs safe. Trade-off vs the old wave-181.65 retry-on-failure: a
    // failed send is no longer retried — an acceptable miss for a
    // thank-you, never a double-text.
    const claimRes = await db.update(bookings)
      .set({ followUp24hSent: 1 })
      .where(and(eq(bookings.id, booking.id), eq(bookings.followUp24hSent, 0)));
    if (((claimRes as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0) === 0) {
      continue; // already claimed by an overlapping run
    }

    const smsBody = thankYouSms(booking.name, booking.service);

    const notification = await createCustomerNotification({
      bookingId: booking.id,
      recipientName: booking.name,
      recipientPhone: booking.phone,
      recipientEmail: booking.email,
      notificationType: "follow_up",
      subject: `Thank you for visiting Nick's Tire & Auto`,
      message: smsBody,
    });

    if (booking.phone) {
      const { isEnabled } = await import("./services/featureFlags");
      if (await isEnabled("sms_review_requests")) {
        // wave-181.58 · route through F25e gateway (Twilio dead per operator).
        const smsResult = await sendSms(booking.phone, smsBody, { via: "shop" }).catch(() => ({ success: false }));
        if (smsResult.success && notification.id) {
          await markNotificationSent(notification.id).catch((e) => { log.warn("[follow-ups] fire-and-forget failed:", e); });
        }
      }
    }

    processed++;
  }

  return { processed };
}

/**
 * Process 7-day review request follow-ups
 */
export async function process7dReviewRequests() {
  const db = await getDb();
  if (!db) return { processed: 0 };

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const eligibleBookings = await db.select().from(bookings)
    .where(and(
      eq(bookings.status, "completed"),
      eq(bookings.followUp24hSent, 1),
      eq(bookings.followUp7dSent, 0),
      lte(bookings.updatedAt, cutoff),
    ))
    .limit(20);

  let processed = 0;
  for (const booking of eligibleBookings) {
    // At-most-once claim — set followUp7dSent BEFORE any send (see the
    // 24h thank-you above for rationale). Crash after the text = booking
    // already marked = no re-text on the next run.
    const claimRes = await db.update(bookings)
      .set({ followUp7dSent: 1 })
      .where(and(eq(bookings.id, booking.id), eq(bookings.followUp7dSent, 0)));
    if (((claimRes as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0) === 0) {
      continue; // already claimed by an overlapping run
    }

    const smsBody = reviewRequestSms(booking.name);

    const notification = await createCustomerNotification({
      bookingId: booking.id,
      recipientName: booking.name,
      recipientPhone: booking.phone,
      recipientEmail: booking.email,
      notificationType: "review_request",
      subject: `How was your experience at Nick's Tire & Auto?`,
      message: smsBody,
    });

    if (booking.phone) {
      const { isEnabled } = await import("./services/featureFlags");
      if (await isEnabled("sms_review_requests")) {
        // wave-181.58 · route through F25e gateway (Twilio dead per operator).
        const smsResult = await sendSms(booking.phone, smsBody, { via: "shop" }).catch(() => ({ success: false }));
        if (smsResult.success && notification.id) {
          await markNotificationSent(notification.id).catch((e) => { log.warn("[follow-ups] fire-and-forget failed:", e); });
        }
      }
    }

    processed++;
  }

  return { processed };
}

/**
 * Run all follow-up processes
 */
export async function runFollowUps() {
  try {
    const thankYou = await process24hFollowUps();
    const reviews = await process7dReviewRequests();

    const total = thankYou.processed + reviews.processed;
    if (total > 0) {
      await notifyOwner({
        title: `Follow-Up Report: ${total} messages queued`,
        content: `24h Thank-You: ${thankYou.processed} queued\n7-Day Review Request: ${reviews.processed} queued\n\nView pending messages in the admin dashboard under Customer Notifications.`,
      }).catch((e) => { log.warn("[follow-ups] fire-and-forget failed:", e); });
    }

    return { thankYou, reviews, total };
  } catch (error) {
    log.error("[Follow-Ups] Error:", error);
    return { thankYou: { processed: 0 }, reviews: { processed: 0 }, total: 0, error: String(error) };
  }
}
