/**
 * /api/cron/alert-telegram-push · v8.5 BATCH 29 · Apr 29.
 *
 * Pushes un-pushed v8.2 alerts (correlation_alert, decision_quality_drift)
 * to Telegram every 15 minutes. Idempotent via per-alert marker rows
 * in BrainMemory category=alert_pushed.
 */

import { cronHandler } from "@/lib/utils/http";
import { runAlertTelegramPush } from "@/lib/brain/alert-telegram-bridge";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const started = Date.now();
  try {
    const report = await runAlertTelegramPush();
    return { ok: true, durationMs: Date.now() - started, ...report };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : "alert-telegram-push failed",
    };
  }
});
