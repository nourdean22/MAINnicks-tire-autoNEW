/**
 * /api/cron/blindspot-pinner · v8.2 · F5 · Apr 29.
 *
 * Auto-promotes critical/high blind spots into pinned_user so they
 * appear at the top of every Nick system prompt + on HQ. Removes
 * (soft-deletes) auto-pins whose underlying spot dropped off the
 * high/critical list.
 *
 * Cadence: every 4h. Cheap because detector caches and the
 * upsert/delete loop is per-domain (typically 0-3).
 */

import { cronHandler } from "@/lib/utils/http";
import { runBlindSpotPinner } from "@/lib/brain/blind-spot-pinner";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const started = Date.now();
  try {
    const report = await runBlindSpotPinner();
    return { ok: true, durationMs: Date.now() - started, ...report };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : "blindspot-pinner failed",
    };
  }
});
