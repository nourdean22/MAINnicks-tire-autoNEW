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
import { eq, and, lte, like } from "drizzle-orm";
import { bookings, customers } from "../drizzle/schema";
import { createCustomerNotification, markNotificationSent } from "./db";
import { notifyOwner } from "./_core/notification";
import { sendSms, thankYouSms, reviewRequestSms } from "./sms";

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
    const firstName = booking.name.split(" ")[0];
    const message = `Hi ${firstName}, thank you for choosing Nick's Tire & Auto for your ${booking.service.toLowerCase()}. We appreciate your business and hope everything is running smoothly. If you have any questions about the work we did, don't hesitate to call us at (216) 862-0005. — Nick's Tire & Auto`;

    const notification = await createCustomerNotification({
      bookingId: booking.id,
      recipientName: booking.name,
      recipientPhone: booking.phone,
      recipientEmail: booking.email,
      notificationType: "follow_up",
      subject: `Thank you for visiting Nick's Tire & Auto`,
      message,
    });

    // Send SMS thank-you (check opt-out first)
    if (booking.phone) {
      const normalized = booking.phone.replace(/\D/g, "").slice(-10);
      const [cust] = await db.select({ smsOptOut: customers.smsOptOut })
        .from(customers).where(like(customers.phone, `%${normalized}`)).limit(1);
      if (cust?.smsOptOut) {
        await db.update(bookings).set({ followUp24hSent: 1 }).where(eq(bookings.id, booking.id));
        processed++;
        continue;
      }
      const smsResult = await sendSms(booking.phone, thankYouSms(booking.name, booking.service)).catch(err => { console.error("[FollowUp] Thank-you SMS failed:", err); return { success: false }; });
      if (smsResult.success && notification.id) {
        await markNotificationSent(notification.id).catch(err => console.error("[FollowUp] Mark sent failed:", err));
      }
    }

    await db.update(bookings).set({ followUp24hSent: 1 }).where(eq(bookings.id, booking.id));
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
    const firstName = booking.name.split(" ")[0];
    const message = `Hi ${firstName}, it's been about a week since your visit to Nick's Tire & Auto. We hope your ${booking.service.toLowerCase()} is holding up great. If you have a moment, a Google review helps other Cleveland drivers find honest repair:\n${REVIEW_URL}\n\nThank you for your trust. — Nick's Team`;

    const notification = await createCustomerNotification({
      bookingId: booking.id,
      recipientName: booking.name,
      recipientPhone: booking.phone,
      recipientEmail: booking.email,
      notificationType: "review_request",
      subject: `How was your experience at Nick's Tire & Auto?`,
      message,
    });

    // Send SMS review request (check opt-out first)
    if (booking.phone) {
      const normalized = booking.phone.replace(/\D/g, "").slice(-10);
      const [cust] = await db.select({ smsOptOut: customers.smsOptOut })
        .from(customers).where(like(customers.phone, `%${normalized}`)).limit(1);
      if (cust?.smsOptOut) {
        await db.update(bookings).set({ followUp7dSent: 1 }).where(eq(bookings.id, booking.id));
        processed++;
        continue;
      }
      const smsResult = await sendSms(booking.phone, reviewRequestSms(booking.name)).catch(err => { console.error("[FollowUp] Review SMS failed:", err); return { success: false }; });
      if (smsResult.success && notification.id) {
        await markNotificationSent(notification.id).catch(err => console.error("[FollowUp] Mark sent failed:", err));
      }
    }

    await db.update(bookings).set({ followUp7dSent: 1 }).where(eq(bookings.id, booking.id));
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
      }).catch(err => console.error("[FollowUp] Owner notification failed:", err));
    }

    return { thankYou, reviews, total };
  } catch (error) {
    console.error("[Follow-Ups] Error:", error);
    return { thankYou: { processed: 0 }, reviews: { processed: 0 }, total: 0, error: String(error) };
  }
}
