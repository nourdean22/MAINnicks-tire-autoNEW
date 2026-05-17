/**
 * /api/cron/brain-bus-backfill · v10 Track B.2 · Apr 30 (v10.0.17 B.2.1).
 *
 * Polling backfill for the durable brain-bus. Catches any
 * BrainBusEvent rows that LISTEN/NOTIFY missed (consumer offline,
 * NOTIFY dropped, processing crashed mid-flight).
 *
 * Two passes per run:
 *   1. reclaimStaleProcessing — moves rows stuck in "processing"
 *      for >5min back to "pending" (handles crashed workers).
 *   2. pollAndProcess — claims pending rows whose availableAt has
 *      passed and dispatches them through brain-bus-handlers, which
 *      routes by topic to the registered consumer (or default-logs
 *      if no handler matches).
 *
 * v10.0.17 B.2.1 wiring: the no-op default handler is replaced by
 * dispatchDurableEvent so producers + consumers compose cleanly
 * once they ship.
 *
 * Schedule: every 2 minutes. Cheap — single SELECT on
 * (status, availableAt) index + UPDATE per claimed row.
 */

import { cronHandler } from "@/lib/utils/http";
import {
  reclaimStaleProcessing,
  pollAndProcess,
} from "@/lib/db/brain-bus-durable";
import { dispatchDurableEvent } from "@/lib/db/brain-bus-handlers";

export const maxDuration = 60;

const WORKER_ID = "cron:brain-bus-backfill";

export const GET = cronHandler(async () => {
  const reclaimed = await reclaimStaleProcessing({ staleAfterMs: 5 * 60_000 });

  // Process up to 50 events per tick. Topic-routed via
  // brain-bus-handlers; unknown topics hit the wildcard fallback.
  const result = await pollAndProcess({
    workerId: WORKER_ID,
    limit: 50,
    handler: async (event) => {
      await dispatchDurableEvent(event, {
        workerId: WORKER_ID,
        fromBackfill: true,
      });
    },
  });

  return {
    reclaimed,
    processed: result.processed,
    failed: result.failed,
    dead: result.dead,
    note: "polling backfill — durable bus delivery via handlers registry",
  };
});
