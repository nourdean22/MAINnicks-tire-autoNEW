/**
 * How we know an estimate was declined (Q-37, estate plan §6.2 Option A).
 *
 *   counter  · a person at the counter recorded that the customer said no
 *              (declined_work_captures, migration 0131). An OBSERVATION.
 *   inferred · an ALG estimate with no matching invoice. An INFERENCE — the
 *              matcher found nothing, which also happens when the customer paid
 *              under a different phone, paid cash, or the invoice never mirrored.
 *   unknown  · the capture read FAILED, so we cannot say which of the two it is.
 *
 * Before 0131 is applied nothing can have been captured, so every decline is
 * genuinely inferred ("not_enabled" -> inferred). A failed read is different: it
 * is unknown, never inferred — showing it as inferred would be a failure rendered
 * as a fact (the empty-vs-error rule).
 */

export type DeclineProvenance = "counter" | "inferred" | "unknown";

export type DeclineCaptureRead =
  | { status: "ok"; capturedIds: ReadonlySet<number> }
  | { status: "not_enabled" }
  // `available: false` is the house marker for an honest outage shape
  // (scripts/lib/fabricatedAdminReadScan.mjs): a dead handle is an error, never an empty set.
  | { status: "error"; available?: false; error: string };

export function declineProvenance(estimateId: number, read: DeclineCaptureRead): DeclineProvenance {
  if (read.status === "error") return "unknown";
  if (read.status === "not_enabled") return "inferred";
  return read.capturedIds.has(estimateId) ? "counter" : "inferred";
}

export function countDeclineProvenance(
  estimateIds: readonly number[],
  read: DeclineCaptureRead,
): Record<DeclineProvenance, number> {
  const out: Record<DeclineProvenance, number> = { counter: 0, inferred: 0, unknown: 0 };
  for (const id of estimateIds) out[declineProvenance(id, read)]++;
  return out;
}

/** Short, operator-facing. The inferred label must never say the customer declined. */
export const DECLINE_PROVENANCE_LABEL: Record<DeclineProvenance, string> = {
  counter: "Declined at counter",
  inferred: "Inferred · no matching invoice",
  unknown: "Provenance unknown",
};

/**
 * How an unmatched estimate is described in the Decision Inbox
 * (services/opportunityQueue.ts). Only a counter capture makes it an observed
 * decline with "verified" data quality; an unknown capture read keeps the
 * inferred wording, which stays true ("not proven declined").
 */
export function estimateOpportunityLabel(
  provenance: DeclineProvenance,
  ageDays: number,
  touches: number,
): { dataQuality: "verified" | "inferred"; reason: string } {
  if (provenance === "counter") {
    return {
      dataQuality: "verified",
      reason: `Customer declined this quote at the counter; no invoice ${ageDays}d later. Recovery SMS touches so far: ${touches}.`,
    };
  }
  return {
    dataQuality: "inferred",
    reason: `Estimate ${ageDays}d old with no matched invoice (unresolved — not proven declined). Recovery SMS touches so far: ${touches}.`,
  };
}
