/**
 * Nour's after-hours EMERGENCY Telegram, sent by nickstire (job 2026-10-18-bdnick-prune wave 4).
 *
 * Until 2026-10-19 statenour's /api/webhooks/nickstire built this alert from the bridge event and
 * answered 500 when Telegram did not take it, so the bridge retry queue re-posted it (Nour,
 * 2026-10-17). bdnick.info no longer receives a customer's name or phone, so the alert moved here,
 * where the data lives: the same text, and a bounded retry with the same 5 s doubling cadence the
 * bridge queue had (5 tries over about 75 s). The bridge no longer posts emergencies to that webhook,
 * so Nour is alerted once.
 */
import { createLogger } from "../lib/logger";
import { withRetry } from "../retry";

const log = createLogger("services:emergencyAlert");

export interface EmergencyAlert {
  emergencyId: number | null;
  name: string;
  phone: string;
  problem: string;
}

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The alert statenour sent, unchanged: HTML mode, so customer text is escaped. */
export function emergencyTelegramText(e: EmergencyAlert): string {
  return (
    `🚨 <b>EMERGENCY REQUEST</b>\n\n` +
    `${html(e.name || "Customer")} — ${html(e.phone || "no phone")}\n` +
    `${html(e.problem)}\n\n` +
    `After-hours emergency. Respond ASAP.`
  );
}

/** true once Telegram accepts the alert; false after every try failed (logged, never thrown). */
export async function sendEmergencyTelegram(e: EmergencyAlert): Promise<boolean> {
  const { sendTelegram } = await import("./telegram");
  try {
    await withRetry(
      async () => {
        if (!(await sendTelegram(emergencyTelegramText(e)))) throw new Error("Telegram did not accept the emergency alert");
      },
      { maxRetries: 4, baseDelayMs: 5000, label: "emergency-telegram" },
    );
    return true;
  } catch (err) {
    // No name or phone in the log: the emergency id finds the row in the admin.
    log.error("emergency Telegram undelivered after 5 tries", {
      emergencyId: e.emergencyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
