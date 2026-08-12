/**
 * Proposals — the generic approval queue (trust ladder, 0111).
 *
 * A proposal is an INTENT: a typed payload naming an action the system (or an
 * operator one-tap) wants performed, held for human review. The safety
 * property this module enforces is BACKEND-ENFORCED APPROVAL:
 *
 *   · the only public write paths are createProposal + the review
 *     transitions; nothing else executes an action;
 *   · execution happens exclusively inside approveAndExecute /
 *     retryExecution, after a compare-and-set claim on the row's status —
 *     two concurrent approvers race on the CAS and exactly one wins
 *     (revenue_opportunities' transition pattern, affectedRowCount-gated);
 *   · executors create INTERNAL records only (callback_requests, bookings).
 *     Customer-facing side effects (SMS/voice/email/social) are banned from
 *     this registry by policy — an executor that wants to reach a customer
 *     must go through the operator-gated send lanes, not this queue.
 *
 * Every lifecycle step writes an attributed audit_log row through the Phase 1
 * ledger (action proposal.*, status 'proposed' until execution).
 */
import { randomUUID } from "crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { adminProposals, type AdminProposal } from "../../drizzle/schema";
import { affectedRowCount } from "../lib/db-affected";
import { db } from "../lib/db-helper";
import { createLogger } from "../lib/logger";
import { recordActivity, type LedgerActor } from "./activityLedger";

const log = createLogger("proposals");

// ─── State machine ──────────────────────────────────────────────────────────

export const PROPOSAL_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "executing",
  "executed",
  "failed",
  "rejected",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/**
 * Allowed transitions. Terminal states have no exits except failed → approved
 * (an operator retry re-approves, then re-runs the executor).
 */
export const PROPOSAL_TRANSITIONS: Record<ProposalStatus, readonly ProposalStatus[]> = {
  draft: ["pending_review", "approved", "rejected"],
  pending_review: ["approved", "rejected"],
  approved: ["executing"],
  executing: ["executed", "failed"],
  failed: ["approved"],
  executed: [],
  rejected: [],
};

export function canTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  return (PROPOSAL_TRANSITIONS[from] ?? []).includes(to);
}

/** Statuses the queue UI treats as "needs a human decision". */
export const REVIEWABLE_STATUSES: readonly ProposalStatus[] = ["draft", "pending_review"];

// ─── Executor registry ──────────────────────────────────────────────────────

export interface ProposalExecutor {
  actionType: string;
  /** Short human label shown beside the Approve button. */
  label: string;
  /** What approval will do, in one sentence — rendered in the review UI. */
  describe: string;
  payloadSchema: z.ZodTypeAny;
  /**
   * Perform the approved action. INTERNAL records only — never a customer
   * send. Returns a small result summary persisted to execution_result_json.
   */
  execute(payload: unknown): Promise<Record<string, unknown>>;
}

export const createCallbackPayload = z.object({
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().min(7).max(30),
  reason: z.string().trim().min(1).max(1000),
  sourcePage: z.string().max(255).optional(),
});

export const createBookingRequestPayload = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(7).max(30),
  service: z.string().trim().min(1).max(100),
  preferredDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "preferredDate must be YYYY-MM-DD")
    .optional(),
  note: z.string().max(2000).optional(),
});

const EXECUTORS: readonly ProposalExecutor[] = [
  {
    actionType: "create_callback",
    label: "Create callback",
    describe: "Creates a callback_requests row for the front desk to work — no customer contact happens.",
    payloadSchema: createCallbackPayload,
    async execute(payload) {
      const p = createCallbackPayload.parse(payload);
      const { createCallbackRequest } = await import("../db");
      const result = await createCallbackRequest({
        name: p.name,
        phone: p.phone,
        context: p.reason,
        sourcePage: p.sourcePage ?? "admin-proposal",
      });
      return { callbackId: result.id };
    },
  },
  {
    actionType: "create_booking_request",
    label: "Create booking request",
    describe: "Creates a bookings row (status 'new') for triage — no confirmation SMS is sent until an operator confirms it.",
    payloadSchema: createBookingRequestPayload,
    async execute(payload) {
      const p = createBookingRequestPayload.parse(payload);
      const { createBooking } = await import("../db");
      const referenceCode = `AP${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
      const result = await createBooking({
        name: p.name,
        phone: p.phone,
        service: p.service,
        preferredDate: p.preferredDate ?? null,
        message: p.note ?? null,
        referenceCode,
      });
      return { bookingId: result.id, referenceCode };
    },
  },
];

export function getExecutor(actionType: string): ProposalExecutor | undefined {
  return EXECUTORS.find((e) => e.actionType === actionType);
}

export function listExecutors(): Array<Pick<ProposalExecutor, "actionType" | "label" | "describe">> {
  return EXECUTORS.map(({ actionType, label, describe }) => ({ actionType, label, describe }));
}

// ─── Creation ───────────────────────────────────────────────────────────────

export interface CreateProposalInput {
  source: "nick_receptionist" | "ai_agent" | "human_user" | "system";
  actor: string;
  actionType: string;
  title: string;
  payload: unknown;
  entityType?: string | null;
  entityId?: string | null;
  context?: Record<string, unknown> | null;
  /** 0-100; null for human-originated proposals. */
  confidence?: number | null;
  /** At-most-once key (e.g. `vapi:<callId>:<action>`); dedup via DB unique index. */
  idempotencyKey?: string | null;
}

export type CreateProposalResult =
  | { created: true; id: string }
  | { created: false; deduped: true; id: string }
  | { created: false; deduped: false; error: string };

/**
 * Create a draft proposal. The payload is validated against the executor's
 * schema NOW, at intake — a malformed draft that could never execute must not
 * sit in the queue looking approvable.
 */
export async function createProposal(input: CreateProposalInput): Promise<CreateProposalResult> {
  const executor = getExecutor(input.actionType);
  if (!executor) {
    return { created: false, deduped: false, error: `Unknown action type: ${input.actionType}` };
  }
  const parsed = executor.payloadSchema.safeParse(input.payload);
  if (!parsed.success) {
    return {
      created: false,
      deduped: false,
      error: `Invalid payload for ${input.actionType}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    };
  }

  const d = await db();
  if (!d) return { created: false, deduped: false, error: "Database not available" };

  if (input.idempotencyKey) {
    const [existing] = await d
      .select({ id: adminProposals.id })
      .from(adminProposals)
      .where(eq(adminProposals.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing) return { created: false, deduped: true, id: existing.id };
  }

  const id = randomUUID();
  try {
    await d.insert(adminProposals).values({
      id,
      source: input.source,
      actor: input.actor.slice(0, 100),
      actionType: input.actionType,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      title: input.title.slice(0, 255),
      payloadJson: parsed.data as Record<string, unknown>,
      contextJson: input.context ?? null,
      confidence: input.confidence ?? null,
      status: "draft",
      idempotencyKey: input.idempotencyKey ?? null,
    });
  } catch (err) {
    // Unique-index race on the idempotency key: the row exists — that IS the
    // at-most-once guarantee working. Re-select and report the dedup.
    const message = err instanceof Error ? err.message : String(err);
    if (input.idempotencyKey && /duplicate/i.test(message)) {
      const [existing] = await d
        .select({ id: adminProposals.id })
        .from(adminProposals)
        .where(eq(adminProposals.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing) return { created: false, deduped: true, id: existing.id };
    }
    log.error("proposal insert failed", { actionType: input.actionType, error: message });
    return { created: false, deduped: false, error: message };
  }

  await recordActivity({
    action: "proposal.created",
    entityType: "proposal",
    entityId: id,
    actor: { actor: input.actor, actorType: input.source === "human_user" ? "human_user" : input.source },
    after: { actionType: input.actionType, title: input.title, confidence: input.confidence ?? null },
    status: "proposed",
    idempotencyKey: input.idempotencyKey ? `ledger:${input.idempotencyKey}` : null,
  });

  return { created: true, id };
}

// ─── Transitions ────────────────────────────────────────────────────────────

interface TransitionExtras {
  reviewedBy?: string;
  reviewNote?: string | null;
  executionResult?: Record<string, unknown> | null;
}

/**
 * Compare-and-set transition: UPDATE ... WHERE id = ? AND status IN (from).
 * Returns false when the row was not in an eligible status — the caller
 * surfaces that as a conflict, never silently proceeds. affectedRowCount
 * handles the drizzle/mysql2 tuple shape (lib/db-affected.ts).
 */
async function casTransition(
  id: string,
  from: readonly ProposalStatus[],
  to: ProposalStatus,
  extras: TransitionExtras = {},
): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  for (const f of from) {
    if (!canTransition(f, to)) {
      throw new Error(`Illegal transition ${f} → ${to}`);
    }
  }
  const set: Record<string, unknown> = { status: to };
  if (extras.reviewedBy !== undefined) {
    set.reviewedBy = extras.reviewedBy.slice(0, 100);
    set.reviewedAt = new Date();
  }
  if (extras.reviewNote !== undefined) set.reviewNote = extras.reviewNote;
  if (extras.executionResult !== undefined) set.executionResultJson = extras.executionResult;
  if (to === "executed") set.executedAt = new Date();

  const result = await d
    .update(adminProposals)
    .set(set)
    .where(and(eq(adminProposals.id, id), inArray(adminProposals.status, [...from])));
  return affectedRowCount(result) === 1;
}

export async function getProposal(id: string): Promise<AdminProposal | null> {
  const d = await db();
  if (!d) return null;
  const [row] = await d.select().from(adminProposals).where(eq(adminProposals.id, id)).limit(1);
  return row ?? null;
}

export interface ReviewOutcome {
  ok: boolean;
  status: ProposalStatus | "missing";
  error?: string;
  result?: Record<string, unknown>;
}

async function auditTransition(
  id: string,
  action: "proposal.submitted" | "proposal.approved" | "proposal.rejected" | "proposal.executed" | "proposal.execution_failed",
  reviewer: LedgerActor,
  detail: Record<string, unknown>,
): Promise<void> {
  await recordActivity({
    action,
    entityType: "proposal",
    entityId: id,
    actor: reviewer,
    after: detail,
    status: action === "proposal.executed" ? "executed" : "proposed",
  });
}

export async function submitForReview(id: string, reviewer: LedgerActor): Promise<ReviewOutcome> {
  const moved = await casTransition(id, ["draft"], "pending_review");
  if (!moved) {
    const row = await getProposal(id);
    return { ok: false, status: (row?.status as ProposalStatus) ?? "missing", error: "Not in draft" };
  }
  await auditTransition(id, "proposal.submitted", reviewer, { to: "pending_review" });
  return { ok: true, status: "pending_review" };
}

export async function rejectProposal(
  id: string,
  reviewer: LedgerActor,
  note?: string,
): Promise<ReviewOutcome> {
  const moved = await casTransition(id, ["draft", "pending_review"], "rejected", {
    reviewedBy: reviewer.actor,
    reviewNote: note ?? null,
  });
  if (!moved) {
    const row = await getProposal(id);
    return {
      ok: false,
      status: (row?.status as ProposalStatus) ?? "missing",
      error: "Not reviewable — already decided or executing",
    };
  }
  await auditTransition(id, "proposal.rejected", reviewer, { note: note ?? null });
  return { ok: true, status: "rejected" };
}

/**
 * The ONE execution path. Approve claims the row (CAS), a second CAS claims
 * execution, the executor runs, and the terminal status is written with the
 * result. A rejected/executed row can never reach here; a concurrent approver
 * loses the first CAS and gets a conflict, not a double execution.
 */
export async function approveAndExecute(id: string, reviewer: LedgerActor): Promise<ReviewOutcome> {
  const approved = await casTransition(id, ["draft", "pending_review"], "approved", {
    reviewedBy: reviewer.actor,
  });
  if (!approved) {
    const row = await getProposal(id);
    return {
      ok: false,
      status: (row?.status as ProposalStatus) ?? "missing",
      error: "Not reviewable — already decided or executing",
    };
  }
  await auditTransition(id, "proposal.approved", reviewer, { to: "approved" });
  return runExecution(id, reviewer);
}

/** Operator retry for a failed execution: failed → approved → executing → …. */
export async function retryExecution(id: string, reviewer: LedgerActor): Promise<ReviewOutcome> {
  const reApproved = await casTransition(id, ["failed"], "approved", { reviewedBy: reviewer.actor });
  if (!reApproved) {
    const row = await getProposal(id);
    return { ok: false, status: (row?.status as ProposalStatus) ?? "missing", error: "Not in failed" };
  }
  return runExecution(id, reviewer);
}

async function runExecution(id: string, reviewer: LedgerActor): Promise<ReviewOutcome> {
  const claimed = await casTransition(id, ["approved"], "executing");
  if (!claimed) {
    const row = await getProposal(id);
    return { ok: false, status: (row?.status as ProposalStatus) ?? "missing", error: "Execution already claimed" };
  }

  const row = await getProposal(id);
  if (!row) return { ok: false, status: "missing", error: "Proposal vanished mid-execution" };

  const executor = getExecutor(row.actionType);
  if (!executor) {
    await casTransition(id, ["executing"], "failed", {
      executionResult: { error: `No executor for ${row.actionType}` },
    });
    await auditTransition(id, "proposal.execution_failed", reviewer, { error: `No executor for ${row.actionType}` });
    return { ok: false, status: "failed", error: `No executor for ${row.actionType}` };
  }

  try {
    const result = await executor.execute(row.payloadJson);
    await casTransition(id, ["executing"], "executed", { executionResult: result });
    await auditTransition(id, "proposal.executed", reviewer, { actionType: row.actionType, ...result });
    return { ok: true, status: "executed", result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await casTransition(id, ["executing"], "failed", { executionResult: { error: message } });
    await auditTransition(id, "proposal.execution_failed", reviewer, { actionType: row.actionType, error: message });
    log.error("proposal execution failed", { id, actionType: row.actionType, error: message });
    return { ok: false, status: "failed", error: message };
  }
}

// ─── Queries ────────────────────────────────────────────────────────────────

export async function listProposals(filter: {
  statuses?: readonly ProposalStatus[];
  limit?: number;
}): Promise<AdminProposal[]> {
  const d = await db();
  if (!d) return [];
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const base = d.select().from(adminProposals);
  const query = filter.statuses?.length
    ? base.where(inArray(adminProposals.status, [...filter.statuses]))
    : base;
  return query.orderBy(desc(adminProposals.createdAt)).limit(limit);
}

/**
 * Tri-state count for the Today signal: `readable: false` means the query
 * failed and MUST render as "?" — an unreadable queue is not an empty queue
 * (integration_failures' readable pattern; adminTruth doctrine).
 */
export async function countReviewable(): Promise<{ readable: boolean; count: number }> {
  try {
    const d = await db();
    if (!d) return { readable: false, count: 0 };
    const [row] = await d
      .select({ n: sql<number>`COUNT(*)` })
      .from(adminProposals)
      .where(inArray(adminProposals.status, [...REVIEWABLE_STATUSES]));
    return { readable: true, count: Number(row?.n ?? 0) };
  } catch (err) {
    log.error("countReviewable failed", { error: err instanceof Error ? err.message : String(err) });
    return { readable: false, count: 0 };
  }
}
