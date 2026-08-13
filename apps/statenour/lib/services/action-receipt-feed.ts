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
  /** BDN-204 · optional payload carrying plannedOutcome/outcomeVsPlan. */
  payload?: unknown;
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
    // BDN-204 · surface the pre-filed plan + plan-vs-outcome diff when the
    // rule registered one. Unknown payload shapes pass through as absent.
    metadata: {
      ruleName: a.ruleName,
      approval: a.approval,
      ...(() => {
        const p = a.payload as
          | { plannedOutcome?: { statement?: string }; outcomeVsPlan?: { planned?: string | null; actual?: string } }
          | null
          | undefined;
        if (!p?.plannedOutcome?.statement) return {};
        return {
          plannedOutcome: p.plannedOutcome.statement,
          ...(p.outcomeVsPlan ? { outcomeVsPlan: p.outcomeVsPlan } : {}),
        };
      })(),
    },
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

/** An AuditEvent row of eventType "action_receipt" — payload is a serialized ActionReceipt. */
export interface AgentReceiptRow {
  id: string;
  payload: unknown;
  createdAt: Date;
}

const STATUSES: ReadonlySet<string> = new Set(["success", "failed", "skipped", "needs_approval", "partial"]);

/**
 * Map a persisted action_receipt AuditEvent row back to an ActionReceipt.
 * Defensive (payload is Json/unknown) — reconstructs a flat, typed receipt so no
 * Prisma JsonValue leaks into the feed return (TS2589-safe). Pure.
 */
export function auditEventToReceipt(row: AgentReceiptRow): ActionReceipt | null {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  if (typeof p.toolName !== "string") return null;
  const status = (typeof p.status === "string" && STATUSES.has(p.status) ? p.status : "partial") as ReceiptStatus;
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return {
    receiptId: str(p.receiptId) ?? `agent_${row.id}`,
    toolName: p.toolName,
    category: str(p.category) ?? "action-block",
    sideEffecting: p.sideEffecting !== false,
    status,
    entityType: str(p.entityType),
    entityId: str(p.entityId),
    label: str(p.label),
    userVisibleSummary: str(p.userVisibleSummary) ?? p.toolName,
    errorSafeMessage: str(p.errorSafeMessage),
    undoAvailable: p.undoAvailable === true,
    metadata: undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ReceiptFeedDeps {
  loadAudit?: (limit: number) => Promise<AuditEntry[]>;
  loadAutonomous?: (limit: number) => Promise<AutonomousActionRow[]>;
  /** Wire 1 · persisted chat action-block receipts (AuditEvent action_receipt). */
  loadAgentReceipts?: (limit: number) => Promise<ActionReceipt[]>;
  limit?: number;
}

async function defaultLoadAutonomous(limit: number): Promise<AutonomousActionRow[]> {
  return prisma.autonomousAction.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, ruleName: true, actionType: true, targetType: true, targetId: true,
      approval: true, executedAt: true, result: true, error: true, createdAt: true,
      payload: true, // BDN-204 · plannedOutcome/outcomeVsPlan surface
    },
  });
}

async function defaultLoadAgentReceipts(limit: number): Promise<ActionReceipt[]> {
  const rows = await prisma.auditEvent.findMany({
    where: { eventType: "action_receipt" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, payload: true, createdAt: true },
  });
  return rows.map(auditEventToReceipt).filter((r): r is ActionReceipt => r != null);
}

/** Drop duplicate receiptIds (keep the first after the newest-first sort). Pure. */
function dedupeById(receipts: ActionReceipt[]): ActionReceipt[] {
  const seen = new Set<string>();
  const out: ActionReceipt[] = [];
  for (const r of receipts) {
    if (seen.has(r.receiptId)) continue;
    seen.add(r.receiptId);
    out.push(r);
  }
  return out;
}

/** Build the receipt feed from EntityAudit + AutonomousAction + chat action receipts. Read-only. */
export async function buildActionReceiptFeed(deps: ReceiptFeedDeps = {}): Promise<ReceiptFeedResult> {
  const limit = deps.limit ?? 50;
  const loadAudit = deps.loadAudit ?? ((l: number) => getGlobalActivity({ limit: l }));
  const loadAutonomous = deps.loadAutonomous ?? defaultLoadAutonomous;
  const loadAgentReceipts = deps.loadAgentReceipts ?? defaultLoadAgentReceipts;

  const [audits, autos, agent] = await Promise.all([
    loadAudit(limit),
    loadAutonomous(limit),
    loadAgentReceipts(limit),
  ]);
  const receipts = [
    ...audits.map(auditEntryToReceipt),
    ...autos.map(autonomousActionToReceipt),
    ...agent,
  ];
  // Sort newest-first, dedupe by receiptId, slice to `limit` FIRST, then count —
  // so the counts always describe exactly the items returned (we load up to
  // 3×limit across the sources).
  const items = dedupeById(mergeReceipts(receipts).items).slice(0, limit);
  return { items, counts: countByStatus(items) };
}
