/**
 * GET /api/cron/data-source-health · v10.0.58 · Wave B.
 *
 * Hourly probe tick for the data-source-health canary system. Each
 * tick runs every probe in `lib/contracts/data-source-health.ts`,
 * persists the result to BrainMemory, and returns a summary.
 *
 * Schedule: every 6 hours (4 ticks per day). The shim probes are
 * fast (single Prisma read each) and the bridge probes have a
 * 12s queryNick timeout, so a single tick stays well within the
 * 60s envelope even if every bridge call times out.
 *
 * Telegram alerting on data_source_dead is intentionally NOT in
 * v1 — operator reads /system/diagnostics or pulls the BrainMemory
 * rows directly. v2 will add the alert hook once probe baseline is
 * established (need ~7 days of data to know what "consistently
 * empty" actually means per probe).
 */

import { cronHandler } from "@/lib/utils/http";
import { runHealthProbes } from "@/lib/contracts/data-source-health";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const summary = await runHealthProbes();
  return {
    ranAt: new Date().toISOString(),
    ...summary,
  };
});
