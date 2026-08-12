/**
 * Snap Finance Applications — log + query via the existing audit_log table.
 *
 * We avoid a new DB migration by using audit_log's `changes` JSON column
 * for application details. Actions:
 *   - snap.application_submitted
 *   - snap.application_status_changed
 *
 * Later: migrate to a dedicated `snap_applications` table when we have
 * a staging env for the migration sprint.
 */

import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { auditLog } from "../../drizzle/schema";
import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";

const log = createLogger("snap-applications");

export interface SnapApplicationInput {
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  amount?: number;
  vehicle?: string;
  service?: string;
  externalApplicationId?: string | null;
  status?: string;
  ipAddress?: string | null;
}

export async function recordSnapApplication(input: SnapApplicationInput): Promise<string> {
  const d = await db();
  const id = randomUUID();
  if (!d) return id;

  try {
    await d.insert(auditLog).values({
      id,
      actor: input.customerPhone.slice(0, 100),
      action: "snap.application_submitted",
      entityType: "snap_application",
      entityId: input.externalApplicationId ?? id,
      changes: {
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerEmail: input.customerEmail ?? null,
        amount: input.amount ?? null,
        vehicle: input.vehicle ?? null,
        service: input.service ?? null,
        externalApplicationId: input.externalApplicationId ?? null,
        status: input.status ?? "pending",
      },
      ipAddress: input.ipAddress?.slice(0, 45) ?? null,
    });
  } catch (err) {
    log.warn("recordSnapApplication failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return id;
}

export async function updateSnapApplicationStatus(input: {
  externalApplicationId: string;
  status: string;
  amount?: number;
}): Promise<void> {
  const d = await db();
  if (!d) return;

  try {
    await d.insert(auditLog).values({
      id: randomUUID(),
      actor: "snap-webhook",
      action: "snap.application_status_changed",
      entityType: "snap_application",
      entityId: input.externalApplicationId,
      changes: {
        externalApplicationId: input.externalApplicationId,
        newStatus: input.status,
        amount: input.amount ?? null,
      },
      ipAddress: null,
    });
  } catch (err) {
    log.warn("updateSnapApplicationStatus failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface SnapApplicationRow {
  id: string;
  submittedAt: Date;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  amount: number | null;
  vehicle: string | null;
  service: string | null;
  externalApplicationId: string | null;
  status: string;
  statusHistory: Array<{ status: string; at: Date }>;
}

/**
 * List recent Snap applications. Joins submission + status-change events
 * so each application surfaces with its latest status.
 */
export async function listSnapApplications(limit: number = 50): Promise<SnapApplicationRow[]> {
  const d = await db();
  if (!d) return [];

  try {
    // Explicit projections (only the fields the mapping below reads): a bare
    // select() enumerates every schema column, which breaks against a database
    // that has not hand-applied the 0110 ledger columns yet.
    const [submissions, statusChanges] = await Promise.all([
      d.select({ id: auditLog.id, entityId: auditLog.entityId, changes: auditLog.changes, createdAt: auditLog.createdAt })
        .from(auditLog)
        .where(eq(auditLog.action, "snap.application_submitted"))
        .orderBy(desc(auditLog.createdAt))
        .limit(limit),
      d.select({ entityId: auditLog.entityId, changes: auditLog.changes, createdAt: auditLog.createdAt })
        .from(auditLog)
        .where(eq(auditLog.action, "snap.application_status_changed"))
        .orderBy(desc(auditLog.createdAt))
        .limit(500),
    ]);

    const statusByApp = new Map<string, Array<{ status: string; at: Date }>>();
    for (const sc of statusChanges as unknown as Array<{
      entityId: string | null;
      changes: { newStatus?: string } | null;
      createdAt: Date;
    }>) {
      if (!sc.entityId || !sc.changes?.newStatus) continue;
      const list = statusByApp.get(sc.entityId) ?? [];
      list.push({ status: sc.changes.newStatus, at: sc.createdAt });
      statusByApp.set(sc.entityId, list);
    }

    return (submissions as unknown as Array<{
      id: string;
      entityId: string | null;
      createdAt: Date;
      changes: {
        customerName?: string;
        customerPhone?: string;
        customerEmail?: string | null;
        amount?: number | null;
        vehicle?: string | null;
        service?: string | null;
        externalApplicationId?: string | null;
        status?: string;
      } | null;
    }>).map((row) => {
      const key = row.entityId ?? row.id;
      const history = statusByApp.get(key) ?? [];
      const latestStatus = history.length > 0 ? history[0].status : (row.changes?.status ?? "pending");
      return {
        id: row.id,
        submittedAt: row.createdAt,
        customerName: row.changes?.customerName ?? "Unknown",
        customerPhone: row.changes?.customerPhone ?? "",
        customerEmail: row.changes?.customerEmail ?? null,
        amount: row.changes?.amount ?? null,
        vehicle: row.changes?.vehicle ?? null,
        service: row.changes?.service ?? null,
        externalApplicationId: row.changes?.externalApplicationId ?? null,
        status: latestStatus,
        statusHistory: history,
      };
    });
  } catch (err) {
    log.warn("listSnapApplications failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export async function getSnapSummary(): Promise<{
  total: number;
  pending: number;
  approved: number;
  declined: number;
  totalApprovedAmount: number;
}> {
  const rows = await listSnapApplications(500);
  const summary = { total: rows.length, pending: 0, approved: 0, declined: 0, totalApprovedAmount: 0 };
  for (const r of rows) {
    if (r.status === "approved") {
      summary.approved++;
      summary.totalApprovedAmount += r.amount ?? 0;
    } else if (r.status === "declined" || r.status === "rejected") {
      summary.declined++;
    } else {
      summary.pending++;
    }
  }
  return summary;
}
