/**
 * The reason a cron run chose not to do its work, read off its own return value.
 *
 * Before 2026-09-23 a run that returned `{ ok: true, skipped: "NICK_AUTONOMY off" }`
 * settled as `success` with `resultCount` NULL - the same row as a run that did
 * its work and reported no count. Measured that day: 479 of 24 h's 694 `success`
 * rows carried a NULL count and nothing could say how many were skips. The job
 * had already said so; the writers threw it away.
 *
 * Written to `cron_job_logs."skipReason"` by BOTH writers - the Inngest
 * middleware (lib/inngest/cron-lifecycle.ts) and the route-cron logger
 * (lib/services/cron-manager.ts) - so it lives here, free of either's imports.
 *
 * The two shapes the fleet actually returns (census 2026-09-23):
 *   `{ skipped: "<reason>" }`                  - most jobs
 *   `{ skipped: true, reason: "<reason>" }`    - mega-fanout
 * Anything else is NOT a skip: `skipped: 3` is a count of skipped ITEMS inside
 * a run that worked, and `skippedCount` is not this key at all. NULL means the
 * run reported no skip - never a guessed one.
 */
export const SKIP_REASON_MAX = 200;

export function deriveSkipReason(output: unknown): string | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const o = output as Record<string, unknown>;
  let reason: string | null = null;
  if (typeof o.skipped === "string") reason = o.skipped;
  else if (o.skipped === true) reason = typeof o.reason === "string" && o.reason.trim() ? o.reason : "skipped";
  const trimmed = reason?.trim();
  return trimmed ? trimmed.slice(0, SKIP_REASON_MAX) : null;
}
