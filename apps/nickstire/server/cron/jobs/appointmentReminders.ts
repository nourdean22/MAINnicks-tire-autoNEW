/**
 * Cron: Appointment Reminders — 24h and 2h before
 * Runs every hour (24h) and every 15 min (2h)
 */
import { createLogger } from "../../lib/logger";
const log = createLogger("cron:reminders");

export async function processAppointmentReminders24h(): Promise<{ recordsProcessed: number }> {
  try {
    const { isEnabled } = await import("../../services/featureFlags");
    if (!(await isEnabled("sms_appointment_reminders"))) {
      return { recordsProcessed: 0 }; // Flag disabled — skip silently
    }
    const { processScheduledSms } = await import("../../services/sms-scheduler");
    const result = await processScheduledSms();
    return { recordsProcessed: result.sent + result.failed };
  } catch (err) {
    // forensic-audit MEDIUM · re-throw so runTier logs status='failed' and the
    // cron-failure observer alerts. Swallowing + returning recordsProcessed:0
    // made a totally-broken run look 'completed', so booking reminders could
    // stop reaching customers for weeks with zero alert.
    log.error("24h reminder processing failed", { error: err instanceof Error ? err.message : String(err) });
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function processAppointmentReminders2h(): Promise<{ recordsProcessed: number }> {
  // Same processor handles both — the sms-scheduler checks scheduledFor dates
  return processAppointmentReminders24h();
}
