import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { auditLog } from "../../drizzle/schema";
import { db } from "../lib/db-helper";

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
