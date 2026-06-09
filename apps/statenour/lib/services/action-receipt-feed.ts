/**
 * Action receipt feed (F4) — a read-side answer to "what did Nick/system
 * actually DO?". Reuses the canonical audit store (EntityAudit, via the existing
 * getGlobalActivity/getActorActivity readers) + AutonomousAction (so FAILED
 * actions are visible), and maps both onto the EXISTING ActionReceipt contract
 * (lib/ai/receipts/action-receipt.ts) — integrate, don't duplicate.
 *
 * Pure mappers (auditEntryToReceipt / autonomousActionToReceipt) are unit-tested;
 * the wrapper does the reads. Read-only — no writes.
 *
 * See docs/project/NEXT-INTELLIGENCE-WAVE.md (F4).
 */

import type { ActionReceipt, ReceiptStatus } from "@/lib/ai/receipts/action-receipt";
import type { AuditEntry } from "@/lib/db/entity-audit";
import { getGlobalActivity } from "@/lib/db/entity-audit";
import { prisma } from "@/lib/prisma";

/** EntityAudit actions are all completed mutations → success; soft_deleted is undoable. */
function auditStatus(action: string): { status: ReceiptStatus; undoAvailable: boolean } {
  switch (action) {
    case "soft_deleted":
      return { status: "success", undoAvailable: true }; // reversible
    case "created":
    case "updated":
    case "restored":
      return { status: "success", undoAvailable: false };
    case "purged":
      return { status: "success", undoAvailable: false }; // hard delete — not reversible
    default:
      return { status: "success", undoAvailable: false };
  }
}

const VERB: Record<string, string> = {
  created: "Created", updated: "Updated", soft_deleted: "Archived",
  restored: "Restored", purged: "Deleted",
};

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

/** Map an EntityAudit entry → ActionReceipt. Pure. */
export function auditEntryToReceipt(e: AuditEntry): ActionReceipt {
  const { status, undoAvailable } = auditStatus(e.action);
  const verb = VERB[e.action] ?? e.action;
  const label = `${e.entityType} ${shortId(e.entityId)}`;
  return {
    receiptId: `audit_${e.id}`,
    toolName: `${e.entityType}.${e.action}`,
    category: "entity-audit",
    sideEffecting: true, // every audited row is a write
    status,
    entityType: e.entityType,
    entityId: e.entityId,
    label,
    userVisibleSummary: `${verb} ${label}${e.reason ? ` — ${e.reason}` : ""}.`,
    errorSafeMessage: undefined,
    undoAvailable,
    metadata: { actor: e.actor, source: e.source ?? null },
    createdAt: e.createdAt.toISOString(),
  };
}

/** AutonomousAction.result → receipt status (this is where FAILED actions surface). */
function autoStatus(action: { approval: string; executedAt: Date | null; result: string | null }): ReceiptStatus {
  if (action.result === "failed") return "failed";
  if (action.result === "success") return "success";
  if (action.result === "skipped") return "skipped";
  // Operator-rejected or policy-forbidden: it did NOT run → skipped, never "queued".
  if (action.approval === "rejected" || action.result === "forbidden_by_policy") return "skipped";
  if (action.approval === "pending" || action.result === "pending_approval") return "needs_approval";
  return "partial"; // queued/unknown — never assert done
}

export interface AutonomousActionRow {
  id: string;
  ruleName: string;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  approval: string;
  executedAt: Date | null;
  result: string | null;
  error: string | null;
  createdAt: Date;
}

/** Map an AutonomousAction row → ActionReceipt. Pure. */
export function autonomousActionToReceipt(a: AutonomousActionRow): ActionReceipt {
  const status = autoStatus(a);
  const label = a.targetType ? `${a.targetType}${a.targetId ? ` ${shortId(a.targetId)}` : ""}` : a.ruleName;
  const summaries: Record<ReceiptStatus, string> = {
    success: `Ran ${a.actionType} on ${label}.`,
    failed: `FAILED ${a.actionType} on ${label}.`,
    skipped: `Skipped ${a.actionType} on ${label}.`,
    needs_approval: `Awaiting approval: ${a.actionType} on ${label}.`,
    partial: `Queued ${a.actionType} on ${label} (unconfirmed).`,
  };
  return {
    receiptId: `auto_${a.id}`,
    toolName: a.actionType,
    category: "autonomous-action",
    sideEffecting: true,
    status,
    entityType: a.targetType ?? "rule",
    entityId: a.targetId ?? a.ruleName,
    label,
    userVisibleSummary: summaries[status],
    errorSafeMessage: status === "failed" && a.error ? a.error.split("\n")[0].slice(0, 200) : undefined,
    undoAvailable: false,
    metadata: { ruleName: a.ruleName, approval: a.approval },
    createdAt: a.createdAt.toISOString(),
  };
}

export interface ReceiptFeedResult {
  items: ActionReceipt[];
  counts: { total: number; success: number; failed: number; other: number };
}

/** Tally receipts by status. Pure. Always run on the list you actually return. */
export function countByStatus(items: ReadonlyArray<ActionReceipt>): ReceiptFeedResult["counts"] {
  let success = 0, failed = 0, other = 0;
  for (const r of items) {
    if (r.status === "success") success++;
    else if (r.status === "failed") failed++;
    else other++;
  }
  return { total: items.length, success, failed, other };
}

/** Merge + sort receipts newest-first; counts match the returned items. Pure. */
export function mergeReceipts(receipts: ActionReceipt[]): ReceiptFeedResult {
  const items = [...receipts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { items, counts: countByStatus(items) };
}

export interface ReceiptFeedDeps {
  loadAudit?: (limit: number) => Promise<AuditEntry[]>;
  loadAutonomous?: (limit: number) => Promise<AutonomousActionRow[]>;
  limit?: number;
}

async function defaultLoadAutonomous(limit: number): Promise<AutonomousActionRow[]> {
  return prisma.autonomousAction.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, ruleName: true, actionType: true, targetType: true, targetId: true,
      approval: true, executedAt: true, result: true, error: true, createdAt: true,
    },
  });
}

/** Build the receipt feed from EntityAudit + AutonomousAction. Read-only. */
export async function buildActionReceiptFeed(deps: ReceiptFeedDeps = {}): Promise<ReceiptFeedResult> {
  const limit = deps.limit ?? 50;
  const loadAudit = deps.loadAudit ?? ((l: number) => getGlobalActivity({ limit: l }));
  const loadAutonomous = deps.loadAutonomous ?? defaultLoadAutonomous;

  const [audits, autos] = await Promise.all([loadAudit(limit), loadAutonomous(limit)]);
  const receipts = [
    ...audits.map(auditEntryToReceipt),
    ...autos.map(autonomousActionToReceipt),
  ];
  // Sort + slice to `limit` FIRST, then count — so the counts always describe
  // exactly the items returned (we loaded up to 2×limit across both sources).
  const items = mergeReceipts(receipts).items.slice(0, limit);
  return { items, counts: countByStatus(items) };
}
