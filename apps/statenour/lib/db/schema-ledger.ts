/**
 * Schema-change ledger helpers · v10 Track B.4 · Apr 30.
 *
 * Every schema change must produce one row in SchemaChangeLedger.
 * This module is the single way to write to that table — keep all
 * future schema-tracking call sites here.
 *
 * See docs/DB-MIGRATION-POLICY.md for the policy contract.
 */

import { prisma } from "@/lib/prisma";

export type ChangeType =
  | "add_column"
  | "drop_column"
  | "alter_index"
  | "fk_change"
  | "enum_add"
  | "rename"
  | "add_table"
  | "drop_table"
  | "other";

export type ChangeMethod = "db_push" | "migrate" | "raw_sql";

export type ChangeEnvironment = "local" | "preview" | "production";

export type ChangeStatus = "planned" | "applied" | "rolled_back" | "failed";

export interface RecordSchemaChangeInput {
  changeKey: string;
  title: string;
  reason: string;
  changeType: ChangeType;
  method: ChangeMethod;
  environment: ChangeEnvironment;
  sqlSummary?: string;
  prismaDiff?: string;
  destructive?: boolean;
  approvedBy?: string;
  rollbackPlan?: string;
}

export interface ApplySchemaChangeInput {
  changeKey: string;
  appliedBy?: string;
}

/**
 * Record a planned schema change.
 *
 * Idempotent on changeKey — if a row already exists with this key,
 * returns the existing row without modification (so a re-run of the
 * same script doesn't create duplicates).
 */
export async function recordSchemaChange(
  input: RecordSchemaChangeInput,
): Promise<{ id: string; created: boolean }> {
  if (input.destructive && !input.approvedBy) {
    throw new Error(
      `recordSchemaChange: destructive changes require approvedBy (key=${input.changeKey})`,
    );
  }
  if (input.destructive && !input.rollbackPlan) {
    throw new Error(
      `recordSchemaChange: destructive changes require rollbackPlan (key=${input.changeKey})`,
    );
  }

  const existing = await prisma.schemaChangeLedger.findUnique({
    where: { changeKey: input.changeKey },
    select: { id: true },
  });
  if (existing) {
    return { id: existing.id, created: false };
  }

  const created = await prisma.schemaChangeLedger.create({
    data: {
      changeKey: input.changeKey,
      title: input.title,
      reason: input.reason,
      changeType: input.changeType,
      method: input.method,
      environment: input.environment,
      sqlSummary: input.sqlSummary ?? null,
      prismaDiff: input.prismaDiff ?? null,
      destructive: input.destructive ?? false,
      approvedBy: input.approvedBy ?? null,
      rollbackPlan: input.rollbackPlan ?? null,
      status: "planned",
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

/**
 * Mark a previously-recorded schema change as applied.
 *
 * Sets status="applied" + appliedAt=now. Throws if the row doesn't
 * exist (caller forgot to call recordSchemaChange first).
 */
export async function markSchemaChangeApplied(
  input: ApplySchemaChangeInput,
): Promise<void> {
  const result = await prisma.schemaChangeLedger.updateMany({
    where: { changeKey: input.changeKey, status: "planned" },
    data: {
      status: "applied",
      appliedBy: input.appliedBy ?? "operator",
      appliedAt: new Date(),
    },
  });
  if (result.count === 0) {
    throw new Error(
      `markSchemaChangeApplied: no planned ledger row found for key=${input.changeKey}`,
    );
  }
}

/**
 * Mark a schema change as failed (the apply step errored).
 */
export async function markSchemaChangeFailed(
  changeKey: string,
  error: string,
): Promise<void> {
  await prisma.schemaChangeLedger.updateMany({
    where: { changeKey, status: "planned" },
    data: {
      status: "failed",
      sqlSummary: `[FAILED] ${error.slice(0, 1000)}`,
    },
  });
}

/**
 * Mark a schema change as rolled back. Includes the rollback
 * timestamp + actor in the ledger.
 */
export async function markSchemaChangeRolledBack(
  changeKey: string,
  rolledBackBy: string,
): Promise<void> {
  await prisma.schemaChangeLedger.updateMany({
    where: { changeKey, status: "applied" },
    data: {
      status: "rolled_back",
      sqlSummary: `[ROLLED-BACK by ${rolledBackBy} at ${new Date().toISOString()}]`,
    },
  });
}

/**
 * Operator dashboard query — returns the most recent N ledger
 * entries with full detail for /system/schema-history.
 */
export async function listRecentSchemaChanges(opts: {
  limit?: number;
  environment?: ChangeEnvironment;
} = {}): Promise<
  Array<{
    id: string;
    changeKey: string;
    title: string;
    reason: string;
    changeType: string;
    method: string;
    environment: string;
    destructive: boolean;
    status: string;
    appliedAt: Date | null;
    appliedBy: string | null;
    approvedBy: string | null;
    rollbackPlan: string | null;
    sqlSummary: string | null;
    prismaDiff: string | null;
    createdAt: Date;
  }>
> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  return prisma.schemaChangeLedger.findMany({
    where: opts.environment ? { environment: opts.environment } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      changeKey: true,
      title: true,
      reason: true,
      changeType: true,
      method: true,
      environment: true,
      destructive: true,
      status: true,
      appliedAt: true,
      appliedBy: true,
      approvedBy: true,
      rollbackPlan: true,
      sqlSummary: true,
      prismaDiff: true,
      createdAt: true,
    },
  });
}

/**
 * Aggregate stats for the dashboard summary.
 */
export async function getSchemaLedgerStats(): Promise<{
  totalChanges: number;
  appliedLast24h: number;
  appliedLast7d: number;
  pendingPlanned: number;
  failedLast24h: number;
  destructiveLast30d: number;
}> {
  const day = new Date(Date.now() - 86_400_000);
  const week = new Date(Date.now() - 7 * 86_400_000);
  const month = new Date(Date.now() - 30 * 86_400_000);

  const [total, applied24h, applied7d, planned, failed24h, destructive30d] =
    await Promise.all([
      prisma.schemaChangeLedger.count(),
      prisma.schemaChangeLedger.count({
        where: { status: "applied", appliedAt: { gte: day } },
      }),
      prisma.schemaChangeLedger.count({
        where: { status: "applied", appliedAt: { gte: week } },
      }),
      prisma.schemaChangeLedger.count({ where: { status: "planned" } }),
      prisma.schemaChangeLedger.count({
        where: { status: "failed", updatedAt: { gte: day } },
      }),
      prisma.schemaChangeLedger.count({
        where: { destructive: true, createdAt: { gte: month } },
      }),
    ]);

  return {
    totalChanges: total,
    appliedLast24h: applied24h,
    appliedLast7d: applied7d,
    pendingPlanned: planned,
    failedLast24h: failed24h,
    destructiveLast30d: destructive30d,
  };
}
