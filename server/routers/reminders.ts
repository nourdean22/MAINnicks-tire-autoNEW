/**
 * Service Reminders Router
 * Handles automated maintenance reminder scheduling and management.
 */
import { z } from "zod";
import { router, adminProcedure, publicProcedure } from "../_core/trpc";
import {
  getReminderSettings, upsertReminderSetting, seedDefaultReminderSettings,
  getServiceReminders, getDueReminders, markReminderSent, snoozeReminder,
  getReminderStats,
} from "../db";
import { sendSms, maintenanceReminderSms } from "../sms";

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
          .replace("{phone}", "(216) 862-0005");
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

      const result = await sendSms(reminder.phone, message);
      if (result.success) {
        await markReminderSent(reminder.id, result.sid);
        sent++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`[Reminders] Failed to send reminder #${reminder.id}:`, err);
      failed++;
    }
  }

  return { processed: due.length, sent, failed };
}
