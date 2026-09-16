/**
 * ActionAttempt — the durable delegation contract · 2026-09-15.
 *
 * docs/NICK-TRUST-ARCHITECTURE-V2-2026-09-10.md §6.5, first vertical slice.
 * One row per consequential tool attempt, keyed by a stable operation key and
 * checked BEFORE the side effect runs. It replaces the BrainMemory
 * `tool_idempotency` bridge (lib/ai/tools/tool-idempotency.ts) as the claim
 * store for tools that opt in — sendTelegram first, exactly one consequential
 * mission, as the design said to do before generalising.
 *
 * States (the ones most systems omit are the ones that matter):
 *   EXECUTING             the side effect is in flight
 *   SUCCEEDED_UNVERIFIED  the provider said yes; the world has not been checked
 *   VERIFIED              reconciled against the source of truth — the ONLY
 *                         state that earns the word "done"
 *   UNKNOWN               the provider may or may not have committed; a real
 *                         terminal state, not a failure, and never retried blindly
 *   FAILED                known not to have happened; a new attempt may follow
 *   COMPENSATED           undone after the fact
 *   PLANNED / WAITING_APPROVAL  reserved for the approval-grant flow (not yet wired)
 *
 * One deliberate deviation from the doc: the doc's duplicate check has no time
 * bound because the operation key is meant to include the authority grant.
 * There is no AuthorizationGrant yet, so the key is tool + payload identity
 * only, and "send the same reminder again tomorrow" must stay possible.
 * Duplicates are therefore bounded by `holdUntil` (the tool's dedupe window,
 * longer for UNKNOWN) — the same semantics the bridge had, now durable and
 * carrying the attempt's whole state instead of a marker string.
 *
 * Fault tolerance (root AGENTS.md: never crash the API on a missing table):
 * the caller checks `isMissingTableError` and falls back to the bridge, so an
 * environment where the migration is not applied keeps today's behaviour.
 */
import type { PrismaClient } from "@prisma/client";

export type AttemptState =
  | "PLANNED"
  | "WAITING_APPROVAL"
  | "EXECUTING"
  | "SUCCEEDED_UNVERIFIED"
  | "VERIFIED"
  | "FAILED"
  | "COMPENSATED"
  | "UNKNOWN";

export type AttemptDisposition = "success" | "known_failure" | "unknown";

/** The states an EXECUTING attempt can settle to. VERIFIED is reconciliation's alone. */
export type SettledState = "SUCCEEDED_UNVERIFIED" | "FAILED" | "UNKNOWN";

/** States in which an identical operation inside its hold window is a duplicate. */
export const ACTIVE_STATES: ReadonlySet<AttemptState> = new Set<AttemptState>([
  "EXECUTING",
  "SUCCEEDED_UNVERIFIED",
  "VERIFIED",
  "UNKNOWN",
]);

/** The legal state machine. Anything not listed is refused, loudly. */
export const TRANSITIONS: Readonly<Record<AttemptState, readonly AttemptState[]>> = {
  PLANNED: ["WAITING_APPROVAL", "EXECUTING", "FAILED"],
  WAITING_APPROVAL: ["EXECUTING", "FAILED"],
  EXECUTING: ["SUCCEEDED_UNVERIFIED", "FAILED", "UNKNOWN"],
  // FAILED from here means reconciliation PROVED the effect did not happen.
  SUCCEEDED_UNVERIFIED: ["VERIFIED", "FAILED", "COMPENSATED"],
  VERIFIED: ["COMPENSATED"],
  // Reconciliation resolves an unknown either way; it is never re-executed blindly.
  UNKNOWN: ["VERIFIED", "FAILED", "COMPENSATED"],
  // A new attempt (attemptNo + 1) re-enters EXECUTING through beginAttempt.
  FAILED: ["EXECUTING"],
  COMPENSATED: ["EXECUTING"],
};

export function canTransition(from: AttemptState, to: AttemptState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export interface AttemptRow {
  id: string;
  state: string;
  attemptNo: number;
  holdUntil: Date | null;
}

/** Duplicate = an ACTIVE state whose hold window has not passed. */
export function isDuplicate(row: Pick<AttemptRow, "state" | "holdUntil">, now: Date = new Date()): boolean {
  if (!ACTIVE_STATES.has(row.state as AttemptState)) return false;
  return row.holdUntil !== null && row.holdUntil.getTime() > now.getTime();
}

export function isMissingTableError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "P2021" || e.code === "P2022") return true; // table / column does not exist
  return typeof e.message === "string" && /relation "?action_attempts"? does not exist/i.test(e.message);
}

export interface BeginAttemptInput {
  operationKey: string;
  tool: string;
  argumentsHash: string;
  effectClass?: "write" | "read" | "unknown";
  /** How long an identical operation counts as a duplicate after this attempt starts. */
  windowMs: number;
  authorityGrantId?: string;
  inputEvidenceIds?: string[];
}

export type BeginAttemptResult =
  | { kind: "claimed"; attemptId: string; attemptNo: number }
  | { kind: "duplicate"; attemptId: string; state: AttemptState; holdUntil: Date | null; attemptNo: number };

type Deps = { prisma: Pick<PrismaClient, "actionAttempt">; now?: () => Date };

async function deps(override?: Partial<Deps>): Promise<Deps> {
  if (override?.prisma) return { prisma: override.prisma, now: override.now ?? (() => new Date()) };
  const { prisma } = await import("@/lib/prisma");
  return { prisma, now: override?.now ?? (() => new Date()) };
}

/**
 * Claim the operation. Exactly one caller wins the EXECUTING row for a key; a
 * loser inside the hold window gets `duplicate` with the prior attempt's real
 * state (so "unknown" can be told from "done"). A FAILED / COMPENSATED / expired
 * row is re-claimed as attemptNo + 1.
 */
export async function beginAttempt(input: BeginAttemptInput, override?: Partial<Deps>): Promise<BeginAttemptResult> {
  const { prisma, now } = await deps(override);
  const startedAt = now!();
  const key = input.operationKey.slice(0, 190);
  const fresh = {
    state: "EXECUTING",
    startedAt,
    settledAt: null,
    holdUntil: new Date(startedAt.getTime() + input.windowMs),
    externalReference: null,
    receiptId: null,
    reason: null,
  };
  try {
    const row = await prisma.actionAttempt.create({
      data: {
        operationKey: key,
        tool: input.tool.slice(0, 80),
        effectClass: input.effectClass ?? "unknown",
        argumentsHash: input.argumentsHash.slice(0, 64),
        authorityGrantId: input.authorityGrantId ?? null,
        inputEvidenceIds: input.inputEvidenceIds ?? [],
        attemptNo: 1,
        ...fresh,
      },
      select: { id: true, attemptNo: true },
    });
    return { kind: "claimed", attemptId: row.id, attemptNo: row.attemptNo };
  } catch (error) {
    if ((error as { code?: string })?.code !== "P2002") throw error;
  }

  const existing = await prisma.actionAttempt.findUnique({
    where: { operationKey: key },
    select: { id: true, state: true, attemptNo: true, holdUntil: true },
  });
  if (!existing) throw new Error(`action_attempts: unique conflict on ${key} but no row readable`);
  if (isDuplicate(existing, startedAt)) {
    return {
      kind: "duplicate",
      attemptId: existing.id,
      state: existing.state as AttemptState,
      holdUntil: existing.holdUntil,
      attemptNo: existing.attemptNo,
    };
  }
  // Compare-and-swap on the row we observed (Codex review of #2338): two
  // identical calls arriving after the same expiry both read this reclaimable
  // row; an unconditional update by id would let BOTH win and both send. The
  // WHERE pins every field the decision read — (attemptNo, state) and the
  // holdUntil the "expired" verdict came from (Codex review of #2343: a
  // renewal that moves only the deadline would otherwise still match) — so
  // exactly one update matches. The loser re-reads the winner's row and is
  // reported as a duplicate with that row's real state.
  const reclaimed = await prisma.actionAttempt.updateMany({
    where: { id: existing.id, attemptNo: existing.attemptNo, state: existing.state, holdUntil: existing.holdUntil },
    data: { ...fresh, attemptNo: existing.attemptNo + 1, tool: input.tool.slice(0, 80), argumentsHash: input.argumentsHash.slice(0, 64) },
  });
  if (reclaimed.count === 1) {
    return { kind: "claimed", attemptId: existing.id, attemptNo: existing.attemptNo + 1 };
  }
  const winner = await prisma.actionAttempt.findUnique({
    where: { id: existing.id },
    select: { id: true, state: true, attemptNo: true, holdUntil: true },
  });
  if (!winner) throw new Error(`action_attempts: lost the reclaim race on ${key} but no row readable`);
  return {
    kind: "duplicate",
    attemptId: winner.id,
    state: winner.state as AttemptState,
    holdUntil: winner.holdUntil,
    attemptNo: winner.attemptNo,
  };
}

export interface SettleAttemptInput {
  disposition: AttemptDisposition;
  externalReference?: string;
  receiptId?: string;
  reason?: string;
  /** For UNKNOWN: how long to fence identical operations while the provider settles. */
  unknownHoldMs?: number;
}

const DISPOSITION_STATE: Record<AttemptDisposition, SettledState> = {
  success: "SUCCEEDED_UNVERIFIED",
  known_failure: "FAILED",
  unknown: "UNKNOWN",
};

/**
 * Record how the side effect came back. Never moves to VERIFIED — that takes
 * reconciliation. Resolves ONLY after the row is written: a caller may report
 * the returned state as the ledger's, and nothing before this resolves is.
 */
export async function settleAttempt(attemptId: string, input: SettleAttemptInput, override?: Partial<Deps>): Promise<SettledState> {
  const { prisma, now } = await deps(override);
  const at = now!();
  const to = DISPOSITION_STATE[input.disposition];
  const current = await prisma.actionAttempt.findUnique({ where: { id: attemptId }, select: { state: true, holdUntil: true } });
  if (!current) throw new Error(`action_attempts: ${attemptId} not found at settle`);
  if (!canTransition(current.state as AttemptState, to)) {
    throw new Error(`action_attempts: illegal transition ${current.state} -> ${to} for ${attemptId}`);
  }
  await prisma.actionAttempt.update({
    where: { id: attemptId },
    data: {
      state: to,
      settledAt: at,
      externalReference: input.externalReference?.slice(0, 200) ?? null,
      receiptId: input.receiptId?.slice(0, 120) ?? null,
      reason: input.reason?.slice(0, 500) ?? null,
      holdUntil:
        to === "FAILED"
          ? null
          : to === "UNKNOWN"
            ? new Date(at.getTime() + Math.max(input.unknownHoldMs ?? 0, (current.holdUntil?.getTime() ?? at.getTime()) - at.getTime()))
            : current.holdUntil,
    },
  });
  return to;
}

/** Reconciliation against the source of truth: the only door to VERIFIED. */
export async function verifyAttempt(attemptId: string, evidence: { reason: string; receiptId?: string }, override?: Partial<Deps>): Promise<void> {
  const { prisma, now } = await deps(override);
  const current = await prisma.actionAttempt.findUnique({ where: { id: attemptId }, select: { state: true } });
  if (!current) throw new Error(`action_attempts: ${attemptId} not found at verify`);
  if (!canTransition(current.state as AttemptState, "VERIFIED")) {
    throw new Error(`action_attempts: illegal transition ${current.state} -> VERIFIED for ${attemptId}`);
  }
  await prisma.actionAttempt.update({
    where: { id: attemptId },
    data: { state: "VERIFIED", settledAt: now!(), reason: evidence.reason.slice(0, 500), receiptId: evidence.receiptId?.slice(0, 120) },
  });
}

/** Undo recorded after the fact; refused from states that never happened. */
export async function compensateAttempt(attemptId: string, reason: string, override?: Partial<Deps>): Promise<void> {
  const { prisma, now } = await deps(override);
  const current = await prisma.actionAttempt.findUnique({ where: { id: attemptId }, select: { state: true } });
  if (!current) throw new Error(`action_attempts: ${attemptId} not found at compensate`);
  if (!canTransition(current.state as AttemptState, "COMPENSATED")) {
    throw new Error(`action_attempts: illegal transition ${current.state} -> COMPENSATED for ${attemptId}`);
  }
  await prisma.actionAttempt.update({ where: { id: attemptId }, data: { state: "COMPENSATED", settledAt: now!(), reason: reason.slice(0, 500), holdUntil: null } });
}
