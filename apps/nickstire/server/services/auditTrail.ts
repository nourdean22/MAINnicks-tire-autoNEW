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
  | "customer.notes_updated"
  | "customer.segment_changed"
  | "workorder.status_changed"
  | "workorder.assigned"
  | "callback.resolved"
  | "estimate.created"
  | "invoice.created"
  // 2026-05-30 · control-plane actions (operator levers, not entity CRUD)
  | "flag.toggled"
  | "customer.sms_manual_send"
  | "migrations.ran"
  // 2026-06-11 · refund action types
  | "tireorder.refunded"
  | "tireorder.refund_failed"
  | "invoice.refunded"
  | "invoice.refund_failed"
  // 2026-06-12 · nonstop nick membership overrides
  | "membership.grace_period_granted"
  // 2026-06-12 · database hygiene and cleanup
  | "database.hygiene_prune";

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
}): Promise<void> {
  try {
    const { auditLog } = await import("../../drizzle/schema");
    const d = await db();
    if (!d) return;

    const changes: Record<string, { old: unknown; new: unknown }> = {};
    if (data.previousValue !== undefined || data.newValue !== undefined) {
      changes.value = { old: data.previousValue ?? null, new: data.newValue ?? null };
    }
    if (data.metadata) {
      changes.metadata = { old: null, new: data.metadata };
    }

    await d.insert(auditLog).values({
      id: randomUUID(),
      actor: data.actor ?? "admin",
      action: data.action,
      entityType: data.entityType,
      entityId: String(data.entityId),
      changes: Object.keys(changes).length > 0 ? changes : { detail: { old: null, new: data.details } },
    });

    log.info(`${data.action} → ${data.entityType}#${data.entityId}: ${data.details}`);
  } catch (err) {
    // Never let audit logging break the main flow
    log.error("Audit trail write failed", {
      error: err instanceof Error ? err.message : String(err),
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
    });
  }
}

// ─── Query audit trail for an entity ────────────────
export async function getAuditTrail(
  entityType: string,
  entityId: number | string,
  limit = 20,
): Promise<Array<{
  id: string;
  actor: string;
  action: string;
  changes: unknown;
  createdAt: Date;
}>> {
  try {
    const { auditLog } = await import("../../drizzle/schema");
    const d = await db();
    if (!d) return [];

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

    return rows;
  } catch (err) {
    log.error("Audit trail read failed", {
      error: err instanceof Error ? err.message : String(err),
      entityType,
      entityId,
    });
    return [];
  }
}
