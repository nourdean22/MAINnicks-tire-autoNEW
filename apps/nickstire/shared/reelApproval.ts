/**
 * Human approval as a PRECONDITION for autonomous publishing.
 *
 * WHAT WAS ACTUALLY TRUE BEFORE THIS FILE, measured 2026-08-29 in prod:
 *   REEL_PUBLISH_ENABLED === "true"   -> true
 *   REEL_AUTOPOST_ENABLED === "true"  -> true
 *   IG_AUTOPOST_DRYRUN === "false"    -> true   (live posting armed)
 * `dailyReelPost` sees an `assembled` job and calls `publishToSocial` itself
 * with no approval step. The ONLY thing standing between that armed path and a
 * live post on the owner's business account was that the head of the queue,
 * job 1710001, contains template-stock clips that `stock_guard` rejects - so
 * the cron held on the same row every ~60s and never advanced.
 *
 * A DEFECT IS NOT A CONTROL. Repair or clear that row and the next clean job
 * publishes with nobody's consent. This module replaces that accident with an
 * assertion: no recorded approval, no publish.
 *
 * WHY APPROVAL IS BOUND TO THE CAPTION BYTES. The operator's stated protocol is
 * that the owner approves a SPECIFIC caption. An approval keyed only on job id
 * would let the caption be edited after the yes and publish words nobody
 * cleared - which is the same "approved in principle, shipped in fact" gap the
 * gate exists to close. So the fingerprint of the exact caption, and the exact
 * video URL, are part of what was approved. Change either and the approval is
 * void, not stale-but-honoured.
 *
 * FAIL-CLOSED IS THE WHOLE POINT. Every unknown - no row, no table, no
 * database, an unparseable record - must resolve to "blocked". This is the
 * autonomous door; there is no human to notice a wrong answer. The canary
 * asserts BOTH directions, because a gate that blocks everything is exactly as
 * broken as one that blocks nothing and is much easier to ship by accident.
 *
 * PRIOR ART, AND WHY THIS IS NOT A SECOND APPROVAL SYSTEM.
 * `social_content_approvals` + `services/contentApprovals.ts` already do this
 * for the Studio lane: bind a human approval to content hashes, expire it after
 * 72h, refuse on mismatch. Reels published through Studio go through it, and
 * `routers/content.ts` even disables two legacy publishers for "bypassing
 * approval provenance". The autonomous cron was never covered, because that
 * table is keyed on (inventory_id, version) and a `reel_jobs` row has no
 * inventory_id - so there was nothing to key on, and the check was simply
 * absent from the one path with no human watching. This module is the
 * reel_jobs-keyed equivalent: same bind-to-content principle, same TTL, and
 * the TTL constant below is adopted from that service rather than reinvented.
 *
 * Pure and browser-safe on purpose: `shared/` is bundled into the client, so
 * the sha256 computation lives server-side in `server/services/reelApproval.ts`
 * and this module reasons over fingerprints as opaque strings.
 */

/** What the publish door is holding, reduced to the fields approval binds to. */
export interface ReelPublishCandidate {
  jobId: number;
  /** Fingerprint of the EXACT caption bytes about to be published. */
  captionFingerprint: string;
  /** The exact rendered asset URL about to be published. */
  videoUrl: string;
}

/** A recorded human decision. Absence of one is not a soft signal - it blocks. */
export interface ReelApprovalRecord {
  reelJobId: number;
  captionFingerprint: string;
  videoUrl: string;
  /** Who approved. A blank value is not an approval. */
  approvedBy: string;
  approvedAt: Date | string;
  /** Set to withdraw a previously granted approval. */
  revokedAt?: Date | string | null;
  /** When the authorization lapses. Null only for rows predating the TTL. */
  expiresAt?: Date | string | null;
}

/**
 * How long one human yes authorizes a publish.
 *
 * ADOPTED FROM PRIOR ART, not invented here. `services/contentApprovals.ts`
 * already carries APPROVAL_TTL_HOURS = 72 for the Studio lane, with the
 * reasoning stated: "a 3-day-old approval of a time-sensitive post should not
 * silently fire - re-approval is one tap." The first draft of this module
 * deliberately skipped expiry as YAGNI; the prior art is evidence that it is
 * load-bearing, and the autonomous lane is the one where a stale yes is most
 * dangerous because no human is watching when it fires.
 */
export const REEL_APPROVAL_TTL_HOURS = 72;

/** Stable, machine-readable reasons - the cron writes these into its status. */
export const APPROVAL_BLOCK = {
  missing: "no_approval_recorded",
  wrongJob: "approval_belongs_to_another_job",
  revoked: "approval_revoked",
  anonymous: "approval_has_no_approver",
  captionChanged: "caption_changed_since_approval",
  videoChanged: "video_changed_since_approval",
  expired: "approval_expired",
} as const;

export type ApprovalBlockCode = (typeof APPROVAL_BLOCK)[keyof typeof APPROVAL_BLOCK];

export interface ApprovalProblem {
  code: ApprovalBlockCode;
  /** Written for a human reading a held job at the moment they are blocked. */
  reason: string;
}

/**
 * Why this candidate may NOT publish, or null when a valid approval covers it.
 *
 * Each branch below is a bypass someone would otherwise find: an approval for a
 * different job, a withdrawn one, an unattributed one, one granted before the
 * copy changed, and one granted before the asset was re-rendered.
 */
export function approvalProblem(
  candidate: ReelPublishCandidate,
  approval: ReelApprovalRecord | null | undefined,
  now: Date = new Date(),
): ApprovalProblem | null {
  if (!approval) {
    return {
      code: APPROVAL_BLOCK.missing,
      reason:
        `no human approval is recorded for reel job ${candidate.jobId}. Publishing is default-deny: ` +
        "record an approval naming the approver, the exact caption and the exact video, or leave it held.",
    };
  }

  if (approval.reelJobId !== candidate.jobId) {
    return {
      code: APPROVAL_BLOCK.wrongJob,
      reason:
        `the approval on hand is for reel job ${approval.reelJobId}, not ${candidate.jobId}. ` +
        "An approval is not transferable between jobs.",
    };
  }

  if (approval.revokedAt) {
    return {
      code: APPROVAL_BLOCK.revoked,
      reason: `the approval for reel job ${candidate.jobId} was revoked. A withdrawn yes is a no.`,
    };
  }

  // A null expiry means a row written before the TTL existed. It is honoured
  // rather than rejected, matching how contentApprovals.ts treats its own
  // pre-0087 legacy rows - a migration should not brick a queue.
  if (approval.expiresAt) {
    const lapsed = new Date(approval.expiresAt).getTime();
    if (Number.isFinite(lapsed) && lapsed < now.getTime()) {
      return {
        code: APPROVAL_BLOCK.expired,
        reason:
          `the approval for reel job ${candidate.jobId} expired. One yes authorizes a publish for ` +
          `${REEL_APPROVAL_TTL_HOURS}h; a stale approval must not fire unattended days later. Re-approve to publish.`,
      };
    }
  }

  if (!approval.approvedBy || !approval.approvedBy.trim()) {
    return {
      code: APPROVAL_BLOCK.anonymous,
      reason:
        `the approval record for reel job ${candidate.jobId} names no approver. ` +
        "An unattributed approval is indistinguishable from a row someone inserted by accident.",
    };
  }

  // Byte-exact on purpose. Normalising whitespace here would let an edit that
  // only moves a line break publish text that was never read.
  if (approval.captionFingerprint !== candidate.captionFingerprint) {
    return {
      code: APPROVAL_BLOCK.captionChanged,
      reason:
        `the caption for reel job ${candidate.jobId} changed after it was approved. ` +
        "The owner approves specific wording; re-approve the current caption.",
    };
  }

  if (approval.videoUrl !== candidate.videoUrl) {
    return {
      code: APPROVAL_BLOCK.videoChanged,
      reason:
        `the rendered video for reel job ${candidate.jobId} changed after it was approved ` +
        `(approved ${approval.videoUrl}, now ${candidate.videoUrl}). Re-approve the current asset.`,
    };
  }

  return null;
}

/** Convenience predicate. Deliberately derived from approvalProblem, never parallel to it. */
export function isApprovedToPublish(
  candidate: ReelPublishCandidate,
  approval: ReelApprovalRecord | null | undefined,
  now: Date = new Date(),
): boolean {
  return approvalProblem(candidate, approval, now) === null;
}
