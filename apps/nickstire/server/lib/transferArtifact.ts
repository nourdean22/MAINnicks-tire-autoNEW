/**
 * TRANSFER ARTIFACT — the only signal that can prove a human ANSWERED.
 *
 * WHY THIS EXISTS. `endedReason === "assistant-forwarded-call"` is what every
 * transfer metric in this app has been built on, and it does not mean what it
 * reads like. VAPI's own documentation is explicit: it confirms VAPI INITIATED
 * the transfer, not that the destination completed it, and its troubleshooting
 * page sends you to the telephony provider's call log to learn the outcome.
 * There is no value anywhere in the 86-entry endedReason enum meaning "the
 * destination answered".
 *
 * The consequence for a tire shop is exact: a call that rang an empty counter
 * eight times and dropped to voicemail carries the SAME endedReason as one Nick
 * picked up on the second ring. A connect-rate built on it cannot emit a
 * failure for the single case it exists to detect.
 *
 * `call.artifact.transfers[]` is the real signal. Each entry carries a
 * `status` from a closed set, documented for warm AND blind attempts.
 *
 * THE GATING CAVEAT, STATED RATHER THAN ASSUMED. VAPI describes blind-transfer
 * outcome detection as enabled per-organisation. Whether this account receives
 * a populated `transfers[]` for its blind transfers is an EMPIRICAL question
 * that no amount of schema reading settles. This module is therefore built so
 * that absence is loud: a forwarded call with no transfers array resolves to
 * `unknown`, never to `connected`, and `connectRate` stays null until the
 * sample is both non-empty and classifiable.
 *
 * Pure and total: no DB, no network, no clock beyond an injected `now`.
 * Mirrors `transferOutcomeEvidence.ts`, which measures REDIAL behaviour and is
 * deliberately kept separate — that one infers from what the customer did next,
 * this one reads what the provider reported. Two independent instruments on the
 * same question is the point; if they disagree, that disagreement is a finding.
 */

import { isTransferAttempt } from "./warmTransferConnect";

/** VAPI's documented transfer statuses, plus the honest catch-all. */
export const TRANSFER_STATUSES = [
  "connected",
  "no-answer",
  "busy",
  "voicemail",
  "failed",
  "completed",
  "cancelled",
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

/**
 * What the shop actually needs to know, in three states.
 *
 * `unknown` is not a failure mode of this module — it is the correct answer
 * whenever the provider did not tell us, and it must never be averaged into
 * either of the other two.
 */
export type TransferVerdict = "connected" | "not_connected" | "unknown";

/**
 * Statuses that prove a human took the call.
 *
 * `completed` is included deliberately: VAPI uses it for an attempt that ran to
 * completion, which for a transfer means the parties were joined. `cancelled`
 * is NOT here — the transfer assistant cancels on voicemail, a busy signal, an
 * IVR, or an operator who declines, all of which are no-connects.
 */
const CONNECTED: ReadonlySet<string> = new Set(["connected", "completed"]);

/** Statuses that prove the caller reached nobody. */
const NOT_CONNECTED: ReadonlySet<string> = new Set([
  "no-answer",
  "busy",
  "voicemail",
  "failed",
  "cancelled",
]);

export interface TransferRecord {
  destination: string | null;
  mode: string | null;
  status: TransferStatus | null;
  /** The raw status string when it is not one we recognise. Never discarded. */
  rawStatus: string | null;
}

export interface TransferArtifactRead {
  /** The per-attempt records, in order. Empty when the array was absent. */
  transfers: TransferRecord[];
  /**
   * THE VERDICT FOR THIS CALL. `unknown` when the array was absent, empty, or
   * carried only statuses outside the documented set.
   */
  verdict: TransferVerdict;
  /**
   * True when VAPI supplied a transfers array at all. This is the field that
   * answers "is blind-transfer outcome detection enabled for this org?" — and
   * it is answered per call, from production, rather than assumed from docs.
   */
  artifactPresent: boolean;
  /** A status string VAPI sent that this module does not model. Surfaces drift. */
  unrecognisedStatuses: string[];
}

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/**
 * Read `call.artifact.transfers[]` from an end-of-call-report payload.
 *
 * Total: any input yields a result, never a throw. This runs inside a webhook
 * whose 200 must not depend on the shape of an optional field.
 */
/**
 * Whether a call's transfer artifact is worth persisting at all.
 *
 * Yes when there is a per-attempt record, or when the ended reason proves a
 * transfer was ATTEMPTED — a forwarded call with no transfers array is the
 * coverage signal (verdict unknown; artifactPresent settles whether the
 * provider sent anything). No for a call that never tried to hand off: it has
 * no transfer outcome, and a stored "unknown" reads to the next person like a
 * transfer whose result was lost.
 *
 * 2026-09-22: the webhook's test used to be `artifactPresent || transfers.length`,
 * and artifactPresent is true whenever Vapi sends a transfers ARRAY — which it
 * does, empty, on calls that never transferred — so 20 of 31 calls after the
 * 2026-09-21 plan change carried verdict "unknown" for a transfer that never
 * happened. No reader treated unknown as failed, so it
 * was cosmetic; it was also a lie in the row.
 */
export function transferArtifactWorthPersisting(
  read: TransferArtifactRead,
  endedReason: string | null | undefined,
): boolean {
  return read.transfers.length > 0 || isTransferAttempt(endedReason);
}

export function readTransferArtifact(artifact: unknown): TransferArtifactRead {
  const empty: TransferArtifactRead = {
    transfers: [],
    verdict: "unknown",
    artifactPresent: false,
    unrecognisedStatuses: [],
  };
  if (!artifact || typeof artifact !== "object") return empty;

  const raw = (artifact as { transfers?: unknown }).transfers;
  if (!Array.isArray(raw)) return empty;

  const transfers: TransferRecord[] = [];
  const unrecognised: string[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const rawStatus = asString(e.status);
    const known = rawStatus && (TRANSFER_STATUSES as readonly string[]).includes(rawStatus);
    if (rawStatus && !known) unrecognised.push(rawStatus);
    transfers.push({
      destination: asString(e.destination) ?? asString((e.destination as Record<string, unknown> | undefined)?.number),
      mode: asString(e.mode),
      status: known ? (rawStatus as TransferStatus) : null,
      rawStatus,
    });
  }

  // The array existed. That fact alone is worth recording — it is the live
  // answer to whether outcome detection is enabled for this account.
  const artifactPresent = true;

  /**
   * ANY connected attempt makes the call connected. A caller who was bounced
   * to a busy line and then successfully transferred did reach a human, and
   * scoring that as a failure would manufacture recovery work for a customer
   * who was already served — the same class of error this whole wave repaired.
   */
  if (transfers.some((t) => t.status && CONNECTED.has(t.status))) {
    return { transfers, verdict: "connected", artifactPresent, unrecognisedStatuses: unrecognised };
  }
  if (transfers.some((t) => t.status && NOT_CONNECTED.has(t.status))) {
    return { transfers, verdict: "not_connected", artifactPresent, unrecognisedStatuses: unrecognised };
  }
  // Array present but nothing classifiable — an empty array, or only statuses
  // we do not model. Unknown, and the raw strings are kept so drift is visible.
  return { transfers, verdict: "unknown", artifactPresent, unrecognisedStatuses: unrecognised };
}

export interface ConnectRateInput {
  /** One entry per call that ATTEMPTED a transfer. */
  verdicts: readonly TransferVerdict[];
}

export interface ConnectRate {
  attempted: number;
  connected: number;
  notConnected: number;
  /** Attempts the provider did not resolve. The honesty denominator. */
  unknown: number;
  /** connected / (connected + notConnected), 0-100, null until classifiable. */
  connectRate: number | null;
  /**
   * Share of attempts the provider actually resolved. A connectRate computed
   * over 4% coverage is noise wearing a percentage sign, so this travels with
   * it and the UI must show both.
   */
  coveragePct: number | null;
}

/** Minimum classifiable attempts before a rate is anything but noise. */
export const MIN_CONNECT_SAMPLE = 10;

/**
 * Aggregate verdicts into a connect rate that refuses to lie.
 *
 * `connectRate` is null until at least MIN_CONNECT_SAMPLE attempts are
 * classifiable, because the failure this replaces was a metric that always had
 * a confident number and was always wrong.
 */
export function computeConnectRate(input: ConnectRateInput): ConnectRate {
  let connected = 0;
  let notConnected = 0;
  let unknown = 0;
  for (const v of input.verdicts) {
    if (v === "connected") connected++;
    else if (v === "not_connected") notConnected++;
    else unknown++;
  }
  const attempted = connected + notConnected + unknown;
  const classifiable = connected + notConnected;
  return {
    attempted,
    connected,
    notConnected,
    unknown,
    connectRate:
      classifiable >= MIN_CONNECT_SAMPLE ? Math.round((connected / classifiable) * 100) : null,
    coveragePct: attempted > 0 ? Math.round((classifiable / attempted) * 100) : null,
  };
}
