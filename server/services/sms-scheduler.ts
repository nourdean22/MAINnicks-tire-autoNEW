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
  thankYouSms,
  reviewRequestSms,
  maintenanceReminderSms,
} from "../sms";

// Inline SMS template helpers (not exported from sms module)
function appointmentReminder24hSms(name: string, service: string, vehicle?: string, time?: string): string {
  const vehicleStr = vehicle ? ` for your ${vehicle}` : "";
  const timeStr = time ? ` at ${time}` : "";
  return `Hi ${name}, reminder: your appointment${vehicleStr} at Nick's Tire & Auto is tomorrow${timeStr}. Call (216) 862-0005 to reschedule.`;
}

function appointmentReminder1hSms(name: string, vehicle?: string): string {
  const vehicleStr = vehicle ? ` for your ${vehicle}` : "";
  return `Hi ${name}, your appointment${vehicleStr} at Nick's Tire & Auto is in about 1 hour. See you soon!`;
}

/**
 * Convert an Eastern Time hour to UTC hour for a given date.
 * Railway runs UTC — we must offset scheduled times so customers
 * receive texts at the intended Eastern Time, not UTC.
 */
function etHourToUtcHour(date: Date, etHour: number): number {
  // Find the ET offset (4 or 5 hours) for the given date using Intl
  const utcParts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", hour12: false }).formatToParts(date);
  const etParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).formatToParts(date);
  const utcH = parseInt(utcParts.find(p => p.type === "hour")?.value || "0");
  const etH = parseInt(etParts.find(p => p.type === "hour")?.value || "0");
  let offset = utcH - etH;
  if (offset < 0) offset += 24;
  return etHour + offset;
}

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
    // Convert ET business hours to UTC — Railway runs UTC
    const reminder1h = new Date(apptDate);
    const etHour = preferredTime === "morning" ? 8 : preferredTime === "afternoon" ? 13 : 9;
    reminder1h.setUTCHours(etHourToUtcHour(reminder1h, etHour), 0, 0, 0);
    reminder1h.setHours(reminder1h.getHours() - 1);
    if (reminder1h > new Date()) {
      reminders.push({ type: "1h-before", scheduledFor: reminder1h });
    }
  }

  // Insert all reminders with their scheduled time
  for (const r of reminders) {
    await db.insert(appointmentReminders).values({
      bookingId,
      type: r.type,
      scheduledFor: r.scheduledFor,
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

  // 3-day review request — send at 10 AM Eastern
  const reviewTime = new Date();
  reviewTime.setDate(reviewTime.getDate() + 3);
  reviewTime.setUTCHours(etHourToUtcHour(reviewTime, 10), 0, 0, 0);

  // 6-month maintenance reminder — send at 10 AM Eastern
  const maintenanceTime = new Date();
  maintenanceTime.setMonth(maintenanceTime.getMonth() + 6);
  maintenanceTime.setUTCHours(etHourToUtcHour(maintenanceTime, 10), 0, 0, 0);

  const reminders = [
    { type: "thank-you", scheduledFor: thankYouTime },
    { type: "review-request", scheduledFor: reviewTime },
    { type: "maintenance-reminder", scheduledFor: maintenanceTime },
  ];

  for (const r of reminders) {
    await db.insert(appointmentReminders).values({
      bookingId,
      type: r.type,
      scheduledFor: r.scheduledFor,
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

  // Atomically claim pending reminders by marking them "processing" first.
  // This prevents duplicate SMS if two scheduler runs overlap.
  await db.update(appointmentReminders)
    .set({ status: "processing" })
    .where(
      and(
        eq(appointmentReminders.status, "pending"),
        isNull(appointmentReminders.sentAt),
        lte(appointmentReminders.scheduledFor, now)
      )
    );

  const dueReminders = await db
    .select()
    .from(appointmentReminders)
    .where(eq(appointmentReminders.status, "processing"))
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

    // Respect SMS opt-out (skip marketing messages, allow transactional)
    const isMarketing = ["review-request", "maintenance-reminder"].includes(reminder.type);
    if (isMarketing) {
      const { customers } = await import("../../drizzle/schema");
      const { like } = await import("drizzle-orm");
      const normalized = booking.phone.replace(/\D/g, "").slice(-10);
      const [cust] = await db.select({ smsOptOut: customers.smsOptOut })
        .from(customers).where(like(customers.phone, `%${normalized}`)).limit(1);
      if (cust?.smsOptOut) {
        await db.update(appointmentReminders)
          .set({ status: "cancelled" })
          .where(eq(appointmentReminders.id, reminder.id));
        continue;
      }
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

    // Check feature flags for each reminder type
    const { isEnabled } = await import("./featureFlags");
    if ((reminder.type === "24h-before" || reminder.type === "1h-before") && !(await isEnabled("sms_appointment_reminders"))) {
      continue; // Skip — flag disabled
    }
    if (reminder.type === "review-request" && !(await isEnabled("sms_review_requests"))) {
      continue;
    }
    if (reminder.type === "maintenance-reminder" && !(await isEnabled("predictive_maintenance_alerts"))) {
      continue;
    }

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
