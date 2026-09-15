/**
 * approvalGate — the reel publish gate (shared/reelApproval.ts) with the
 * reel-specific nouns removed, so the NEXT autonomous lane (a Night Shift
 * proposal, a ShopState copy change, a market-driven page edit) is held by
 * the same door instead of a fifth re-implementation.
 *
 * The rules are the reel gate's, unchanged in substance — a parity test pins
 * the two against each other:
 *
 *   · no approval, or one for another subject       -> blocked
 *   · revoked                                       -> blocked (a withdrawn yes is a no)
 *   · an explicit window governs; else the TTL      -> not-yet-due / passed / expired
 *   · no approver named                             -> blocked
 *   · any approved BINDING differs from the candidate -> blocked
 *   · the approval binds to something the candidate cannot present -> blocked
 *     ("we could not check" is not "unchanged")
 *
 * BINDINGS are the byte-exact things the human read: a caption sha, a PR head
 * sha, a rendered-diff sha, a contract hash. The gate never normalises them.
 *
 * Pure and browser-safe. Hashing happens on the server; this module compares
 * opaque strings.
 */

export interface GateCandidate {
  subjectId: string;
  /** name -> fingerprint of the exact bytes ABOUT TO SHIP. */
  bindings: Record<string, string>;
}

export interface GateApproval {
  subjectId: string;
  /** name -> fingerprint of the exact bytes AS APPROVED. */
  bindings: Record<string, string>;
  approvedBy: string;
  approvedAt: Date | string;
  revokedAt?: Date | string | null;
  expiresAt?: Date | string | null;
  windowStart?: Date | string | null;
  windowEnd?: Date | string | null;
}

export const GATE_TTL_HOURS = 72;

export const GATE_BLOCK = {
  missing: "no_approval_recorded",
  wrongSubject: "approval_belongs_to_another_subject",
  revoked: "approval_revoked",
  anonymous: "approval_has_no_approver",
  expired: "approval_expired",
  notYetDue: "before_approved_window",
  windowPassed: "approved_window_passed",
  bindingChanged: "binding_changed_since_approval",
  bindingUnverifiable: "binding_unverifiable",
} as const;

export type GateBlockCode = (typeof GATE_BLOCK)[keyof typeof GATE_BLOCK];

export interface GateProblem {
  code: GateBlockCode;
  reason: string;
  /** The binding that failed, when one did. */
  binding?: string;
}

function toTime(v: Date | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Why this candidate may NOT proceed, or null when a valid approval covers it. */
export function gateProblem(candidate: GateCandidate, approval: GateApproval | null | undefined, now: Date = new Date()): GateProblem | null {
  if (!approval) {
    return { code: GATE_BLOCK.missing, reason: `no human approval is recorded for ${candidate.subjectId}. Default-deny: record one or leave it held.` };
  }
  if (approval.subjectId !== candidate.subjectId) {
    return { code: GATE_BLOCK.wrongSubject, reason: `the approval on hand is for ${approval.subjectId}, not ${candidate.subjectId}. Approvals are not transferable.` };
  }
  if (approval.revokedAt) {
    return { code: GATE_BLOCK.revoked, reason: `the approval for ${candidate.subjectId} was revoked. A withdrawn yes is a no.` };
  }

  const windowStart = toTime(approval.windowStart);
  const windowEnd = toTime(approval.windowEnd);
  if (windowStart !== null || windowEnd !== null) {
    if (windowStart !== null && now.getTime() < windowStart) {
      return { code: GATE_BLOCK.notYetDue, reason: `${candidate.subjectId} is approved for a later window (from ${new Date(windowStart).toISOString()}). Not blocked — not due yet.` };
    }
    if (windowEnd !== null && now.getTime() > windowEnd) {
      return { code: GATE_BLOCK.windowPassed, reason: `the approved window for ${candidate.subjectId} ended ${new Date(windowEnd).toISOString()}. Re-approve for a new window.` };
    }
  } else if (approval.expiresAt) {
    const lapsed = toTime(approval.expiresAt);
    if (lapsed !== null && lapsed < now.getTime()) {
      return { code: GATE_BLOCK.expired, reason: `the approval for ${candidate.subjectId} expired. One yes authorizes ${GATE_TTL_HOURS}h; a stale yes must not fire unattended.` };
    }
  }

  if (!approval.approvedBy || !approval.approvedBy.trim()) {
    return { code: GATE_BLOCK.anonymous, reason: `the approval for ${candidate.subjectId} names no approver. An unattributed approval is indistinguishable from an accident.` };
  }

  for (const [name, approved] of Object.entries(approval.bindings)) {
    if (!approved) continue;
    const presented = candidate.bindings[name];
    if (!presented) {
      return { code: GATE_BLOCK.bindingUnverifiable, binding: name, reason: `the approval for ${candidate.subjectId} binds to ${name}, but the candidate presents none — it cannot be shown to be the approved bytes.` };
    }
    if (presented !== approved) {
      return { code: GATE_BLOCK.bindingChanged, binding: name, reason: `${name} for ${candidate.subjectId} changed after it was approved. Re-approve the current version.` };
    }
  }
  return null;
}

/** Derived from gateProblem, never parallel to it. */
export function isApproved(candidate: GateCandidate, approval: GateApproval | null | undefined, now: Date = new Date()): boolean {
  return gateProblem(candidate, approval, now) === null;
}
