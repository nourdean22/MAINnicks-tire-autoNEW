/**
 * /api/cron/correlation-alarm · v8.2 · F2 · Apr 29.
 *
 * Runs every 6h. Finds cross-domain correlations across Nour's life
 * data (scores, jobs, habits, tasks, leads, commitments, chat
 * activity) and emits a BrainMemory alert when a NEW strong
 * correlation crosses |r|>0.7 vs. the last snapshot.
 *
 * Idempotency: each alert mints a key from {pair, direction,
 * rounded-r} so a flapping correlation doesn't re-fire alerts.
 *
 * Wired in config/crons.ts (v8.2 batch).
 */

import { cronHandler } from "@/lib/utils/http";
import { runCorrelationAlarm } from "@/lib/brain/correlation-alarm";

export const maxDuration = 120;

export const GET = cronHandler(async () => {
  const started = Date.now();
  try {
    const report = await runCorrelationAlarm();
    return {
      ok: true,
      durationMs: Date.now() - started,
      ...report,
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : "correlation-alarm failed",
    };
  }
});
