/**
 * GET /api/cron/operating-rhythm
 *
 * Runs at key ADHD rhythm checkpoints throughout the day.
 * Detects which slot based on current ET hour and sends
 * the appropriate Telegram message.
 *
 * Slots: 8am (peak), 11am (mid-morning), 2pm (ops), 5pm (pre-close), 9pm (shutdown)
 */

import { cronHandler } from "@/lib/utils/http";
import { executeRhythm } from "@/lib/brain/operating-rhythm";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  return executeRhythm();
});
