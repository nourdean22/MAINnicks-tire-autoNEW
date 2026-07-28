/**
 * Intelligence Outcome Ledger (S4, 2026-07-28) — the learning layer's
 * missing half. Records what the machine RECOMMENDED, where it was
 * shown, what the operator did, and whether it helped — the audit's
 * PR-9, scoped to surfaces that have NO outcome tracking of their own.
 * Surfaces with receipts (agenda, approvals, opportunity queue) are
 * read beside this ledger, never duplicated into it.
 *
 * The recall-eval corpus grows from here: rows where decision =
 * dismissed or outcomeUseful = false are correction candidates
 * (outcomesNeedingReview) that become eval cases with real provenance.
 *
 * Every write is fire-and-forget-safe: a ledger failure must never
 * break the surface that was recommending.
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";

export type OutcomeKind =
  | "daily_brief"
  | "decision_surface"
  | "proactive_push"
  | "suggestion"
  | "prediction";

export type OutcomeDecision = "accepted" | "dismissed" | "edited" | "ignored";

/** Stable 16-hex hash of the normalized summary — exported for tests. */
export function outcomeContentHash(summary: string): string {
  return createHash("sha256")
    .update(summary.replace(/\s+/g, " ").trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

export interface RecordShownInput {
  kind: OutcomeKind;
  sourceEngine: string;
  summary: string;
  shownSurface: string;
  evidenceRefs?: Record<string, unknown> | null;
  confidence?: number | null;
  conversationId?: string | null;
  traceId?: string | null;
}

/**
 * Record a recommendation the operator was SHOWN. Dedup: an identical
 * summary re-shown within 24h reuses the existing row (re-surfacing is
 * not a new recommendation — counting it as one would be the
 * refresh-as-production defect all over again).
 */
export async function recordShown(input: RecordShownInput): Promise<string | null> {
  try {
    const contentHash = outcomeContentHash(input.summary);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = await prisma.intelligenceOutcome.findFirst({
      where: { contentHash, shownAt: { gte: dayAgo } },
      select: { id: true },
    });
    if (existing) return existing.id;
    const row = await prisma.intelligenceOutcome.create({
      data: {
        kind: input.kind,
        sourceEngine: input.sourceEngine,
        contentHash,
        summary: input.summary.slice(0, 2000),
        shownSurface: input.shownSurface,
        evidenceRefs: (input.evidenceRefs ?? undefined) as never,
        confidence: input.confidence ?? undefined,
        conversationId: input.conversationId ?? undefined,
        traceId: input.traceId ?? undefined,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    logError("intel.outcome-ledger", err, { stage: "record-shown", kind: input.kind }, "warn");
    return null;
  }
}

/** The operator acted on (or dismissed) a recommendation. */
export async function recordDecision(params: {
  id: string;
  decision: OutcomeDecision;
  resultRef?: string | null;
}): Promise<boolean> {
  try {
    const res = await prisma.intelligenceOutcome.updateMany({
      where: { id: params.id, decision: null },
      data: {
        decision: params.decision,
        decidedAt: new Date(),
        resultRef: params.resultRef ?? undefined,
      },
    });
    return res.count === 1;
  } catch (err) {
    logError("intel.outcome-ledger", err, { stage: "record-decision", id: params.id }, "warn");
    return false;
  }
}

/** The real-world outcome landed (or the operator judged usefulness). */
export async function recordOutcome(params: {
  id: string;
  useful: boolean;
  resultRef?: string | null;
}): Promise<boolean> {
  try {
    const res = await prisma.intelligenceOutcome.updateMany({
      where: { id: params.id },
      data: {
        outcomeUseful: params.useful,
        outcomeAt: new Date(),
        ...(params.resultRef ? { resultRef: params.resultRef } : {}),
      },
    });
    return res.count === 1;
  } catch (err) {
    logError("intel.outcome-ledger", err, { stage: "record-outcome", id: params.id }, "warn");
    return false;
  }
}

/** Raw counts, no invented rates — nulls stay visible as undecided/unmeasured. */
export async function outcomeStats(windowDays = 30): Promise<{
  shown: number;
  decided: number;
  accepted: number;
  dismissed: number;
  usefulTrue: number;
  usefulFalse: number;
  undecided: number;
} | null> {
  try {
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const rows = await prisma.intelligenceOutcome.findMany({
      where: { shownAt: { gte: since } },
      select: { decision: true, outcomeUseful: true },
    });
    return {
      shown: rows.length,
      decided: rows.filter((r) => r.decision != null).length,
      accepted: rows.filter((r) => r.decision === "accepted").length,
      dismissed: rows.filter((r) => r.decision === "dismissed").length,
      usefulTrue: rows.filter((r) => r.outcomeUseful === true).length,
      usefulFalse: rows.filter((r) => r.outcomeUseful === false).length,
      undecided: rows.filter((r) => r.decision == null).length,
    };
  } catch (err) {
    logError("intel.outcome-ledger", err, { stage: "stats" }, "warn");
    return null;
  }
}

/** Correction candidates → future recall-eval corpus cases. */
export async function outcomesNeedingReview(limit = 20) {
  return prisma.intelligenceOutcome.findMany({
    where: { OR: [{ decision: "dismissed" }, { outcomeUseful: false }] },
    orderBy: { shownAt: "desc" },
    take: limit,
    select: { id: true, kind: true, sourceEngine: true, summary: true, decision: true, outcomeUseful: true, shownAt: true },
  });
}
