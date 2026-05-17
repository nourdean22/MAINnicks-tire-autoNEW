/**
 * /api/cron/decision-quality-drift · v8.2 · F3 · Apr 29.
 *
 * Weekly trend check on Nour's decision grades. Writes a BrainMemory
 * alert when this week's GPA dropped 15%+ vs the prior 4-week
 * baseline. Idempotent per week-ending-date.
 *
 * Cadence: weekly, Sunday 11:00 UTC (7am Cleveland Sunday morning so
 * Nour sees it with his weekly review).
 */

import { cronHandler } from "@/lib/utils/http";
import { runDecisionQualityDrift } from "@/lib/brain/decision-quality-drift";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const started = Date.now();
  try {
    const report = await runDecisionQualityDrift();
    return { ok: true, durationMs: Date.now() - started, ...report };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : "decision-quality-drift failed",
    };
  }
});
