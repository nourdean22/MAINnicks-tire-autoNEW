/**
 * Warm-transfer connect-rate for the VAPI receptionist — READ-ONLY, "honest
 * hybrid" (2026-06-20).
 *
 * The operator's #1 voice question is: of the ~51% of calls the AI warm-transfers
 * to the shop landline, how many actually REACH a human? VAPI exposes NO
 * "human answered" bit on either webhook event, so a *measured* connect rate is
 * impossible from current data. This helper gives the honest best-effort:
 *
 *   GROUND TRUTH (counts, not guesses):
 *     - attempted = forwards attempted = completed forwards + failed transfers
 *     - failed    = transfers that DID NOT complete (VAPI's *-transfer-* error /
 *                   timeout / customer-bailed reasons) — definite no-connects
 *
 *   INFERRED (a duration proxy, ~80-90% accurate — NOT a fact):
 *     - connected = a completed forward (endedReason "assistant-forwarded-call")
 *                   whose TOTAL call duration clears a floor. The AI's
 *                   greet+capture+"connecting you now" leg alone runs ~20-35s; a
 *                   real human conversation pushes total well past the floor. A
 *                   bridged call where everyone hangs up in 2s reads as no-answer;
 *                   that error is why this is labeled "inferred" on every surface.
 *
 * The rate is withheld (null) until there are enough forwards to mean anything —
 * a single noisy day must never surface a misleading percentage.
 *
 * No DB, no imports — trivially unit-testable. The DEFINITIVE connect bit would
 * require a Twilio <Dial> statusCallback (DialCallStatus) on the voice leg, which
 * does not exist in this repo today; that is an optional future upgrade, not a
 * dependency of this metric.
 */

/** Minimal row shape pulled from vapi_call_logs (endedReason + duration). */
export interface ConnectRow {
  endedReason: string | null;
  durationSeconds: number | null;
}

export interface WarmTransferConnectStats {
  /** Forwards attempted in the window = completed forwards + failed transfers. */
  attempted: number;
  /** Inferred connected (completed forward whose duration cleared the floor). */
  connected: number;
  /** GROUND TRUTH: transfers that did not complete (definite no-connects). */
  failed: number;
  /** connected/attempted as a 0-100 int — null until the sample is reliable. */
  rate: number | null;
  /** True once `attempted` clears the minimum sample (else `rate` is null). */
  reliable: boolean;
}

/**
 * Total-call-duration floor (seconds) above which a COMPLETED forward is inferred
 * to have reached a human. Starting estimate — recalibrate from the real
 * assistant-forwarded-call duration distribution once ~20-30 forwards exist
 * (eyeball the short=no-answer / long=connected split, set the floor at the trough).
 */
export const DEFAULT_PRE_TRANSFER_FLOOR_SEC = 45;

/** Minimum forwards before a connect % is anything but noise. */
export const MIN_RELIABLE_SAMPLE = 10;

/**
 * A COMPLETED forward — VAPI ends the call "assistant-forwarded-call" once it has
 * handed the caller to the destination. Keyed on the same stable "forward"
 * substring as the webhook's isForwardedEndedReason (kept separate to keep this
 * module pure/DB-free). Does NOT prove a human answered — see connected above.
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

export function computeWarmTransferConnectRate(
  rows: ReadonlyArray<ConnectRow>,
  opts?: { preTransferFloorSec?: number; minReliableSample?: number },
): WarmTransferConnectStats {
  const floor = opts?.preTransferFloorSec ?? DEFAULT_PRE_TRANSFER_FLOOR_SEC;
  const minSample = opts?.minReliableSample ?? MIN_RELIABLE_SAMPLE;

  let completed = 0;
  let failed = 0;
  let connected = 0;

  for (const row of rows) {
    const reason = row.endedReason;
    if (isForwardCompleted(reason)) {
      completed++;
      if ((row.durationSeconds ?? 0) >= floor) connected++;
    } else if (isTransferFailure(reason)) {
      failed++;
    }
    // every other endedReason (customer-ended-call, etc.) is not a forward —
    // excluded from the denominator entirely.
  }

  const attempted = completed + failed;
  const reliable = attempted >= minSample;
  // Divide-by-zero / low-sample guard: rate stays null (never NaN, never a
  // misleading number) until the sample is big enough to trust.
  const rate = reliable && attempted > 0 ? Math.round((connected / attempted) * 100) : null;

  return { attempted, connected, failed, rate, reliable };
}
