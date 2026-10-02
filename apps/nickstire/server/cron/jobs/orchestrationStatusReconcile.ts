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
import { affectedRowCount } from "../../lib/db-affected";

const RECONCILE_LOOKBACK_DAYS = 7; // module-private: an export whose only importer is a test is what the orphan gate exists to catch
/** How long after queueing the delayed queue may legitimately still send: next 08:00 plus slack. */
const QUEUE_WINDOW_HOURS = 36;

interface Candidate {
  id: number;
  anySent: number | string | boolean;
  anyFailed: number | string | boolean;
  sentAt: string | Date | null;
}

type Stamp = { status: "sent"; statusReason: "sent_from_delayed_queue" } | { status: "failed"; statusReason: "delayed_queue_failed" } | null;

/** A sent message wins over a failed attempt for the same text; nothing seen → leave it queued. */
function decideStamp(c: Candidate): Stamp {
  if (Number(c.anySent) === 1) return { status: "sent", statusReason: "sent_from_delayed_queue" };
  if (Number(c.anyFailed) === 1) return { status: "failed", statusReason: "delayed_queue_failed" };
  return null;
}

type Executor = { execute(query: ReturnType<typeof sql>): Promise<unknown> };

const rowsOf = <T = Candidate>(result: unknown): T[] => {
  const r = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  return Array.isArray(r) ? (r as T[]) : [];
};

/** The queued rows in the lookback that have at least one outbound message row in their window. */
async function selectCandidates(d: Executor, lookbackDays: number, windowHours: number): Promise<Candidate[]> {
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
async function stampOrchestration(d: Executor, id: number, stamp: NonNullable<Stamp>, sentAt: Candidate["sentAt"]): Promise<void> {
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

/* ─── Stale human-review drafts ─────────────────────────────────────────────
 * 2026-10-02 · a `drafted` row with requires_human_approval=1 sits in the
 * review queue until an operator taps it, and nothing else ever closed one:
 * 366 open in production, the oldest from 2026-06-24. The obligation behind a
 * draft can end without the draft being touched — the operator answered from
 * the thread, the customer texted again (a fresh draft supersedes this one), or
 * simply the week it answered is gone. A months-old draft is not a reply.
 *
 * Bookkeeping only — never sends. Each closure is a compare-and-swap on
 * `status = 'drafted'`, so an operator acting on the same row wins the race;
 * status_reason names the rule, message_body is untouched, so every closure is
 * auditable and reversible by hand.
 */

/** A human-review draft older than this is expired: it answers a conversation that has moved on. */
export const STALE_DRAFT_MAX_AGE_DAYS = 7;
/** Candidates read per run — oldest first, so a backlog drains over successive pulses. */
const STALE_DRAFT_BATCH = 500;

interface DraftCandidate {
  id: number;
  /**
   * The linked sms_response_jobs row reached an outcome that CLOSES the obligation: answered
   * (responded / human_replied), deliberately not answered (no_reply_required), or suppressed.
   * failed / dead are terminal for the JOB but nobody answered the customer — those drafts
   * stay open until the age rule, never "obligation_closed".
   */
  jobClosed: number | string | boolean | null;
  /** A linked job is still open (pending / processing / human_pending). */
  jobOpen: number | string | boolean | null;
  /**
   * inbound_sms only: the CUSTOMER texted again after this draft (that message gets its own
   * draft/reply). Outbound rows deliberately do not count: sms_messages cannot tell a
   * human answer from an automated reminder, and a reminder does not answer the customer.
   * A human answer closes the draft via resolveHumanPendingForConversation instead.
   */
  newerActivity: number | string | boolean | null;
  /** created more than STALE_DRAFT_MAX_AGE_DAYS ago. */
  stale: number | string | boolean | null;
}

type DraftClosure =
  | { status: "cancelled"; statusReason: "obligation_closed" | "superseded_by_newer_activity" }
  | { status: "expired"; statusReason: "stale_draft_expired" | "stale_draft_expired_obligation_open" }
  | null;

/** Obligation closed beats superseded beats age; an open job with no other signal keeps the draft. */
function decideDraftClosure(c: DraftCandidate): DraftClosure {
  if (Number(c.jobClosed) === 1 && Number(c.jobOpen) !== 1) return { status: "cancelled", statusReason: "obligation_closed" };
  if (Number(c.newerActivity) === 1) return { status: "cancelled", statusReason: "superseded_by_newer_activity" };
  // A week-old draft answers a conversation that has moved on, so it expires even when
  // its obligation is still open. The CUSTOMER is not dropped: the open sms_response_jobs
  // row keeps them on Today's "waiting on a reply" list (listWaitingConversations), where
  // the operator answers from the thread. The distinct reason keeps those rows findable.
  if (Number(c.stale) === 1) {
    return {
      status: "expired",
      statusReason: Number(c.jobOpen) === 1 ? "stale_draft_expired_obligation_open" : "stale_draft_expired",
    };
  }
  return null;
}

async function selectDraftCandidates(d: Executor, maxAgeDays: number): Promise<DraftCandidate[]> {
  const result = await d.execute(sql`
    SELECT o.id AS id,
           EXISTS (SELECT 1 FROM sms_response_jobs j WHERE j.orchestrationId = o.id
                   AND j.status IN ('responded', 'suppressed', 'human_replied', 'no_reply_required')) AS jobClosed,
           EXISTS (SELECT 1 FROM sms_response_jobs j WHERE j.orchestrationId = o.id
                   AND j.status IN ('pending', 'processing', 'human_pending')) AS jobOpen,
           (o.event_type = 'inbound_sms' AND o.related_conversation_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM sms_messages m WHERE m.conversationId = o.related_conversation_id
                AND m.createdAt > o.createdAt AND m.direction = 'inbound')) AS newerActivity,
           (o.createdAt < NOW() - INTERVAL ${maxAgeDays} DAY) AS stale
    FROM sms_orchestrations o
    WHERE o.status = 'drafted' AND o.requires_human_approval = 1
    ORDER BY o.id ASC
    LIMIT ${STALE_DRAFT_BATCH}
  `);
  return rowsOf<DraftCandidate>(result);
}

export async function reconcileStaleHumanReviewDrafts(
  d?: Executor | null,
  maxAgeDays: number = STALE_DRAFT_MAX_AGE_DAYS,
): Promise<{ recordsProcessed: number; details: string }> {
  const db = d === undefined ? await getDb() : d;
  if (!db) return { recordsProcessed: 0, details: "No DB — no drafts reconciled" };
  const candidates = await selectDraftCandidates(db, maxAgeDays);
  const closed = { obligation_closed: 0, superseded_by_newer_activity: 0, stale_draft_expired: 0, stale_draft_expired_obligation_open: 0 };
  let lostRace = 0;
  let left = 0;
  for (const c of candidates) {
    const closure = decideDraftClosure(c);
    if (!closure) { left += 1; continue; }
    const res = await db.execute(sql`
      UPDATE sms_orchestrations
      SET status = ${closure.status}, status_reason = ${closure.statusReason}, updatedAt = NOW()
      WHERE id = ${Number(c.id)} AND status = 'drafted' AND requires_human_approval = 1
    `);
    if (affectedRowCount(res) === 1) closed[closure.statusReason] += 1;
    else lostRace += 1;
  }
  const total = closed.obligation_closed + closed.superseded_by_newer_activity + closed.stale_draft_expired + closed.stale_draft_expired_obligation_open;
  return {
    recordsProcessed: total,
    details: `drafts closed ${total}: obligation_closed ${closed.obligation_closed} · superseded ${closed.superseded_by_newer_activity} · expired ${closed.stale_draft_expired} (+${closed.stale_draft_expired_obligation_open} with the customer still waiting) · lost race ${lostRace} · left open ${left} of ${candidates.length} · max age ${maxAgeDays}d`,
  };
}
