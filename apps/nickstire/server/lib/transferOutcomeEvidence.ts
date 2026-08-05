/**
 * Transfer-outcome EVIDENCE for the VAPI receptionist — read-only, honest
 * (2026-08-05, replaces the duration-floor "connect rate").
 *
 * WHY THE OLD INFERENCE DIED
 * The 45s-total-duration floor assumed a bridged human conversation extends the
 * VAPI call. Verified against live call artifacts (2026-08-05): on this
 * assistant's BLIND transfer, `endedAt` equals the transferCall tool-result
 * timestamp — the VAPI leg ENDS the moment the hand-off is issued, and the
 * customer↔shop leg happens entirely outside VAPI's record. Total duration can
 * therefore NEVER contain the human leg; the floor was measuring how long the
 * AI's capture script ran. (`phoneCallProviderDetails` carries only the
 * original inbound SIP INVITE — no dial outcome for the transfer leg either.)
 *
 * WHAT CAN BE MEASURED TODAY, WITHOUT TOUCHING THE LIVE LINE
 * A caller who redials the shop shortly after being forwarded is hard evidence
 * the forward did NOT resolve their need (nobody answered, or the line dropped).
 * Prod shows exactly this signature: 16 calls in 20 minutes, 15 in 80 minutes.
 * So this module reports:
 *
 *   GROUND TRUTH:
 *     - failedTransfers — VAPI's *-transfer-* error reasons (hand-off never completed)
 *     - redialed        — forwards followed by a same-phone call within the window
 *   HONEST ABSENCE (not proof of success):
 *     - quiet           — forwards with NO redial inside the window. The caller
 *                         may have been helped, or may have given up. Label
 *                         surfaces must say "no redial", never "answered".
 *   HONEST UNKNOWN:
 *     - tooRecent       — forwards younger than the window at compute time;
 *                         excluded from every rate denominator.
 *
 * True per-call answer-proof requires moving the assistant to a VAPI
 * warm-transfer plan (VAPI dials the shop as a separate leg it observes) —
 * a live-line configuration change that belongs to the operator.
 *
 * No DB, no imports beyond the sibling predicates — trivially unit-testable.
 */
import { isForwardCompleted, isTransferFailure, MIN_RELIABLE_SAMPLE } from "./warmTransferConnect";

/** Row shape pulled from vapi_call_logs. */
export interface EvidenceCallRow {
  phoneNumber: string | null;
  createdAt: Date;
  endedReason: string | null;
}

export interface TransferOutcomeEvidence {
  /** Minutes after a forward within which a same-phone call counts as a redial. */
  windowMinutes: number;
  /** Completed forwards + failed transfers (hand-offs attempted). */
  attempted: number;
  /** GROUND TRUTH: hand-offs VAPI reported as failed. */
  failedTransfers: number;
  /** Completed forwards ("assistant-forwarded-call"). */
  forwards: number;
  /** Forwards old enough for the window to have fully elapsed. */
  classifiable: number;
  /** Forwards younger than the window at compute time — outcome unknowable yet. */
  tooRecent: number;
  /** Classifiable forwards where the same phone called again inside the window. */
  redialed: number;
  /** Classifiable forwards with no redial inside the window (absence, not proof). */
  quiet: number;
  /** redialed/classifiable as 0-100 int — null until the sample is reliable. */
  redialRate: number | null;
  reliable: boolean;
}

export const DEFAULT_REDIAL_WINDOW_MIN = 15;

const last10 = (phone: string | null): string | null => {
  const norm = (phone ?? "").replace(/\D/g, "").slice(-10);
  return norm.length === 10 ? norm : null;
};

export function computeTransferOutcomeEvidence(
  rows: ReadonlyArray<EvidenceCallRow>,
  opts?: { windowMinutes?: number; minReliableSample?: number; asOf?: Date },
): TransferOutcomeEvidence {
  const windowMinutes = opts?.windowMinutes ?? DEFAULT_REDIAL_WINDOW_MIN;
  const windowMs = windowMinutes * 60_000;
  const minSample = opts?.minReliableSample ?? MIN_RELIABLE_SAMPLE;
  const asOf = (opts?.asOf ?? new Date()).getTime();

  // All call times per phone (any endedReason) — a redial is any later call,
  // whatever the follow-up call's own outcome was.
  const callTimesByPhone = new Map<string, number[]>();
  for (const row of rows) {
    const p = last10(row.phoneNumber);
    if (!p) continue;
    const t = new Date(row.createdAt).getTime();
    if (Number.isNaN(t)) continue;
    const arr = callTimesByPhone.get(p);
    if (arr) arr.push(t); else callTimesByPhone.set(p, [t]);
  }
  for (const arr of callTimesByPhone.values()) arr.sort((a, b) => a - b);

  let forwards = 0;
  let failedTransfers = 0;
  let tooRecent = 0;
  let redialed = 0;
  let quiet = 0;

  for (const row of rows) {
    if (isTransferFailure(row.endedReason)) { failedTransfers++; continue; }
    if (!isForwardCompleted(row.endedReason)) continue;
    forwards++;

    const t = new Date(row.createdAt).getTime();
    if (Number.isNaN(t)) continue; // unclassifiable row — count in forwards only
    if (asOf - t < windowMs) { tooRecent++; continue; }

    const p = last10(row.phoneNumber);
    if (!p) { quiet++; continue; } // no phone → can never observe a redial
    const times = callTimesByPhone.get(p) ?? [];
    // strictly later, inside the window (same-timestamp = the forward itself)
    const hasRedial = times.some((other) => other > t && other - t <= windowMs);
    if (hasRedial) redialed++; else quiet++;
  }

  const classifiable = redialed + quiet;
  const attempted = forwards + failedTransfers;
  const reliable = classifiable >= minSample;
  const redialRate = reliable && classifiable > 0
    ? Math.round((redialed / classifiable) * 100)
    : null;

  return {
    windowMinutes,
    attempted,
    failedTransfers,
    forwards,
    classifiable,
    tooRecent,
    redialed,
    quiet,
    redialRate,
    reliable,
  };
}
