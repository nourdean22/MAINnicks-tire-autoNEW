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
  REEL_APPROVAL_TTL_HOURS,
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

/* ────────────────────────────────────────────────────────────────────────────
 * THE WRITE PATH
 *
 * Everything above this line reads approvals. Nothing wrote them, which made
 * the gate unopenable: `reel_publish_approvals` shipped with three readers
 * (the drain in dailyReelPost, findLiveApproval, the schema) and ZERO writers,
 * so the default-deny door had no handle and the autonomous lane could never
 * publish again. Default-deny was correct; unopenable was not.
 *
 * WHAT THE APPROVAL MUST BIND TO, and why getting this wrong ships a no-op:
 * the cron hashes `reel_jobs.caption` and compares `reel_jobs.mp4Url`
 * (cron/jobs/dailyReelPost.ts:555,567 -> :869). An approval bound to anything
 * else - the Studio draft's composed caption, an asset path, a normalised
 * string - is VOID the instant it is read, and the UI would report success
 * while the reel stayed held forever. So these functions read the live
 * reel_jobs row and bind to exactly those two columns.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Why an approval could not be recorded. Never a silent failure. */
export class ReelApprovalWriteError extends Error {
  constructor(
    readonly code:
      | "no_database"
      | "job_not_found"
      | "job_not_assembled"
      | "job_has_no_asset"
      | "job_has_no_caption"
      | "content_vetoed"
      | "stale_review"
      | "no_approver",
    message: string,
  ) {
    super(message);
    this.name = "ReelApprovalWriteError";
  }
}

/** The exact bytes the cron will publish for one job. */
export interface ReelPublishSubject {
  jobId: number;
  status: string;
  /** `reel_jobs.caption` verbatim - what the gate hashes. */
  caption: string;
  captionSha: string;
  /** `reel_jobs.mp4Url` verbatim - what the gate compares. */
  videoUrl: string;
  /** Current hold text on the job, if any. */
  holdReason: string | null;
}

/**
 * Read the publish subject straight off `reel_jobs`.
 *
 * Deliberately NOT derived from the Studio inventory draft. The draft's
 * `publishCaption` is composed differently (caption + blank line + hashtags),
 * so approving what the draft shows would fingerprint text the cron never
 * sends. The operator must see, and consent to, the bytes that actually ship.
 */
async function loadReelPublishSubject(jobId: number): Promise<ReelPublishSubject | null> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return null;
  const { reelJobs } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await d.select().from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
  if (!row) return null;
  const caption = row.caption ?? "";
  return {
    jobId: row.id,
    status: String(row.status),
    caption,
    captionSha: captionFingerprint(caption),
    videoUrl: row.mp4Url ?? "",
    holdReason: row.error ?? null,
  };
}

/**
 * Record one attributable human yes for a reel job.
 *
 * `expectedCaptionSha` / `expectedVideoUrl` are an OPTIMISTIC-CONCURRENCY
 * check, mirroring `approveDraft`'s `expectedVersion`: they are what the
 * operator was actually looking at when they tapped. If the live row has moved
 * on - a re-render, a caption repair - the approval is REFUSED rather than
 * recorded against bytes nobody read. Without this the UI could approve a
 * caption that changed between render and tap, which is the precise failure
 * the byte-exact binding exists to prevent.
 *
 * The row is written from the LIVE values, never from the client's copy: the
 * check proves they agree, and the database stays the source of truth.
 */
export async function recordReelApproval(args: {
  jobId: number;
  approvedBy: string;
  expectedCaptionSha: string;
  expectedVideoUrl: string;
  note?: string;
}): Promise<{ approvalId: string; expiresAt: Date; captionSha: string; videoUrl: string }> {
  const approvedBy = (args.approvedBy ?? "").trim();
  if (!approvedBy) {
    // The gate rejects an unattributed row (APPROVAL_BLOCK.anonymous). Refusing
    // here too means we never write a row that can only ever block.
    throw new ReelApprovalWriteError("no_approver", "An approval must name its approver.");
  }

  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) {
    throw new ReelApprovalWriteError("no_database", "Database unavailable — no approval was recorded.");
  }

  const subject = await loadReelPublishSubject(args.jobId);
  if (!subject) {
    throw new ReelApprovalWriteError("job_not_found", `Reel job ${args.jobId} does not exist.`);
  }
  if (subject.status !== "assembled") {
    throw new ReelApprovalWriteError(
      "job_not_assembled",
      `Reel job ${args.jobId} is '${subject.status}', not 'assembled'. Only a finished render can be approved — ` +
        "the asset an approval binds to has to exist.",
    );
  }
  if (!subject.videoUrl.trim()) {
    throw new ReelApprovalWriteError("job_has_no_asset", `Reel job ${args.jobId} has no rendered mp4 to approve.`);
  }
  if (!subject.caption.trim()) {
    throw new ReelApprovalWriteError("job_has_no_caption", `Reel job ${args.jobId} has no caption to approve.`);
  }

  // The claim audit is an ENFORCED VETO that runs BEFORE the approval check in
  // the cron: an operator must not be able to approve away a false claim. It is
  // re-checked here so a condemned job is refused at the tap instead of
  // accepting a yes that the publish door will silently ignore forever.
  const { auditPublishBlock } = await import("@shared/reelClaimAudit");
  const vetoed = auditPublishBlock(args.jobId);
  if (vetoed) {
    throw new ReelApprovalWriteError(
      "content_vetoed",
      `This reel is vetoed by the claim audit and cannot be approved: ${vetoed}`,
    );
  }

  if (
    subject.captionSha !== args.expectedCaptionSha ||
    subject.videoUrl !== args.expectedVideoUrl
  ) {
    throw new ReelApprovalWriteError(
      "stale_review",
      `Reel job ${args.jobId} changed while you were reviewing it — ` +
        `${subject.captionSha !== args.expectedCaptionSha ? "the caption" : "the video"} is not what was on screen. ` +
        "Reload and review the current version before approving.",
    );
  }

  const { randomUUID } = await import("crypto");
  const { reelPublishApprovals } = await import("../../drizzle/schema");
  const { eq, and, isNull } = await import("drizzle-orm");

  // SUPERSEDE, don't accumulate. Re-approving after a caption fix would
  // otherwise leave the void older row live; `findLiveApproval` takes the
  // newest so publishing would still be correct, but the drain selects on "has
  // ANY non-revoked row", and a ledger where two contradictory yeses are both
  // live is not an audit trail. Revoking first keeps exactly one live row.
  await d
    .update(reelPublishApprovals)
    .set({ revokedAt: new Date(), revokedBy: `superseded by ${approvedBy}`.slice(0, 100) })
    .where(and(eq(reelPublishApprovals.reelJobId, args.jobId), isNull(reelPublishApprovals.revokedAt)));

  // BARE UUID — exactly 36 chars, which is exactly `id varchar(36)` in
  // drizzle/0112_reel_publish_approvals.sql. A readable prefix does not fit:
  // `rappr_` + a 36-char UUID is 42, and TiDB runs STRICT_TRANS_TABLES, so an
  // over-width id is REJECTED and the approval row is LOST — the first tap
  // would have failed and the reel would have stayed held. contentApprovals.ts
  // can afford its `appr_` prefix because social_content_approvals.id is wider;
  // this column is UUID-sized on purpose. Widths are pinned by a test.
  const approvalId = randomUUID();
  // Same TTL semantics and the same construction as contentApprovals.ts — one
  // yes authorizes for 72h and then a stale approval must not fire unattended.
  const expiresAt = new Date(Date.now() + REEL_APPROVAL_TTL_HOURS * 3600_000);
  await d.insert(reelPublishApprovals).values({
    id: approvalId,
    reelJobId: args.jobId,
    captionSha: subject.captionSha,
    videoUrl: subject.videoUrl,
    approvedBy: approvedBy.slice(0, 100),
    expiresAt,
    note: args.note?.trim() ? args.note.trim().slice(0, 500) : null,
  });

  return { approvalId, expiresAt, captionSha: subject.captionSha, videoUrl: subject.videoUrl };
}

/** One row of the autonomous publish queue, as an operator needs to see it. */
export interface ReelPublishQueueEntry extends ReelPublishSubject {
  /** Null when this job may publish; otherwise exactly why the cron holds it. */
  approvalProblem: ApprovalProblem | null;
  approvedBy: string | null;
  approvedAt: Date | string | null;
  expiresAt: Date | string | null;
  /** Set when the claim audit permanently condemns this reel. Never approvable. */
  vetoReason: string | null;
}

/**
 * Every assembled reel the autonomous cron could publish, with its real
 * approval state.
 *
 * Read-only and side-effect free. This is a MIRROR of the cron's own decision,
 * computed through the SAME `approvalProblem` the publish door uses rather than
 * a parallel re-implementation — a queue screen that computes approval its own
 * way is exactly how a UI ends up confidently disagreeing with the gate.
 *
 * A missing approvals table does not blank the screen: every job simply reports
 * `no_approval_recorded`, which is the truth, and the caller surfaces the
 * unreadable-table case separately so "nothing is approved" can never be
 * confused with "the table does not exist".
 */
export async function listReelPublishQueue(limit = 25): Promise<{
  entries: ReelPublishQueueEntry[];
  approvalsTableReadable: boolean;
}> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return { entries: [], approvalsTableReadable: false };

  const { reelJobs } = await import("../../drizzle/schema");
  const { eq, and, isNotNull, ne, desc } = await import("drizzle-orm");
  const { auditPublishBlock } = await import("@shared/reelClaimAudit");

  const rows = await d
    .select()
    .from(reelJobs)
    .where(and(eq(reelJobs.status, "assembled"), isNotNull(reelJobs.mp4Url), ne(reelJobs.mp4Url, "")))
    .orderBy(desc(reelJobs.id))
    .limit(limit);

  // Probed once rather than per row: whether the table exists is a property of
  // the deployment, not of a job, and 25 identical failures would say the same
  // thing 25 times while looking like 25 unapproved reels.
  let approvalsTableReadable = true;
  try {
    const { reelPublishApprovals } = await import("../../drizzle/schema");
    await d.select({ id: reelPublishApprovals.id }).from(reelPublishApprovals).limit(1);
  } catch {
    approvalsTableReadable = false;
  }

  const entries: ReelPublishQueueEntry[] = [];
  for (const row of rows) {
    const caption = row.caption ?? "";
    const videoUrl = row.mp4Url ?? "";
    const approval = await findLiveApproval(row.id);
    entries.push({
      jobId: row.id,
      status: String(row.status),
      caption,
      captionSha: captionFingerprint(caption),
      videoUrl,
      holdReason: row.error ?? null,
      approvalProblem: approvalProblem(
        { jobId: row.id, captionFingerprint: captionFingerprint(caption), videoUrl },
        approval,
      ),
      approvedBy: approval?.approvedBy ?? null,
      approvedAt: approval?.approvedAt ?? null,
      expiresAt: approval?.expiresAt ?? null,
      vetoReason: auditPublishBlock(row.id),
    });
  }
  return { entries, approvalsTableReadable };
}

/**
 * Withdraw every live approval for a job.
 *
 * A withdrawal, never a delete (0112's own words): the ledger of who approved
 * what and when it was taken back IS the audit trail. Returns how many rows
 * were withdrawn so the caller can tell "revoked one" from "there was nothing
 * to revoke" — those are different facts and must not render the same.
 */
export async function revokeReelApproval(args: {
  jobId: number;
  revokedBy: string;
}): Promise<{ revoked: number }> {
  const revokedBy = (args.revokedBy ?? "").trim();
  if (!revokedBy) {
    throw new ReelApprovalWriteError("no_approver", "A revocation must name who withdrew it.");
  }
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) {
    throw new ReelApprovalWriteError("no_database", "Database unavailable — nothing was revoked.");
  }
  const { reelPublishApprovals } = await import("../../drizzle/schema");
  const { eq, and, isNull } = await import("drizzle-orm");
  const { affectedRowCount } = await import("../lib/db-affected");
  const res = await d
    .update(reelPublishApprovals)
    .set({ revokedAt: new Date(), revokedBy: revokedBy.slice(0, 100) })
    .where(and(eq(reelPublishApprovals.reelJobId, args.jobId), isNull(reelPublishApprovals.revokedAt)));
  return { revoked: affectedRowCount(res) };
}
