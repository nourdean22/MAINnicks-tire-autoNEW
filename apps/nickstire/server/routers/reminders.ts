/**
 * Service Reminders Router
 * Handles automated maintenance reminder scheduling and management.
 */
import { z } from "zod";
import { router, adminProcedure, publicProcedure, dbAdminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getReminderSettings, upsertReminderSetting, seedDefaultReminderSettings,
  getServiceReminders, snoozeReminder, getReminderStats,
} from "../db";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:reminders");
export const remindersRouter = router({
  /** Get all reminder interval settings (admin) */
  getSettings: dbAdminProcedure.query(async () => {
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
  list: dbAdminProcedure
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
  processQueue: dbAdminProcedure.mutation(async () => {
    return processReminderQueue();
  }),
});

/**
 * Plan reminders from closed jobs, then send the due ones — called by the
 * `reminder-queue` cron and the admin trigger. Unarmed (the default), the
 * planner only counts and nothing is written or sent: before 2026-10-22 this
 * function texted every due row with no flag at all.
 */
export async function processReminderQueue() {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable: reminders not planned or sent");
  const { isEnabled } = await import("../services/featureFlags");
  const armed = await isEnabled("service_reminders_from_invoices");
  const { syncServiceReminders, sendDueServiceReminders } = await import("../services/serviceReminders");
  const plan = await syncServiceReminders(db, armed);
  const send = armed ? await sendDueServiceReminders(db) : null;
  log.info("reminder queue", { mode: plan.mode, planned: plan.planned, inserted: plan.inserted, closed: plan.closed, sent: send?.sent ?? 0 });
  return { plan, send };
}
