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

const log = createLogger("audit-trail");

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

// ─── Typed Actions ──────────────────────────────────
export type AuditAction =
  | "lead.status_changed"
  | "lead.notes_updated"
  | "booking.status_changed"
  | "booking.notes_updated"
  | "booking.stage_changed"
  | "booking.priority_changed"
  | "customer.sms_sent"
  | "customer.notes_updated"
  | "customer.segment_changed"
  | "workorder.status_changed"
  | "workorder.assigned"
  | "callback.resolved"
  | "estimate.created"
  | "invoice.created";

// ─── Log an admin action ────────────────────────────
export async function logAdminAction(data: {
  action: AuditAction;
  entityType: string;
  entityId: number | string;
  details: string;
  previousValue?: string;
  newValue?: string;
  metadata?: Record<string, unknown>;
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
      actor: "admin",
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
