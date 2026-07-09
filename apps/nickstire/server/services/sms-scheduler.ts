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
  isShopGatewayReachable,
  appointmentReminder24hSms,
  appointmentReminder1hSms,
  thankYouSms,
  reviewRequestSms,
  maintenanceReminderSms,
  bookingConfirmationRequestSms,
} from "../sms";

import { BUSINESS } from "@shared/business";
import { createLogger } from "../lib/logger";

const log = createLogger("services:sms-scheduler");
/**
 * Convert an Eastern Time hour to UTC hour for a given date.
 * Railway runs UTC — we must offset scheduled times so customers
 * receive texts at the intended Eastern Time, not UTC.
 */
function etHourToUtcHour(date: Date, etHour: number): number {
  // Find the ET offset (4 or 5 hours) for the given date using Intl
  const utcParts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", hour12: false }).formatToParts(date);
  const etParts = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false }).formatToParts(date);
  const utcH = parseInt(utcParts.find(p => p.type === "hour")?.value || "0", 10);
  const etH = parseInt(etParts.find(p => p.type === "hour")?.value || "0", 10);
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

  // Schedule confirmation request SMS: 2 hours after booking creation
  // Only if the appointment is >4 hours away (otherwise too late to confirm)
  const confirmationTime = new Date();
  confirmationTime.setHours(confirmationTime.getHours() + 2);

  if (preferredDate) {
    const apptDate = new Date(preferredDate);
    const hoursUntilAppt = (apptDate.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntilAppt > 4) {
      reminders.push({ type: "confirmation-request", scheduledFor: confirmationTime });
    }
  } else {
    // No preferred date — always send confirmation request (drop-off shop model)
    reminders.push({ type: "confirmation-request", scheduledFor: confirmationTime });
  }

  // Parse preferred date/time to schedule reminders
  if (preferredDate) {
    const apptDate = new Date(preferredDate);

    // forensic-audit HIGH · apptDate = new Date('YYYY-MM-DD') is UTC
    // midnight; the old `setHours(getHours()-24)` read server-local time
    // and landed ~28-38h early (evening two days out) while the template
    // says "expecting you tomorrow". Fire the EVENING BEFORE at 6pm ET so
    // "tomorrow" is accurate, using the same ET→UTC conversion as the 1h
    // path below.
    const reminder24h = new Date(apptDate);
    reminder24h.setUTCDate(reminder24h.getUTCDate() - 1);
    reminder24h.setUTCHours(etHourToUtcHour(reminder24h, 18), 0, 0, 0);
    if (reminder24h > new Date()) {
      reminders.push({ type: "24h-before", scheduledFor: reminder24h });
    }

    // 1 hour before (assume morning appointment if no time specified)
    // Convert ET business hours to UTC — Railway runs UTC. The "-1" for
    // the one-hour-prior offset is folded into setUTCHours so the whole
    // calculation stays in UTC; the prior setHours/getHours follow-up
    // read local time (correct on UTC Railway, but confusing to read).
    const reminder1h = new Date(apptDate);
    const etHour = preferredTime === "morning" ? 8 : preferredTime === "afternoon" ? 13 : 9;
    reminder1h.setUTCHours(etHourToUtcHour(reminder1h, etHour) - 1, 0, 0, 0);
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

  // Wave BH · 2026-05-29 · gateway-offline gate. If the F25e cloud is
  // offline, skip the WHOLE drain — claim nothing, mark nothing. Pending
  // reminders stay pending and deliver exactly once when the cloud is
  // back (the atomic pending->sent claim below guarantees once). Pre-this,
  // a gateway-down run claimed each row 'sent' then marked it 'failed' on
  // the failed send = customer never got the reminder (lost). Holding
  // beats losing. Operator: "wait till the cloud comes back online."
  if (!(await isShopGatewayReachable())) {
    console.info("[sms-scheduler] gateway offline — holding pending reminders (no claim)");
    return { sent: 0, failed: 0 };
  }

  const now = new Date();
  let sent = 0;
  let failed = 0;

  // Recovery sweep — reclaim reminders orphaned in "processing". A row is
  // only meant to sit in "processing" for the duration of one
  // processScheduledSms() pass. Anything still "processing" with sentAt
  // NULL and a scheduledFor >45min in the past was abandoned by a crashed
  // run — or over-claimed (the claim UPDATE below is unbounded but the
  // SELECT is capped at 50, so a >50-row backlog strands the overflow).
  // Flip those back to "pending" so a later run re-claims them; without
  // this they strand forever and the customer never gets the reminder.
  // 45min is comfortably longer than any single pass (<=50 sequential
  // sends) so a live run is never reclaimed out from under itself.
  const stuckCutoff = new Date(now.getTime() - 45 * 60 * 1000);
  await db.update(appointmentReminders)
    .set({ status: "pending" })
    .where(
      and(
        eq(appointmentReminders.status, "processing"),
        isNull(appointmentReminders.sentAt),
        lte(appointmentReminders.scheduledFor, stuckCutoff)
      )
    );

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

    // Check feature flags for each reminder type — mark as skipped so they don't stay "processing" forever
    const { isEnabled } = await import("./featureFlags");
    if ((reminder.type === "24h-before" || reminder.type === "1h-before" || reminder.type === "confirmation-request") && !(await isEnabled("sms_appointment_reminders"))) {
      await db.update(appointmentReminders).set({ status: "skipped" }).where(eq(appointmentReminders.id, reminder.id));
      continue;
    }
    if (reminder.type === "review-request" && !(await isEnabled("sms_review_requests"))) {
      await db.update(appointmentReminders).set({ status: "skipped" }).where(eq(appointmentReminders.id, reminder.id));
      continue;
    }
    if (reminder.type === "maintenance-reminder" && !(await isEnabled("predictive_maintenance_alerts"))) {
      await db.update(appointmentReminders).set({ status: "skipped" }).where(eq(appointmentReminders.id, reminder.id));
      continue;
    }

    // Skip confirmation request if booking is already confirmed
    if (reminder.type === "confirmation-request" && booking.status === "confirmed") {
      await db.update(appointmentReminders).set({ status: "skipped" }).where(eq(appointmentReminders.id, reminder.id));
      continue;
    }

    // At-most-once claim — mark the reminder 'sent' BEFORE the send.
    // Use CAS (Check-And-Set) to prevent double-send races.
    const claimResult = await db.update(appointmentReminders)
      .set({ status: "sent", sentAt: now })
      .where(and(eq(appointmentReminders.id, reminder.id), eq(appointmentReminders.status, "processing")));
      
    if (claimResult[0].affectedRows === 0) {
      continue; // Another worker claimed it first
    }

    const { orchestrateSms } = await import("./smsOrchestrator");
    let result: { status: any; id?: number; reason?: string };

    if (reminder.type === "review-request") {
      result = await orchestrateSms({
        type: "review_request",
        phone: booking.phone,
        name: booking.name,
      });
    } else {
      result = await orchestrateSms({
        type: "booking_reminder",
        phone: booking.phone,
        name: booking.name,
        reminderType: reminder.type,
        service: booking.service,
        vehicle: vehicle || undefined,
        preferredTime: booking.preferredTime || undefined,
        refCode: String(booking.id),
      });
    }

    if (result.status === "sent" || result.status === "queued") {
      await db.update(appointmentReminders)
        .set({ smsSid: result.id?.toString() || null })
        .where(eq(appointmentReminders.id, reminder.id));
      sent++;

      // Track when confirmation request was sent on the booking itself
      if (reminder.type === "confirmation-request") {
        await db.update(bookings)
          .set({ confirmationSentAt: now })
          .where(eq(bookings.id, reminder.bookingId));
      }
    } else {
      await db.update(appointmentReminders)
        .set({ status: result.status === "skipped" ? "skipped" : "failed" })
        .where(eq(appointmentReminders.id, reminder.id));
      failed++;
    }
  }

  if (sent > 0 || failed > 0) {
    console.info(`[sms-scheduler:processed] ${sent} sent, ${failed} failed`);
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
      log.error("[SMS Scheduler] Error:", err);
    });
  }, 5 * 60 * 1000);

  // Also run immediately on startup
  processScheduledSms().catch((err) => {
    log.error("[SMS Scheduler] Initial run error:", err);
  });

  console.info("[sms-scheduler:start] Started (5-minute interval)");
}

export function stopSmsScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
