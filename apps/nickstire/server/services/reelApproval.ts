/**
 * Reading recorded publish approvals. The decision logic is in
 * `shared/reelApproval.ts`; this module only supplies it with facts.
 *
 * EVERY FAILURE MODE RESOLVES TO "BLOCKED". No database, no table (the DDL in
 * drizzle/0112_reel_publish_approvals.sql is hand-applied and may not have run
 * yet), a malformed row, a thrown driver error - all of them mean the same
 * thing at this door: we cannot prove a human said yes, so we do not publish.
 *
 * That is not defensive padding. `dailyReelPost` runs unattended with live
 * posting armed; a fail-open branch here would publish to the owner's business
 * account on the strength of a transient connection error. The repo has this
 * exact scar already - the rendered-QA catch in the same cron used to log
 * "publishing without gate" and fall through.
 *
 * A useful consequence: before the migration is applied there are zero
 * approvals, so the autonomous lane is held. Shipping this code is itself the
 * safe state; applying the DDL is what later makes publishing possible at all.
 */
import { createHash } from "node:crypto";
import {
  approvalProblem,
  type ApprovalProblem,
  type ReelApprovalRecord,
  type ReelPublishCandidate,
} from "@shared/reelApproval";

/**
 * Fingerprint of the exact caption bytes.
 *
 * NOT normalised. Trimming or collapsing whitespace here would let an edit that
 * only moves a line break inherit a previous approval, and the whole point is
 * that the owner approved specific wording.
 */
export function captionFingerprint(caption: string): string {
  return createHash("sha256").update(caption ?? "", "utf8").digest("hex");
}

/**
 * The live (non-revoked) approval for a job, or null.
 *
 * Returns null rather than throwing on ANY error: callers must treat null as
 * "not approved", and a thrown error at a publish door invites a catch that
 * accidentally proceeds.
 */
export async function findLiveApproval(jobId: number): Promise<ReelApprovalRecord | null> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return null;
    const { reelPublishApprovals } = await import("../../drizzle/schema");
    const { eq, and, isNull, desc } = await import("drizzle-orm");
    const [row] = await d
      .select()
      .from(reelPublishApprovals)
      .where(and(eq(reelPublishApprovals.reelJobId, jobId), isNull(reelPublishApprovals.revokedAt)))
      .orderBy(desc(reelPublishApprovals.approvedAt))
      .limit(1);
    if (!row) return null;
    return {
      reelJobId: row.reelJobId,
      captionFingerprint: row.captionSha,
      videoUrl: row.videoUrl,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      expiresAt: row.expiresAt ?? null,
      revokedAt: row.revokedAt ?? null,
    };
  } catch {
    // Missing table, dead pool, driver error. All mean "cannot prove consent".
    return null;
  }
}

/**
 * The publish permit for one job: null when it may publish, otherwise why not.
 *
 * `caption` and `videoUrl` are the values ABOUT TO BE SENT, never the values
 * stored at approval time - comparing the record against itself would pass
 * trivially and prove nothing.
 */
export async function reelApprovalProblem(args: {
  jobId: number;
  caption: string;
  videoUrl: string;
}): Promise<ApprovalProblem | null> {
  const candidate: ReelPublishCandidate = {
    jobId: args.jobId,
    captionFingerprint: captionFingerprint(args.caption),
    videoUrl: args.videoUrl,
  };
  const approval = await findLiveApproval(args.jobId);
  return approvalProblem(candidate, approval);
}
