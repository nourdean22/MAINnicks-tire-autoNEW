/**
 * /api/cron/audit-retention · v8.9 BATCH 51 · Apr 29.
 *
 * Daily TTL pass on entity_audits. Folded into mega-evening so it
 * doesn't burn a Vercel cron slot — runs as part of the nightly
 * cleanup block alongside data-cleanup + storage-quota-watch.
 */

import { cronHandler } from "@/lib/utils/http";
import { runAuditRetention } from "@/lib/db/audit-retention";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const started = Date.now();
  try {
    const report = await runAuditRetention();
    return { ok: true, durationMs: Date.now() - started, ...report };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : "audit-retention failed",
    };
  }
});
