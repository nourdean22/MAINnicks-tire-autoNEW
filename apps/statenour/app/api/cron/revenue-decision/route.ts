/**
 * GET /api/cron/revenue-decision · v10.0.526 · Arc C · Feature 1
 *
 * Folded into mega-morning. Runs the revenue-decision engine and
 * pushes a Telegram approval message when 1-3 moves were drafted.
 *
 * Idempotency: BrainMemory(category="revenue_move", key="move_YYYY-MM-DD_1")
 * is the sentinel. If today's first-move row exists, the cron exits with
 * `skipped: already_drafted_today` so retries don't double-page.
 *
 * Bridge-down behavior: when nickstire signals are unavailable
 * (signals.source === "empty"), the run logs and exits cleanly · no
 * Telegram noise (spec requirement).
 */

import { cronHandler } from "@/lib/utils/http";
import { runRevenueDecisionChannel } from "@/lib/services/revenue-decision-channel";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  return await runRevenueDecisionChannel();
});
