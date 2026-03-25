/**
 * Audit Log — Records all admin/system mutations for accountability
 */

import { createLogger } from "../lib/logger";
import { randomUUID } from "crypto";

const log = createLogger("audit");

interface AuditParams {
  actor: string; // 'admin', 'system', 'customer:UUID'
  action: string; // 'update_order', 'delete_lead', 'toggle_flag'
  entityType?: string;
  entityId?: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
  ipAddress?: string;
}

export async function logAudit(params: AuditParams): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { auditLog } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return;

    await db.insert(auditLog).values({
      id: randomUUID(),
      actor: params.actor,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      changes: params.changes ? params.changes : undefined,
      ipAddress: params.ipAddress,
    });

    log.info(`Audit: ${params.actor} → ${params.action}`, {
      entityType: params.entityType,
      entityId: params.entityId,
    });
  } catch (err) {
    // Never let audit logging break the main flow
    log.error("Audit log write failed", { error: err instanceof Error ? err.message : String(err) });
  }
}
