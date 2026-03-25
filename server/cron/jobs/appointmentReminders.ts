/**
 * Cron: Appointment Reminders — 24h and 2h before
 * Runs every hour (24h) and every 15 min (2h)
 */
import { createLogger } from "../../lib/logger";
const log = createLogger("cron:reminders");

export async function processAppointmentReminders24h(): Promise<{ recordsProcessed: number }> {
  try {
    const { processScheduledSms } = await import("../../services/sms-scheduler");
    const result = await processScheduledSms();
    return { recordsProcessed: result.sent + result.failed };
  } catch (err) {
    log.error("24h reminder processing failed", { error: err instanceof Error ? err.message : String(err) });
    return { recordsProcessed: 0 };
  }
}

export async function processAppointmentReminders2h(): Promise<{ recordsProcessed: number }> {
  // Same processor handles both — the sms-scheduler checks scheduledFor dates
  return processAppointmentReminders24h();
}
