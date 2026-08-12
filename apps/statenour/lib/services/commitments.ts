/**
 * lib/services/commitments.ts · hooks-lib REST→tRPC slice (2026-05-22)
 *
 * Commitment-create service · extracted from the create branch of the
 * POST /api/commitments route handler so the legacy REST endpoint AND
 * the new `operator.createCommitment` tRPC procedure (the `/commit`
 * direct-action) both call this one function · drift between the two
 * consumers is structurally impossible.
 *
 * Scope · CREATE only. The route's other branches (update · bulk_update
 * · expire_stale) stay inline in the REST handler — no tRPC consumer in
 * this slice touches them.
 */

import { prisma } from "@/lib/prisma";
import { today } from "@/lib/utils/datetime";
import { logCreate } from "@/lib/db/entity-audit";

export interface CreateCommitmentArgs {
  description: string;
  toWhom?: string | null;
  deadline?: string | null;
  domain?: string | null;
}

/**
 * Normalize an extractor-supplied deadline. LLM extraction emits
 * "YYYY-MM-DD" without knowing the current date, so "tonight" has
 * landed as 2024-03-16 on a commitment made 2026-06-02 (prod rows
 * #271/#295/#302…). A deadline before today at creation time is
 * always an extraction error, never intent — drop it instead of
 * storing a lie that instantly reads as "N-hundred days overdue".
 * Non-YYYY-MM-DD shapes are dropped for the same reason.
 */
export function sanitizeDeadline(deadline: string | null | undefined): string | null {
  if (!deadline) return null;
  const trimmed = deadline.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed < today() ? null : trimmed;
}

/**
 * Create a commitment. `toWhom` defaults to "self". Writes the
 * entity-audit create event, exactly as the REST route did. Returns
 * `{ ok, id }` mirroring the legacy envelope.
 */
export async function createCommitment(
  args: CreateCommitmentArgs,
): Promise<{ ok: true; id: number }> {
  const created = await prisma.commitment.create({
    data: {
      dateMade: today(),
      toWhom: args.toWhom || "self",
      description: args.description,
      deadline: sanitizeDeadline(args.deadline),
      domain: args.domain || null,
    },
  });

  void logCreate(
    "commitment",
    String(created.id),
    created as unknown as Record<string, unknown>,
    { source: "api:commitments.POST.create" },
  );

  return { ok: true, id: created.id };
}

// ─── Lifecycle (WP-13 · 2026-07-28 blueprint batch) ────────────────────
// The blueprint's doctrine centers commitments as the loop object:
//   proposed → active → verified | abandoned  (blocked = parking state;
//   "accepted" reserved in contracts COMMITMENT_STATUSES for future
//   delegation flows). A PROPOSED commitment is machine-suggested (first
//   producer: journal nextAction, WP-16) and has NO standing until the
//   operator accepts it. Dismissal is remembered — the sourceRef
//   idempotency check spans ALL statuses, so a dismissed proposal never
//   re-proposes on the next enrichment sweep. Every transition is a
//   status-guarded updateMany (no P2025, no lost-race double-flip).

export interface ProposeCommitmentInput {
  statement: string;
  /** Provenance + idempotency key, e.g. "journal-take:<entryId>". */
  sourceRef: string;
  domain?: string | null;
  deadline?: string | null;
  successCondition?: string | null;
}

/**
 * Idempotently propose a commitment. Returns the existing row's id when
 * the sourceRef already exists (in ANY status). Null on failure —
 * proposers are best-effort and must never break their host pipeline.
 */
export async function proposeCommitment(
  input: ProposeCommitmentInput,
): Promise<{ id: number; created: boolean } | null> {
  try {
    const statement = input.statement.trim().slice(0, 500);
    if (!statement) return null;
    const existing = await prisma.commitment.findFirst({
      where: { sourceRef: input.sourceRef },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };
    const created = await prisma.commitment.create({
      data: {
        dateMade: today(),
        toWhom: "self",
        description: statement,
        domain: input.domain || null,
        deadline: sanitizeDeadline(input.deadline),
        status: "proposed",
        successCondition: input.successCondition ?? undefined,
        sourceRef: input.sourceRef,
        createdBy: "system:proposer",
      },
    });
    void logCreate(
      "commitment",
      String(created.id),
      created as unknown as Record<string, unknown>,
      { source: "service:commitments.propose" },
    );
    return { id: created.id, created: true };
  } catch (err) {
    const { logError } = await import("@/lib/utils/error-log");
    logError("commitments", err, { stage: "propose", sourceRef: input.sourceRef }, "warn");
    return null;
  }
}

/** Operator accepts a proposal → it goes on the books as active. */
export async function acceptCommitment(id: number): Promise<boolean> {
  const res = await prisma.commitment.updateMany({
    where: { id, status: "proposed", deletedAt: null },
    data: { status: "active", updatedBy: "operator" },
  });
  return res.count === 1;
}

/** Operator dismisses a proposal — remembered, never re-proposed. */
export async function dismissProposed(id: number): Promise<boolean> {
  const res = await prisma.commitment.updateMany({
    where: { id, status: "proposed", deletedAt: null },
    data: { status: "abandoned", updatedBy: "operator" },
  });
  return res.count === 1;
}

/** A commitment's success condition was met — link the evidence. */
export async function verifyCommitment(
  id: number,
  outcomeRef?: string | null,
): Promise<boolean> {
  const res = await prisma.commitment.updateMany({
    where: { id, status: { in: ["active", "accepted"] }, deletedAt: null },
    data: {
      status: "verified",
      verifiedAt: new Date(),
      ...(outcomeRef ? { outcomeRef } : {}),
      updatedBy: "operator",
    },
  });
  return res.count === 1;
}

// ─── Active-commitment resolution (2026-08-12) ──────────────────────────
// The Pulse ticker surfaces overdue ACTIVE commitments every day (personal-
// pulse.ts) but until now the only way to close one out was chat — asking
// Nick to notice a completion-report turn and call the completeCommitment
// tool, or waiting up to 90 days for the auto-expiry floor. These give the
// ticker itself a direct, idempotent resolve path. Status-guarded
// updateMany (0 or 1 rows) matches the pattern above — a second tap or a
// race with the chat tool is a no-op, never a P2025 throw.

/** Operator did it — completes an ACTIVE commitment from the pulse ticker.
 *  Reuses the same "completed" status the completeCommitment chat tool
 *  writes (not "verified") so a single vocabulary continues to describe
 *  every UI-driven completion — see identity-snapshot.ts computePromiseIntegrity. */
export async function completeActiveCommitment(id: number): Promise<boolean> {
  const res = await prisma.commitment.updateMany({
    where: { id, status: "active", deletedAt: null },
    data: { status: "completed", notes: "Completed (pulse ticker)", updatedBy: "operator" },
  });
  return res.count === 1;
}

/** Operator no longer intends to — drops an ACTIVE commitment without
 *  claiming it was kept. Distinct from "completed": this is an honest
 *  "I'm not doing this" signal, deliberately excluded from BOTH the
 *  kept and broken buckets in computePromiseIntegrity (an abandoned
 *  intention isn't a broken promise any more than a declined machine
 *  suggestion is). */
export async function abandonActiveCommitment(id: number): Promise<boolean> {
  const res = await prisma.commitment.updateMany({
    where: { id, status: "active", deletedAt: null },
    data: { status: "abandoned", notes: "Dropped (pulse ticker)", updatedBy: "operator" },
  });
  return res.count === 1;
}

/** Proposed commitments awaiting the operator's verdict, oldest first. */
export async function listProposed(limit = 10) {
  return prisma.commitment.findMany({
    where: { status: "proposed", deletedAt: null },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: {
      id: true,
      description: true,
      domain: true,
      sourceRef: true,
      successCondition: true,
      createdAt: true,
    },
  });
}
