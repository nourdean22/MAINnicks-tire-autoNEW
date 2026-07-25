/**
 * GET /api/cron/outbox-drain — replay orphaned post-turn work.
 *
 * 2026-07-25 · durable-outbox arc (audit P1). The chat post-turn
 * pipeline runs inline and marks its outbox row done; a crash mid-work
 * strands the row at status=pending. This nightly drain claims orphans
 * past the grace window with the atomic first-claimant-wins pattern
 * and re-runs runDeferredBackgroundWork with a server logger. Replay
 * is safe: every phase is withErrorCapture-bounded and
 * idempotent-or-harmless (upserts, dedup guards, audit appends).
 */

import { cronHandler } from "@/lib/utils/http";
import { logger as rootLogger } from "@/lib/logger";
import {
  claimOrphans,
  finishClaim,
} from "@/lib/services/chat/post-turn-outbox";
import { runDeferredBackgroundWork } from "@/lib/services/chat/deferred-background-work";

export const maxDuration = 300;

const log = rootLogger.withSurface("cron/outbox-drain");

export const GET = cronHandler(async () => {
  const claimed = await claimOrphans(25);
  let ok = 0;
  let failed = 0;
  for (const row of claimed) {
    try {
      await runDeferredBackgroundWork({ log, ...row.payload });
      await finishClaim(row.id, true, row.attempts);
      ok++;
    } catch (err) {
      await finishClaim(row.id, false, row.attempts, err);
      failed++;
    }
  }
  log.info("outbox_drain_done", { claimed: claimed.length, ok, failed });
  return { claimed: claimed.length, ok, failed };
});
