/**
 * Forward/transfer-failure predicates for the VAPI receptionist.
 *
 * HISTORY — the duration-floor "connect rate" that used to live here was
 * REFUTED 2026-08-05 and removed. It inferred "human connected" from total
 * call duration >= 45s, assuming a bridged conversation extends the VAPI call.
 * Live call artifacts disproved the premise: on this assistant's BLIND
 * transfer, `endedAt` equals the transferCall tool-result timestamp — the
 * VAPI leg ends the instant the hand-off is issued, so total duration only
 * ever measured the AI capture script (forwarded calls average ~36s, below
 * the floor by construction). The replacement evidence model lives in
 * lib/transferOutcomeEvidence.ts (redial-within-window); true per-call
 * answer-proof needs a VAPI warm-transfer plan — an operator decision on the
 * live line.
 *
 * The two predicates below remain valid ground truth and are shared by the
 * webhook, the SMS follow-up trigger, and the evidence module.
 */

/** Minimum classifiable sample before any rate is anything but noise. */
export const MIN_RELIABLE_SAMPLE = 10;

/**
 * A COMPLETED forward — VAPI ends the call "assistant-forwarded-call" once it has
 * handed the caller to the destination. Keyed on the same stable "forward"
 * substring as the webhook's isForwardedEndedReason (kept separate to keep this
 * module pure/DB-free). Does NOT prove a human answered — the VAPI leg ends
 * at the hand-off, so nothing in this record can.
 */
export function isForwardCompleted(endedReason: string | null | undefined): boolean {
  return /forward/i.test(endedReason ?? "");
}

/**
 * A FAILED transfer — VAPI's *-warm-transfer-* / *-transfer-failed ended reasons
 * mean the hand-off did NOT complete (silence/timeout/error/customer bailed).
 * GROUND TRUTH no-connects. Keyed on the stable "transfer" substring so the
 * metric does not depend on VAPI's exact enum spelling; disjoint from a
 * completed forward (no VAPI reason contains both "forward" and "transfer").
 */
export function isTransferFailure(endedReason: string | null | undefined): boolean {
  const r = endedReason ?? "";
  return /transfer/i.test(r) && !isForwardCompleted(r);
}

