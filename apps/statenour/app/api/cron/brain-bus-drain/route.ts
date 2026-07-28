/**
 * GET /api/cron/brain-bus-drain — revive the durable brain-bus consumer.
 *
 * 2026-07-28 · blueprint audit finding #1. Wave AE (05-28) pruned the
 * brain-bus-backfill cron ROUTE but left all nine producers publishing
 * (tasks · goals · journal · drift · identity · autonomous-engine ·
 * cron-manager failures). `pollAndProcess` had ZERO callers from that
 * day forward — verified in prod: last `done` event 2026-05-28, then
 * 393 pending rows accumulating through 2026-07-28 (task.completed 184,
 * brain_dump.finalized 161, cron.failure 23, score.logged 20).
 *
 * Because the bus is durable, the backlog is REPLAYABLE — handlers are
 * idempotent (findUnique→create BrainMemory writes). Fired by the
 * WORKER's node-cron every 15 min (see apps/worker/src/scheduler.ts):
 * 50/run clears the two-month backlog in ~2h, then steady-state is a
 * handful of events per tick.
 */

import { cronHandler } from "@/lib/utils/http";
import { logger as rootLogger } from "@/lib/logger";
import {
  pollAndProcess,
  reclaimStaleProcessing,
  getDurableBusHealth,
} from "@/lib/db/brain-bus-durable";
import { dispatchDurableEvent } from "@/lib/db/brain-bus-handlers";

export const maxDuration = 120;

const log = rootLogger.withSurface("cron/brain-bus-drain");

export const GET = cronHandler(async () => {
  const reclaimed = await reclaimStaleProcessing();
  const workerId = `drain-${process.pid}-${Date.now().toString(36)}`;
  const result = await pollAndProcess({
    workerId,
    limit: 50,
    handler: (event) =>
      dispatchDurableEvent(event, { workerId, fromBackfill: true }),
  });
  const health = await getDurableBusHealth();
  log.info("brain_bus_drain_done", { reclaimed, ...result });
  return { reclaimed, ...result, health };
});
