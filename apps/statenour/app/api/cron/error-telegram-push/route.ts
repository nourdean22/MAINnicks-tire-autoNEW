/**
 * GET /api/cron/error-telegram-push · v10.0.88 · 2026-05-02.
 *
 * Pushes recent fatal/error log rows to Telegram, deduped by
 * stack-fingerprint. Window: 15 minutes. Cadence: every 5 minutes
 * (matches the manifest schedule below).
 *
 * Pairs with the existing alert-telegram-push (15 min cadence for
 * brain-bus alerts). Errors are more urgent — Nour gets paged when
 * a route is bleeding, not after the next 15-min sweep.
 */

import { cronHandler } from "@/lib/utils/http";
import { runFatalErrorTelegramPush } from "@/lib/system/fatal-error-telegram";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const report = await runFatalErrorTelegramPush();
  return report;
});
