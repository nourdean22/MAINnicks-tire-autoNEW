/**
 * Audit Trail — Typed admin action logging for Nick AI pattern learning.
 *
 * Uses the existing auditLog table in drizzle/schema.ts.
 * Every status change, note edit, and SMS send gets recorded with
 * before/after values so Nick AI can learn from admin behavior patterns.
 */

import { createLogger } from "../lib/logger";
import { randomUUID } from "crypto";
import { eq, and, desc } from "drizzle-orm";

import { db } from "../lib/db-helper";
import { describeDbError } from "../lib/dbErrors";

const log = createLogger("audit-trail");

// ─── Typed Actions ──────────────────────────────────
export type AuditAction =
  | "lead.status_changed"
  | "lead.notes_updated"
  | "lead.deleted"
  | "booking.status_changed"
  | "booking.notes_updated"
  | "booking.stage_changed"
  | "booking.priority_changed"
  | "booking.deleted"
  | "customer.sms_sent"
  // 2026-09-01 · audit F-3: a text parked for the 8 AM window is not sent yet;
  // the receipt says queued so nobody reads it as delivered.
  | "customer.sms_queued"
  | "customer.email_sent"
  | "customer.notes_updated"
  | "customer.segment_changed"
  | "workorder.status_changed"
  | "workorder.assigned"
  // 2026-09-16 · `callback.resolved` below has been declared here with ZERO
  // writers anywhere in the repo — a reserved audit slot that was never wired,
  // which is why a resolved callback's only receipt was the client's separate
  // adminSecurity.recordAction request. `callback.status_changed` is the name
  // callback.updateStatus now writes, matching its siblings lead./booking.
  // `callback.resolved` is LEFT IN PLACE deliberately: prod rows may carry it
  // from code since deleted, and dropping a name a historical query could
  // filter on is the silent-reinterpretation PROTECTED-CORE rule 2 forbids.
  | "callback.status_changed"
  | "callback.resolved"
  | "estimate.created"
  | "invoice.created"
  // 2026-05-30 · control-plane actions (operator levers, not entity CRUD)
  | "flag.toggled"
  // 2026-10-08 · blind pairwise review: one operator pick between two judged
  // photo posts, with both judge totals snapshotted (services/pairwiseReview.ts)
  | "content.pairwise_pick"
  // 2026-07-29 · SMS Revenue Agent OS — global pause arm/lift (smsOps.setPause)
  | "sms.global_pause"
  // 2026-07-29 · Autopilot Wave 1 — failed-row replay (smsOps.replayFailed)
  | "sms.replay_failed"
  // 2026-07-29 · Autopilot Wave 2 — bounded bridge send (nour-os-query
  // send_opportunity_sms); the details field carries the idempotency marker
  | "sms.bridge_send"
  // 2026-07-29 · Autopilot Wave 6 — operator hands a thread back to the AI
  // early (ends the 60-min takeover hold; humanTakeover.ts reads it)
  | "customer.sms_takeover_released"
  | "customer.sms_manual_send"
  // 2026-09-23 · an operator closes a waiting text without replying (ROS-058
  // markNoReplyNeeded). Deliberately NOT sms_manual_send: nothing was sent,
  // so it must not arm the 60-min takeover hold humanTakeover.ts reads.
  | "customer.sms_no_reply_needed"
  // Was listed three times; a repeated union member is a no-op to TS, so
  // nothing ever flagged it. Collapsed to one — no behaviour change.
  | "customer.sms_autosend_reply"
  | "migrations.ran"
  // 2026-06-11 · refund action types
  | "tireorder.refunded"
  | "tireorder.refund_failed"
  // 2026-09-01 · audit F-19: a tire order's status changes carried no actor,
  // no time and no history — "ordered" was a human claim with no receipt.
  | "tireorder.status_changed"
  | "invoice.refunded"
  | "invoice.refund_failed"
  // 2026-06-12 · nonstop nick membership overrides
  | "membership.grace_period_granted"
  // 2026-06-12 · database hygiene and cleanup
  | "database.hygiene_prune"
  // 2026-06-12 · ShopDriver actions
  | "shopdriver.force_sync"
  | "shopdriver.manual_probe"
  // 2026-08-12 · activity-ledger wired mutations (services/activityLedger.ts)
  | "lead.created"
  | "financing.click_tracked"
  | "financing.application_logged"
  | "estimate.generated"
  | "workorder.created_from_estimate"
  // 2026-08-12 · approval-queue lifecycle (services/proposals.ts)
  | "proposal.created"
  | "proposal.submitted"
  | "proposal.approved"
  | "proposal.rejected"
  | "proposal.executed"
  | "proposal.execution_failed"
  // 2026-09-09 · technician-referral bonus tracking (server/routers/technicianReferrals.ts)
  | "technician_referral.marked_hired"
  | "technician_referral.marked_paid"
  | "technician_referral.disqualified"
  // Distinct from .disqualified on purpose: the claim was VALID and the
  // referred tech left inside 90 days. Auditing both as one action would erase
  // the only difference that matters when a referrer contests a lost $300.
  | "technician_referral.forfeited"
  // 2026-09-09 · candidate applications (server/routers/candidates.ts)
  | "candidate.status_changed"
  // 2026-09-29 · Q-46: a customer's approve / decline / question on an
  // inspection item via the share link, with the amount (db.ts
  // decideInspectionItem). One row per decision; the item keeps only the latest.
  | "inspection.item_decided";

// ─── Log an admin action ────────────────────────────
export async function logAdminAction(data: {
  action: AuditAction;
  entityType: string;
  entityId: number | string;
  details: string;
  previousValue?: string;
  newValue?: string;
  metadata?: Record<string, unknown>;
  // 2026-05-30: optional actor attribution. Pass ctx.user.email/name to record
  // WHO pulled the lever (the audit table can't otherwise say). Defaults to
  // "admin" so all existing callers keep working unchanged.
  actor?: string;
  // 2026-08-12 · 0110 activity-ledger columns (hand-apply required). These are
  // included in the INSERT only when provided, so every pre-existing call site
  // emits byte-identical SQL — and keeps working against a database that has
  // not applied 0110 yet. Callers that DO pass them (services/activityLedger.ts,
  // services/proposals.ts) degrade loudly via the catch below until 0110 lands.
  actorType?: "human_user" | "ai_agent" | "nick_receptionist" | "public" | "system";
  status?: "executed" | "proposed";
  idempotencyKey?: string;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
}): Promise<boolean> {
  // Returns whether the row was written. Every existing caller ignores it
  // (audit logging must never break the main flow); a caller for which the
  // audit row IS the record (pairwiseReview.recordPairPick, 2026-10-08) must
  // not report success on a swallowed insert failure.
  try {
    const { auditLog } = await import("../../drizzle/schema");
    const d = await db();
    if (!d) return false;

    const changes: Record<string, { old: unknown; new: unknown }> = {};
    if (data.previousValue !== undefined || data.newValue !== undefined) {
      changes.value = { old: data.previousValue ?? null, new: data.newValue ?? null };
    }
    if (data.metadata) {
      changes.metadata = { old: null, new: data.metadata };
    }

    const values: typeof auditLog.$inferInsert = {
      id: randomUUID(),
      actor: data.actor ?? "admin",
      action: data.action,
      entityType: data.entityType,
      entityId: String(data.entityId),
      changes: Object.keys(changes).length > 0 ? changes : { detail: { old: null, new: data.details } },
    };
    if (data.actorType !== undefined) values.actorType = data.actorType;
    if (data.status !== undefined) values.status = data.status;
    if (data.idempotencyKey !== undefined) values.idempotencyKey = data.idempotencyKey;
    if (data.beforeJson !== undefined) values.beforeJson = data.beforeJson;
    if (data.afterJson !== undefined) values.afterJson = data.afterJson;

    await d.insert(auditLog).values(values);

    log.info(`${data.action} → ${data.entityType}#${data.entityId}: ${data.details}`);
    return true;
  } catch (err) {
    // Never let audit logging break the main flow. Log the error's classes and
    // driver codes only: a drizzle query error's message carries every bound
    // value, which here is the row itself (details, snapshots, customer notes).
    log.error("Audit trail write failed", {
      error: describeDbError(err),
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
    });
    return false;
  }
}

// ─── Query audit trail for an entity ────────────────
export type AuditTrailEntry = {
  id: string;
  actor: string;
  action: string;
  changes: unknown;
  createdAt: Date;
};

/**
 * EMPTY-VS-ERROR (fixed 2026-09-10). This returned a bare array, and returned
 * `[]` from THREE different places: a dead database handle, a thrown query, and
 * a genuine no-history-yet. On a $300 technician-referral payout those are not
 * the same fact - "nobody touched this record" is the most exonerating answer
 * an audit trail can give, which makes it the one that must never be
 * fabricated from a failed read. `available: false` marks the read as failed,
 * matching the convention getTechnicianReferrals and getCandidates already use.
 */
export async function getAuditTrail(
  entityType: string,
  entityId: number | string,
  limit = 20,
): Promise<{ available: boolean; rows: AuditTrailEntry[] }> {
  try {
    const { auditLog } = await import("../../drizzle/schema");
    const d = await db();
    if (!d) return { available: false, rows: [] };

    const rows = await d
      .select({
        id: auditLog.id,
        actor: auditLog.actor,
        action: auditLog.action,
        changes: auditLog.changes,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, entityType),
          eq(auditLog.entityId, String(entityId)),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);

    return { available: true, rows };
  } catch (err) {
    log.error("Audit trail read failed", {
      error: err instanceof Error ? err.message : String(err),
      entityType,
      entityId,
    });
    return { available: false, rows: [] };
  }
}
