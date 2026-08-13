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
export async function completeActiveCommitment(
  id: number,
  notes = "Completed (pulse ticker)",
  updatedBy = "operator",
): Promise<boolean> {
  const res = await prisma.commitment.updateMany({
    where: { id, status: "active", deletedAt: null },
    data: { status: "completed", notes, updatedBy },
  });
  // BDN-208 · stamp the conditions this completion happened under
  // (sleep/energy/stress/day-state). Fire-and-forget — never blocks.
  if (res.count === 1) {
    const { captureCommitmentConditions } = await import("./commitment-conditions");
    void captureCommitmentConditions(id, "completed");
  }
  return res.count === 1;
}

/** Operator no longer intends to — drops an ACTIVE commitment without
 *  claiming it was kept. Distinct from "completed": this is an honest
 *  "I'm not doing this" signal, deliberately excluded from BOTH the
 *  kept and broken buckets in computePromiseIntegrity (an abandoned
 *  intention isn't a broken promise any more than a declined machine
 *  suggestion is). */
export async function abandonActiveCommitment(
  id: number,
  notes = "Dropped (pulse ticker)",
  updatedBy = "operator",
): Promise<boolean> {
  const res = await prisma.commitment.updateMany({
    where: { id, status: "active", deletedAt: null },
    data: { status: "abandoned", notes, updatedBy },
  });
  // BDN-208 · abandons carry conditions too — the contrast class is what
  // makes per-condition completion rates readable.
  if (res.count === 1) {
    const { captureCommitmentConditions } = await import("./commitment-conditions");
    void captureCommitmentConditions(id, "abandoned");
  }
  return res.count === 1;
}

/**
 * Evidence-tier + confidence off a journal take's stored JSON —
 * PURE and exported for the test (2026-08-12 WP). Machine takes carry
 * `evidenceTier: "INFERRED"` + `confidence: HIGH|MED|LOW` (stamped by
 * generateJournalTake on the same funded extraction call). Anything
 * unparseable or pre-dating the field degrades to nulls — the chip
 * simply doesn't render; nothing ever blocks on this.
 */
export function parseTakeEpistemics(content: string | null | undefined): {
  evidenceTier: string | null;
  confidence: string | null;
} {
  if (!content) return { evidenceTier: null, confidence: null };
  try {
    const parsed = JSON.parse(content) as { evidenceTier?: unknown; confidence?: unknown };
    const tier =
      typeof parsed.evidenceTier === "string" &&
      ["OBSERVED", "INFERRED", "SPECULATIVE"].includes(parsed.evidenceTier)
        ? parsed.evidenceTier
        : null;
    const conf =
      typeof parsed.confidence === "string" && ["HIGH", "MED", "LOW"].includes(parsed.confidence)
        ? parsed.confidence
        : null;
    return { evidenceTier: tier, confidence: conf };
  } catch {
    return { evidenceTier: null, confidence: null };
  }
}

/** Proposed commitments awaiting the operator's verdict, oldest first. */
export async function listProposed(limit = 10) {
  const rows = await prisma.commitment.findMany({
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

  // Evidence-tier join (2026-08-12 WP): journal-sourced proposals carry
  // their take's epistemics so the verdict card can say WHY to trust the
  // proposal, not just where it came from. One indexed query; proposals
  // from other sources (or pre-field takes) get nulls.
  const takeKeys = rows.map((r) => r.sourceRef).filter((s): s is string => !!s?.startsWith("journal-take:"));
  const takesByKey = new Map<string, { evidenceTier: string | null; confidence: string | null }>();
  if (takeKeys.length > 0) {
    const takes = await prisma.brainMemory.findMany({
      where: { category: "journal_brain_take", key: { in: takeKeys }, deletedAt: null },
      select: { key: true, content: true },
    });
    for (const t of takes) takesByKey.set(t.key, parseTakeEpistemics(t.content));
  }

  return rows.map((r) => ({
    ...r,
    evidenceTier: (r.sourceRef && takesByKey.get(r.sourceRef)?.evidenceTier) ?? null,
    evidenceConfidence: (r.sourceRef && takesByKey.get(r.sourceRef)?.confidence) ?? null,
  }));
}
