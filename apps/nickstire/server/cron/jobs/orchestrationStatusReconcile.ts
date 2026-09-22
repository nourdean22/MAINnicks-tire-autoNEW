/**
 * orchestration-status-reconcile · an sms_orchestrations row persisted as
 * `queued · outside_hours_queued` never learns what happened to its text.
 *
 * WHY. Outside the sending window the orchestrator's sendSms() returns
 * `{ queued: true }` and the row is written `queued`; the text itself goes to
 * the durable delayed queue in sms_messages, which processDelayedQueue() sends
 * at the next window and stamps — on the sms_messages row only. Nothing ever
 * touches the orchestration again, so `queued` is terminal by omission: the
 * admin queue filter, the learning engine (which labels these `gatewayOffline`)
 * and any census read a sent text as unsent. Measured 2026-09-22
 * (docs/operations/QUEUE-CENSUS-2026-09-22.md): 308 rows, 243 of them followed
 * by a sent outbound to the same phone within 36 h.
 *
 * WHAT THIS DOES. Bookkeeping only — it never sends. For each queued row
 * younger than LOOKBACK_DAYS it reads the outbound sms_messages rows for the
 * same phone (10-digit, the conversation key) inside the queueing window and
 * stamps the orchestration with what actually happened: sent / failed. A row
 * with no message row yet (today's, held by an offline gateway) stays queued.
 * Rows older than the lookback are left alone on purpose: rewriting months of
 * history is the operator's call — scripts/maintenance/backstamp-queued-
 * orchestrations.mjs does it with a dry run.
 *
 * FAIL-CLOSED. No database → 0 with a reason in details. A failing query
 * throws, so cron_log records `failed` (the cron-rethrow contract) instead of a
 * completed-with-0 that reads like "nothing to do".
 */
import { sql } from "drizzle-orm";
import { getDb } from "../../db";

export const RECONCILE_LOOKBACK_DAYS = 7;
/** How long after queueing the delayed queue may legitimately still send: next 08:00 plus slack. */
export const QUEUE_WINDOW_HOURS = 36;

export interface Candidate {
  id: number;
  anySent: number | string | boolean;
  anyFailed: number | string | boolean;
  sentAt: string | Date | null;
}

export type Stamp = { status: "sent"; statusReason: "sent_from_delayed_queue" } | { status: "failed"; statusReason: "delayed_queue_failed" } | null;

/** A sent message wins over a failed attempt for the same text; nothing seen → leave it queued. */
export function decideStamp(c: Candidate): Stamp {
  if (Number(c.anySent) === 1) return { status: "sent", statusReason: "sent_from_delayed_queue" };
  if (Number(c.anyFailed) === 1) return { status: "failed", statusReason: "delayed_queue_failed" };
  return null;
}

type Executor = { execute(query: ReturnType<typeof sql>): Promise<unknown> };

const rowsOf = (result: unknown): Candidate[] => {
  const r = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  return Array.isArray(r) ? (r as Candidate[]) : [];
};

/** The queued rows in the lookback that have at least one outbound message row in their window. */
export async function selectCandidates(d: Executor, lookbackDays: number, windowHours: number): Promise<Candidate[]> {
  const result = await d.execute(sql`
    SELECT o.id AS id,
           MAX(CASE WHEN m.status IN ('sent', 'delivered') THEN 1 ELSE 0 END) AS anySent,
           MAX(CASE WHEN m.status = 'failed' THEN 1 ELSE 0 END) AS anyFailed,
           MAX(m.sent_at) AS sentAt
    FROM sms_orchestrations o
    JOIN sms_conversations sc ON sc.phone = RIGHT(REGEXP_REPLACE(o.customer_phone, '[^0-9]', ''), 10)
    JOIN sms_messages m ON m.conversationId = sc.id AND m.direction = 'outbound'
      AND m.createdAt BETWEEN o.createdAt - INTERVAL 5 MINUTE AND o.createdAt + INTERVAL ${windowHours} HOUR
    WHERE o.status = 'queued' AND o.status_reason = 'outside_hours_queued'
      AND o.createdAt >= NOW() - INTERVAL ${lookbackDays} DAY
    GROUP BY o.id
    ORDER BY o.id ASC
    LIMIT 200
  `);
  return rowsOf(result);
}

/** Stamp one orchestration; the WHERE re-checks the queued state so a concurrent writer cannot be overwritten. */
export async function stampOrchestration(d: Executor, id: number, stamp: NonNullable<Stamp>, sentAt: Candidate["sentAt"]): Promise<void> {
  if (stamp.status === "sent") {
    await d.execute(sql`
      UPDATE sms_orchestrations
      SET status = 'sent', status_reason = ${stamp.statusReason}, sent_at = COALESCE(${sentAt ?? null}, NOW()), updatedAt = NOW()
      WHERE id = ${id} AND status = 'queued' AND status_reason = 'outside_hours_queued'
    `);
  } else {
    await d.execute(sql`
      UPDATE sms_orchestrations
      SET status = 'failed', status_reason = ${stamp.statusReason}, failed_at = NOW(), updatedAt = NOW()
      WHERE id = ${id} AND status = 'queued' AND status_reason = 'outside_hours_queued'
    `);
  }
}

export async function reconcileQueuedOrchestrations(
  d?: Executor | null,
  lookbackDays: number = RECONCILE_LOOKBACK_DAYS,
): Promise<{ recordsProcessed: number; details: string }> {
  const db = d === undefined ? await getDb() : d;
  if (!db) return { recordsProcessed: 0, details: "No DB — nothing reconciled" };
  const candidates = await selectCandidates(db, lookbackDays, QUEUE_WINDOW_HOURS);
  let sent = 0;
  let failed = 0;
  let left = 0;
  for (const c of candidates) {
    const stamp = decideStamp(c);
    if (!stamp) { left += 1; continue; }
    await stampOrchestration(db, Number(c.id), stamp, c.sentAt);
    if (stamp.status === "sent") sent += 1;
    else failed += 1;
  }
  return {
    recordsProcessed: sent + failed,
    details: `stamped sent ${sent} · failed ${failed} · left queued ${left} of ${candidates.length} with a message row · lookback ${lookbackDays}d, window ${QUEUE_WINDOW_HOURS}h`,
  };
}
