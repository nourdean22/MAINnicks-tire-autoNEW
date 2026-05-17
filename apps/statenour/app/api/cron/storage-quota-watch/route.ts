/**
 * /api/cron/storage-quota-watch · v8.8 BATCH 47 · Apr 29.
 *
 * Daily storage-size + quota check. Emits a BrainMemory
 * storage_quota_alert when any tracked table crosses 60/80/95% of
 * its soft cap. The alert-telegram-push cron picks up new alerts
 * and sends them to phone.
 *
 * Folded into mega-evening (no standalone schedule) so we don't
 * burn a Vercel cron slot on a once-a-day check.
 */

import { cronHandler } from "@/lib/utils/http";
import { runStorageQuotaWatch } from "@/lib/db/storage-quota";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const started = Date.now();
  try {
    const report = await runStorageQuotaWatch();
    return {
      ok: true,
      durationMs: Date.now() - started,
      ...report,
    };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : "storage-quota-watch failed",
    };
  }
});
