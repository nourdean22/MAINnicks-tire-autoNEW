/**
 * Action receipt feed (F4) — a read-side answer to "what did Nick/system
 * actually DO?". Reuses the canonical audit store (EntityAudit, via the existing
 * getGlobalActivity/getActorActivity readers) + AutonomousAction (so FAILED
 * ones are visible), and maps both onto the EXISTING ActionReceipt contract
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
    // This mapper runs from an already-persisted authoritative audit row,
    // not from the original tool response. The read-side audit record is the
    // independent evidence that the mutation reached canonical state.
    verificationState: "VERIFIED",
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

function verificationStateForAutonomousStatus(status: ReceiptStatus): ActionReceipt["verificationState"] {
  if (status === "failed") return "FAILED_KNOWN";
  if (status === "skipped" || status === "needs_approval") return "NOT_ATTEMPTED";
  if (status === "partial") return "UNKNOWN_COMPLETION";
  // A recorded executor success is still the executor/provider's own receipt.
  // Without an independent postcondition/read-back it is not strict VERIFIED.
  return "PROVIDER_ACCEPTED";
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
    verificationState: verificationStateForAutonomousStatus(status),
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

export interface ReceiptVerificationCounts {
  /** Only consequential/unclassifiable receipts participate in this denominator. */
  consequentialTotal: number;
  verified: number;
  providerAccepted: number;
  unknownCompletion: number;
  failedKnown: number;
  notAttempted: number;
  /** Historical/legacy consequential receipts with no strict state attached. */
  unmeasured: number;
}

export interface ReceiptFeedResult {
  items: ActionReceipt[];
  /** Legacy execution-status counts, kept for compatibility. */
  counts: { total: number; success: number; failed: number; other: number };
  /** Strict completion-truth census over consequential receipts only. */
  verificationCounts: ReceiptVerificationCounts;
}

/** Tally receipts by legacy execution status. Pure. Always run on the list actually returned. */
export function countByStatus(items: ReadonlyArray<ActionReceipt>): ReceiptFeedResult["counts"] {
  let success = 0, failed = 0, other = 0;
  for (const r of items) {
    if (r.status === "success") success++;
    else if (r.status === "failed") failed++;
    else other++;
  }
  return { total: items.length, success, failed, other };
}

/**
 * Tally strict completion truth over consequential receipts only.
 *
 * Known pure reads are intentionally excluded so a successful read cannot
 * inflate the number of independently verified mutations. Unknown/unclassifiable
 * receipts (`verifiable === false`) remain consequential because their effect
 * cannot honestly be assumed pure.
 *
 * Missing strict state is UNMEASURED — never inferred VERIFIED from legacy
 * `status: "success"`.
 */
export function countByVerification(
  items: ReadonlyArray<ActionReceipt>,
): ReceiptVerificationCounts {
  let consequentialTotal = 0;
  let verified = 0;
  let providerAccepted = 0;
  let unknownCompletion = 0;
  let failedKnown = 0;
  let notAttempted = 0;
  let unmeasured = 0;

  for (const r of items) {
    if (!r.sideEffecting && r.verifiable !== false) continue;
    consequentialTotal++;
    switch (r.verificationState) {
      case "VERIFIED":
        verified++;
        break;
      case "PROVIDER_ACCEPTED":
        providerAccepted++;
        break;
      case "UNKNOWN_COMPLETION":
        unknownCompletion++;
        break;
      case "FAILED_KNOWN":
        failedKnown++;
        break;
      case "NOT_ATTEMPTED":
        notAttempted++;
        break;
      default:
        unmeasured++;
        break;
    }
  }

  return {
    consequentialTotal,
    verified,
    providerAccepted,
    unknownCompletion,
    failedKnown,
    notAttempted,
    unmeasured,
  };
}

/** Merge + sort receipts newest-first; both count sets match the returned items. Pure. */
export function mergeReceipts(receipts: ActionReceipt[]): ReceiptFeedResult {
  const items = [...receipts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    items,
    counts: countByStatus(items),
    verificationCounts: countByVerification(items),
  };
}

/** An AuditEvent row of eventType "action_receipt" — payload is a serialized ActionReceipt. */
export interface AgentReceiptRow {
  id: string;
  payload: unknown;
  createdAt: Date;
}

const STATUSES: ReadonlySet<string> = new Set(["success", "failed", "skipped", "needs_approval", "partial"]);
const VERIFICATION_STATES: ReadonlySet<string> = new Set([
  "NOT_ATTEMPTED",
  "FAILED_KNOWN",
  "UNKNOWN_COMPLETION",
  "PROVIDER_ACCEPTED",
  "VERIFIED",
]);

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
  const verificationState =
    typeof p.verificationState === "string" && VERIFICATION_STATES.has(p.verificationState)
      ? (p.verificationState as ActionReceipt["verificationState"])
      : undefined;
  return {
    receiptId: str(p.receiptId) ?? `agent_${row.id}`,
    toolName: p.toolName,
    category: str(p.category) ?? "action-block",
    sideEffecting: p.sideEffecting !== false,
    // Preserve the fail-closed classification bit across persistence. Dropping
    // verifiable:false made an unknown failed tool become less strict after
    // serialization/read-back than it was at creation time.
    verifiable: typeof p.verifiable === "boolean" ? p.verifiable : undefined,
    status,
    verificationState,
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
  // so both count sets always describe exactly the items returned (we load up
  // to 3×limit across the sources).
  const items = dedupeById(mergeReceipts(receipts).items).slice(0, limit);
  return {
    items,
    counts: countByStatus(items),
    verificationCounts: countByVerification(items),
  };
}
