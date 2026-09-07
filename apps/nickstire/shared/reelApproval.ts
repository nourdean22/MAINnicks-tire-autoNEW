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
  /**
   * sha256 of the asset BYTES about to be published, when known.
   *
   * A STABLE URL IS NOT PROOF OF UNCHANGED BYTES. `storagePut` writes to a
   * deterministic key (`reels/reel-<jobId>.mp4`), so a re-render, a repair, or
   * a manual overwrite produces the SAME url with different content — and the
   * videoUrl comparison below would pass while publishing a video nobody
   * approved. `media_assets` already records sha256 + byte size at registration
   * (reelAssembly.ts), so the digest exists; this is what binds to it.
   */
  assetSha256?: string | null;
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
  /**
   * ── DELIVERY ELIGIBILITY, which is not the same thing as creative approval ──
   *
   * The rolling 72h TTL answers "is this yes still fresh?". It cannot answer
   * "may this publish on the 14th?", so a post approved today for a slot two
   * weeks out is structurally impossible: the approval expires four days before
   * its own slot. Removing the TTL would solve the wrong problem — it exists
   * because a stale yes firing unattended is the exact hazard of an autonomous
   * lane.
   *
   * So the two are separated. CREATIVE APPROVAL is the human reading these
   * caption bytes and this asset and saying yes. DELIVERY ELIGIBILITY is the
   * human also authorizing WHEN, as a bounded window they explicitly saw.
   *
   * When a window is present it GOVERNS, and the rolling TTL does not apply —
   * an explicit "publish it between the 12th and the 15th" is a stronger, more
   * specific authorization than a default freshness heuristic, and letting the
   * heuristic veto it would make scheduling impossible again. When absent,
   * behaviour is exactly as before: the 72h TTL.
   *
   * A window is NOT a schedule. It says "allowed during", never "due at". The
   * intended publish time lives on the job (`reel_jobs.publication_intended_at`),
   * because a job has one intent while approvals may be superseded.
   */
  publishWindowStart?: Date | string | null;
  publishWindowEnd?: Date | string | null;
  /**
   * sha256 of the asset bytes AS APPROVED. When set, the candidate must present
   * a matching digest — and a candidate that cannot present one at all is
   * refused rather than waved through, because "we could not check" is not
   * "unchanged".
   */
  assetSha256?: string | null;
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
  /** Approved for a later slot. Not an error — it is simply not due yet. */
  notYetDue: "before_approved_window",
  /** The authorized slot has passed. Re-approve for a new one. */
  windowPassed: "approved_window_passed",
  /** Same URL, different bytes. */
  assetBytesChanged: "asset_bytes_changed_since_approval",
  /** The approval binds to a digest and the candidate has none to compare. */
  assetDigestUnverifiable: "asset_digest_unverifiable",
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

  // ── DELIVERY ELIGIBILITY ──
  //
  // An explicit window GOVERNS and suppresses the rolling TTL. The human named
  // these dates while looking at this item; a freshness default must not veto a
  // more specific authorization, or scheduling ahead becomes impossible again.
  // With no window, behaviour is unchanged: the 72h TTL.
  const windowStart = toTime(approval.publishWindowStart);
  const windowEnd = toTime(approval.publishWindowEnd);
  const hasWindow = windowStart !== null || windowEnd !== null;

  if (hasWindow) {
    if (windowStart !== null && now.getTime() < windowStart) {
      return {
        code: APPROVAL_BLOCK.notYetDue,
        reason:
          `reel job ${candidate.jobId} is approved for a later slot (from ` +
          `${new Date(windowStart).toISOString()}). It is not blocked — it is not due yet.`,
      };
    }
    if (windowEnd !== null && now.getTime() > windowEnd) {
      return {
        code: APPROVAL_BLOCK.windowPassed,
        reason:
          `the approved publishing window for reel job ${candidate.jobId} ended ` +
          `${new Date(windowEnd).toISOString()}. A slot that has passed is not a licence to post late — ` +
          "re-approve for a new window. Time-sensitive copy is the reason this expires.",
      };
    }
  } else if (approval.expiresAt) {
    // A null expiry means a row written before the TTL existed. It is honoured
    // rather than rejected, matching how contentApprovals.ts treats its own
    // pre-0087 legacy rows - a migration should not brick a queue.
    const lapsed = toTime(approval.expiresAt);
    if (lapsed !== null && lapsed < now.getTime()) {
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

  // ── BYTES, not just the name of the bytes ──
  //
  // The URL check above is necessary and not sufficient. `storagePut` writes to
  // a deterministic key (`reels/reel-<jobId>.mp4`), so a re-render or a beat
  // repair produces the SAME url with different content and sails through an
  // equality check on the string. When the approval recorded a digest, the
  // candidate must match it — and a candidate with no digest at all is REFUSED,
  // because "we could not verify" is not "unchanged". Approvals with no digest
  // (rows predating this) skip the check, the same legacy-tolerance the expiry
  // branch uses.
  if (approval.assetSha256) {
    if (!candidate.assetSha256) {
      return {
        code: APPROVAL_BLOCK.assetDigestUnverifiable,
        reason:
          `the approval for reel job ${candidate.jobId} binds to a specific asset digest, but the ` +
          "asset about to be published presents none, so it cannot be shown to be the approved bytes. " +
          "A stable URL is not proof of unchanged content.",
      };
    }
    if (approval.assetSha256 !== candidate.assetSha256) {
      return {
        code: APPROVAL_BLOCK.assetBytesChanged,
        reason:
          `the video bytes for reel job ${candidate.jobId} changed after approval even though the URL ` +
          "did not — the asset was re-rendered or repaired in place. Re-approve the current asset.",
      };
    }
  }

  return null;
}

/** Milliseconds, or null for absent/unparseable. Null never blocks by itself. */
function toTime(v: Date | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Convenience predicate. Deliberately derived from approvalProblem, never parallel to it. */
export function isApprovedToPublish(
  candidate: ReelPublishCandidate,
  approval: ReelApprovalRecord | null | undefined,
  now: Date = new Date(),
): boolean {
  return approvalProblem(candidate, approval, now) === null;
}
