/**
 * Service Reminders Router
 * Handles automated maintenance reminder scheduling and management.
 */
import { z } from "zod";
import { router, adminProcedure, publicProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getReminderSettings, upsertReminderSetting, seedDefaultReminderSettings,
  getServiceReminders, getDueReminders, markReminderSent, snoozeReminder,
  getReminderStats,
} from "../db";
import { sendSms, maintenanceReminderSms } from "../sms";
import { BUSINESS } from "@shared/business";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:reminders");
export const remindersRouter = router({
  /** Get all reminder interval settings (admin) */
  getSettings: adminProcedure.query(async () => {
    await seedDefaultReminderSettings();
    return getReminderSettings();
  }),

  /** Update a reminder setting (admin) */
  updateSetting: adminProcedure
    .input(z.object({
      serviceType: z.string().max(100),
      serviceLabel: z.string().max(255),
      intervalMonths: z.number().int().min(1).max(120),
      intervalMiles: z.number().int().min(0).max(200000),
      enabled: z.number().int().min(0).max(1),
      messageTemplate: z.string().max(500).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      return upsertReminderSetting(input);
    }),

  /** Get all reminders with filtering (admin) */
  list: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ input }) => {
      return getServiceReminders(input?.limit ?? 100);
    }),

  /** Get reminder stats (admin) */
  stats: adminProcedure.query(async () => {
    // getReminderStats returns { total: 0, scheduled: 0, sent: 0, ... } when the
    // DB handle is gone. Every counter reads as a real measurement, so a dead
    // read renders as "nothing scheduled, nothing due, nothing missed" - the
    // most reassuring possible answer, produced by not looking. Same guard, same
    // reason, as routers/callback.ts (ROS-083).
    const { getDb } = await import("../db");
    if (!(await getDb())) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "Database unavailable — reminder counts are unknown, not zero.",
      });
    }
    return getReminderStats();
  }),

  /** Snooze a reminder by N days (admin) */
  snooze: adminProcedure
    .input(z.object({
      id: z.number().int(),
      days: z.number().int().min(1).max(365).default(30),
    }))
    .mutation(async ({ input }) => {
      await snoozeReminder(input.id, input.days);
      return { success: true };
    }),

  /** Process due reminders — send SMS for all that are past their nextDueDate (admin) */
  processQueue: adminProcedure.mutation(async () => {
    return processReminderQueue();
  }),
});

/**
 * Process all due reminders — called by the periodic timer and manual trigger.
 */
export async function processReminderQueue() {
  const due = await getDueReminders();
  let sent = 0;
  let queued = 0;
  let uncertain = 0; // attempted, unconfirmed (gateway timeout) — consumed, never re-sent
  let failed = 0;

  for (const reminder of due) {
    try {
      const settings = await getReminderSettings();
      const setting = settings.find((s: any) => s.serviceType === reminder.serviceType);
      const template = setting?.messageTemplate;

      let message: string;
      if (template) {
        message = template
          .replace("{firstName}", reminder.customerName.split(" ")[0])
          .replace("{service}", setting?.serviceLabel || reminder.serviceType)
          .replace("{phone}", BUSINESS.phone.display);
      } else {
        const mileageNote = reminder.nextDueMileage
          ? `Your vehicle may be approaching ${reminder.nextDueMileage.toLocaleString()} miles.`
          : undefined;
        message = maintenanceReminderSms(
          reminder.customerName,
          setting?.serviceLabel || reminder.serviceType,
          mileageNote,
        );
      }

      // Wave-108: appointment reminder via shop gateway (1:1 transactional)
      const result = await sendSms(reminder.phone, message, { via: "shop" });
      // 2026-09-01 (audit F-3): a reminder parked for the 8 AM window is
      // marked (it will go out — no re-send) but counted as queued, not sent.
      const { smsOutcome, smsClaimConsumed } = await import("../lib/smsOutcome");
      const outcome = smsOutcome(result);
      if (smsClaimConsumed(result)) {
        // sent, queued AND uncertain all consume the reminder: an uncertain
        // (gateway-timeout) text may have been delivered, and leaving the
        // reminder "scheduled" re-texted the customer every tick.
        await markReminderSent(reminder.id, result.sid);
        if (outcome === "sent") sent++; else if (outcome === "queued") queued++; else uncertain++;
      } else {
        failed++;
      }
    } catch (err) {
      log.error(`[Reminders] Failed to send reminder #${reminder.id}:`, err);
      failed++;
    }
  }

  return { processed: due.length, sent, queued, uncertain, failed };
}
