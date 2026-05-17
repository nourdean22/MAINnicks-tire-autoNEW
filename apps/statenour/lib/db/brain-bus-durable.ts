/**
 * Durable brain-bus · v10 Track B.2 · Apr 30.
 *
 * Closes the at-most-once delivery gap in the v8.4 LISTEN/NOTIFY
 * skeleton. Round 1 Agent D Q5 documented this:
 *
 *   "LISTEN/NOTIFY is at-most-once by design. The comment in
 *    brain-bus.ts line 25 explicitly documents 'Replay-from-offset...
 *    separate batch.' No durable fallback exists, but this is a
 *    known limitation documented and accepted."
 *
 * v10 v9.1.16 fixed the probe lying about LISTEN health, but didn't
 * close this gap. Now it does.
 *
 * Architecture:
 *
 *   producer:
 *     1. INSERT INTO brain_bus_events (...)  -- durable
 *     2. pg_notify('brain_bus', event.id)    -- wake bell
 *
 *   consumer (LISTEN path):
 *     on NOTIFY → claim event by id, process, mark done
 *
 *   consumer (POLL backfill — runs on cron):
 *     every N seconds → claim pending events whose availableAt has
 *     passed, process, mark done. Catches anything missed while
 *     LISTEN was down.
 *
 * If the consumer is offline when NOTIFY fires, the row is still
 * here for the next polling cycle to pick up. No event is lost
 * unless the producer's INSERT fails — and that surfaces as a
 * write error to the caller, not a silent drop.
 *
 * Compose with v8.4 brain-bus.ts: this file ADDS durability; it
 * doesn't replace the LISTEN/NOTIFY layer. Callers can still use
 * publish() / subscribe() for fire-and-forget ephemeral events.
 * Use these helpers when delivery actually matters.
 */

import { prisma } from "@/lib/prisma";
import { recordError } from "@/lib/errors/record-error";
import { publish as ephemeralPublish } from "./brain-bus";

export interface DurablePublishOptions {
  /** Optional dedupe key — second publish with same key is a no-op. */
  dedupeKey?: string;
  /** Defer processing — caller wants the event picked up after this time. */
  availableAt?: Date;
  /** Skip the NOTIFY wake-bell (purely durable, picked up by polling). */
  noNotify?: boolean;
}

export interface DurableEvent {
  id: string;
  topic: string;
  eventType: string;
  payload: unknown;
  attempts: number;
  createdAt: Date;
  availableAt: Date;
}

/**
 * Publish a durable event. Writes a row to BrainBusEvent FIRST,
 * then fires NOTIFY as a wake-bell. The NOTIFY payload is the row's
 * id — consumers fetch the full event via the id.
 *
 * Returns the event id on success. Throws on INSERT failure (caller
 * should handle — durable delivery requires the write to land).
 */
export async function publishDurable(
  topic: string,
  eventType: string,
  payload: unknown,
  opts: DurablePublishOptions = {},
): Promise<{ id: string; deduped: boolean }> {
  const dedupeKey = opts.dedupeKey ?? null;

  // Dedupe fast-path — return existing id if dedupeKey already used.
  if (dedupeKey) {
    const existing = await prisma.brainBusEvent.findUnique({
      where: { dedupeKey },
      select: { id: true },
    });
    if (existing) {
      return { id: existing.id, deduped: true };
    }
  }

  const created = await prisma.brainBusEvent
    .create({
      data: {
        topic,
        eventType,
        payload: payload as never,
        dedupeKey,
        status: "pending",
        availableAt: opts.availableAt ?? new Date(),
      },
      select: { id: true },
    })
    .catch(async (err) => {
      // Race condition: another caller minted the same dedupeKey
      // between our findUnique and create. Look up + return that id.
      const code = (err as { code?: string }).code;
      if (code === "P2002" && dedupeKey) {
        const existing = await prisma.brainBusEvent.findUnique({
          where: { dedupeKey },
          select: { id: true },
        });
        if (existing) {
          return { id: existing.id };
        }
      }
      throw err;
    });

  const id = created.id;

  // Fire NOTIFY as a wake-bell (best-effort — if NOTIFY fails, the
  // polling backfill will still pick this up). Pass only the id;
  // the consumer fetches the full event.
  if (!opts.noNotify) {
    await ephemeralPublish(`bbe_${topic}`, { eventId: id }).catch(() => {
      // Swallow. The row is durable; the bell is best-effort.
    });
  }

  return { id, deduped: false };
}

/**
 * Atomically claim a batch of pending events for processing.
 *
 * Uses a single UPDATE...SET status='processing' WHERE status='pending'
 * AND availableAt<=NOW() RETURNING * pattern so two concurrent claim
 * calls never claim the same row. Sets lockedAt / lockedBy so a
 * crashed consumer's claims can be detected (a future requeue-stale
 * cron can reclaim rows where lockedAt < NOW() - 5min).
 *
 * Returns up to `limit` events. Caller MUST call markDone or
 * markFailed for each claimed event.
 */
export async function claimEvents(opts: {
  limit?: number;
  topic?: string;
  workerId: string;
}): Promise<DurableEvent[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 10, 100));
  const now = new Date();

  // v10.0.27 attempted Prisma.empty for the no-op topic filter.
  // It still failed with `syntax error at or near "$5"` in Neon —
  // Prisma.empty doesn't always collapse cleanly when surrounded
  // by other parameterized expressions in the same template.
  //
  // 2026-05-01 — fully branched query. Two literal templates,
  // each compiled to its own prepared statement with no
  // conditional fragments. Verbose by design — there is no way
  // for Prisma to mis-count parameters here. opts.topic is still
  // parameterized inside its branch so SQL injection isn't possible.
  type Row = {
    id: string;
    topic: string;
    event_type: string;
    payload: unknown;
    attempts: number;
    created_at: Date;
    available_at: Date;
  };
  const rows = opts.topic
    ? await prisma.$queryRaw<Row[]>`
        UPDATE brain_bus_events
        SET status = 'processing',
            locked_at = ${now},
            locked_by = ${opts.workerId},
            attempts = attempts + 1,
            updated_at = ${now}
        WHERE id IN (
          SELECT id FROM brain_bus_events
          WHERE status = 'pending'
            AND available_at <= ${now}
            AND topic = ${opts.topic}
          ORDER BY available_at ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, topic, event_type, payload, attempts, created_at, available_at
      `
    : await prisma.$queryRaw<Row[]>`
        UPDATE brain_bus_events
        SET status = 'processing',
            locked_at = ${now},
            locked_by = ${opts.workerId},
            attempts = attempts + 1,
            updated_at = ${now}
        WHERE id IN (
          SELECT id FROM brain_bus_events
          WHERE status = 'pending'
            AND available_at <= ${now}
          ORDER BY available_at ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, topic, event_type, payload, attempts, created_at, available_at
      `;

  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    eventType: r.event_type,
    payload: r.payload,
    attempts: r.attempts,
    createdAt: r.created_at,
    availableAt: r.available_at,
  }));
}

/** Mark a claimed event as successfully processed. */
export async function markDone(eventId: string): Promise<void> {
  await prisma.brainBusEvent.update({
    where: { id: eventId },
    data: {
      status: "done",
      processedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });
}

/**
 * Mark a claimed event as failed.
 *
 * If attempts is below maxAttempts, schedules a retry with backoff.
 * Otherwise transitions to "dead" — operator-visible, manual review.
 *
 * Backoff: 1m, 5m, 30m, 2h, 6h. After 5 failed attempts → dead.
 */
export async function markFailed(
  eventId: string,
  error: string,
  opts: { maxAttempts?: number } = {},
): Promise<void> {
  const event = await prisma.brainBusEvent.findUnique({
    where: { id: eventId },
    select: { attempts: true, topic: true },
  });
  if (!event) return;

  // v10.0.90 · per-topic retry policy. Old behavior (caller-provided
  // maxAttempts OR default 5 + fixed backoff ladder) preserved when
  // the topic has no entry in lib/db/brain-bus-retry-policy.ts.
  const { getRetryPolicy, backoffMs, shouldDrop, shouldEscalate } =
    await import("./brain-bus-retry-policy");
  const policy = getRetryPolicy(event.topic);
  const maxAttempts = opts.maxAttempts ?? policy.maxAttempts;

  const attempts = event.attempts;
  if (attempts >= maxAttempts) {
    if (shouldDrop(event.topic)) {
      // Best-effort topics: delete the row entirely on max-out
      await prisma.brainBusEvent
        .delete({ where: { id: eventId } })
        .catch((err) => {
          recordError("db:brain-bus-durable", err, { phase: "delete-best-effort", eventId, topic: event.topic });
        });
      return;
    }
    await prisma.brainBusEvent.update({
      where: { id: eventId },
      data: {
        status: "dead",
        processedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: error.slice(0, 1000),
      },
    });
    if (shouldEscalate(event.topic)) {
      // Write a brain-bus-alert BrainMemory row so alert-telegram-push
      // picks it up next sweep — single source of truth for Telegram.
      await prisma.brainMemory
        .create({
          data: {
            category: "brain_bus_alert",
            key: `dead-event:${eventId.slice(0, 24)}`,
            content: `Brain-bus event escalated after ${maxAttempts} attempts. Topic: ${event.topic}. Last error: ${error.slice(0, 400)}`,
            confidence: 1.0,
            source: "lib:brain-bus-durable",
            metadata: {
              eventId,
              topic: event.topic,
              attempts,
              deadAction: policy.deadAction,
            },
          },
        })
        .catch((err) => {
          recordError("db:brain-bus-durable", err, { phase: "dead-event-escalation", eventId, topic: event.topic });
        });
    }
    return;
  }

  const delay = backoffMs(event.topic, attempts);
  const nextAvailable = new Date(Date.now() + delay);

  await prisma.brainBusEvent.update({
    where: { id: eventId },
    data: {
      status: "pending",
      availableAt: nextAvailable,
      lockedAt: null,
      lockedBy: null,
      lastError: error.slice(0, 1000),
    },
  });
}

/**
 * Polling backfill — claim + process pending events. Wraps
 * claimEvents + caller-provided handler + markDone/markFailed.
 *
 * Designed to be called from a cron tick. The handler is invoked
 * once per event and must throw on failure for retry semantics
 * to work.
 */
export async function pollAndProcess(opts: {
  workerId: string;
  topic?: string;
  limit?: number;
  handler: (event: DurableEvent) => Promise<void>;
}): Promise<{ processed: number; failed: number; dead: number }> {
  let processed = 0;
  let failed = 0;
  let dead = 0;

  const events = await claimEvents({
    workerId: opts.workerId,
    topic: opts.topic,
    limit: opts.limit,
  });

  for (const event of events) {
    try {
      await opts.handler(event);
      await markDone(event.id);
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const beforeAttempts = event.attempts;
      await markFailed(event.id, msg);
      // Re-fetch to determine if it transitioned to dead.
      const after = await prisma.brainBusEvent.findUnique({
        where: { id: event.id },
        select: { status: true },
      });
      if (after?.status === "dead") {
        dead++;
      } else {
        failed++;
      }
      // Suppress unused-var warning while keeping name for future
      // attempt-delta debugging.
      void beforeAttempts;
    }
  }

  return { processed, failed, dead };
}

/**
 * Operator-facing health snapshot. Powers /system/brain-bus dashboard.
 */
export async function getDurableBusHealth(): Promise<{
  pending: number;
  processing: number;
  done24h: number;
  failed24h: number;
  dead: number;
  oldestPendingAt: string | null;
  oldestStuckProcessing: string | null;
}> {
  const since = new Date(Date.now() - 86_400_000);
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000);

  const [pending, processing, done24h, failed24h, dead, oldestPending, stuckProcessing] =
    await Promise.all([
      prisma.brainBusEvent.count({ where: { status: "pending" } }),
      prisma.brainBusEvent.count({ where: { status: "processing" } }),
      prisma.brainBusEvent.count({
        where: { status: "done", processedAt: { gte: since } },
      }),
      prisma.brainBusEvent.count({
        where: { status: "pending", attempts: { gte: 1 }, updatedAt: { gte: since } },
      }),
      prisma.brainBusEvent.count({ where: { status: "dead" } }),
      prisma.brainBusEvent.findFirst({
        where: { status: "pending" },
        orderBy: { availableAt: "asc" },
        select: { availableAt: true },
      }),
      prisma.brainBusEvent.findFirst({
        where: { status: "processing", lockedAt: { lt: fiveMinAgo } },
        orderBy: { lockedAt: "asc" },
        select: { lockedAt: true },
      }),
    ]);

  return {
    pending,
    processing,
    done24h,
    failed24h,
    dead,
    oldestPendingAt: oldestPending?.availableAt.toISOString() ?? null,
    oldestStuckProcessing: stuckProcessing?.lockedAt?.toISOString() ?? null,
  };
}

/**
 * Sweeper — reclaim events that have been "processing" longer than
 * the timeout (consumer crashed mid-process). Resets them to
 * pending so the next claim cycle picks them up.
 *
 * Called from a periodic cron (every 5 min is plenty).
 */
export async function reclaimStaleProcessing(opts: {
  staleAfterMs?: number;
} = {}): Promise<number> {
  const staleAfter = opts.staleAfterMs ?? 5 * 60_000; // 5min default
  const cutoff = new Date(Date.now() - staleAfter);
  const result = await prisma.brainBusEvent.updateMany({
    where: {
      status: "processing",
      lockedAt: { lt: cutoff },
    },
    data: {
      status: "pending",
      lockedAt: null,
      lockedBy: null,
    },
  });
  return result.count;
}
