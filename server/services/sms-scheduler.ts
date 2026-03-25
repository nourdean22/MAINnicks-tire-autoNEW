/**
 * SMS Scheduler — Queues post-booking SMS lifecycle messages
 *
 * On booking creation: schedules confirmation, 24h reminder, 1h reminder
 * On booking completion: schedules thank-you, 3-day review request, 6-month maintenance
 * On booking cancellation: cancels all pending scheduled messages
 *
 * The processScheduledSms() function runs on a 5-minute interval to send due messages.
 */

import { eq, and, lte, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { appointmentReminders, bookings } from "../../drizzle/schema";
import {
  sendSms,
  appointmentReminder24hSms,
  appointmentReminder1hSms,
  serviceCompleteSms,
  thankYouSms,
  reviewRequestSms,
  maintenanceReminderSms,
} from "../sms";

// ─── SCHEDULE ON BOOKING CREATION ───────────────────────
export async function scheduleBookingReminders(
  bookingId: number,
  phone: string,
  name: string,
  service: string,
  preferredDate?: string,
  preferredTime?: string,
  vehicle?: string
) {
  const db = await getDb();
  if (!db) return;

  const reminders: { type: string; scheduledFor: Date }[] = [];

  // Parse preferred date/time to schedule reminders
  if (preferredDate) {
    const apptDate = new Date(preferredDate);

    // 24 hours before
    const reminder24h = new Date(apptDate);
    reminder24h.setHours(reminder24h.getHours() - 24);
    if (reminder24h > new Date()) {
      reminders.push({ type: "24h-before", scheduledFor: reminder24h });
    }

    // 1 hour before (assume morning appointment if no time specified)
    const reminder1h = new Date(apptDate);
    if (preferredTime === "morning") reminder1h.setHours(8, 0);
    else if (preferredTime === "afternoon") reminder1h.setHours(13, 0);
    else reminder1h.setHours(9, 0);
    reminder1h.setHours(reminder1h.getHours() - 1);
    if (reminder1h > new Date()) {
      reminders.push({ type: "1h-before", scheduledFor: reminder1h });
    }
  }

  // Insert all reminders
  for (const r of reminders) {
    await db.insert(appointmentReminders).values({
      bookingId,
      type: r.type,
      status: "pending",
    });
  }
}

// ─── SCHEDULE ON BOOKING COMPLETION ─────────────────────
export async function schedulePostServiceReminders(
  bookingId: number,
  phone: string,
  name: string,
  service: string,
  vehicle?: string
) {
  const db = await getDb();
  if (!db) return;

  // Same-day thank you (2 hours after completion)
  const thankYouTime = new Date();
  thankYouTime.setHours(thankYouTime.getHours() + 2);

  // 3-day review request
  const reviewTime = new Date();
  reviewTime.setDate(reviewTime.getDate() + 3);
  reviewTime.setHours(10, 0, 0, 0); // Send at 10am

  // 6-month maintenance reminder
  const maintenanceTime = new Date();
  maintenanceTime.setMonth(maintenanceTime.getMonth() + 6);
  maintenanceTime.setHours(10, 0, 0, 0);

  const reminders = [
    { type: "thank-you", scheduledFor: thankYouTime },
    { type: "review-request", scheduledFor: reviewTime },
    { type: "maintenance-reminder", scheduledFor: maintenanceTime },
  ];

  for (const r of reminders) {
    await db.insert(appointmentReminders).values({
      bookingId,
      type: r.type,
      status: "pending",
    });
  }
}

// ─── CANCEL ON BOOKING CANCELLATION ─────────────────────
export async function cancelBookingReminders(bookingId: number) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(appointmentReminders)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(appointmentReminders.bookingId, bookingId),
        eq(appointmentReminders.status, "pending")
      )
    );
}

// ─── PROCESS QUEUE (runs every 5 minutes) ───────────────
export async function processScheduledSms() {
  const db = await getDb();
  if (!db) return { sent: 0, failed: 0 };

  const now = new Date();
  let sent = 0;
  let failed = 0;

  // Get all pending reminders that are due
  const dueReminders = await db
    .select()
    .from(appointmentReminders)
    .where(
      and(
        eq(appointmentReminders.status, "pending"),
        isNull(appointmentReminders.sentAt)
      )
    )
    .limit(50);

  for (const reminder of dueReminders) {
    // Get the associated booking
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, reminder.bookingId))
      .limit(1);

    if (!booking || !booking.phone) {
      await db.update(appointmentReminders)
        .set({ status: "cancelled" })
        .where(eq(appointmentReminders.id, reminder.id));
      continue;
    }

    // Skip if booking was cancelled
    if (booking.status === "cancelled") {
      await db.update(appointmentReminders)
        .set({ status: "cancelled" })
        .where(eq(appointmentReminders.id, reminder.id));
      continue;
    }

    const vehicle = [booking.vehicleYear, booking.vehicleMake, booking.vehicleModel]
      .filter(Boolean)
      .join(" ");

    // Generate message based on type
    let message: string;
    switch (reminder.type) {
      case "24h-before":
        message = appointmentReminder24hSms(booking.name, booking.service, vehicle || undefined, booking.preferredTime || undefined);
        break;
      case "1h-before":
        message = appointmentReminder1hSms(booking.name, vehicle || undefined);
        break;
      case "thank-you":
        message = thankYouSms(booking.name, booking.service);
        break;
      case "review-request":
        message = reviewRequestSms(booking.name);
        break;
      case "maintenance-reminder":
        message = maintenanceReminderSms(booking.name, booking.service);
        break;
      default:
        message = `Hi ${booking.name.split(" ")[0]}, reminder from Nick's Tire & Auto about your ${booking.service}. Call (216) 862-0005.`;
    }

    const result = await sendSms(booking.phone, message);

    if (result.success) {
      await db.update(appointmentReminders)
        .set({ status: "sent", sentAt: now, smsSid: result.sid || null })
        .where(eq(appointmentReminders.id, reminder.id));
      sent++;
    } else {
      await db.update(appointmentReminders)
        .set({ status: "failed" })
        .where(eq(appointmentReminders.id, reminder.id));
      failed++;
    }
  }

  if (sent > 0 || failed > 0) {
    console.log(`[SMS Scheduler] Processed: ${sent} sent, ${failed} failed`);
  }

  return { sent, failed };
}

// ─── START SCHEDULER (call from server startup) ─────────
let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startSmsScheduler() {
  if (schedulerInterval) return;

  // Process every 5 minutes
  schedulerInterval = setInterval(() => {
    processScheduledSms().catch((err) => {
      console.error("[SMS Scheduler] Error:", err);
    });
  }, 5 * 60 * 1000);

  // Also run immediately on startup
  processScheduledSms().catch((err) => {
    console.error("[SMS Scheduler] Initial run error:", err);
  });

  console.log("[SMS Scheduler] Started (5-minute interval)");
}

export function stopSmsScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
