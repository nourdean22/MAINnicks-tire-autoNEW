import { randomUUID } from "crypto";
import { desc, eq, sql } from "drizzle-orm";
import { auditLog } from "../../drizzle/schema";
import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";

export async function recordAdminAction(input: {
  actor: string;
  action: string;
  entityType?: string | null;
  entityId?: string | number | null;
  changes?: Record<string, unknown> | null;
  ipAddress?: string | null;
}): Promise<string> {
  const reference = `ACT-${randomUUID().slice(0, 8).toUpperCase()}`;
  const database = await db();
  if (!database) return reference;
  await database.insert(auditLog).values({
    id: randomUUID(),
    actor: input.actor.slice(0, 100),
    action: input.action.slice(0, 100),
    entityType: input.entityType ?? null,
    entityId: input.entityId == null ? null : String(input.entityId),
    changes: { reference, ...(input.changes ?? {}) },
    ipAddress: input.ipAddress?.slice(0, 45) ?? null,
  });
  return reference;
}

export async function getRecentAdminActions(limit = 50) {
  const database = await db();
  if (!database) return [];
  return database
    // Explicit pre-0110 projection: a bare select() enumerates every schema
    // column, which breaks against a database that has not hand-applied the
    // 0110 ledger columns yet.
    .select({
      id: auditLog.id,
      actor: auditLog.actor,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      changes: auditLog.changes,
      ipAddress: auditLog.ipAddress,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(eq(auditLog.entityType, "admin_action"))
    .orderBy(desc(auditLog.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}

export type QueueFeedbackSummary =
  | {
      readable: true;
      total: number;
      since: string | null;
      byType: Array<{ itemType: string; keep: number; less: number }>;
    }
  | { readable: false; reason: string };

const log = createLogger("admin-audit");

/**
 * The Keep/Less verdicts the Today board records through adminSecurity.recordAction
 * (action `admin.queue_feedback`, changes `{ verdict, itemType, source }`), summed per item type.
 *
 * A dead database or a failed query is `readable: false`, never zeros: W6's two-week clock must not
 * start (or read "nothing marked") because a read failed. A genuinely empty table is a real zero.
 *
 * Counted in SQL, not by fetching rows. `since` is UNIX_TIMESTAMP(MIN(created_at)) turned into an ISO
 * string here, so the driver's DATETIME parsing (shifted on ET) never touches it. The WHERE rides
 * idx_audit_entity (entity_type prefix); `action` and the JSON verdict are filtered after that range
 * read, which is correct without a new index. Only pre-0110 columns are named.
 */
export async function getQueueFeedbackSummary(): Promise<QueueFeedbackSummary> {
  try {
    const database = await db();
    if (!database) return { readable: false, reason: "database unavailable" };
    const result = await database.execute(sql`
      SELECT COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(changes, '$.itemType')), 'null'), 'unknown') AS itemType,
             SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(changes, '$.verdict')) = 'keep' THEN 1 ELSE 0 END) AS keepN,
             SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(changes, '$.verdict')) = 'less' THEN 1 ELSE 0 END) AS lessN,
             UNIX_TIMESTAMP(MIN(created_at)) AS firstAt
      FROM audit_log
      WHERE entity_type = 'admin_action'
        AND action = 'admin.queue_feedback'
        AND JSON_UNQUOTE(JSON_EXTRACT(changes, '$.verdict')) IN ('keep', 'less')
      GROUP BY itemType
      ORDER BY itemType
    `);
    const list = Array.isArray(result) ? result[0] : result;
    const rows = Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
    const byType: Array<{ itemType: string; keep: number; less: number }> = [];
    let total = 0;
    let firstEpoch: number | null = null;
    for (const row of rows) {
      const keep = Number(row.keepN);
      const less = Number(row.lessN);
      if (!Number.isFinite(keep) || !Number.isFinite(less) || keep + less <= 0) continue;
      byType.push({ itemType: String(row.itemType ?? "unknown"), keep, less });
      total += keep + less;
      const epoch = Number(row.firstAt);
      if (Number.isFinite(epoch) && (firstEpoch === null || epoch < firstEpoch)) firstEpoch = epoch;
    }
    return {
      readable: true,
      total,
      since: firstEpoch === null ? null : new Date(firstEpoch * 1000).toISOString(),
      byType,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.warn("queue feedback summary unreadable", { error: reason });
    return { readable: false, reason };
  }
}

export async function reportAdminClientError(input: {
  actor: string;
  reference: string;
  section: string;
  message: string;
  componentStack?: string | null;
  path?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}) {
  return recordAdminAction({
    actor: input.actor,
    action: "admin.client_error",
    entityType: "admin_action",
    entityId: input.reference,
    changes: {
      reference: input.reference,
      section: input.section.slice(0, 80),
      message: input.message.slice(0, 500),
      componentStack: input.componentStack?.slice(0, 2000) ?? null,
      path: input.path?.slice(0, 500) ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    },
    ipAddress: input.ipAddress,
  });
}
