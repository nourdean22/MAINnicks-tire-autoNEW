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
  APPROVAL_BLOCK,
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
      // 0118, applied 2026-09-07. NULL on every pre-0118 row, and the gate
      // treats absent-window as "use the rolling TTL", so reading them changes
      // no existing decision.
      publishWindowStart: row.publishWindowStart ?? null,
      publishWindowEnd: row.publishWindowEnd ?? null,
      assetSha256: row.assetSha256 ?? null,
    };
  } catch {
    // Missing table, dead pool, driver error. All mean "cannot prove consent".
    return null;
  }
}

/**
 * Did a HUMAN withdraw this job's most recent approval? `findLiveApproval`
 * cannot say: it skips revoked rows, so after a revocation the gate reports
 * `no_approval_recorded` — and auto-approval, which approves exactly that code,
 * re-approved the reel on the next tick. A revocation that auto-approval undoes
 * is not a revocation.
 *
 * Only the NEWEST row counts (a later human approval supersedes an older no),
 * and a supersede by the writer itself ("superseded by …") is not a human no.
 * Returns the revoker, or null. A read failure returns "unreadable" so the
 * caller fails closed — "cannot prove nobody said no" must not mean yes.
 */
async function humanRevocationOf(jobId: number): Promise<string | null> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return "unreadable";
    const { reelPublishApprovals } = await import("../../drizzle/schema");
    const { eq, desc } = await import("drizzle-orm");
    const [row] = await d
      .select({ revokedAt: reelPublishApprovals.revokedAt, revokedBy: reelPublishApprovals.revokedBy })
      .from(reelPublishApprovals)
      .where(eq(reelPublishApprovals.reelJobId, jobId))
      .orderBy(desc(reelPublishApprovals.approvedAt))
      .limit(1);
    if (!row?.revokedAt) return null;
    const by = String(row.revokedBy ?? "");
    return by.startsWith("superseded by ") ? null : by || "unknown";
  } catch {
    return "unreadable";
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
  const approval = await findLiveApproval(args.jobId);
  // Only look up the digest when the approval actually binds to one. An
  // approval with no digest skips the check entirely (pre-0118 rows), so
  // querying media_assets for every gate evaluation would be a read per pulse
  // for a value nothing consumes.
  const assetSha256 = approval?.assetSha256 ? await loadAssetDigest(args.videoUrl) : null;
  const candidate: ReelPublishCandidate = {
    jobId: args.jobId,
    captionFingerprint: captionFingerprint(args.caption),
    videoUrl: args.videoUrl,
    assetSha256,
  };
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
      | "no_approver"
      // 0118 · a publishing window that cannot authorize anything is refused at
      // the tap rather than written as a row that can only ever block.
      | "window_inverted"
      | "window_already_passed",
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
  /**
   * DELIVERY ELIGIBILITY (0118). Optional and absent by default — omitting both
   * reproduces the previous behaviour exactly: the rolling 72h TTL governs.
   *
   * Supplying them is the operator saying "publish it between these dates",
   * which is a STRONGER authorization than a freshness default and therefore
   * suppresses the TTL. It is only meaningful when the human was shown those
   * dates, which is why this is an explicit argument and never a default.
   */
  publishWindowStart?: Date | null;
  publishWindowEnd?: Date | null;
}): Promise<{
  approvalId: string;
  expiresAt: Date;
  captionSha: string;
  videoUrl: string;
  publishWindowStart: Date | null;
  publishWindowEnd: Date | null;
  assetSha256: string | null;
}> {
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

  // A window must be ordered, or it authorizes nothing and blocks forever with
  // a confusing reason. Refuse at the tap rather than writing a dead row.
  const windowStart = args.publishWindowStart ?? null;
  const windowEnd = args.publishWindowEnd ?? null;
  if (windowStart && windowEnd && windowStart.getTime() > windowEnd.getTime()) {
    throw new ReelApprovalWriteError(
      "window_inverted",
      `The publishing window starts (${windowStart.toISOString()}) after it ends (${windowEnd.toISOString()}).`,
    );
  }
  if (windowEnd && windowEnd.getTime() <= Date.now()) {
    throw new ReelApprovalWriteError(
      "window_already_passed",
      `The publishing window ended ${windowEnd.toISOString()}, which is in the past. An approval that can never fire is not an approval.`,
    );
  }

  // BIND TO THE BYTES, not just their name. `storagePut` writes to a
  // deterministic key, so a re-render or a beat repair produces the SAME url
  // with different content and the videoUrl check alone would wave it through.
  // Best-effort: media_assets registration is a tolerant seam (reelAssembly
  // swallows its failure), so a master can legitimately exist with no digest.
  // A NULL here means "not bound to bytes" and the gate skips the check —
  // exactly how it treats pre-0118 rows. It must never mean "bound to nothing".
  const assetSha256 = await loadAssetDigest(subject.videoUrl);

  // SUPERSEDE + INSERT AS ONE UNIT.
  //
  // Supersede, don't accumulate: re-approving after a caption fix would leave
  // the void older row live. `findLiveApproval` takes the newest so publishing
  // would still be correct, but the DRAIN selects on "has ANY non-revoked row",
  // and a ledger holding two contradictory live yeses is not an audit trail.
  //
  // ATOMIC because the two halves fail in opposite directions. Un-transacted,
  // a revoke that succeeds followed by an insert that fails leaves the job with
  // NO live approval: an operator who was re-approving a caption fix silently
  // loses the yes they already had, and the reel drops back to held with the
  // UI reporting an error but not that it also destroyed the prior consent.
  // Fail-closed is the safe direction, which is exactly why it would have gone
  // unnoticed. One transaction makes the pair all-or-nothing, so a failed
  // re-approval leaves the previous approval standing.
  await d.transaction(async (tx: typeof d) => {
    await tx
      .update(reelPublishApprovals)
      .set({ revokedAt: new Date(), revokedBy: `superseded by ${approvedBy}`.slice(0, 100) })
      .where(and(eq(reelPublishApprovals.reelJobId, args.jobId), isNull(reelPublishApprovals.revokedAt)));
    await tx.insert(reelPublishApprovals).values({
      id: approvalId,
      reelJobId: args.jobId,
      captionSha: subject.captionSha,
      videoUrl: subject.videoUrl,
      approvedBy: approvedBy.slice(0, 100),
      expiresAt,
      note: args.note?.trim() ? args.note.trim().slice(0, 500) : null,
      publishWindowStart: windowStart,
      publishWindowEnd: windowEnd,
      assetSha256,
    });
  });

  return {
    approvalId,
    expiresAt,
    captionSha: subject.captionSha,
    videoUrl: subject.videoUrl,
    publishWindowStart: windowStart,
    publishWindowEnd: windowEnd,
    assetSha256,
  };
}

/**
 * sha256 of the rendered asset, from `media_assets`, or null.
 *
 * NULL IS A LEGITIMATE ANSWER, not a failure to paper over. `reelAssembly`
 * registers the master through `mediaRegistry.registerProducedAsset` on a
 * TOLERANT seam — a registration failure is logged and swallowed — so a real
 * master can exist with no registry row. Returning null makes the approval
 * URL-bound, which is exactly what every pre-0118 approval is, rather than
 * blocking a job over bookkeeping.
 *
 * What it must NEVER do is invent a digest, which is why every failure path
 * returns null instead of a computed-from-somewhere-else value.
 */
async function loadAssetDigest(videoUrl: string): Promise<string | null> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return null;
    const { mediaAssets } = await import("../../drizzle/schema");
    const { eq, desc } = await import("drizzle-orm");
    // Projected select, NOT a bare select(): this reads a table whose column set
    // is not what this change is about, and a projection cannot break when that
    // table gains a column ahead of its own hand-applied DDL.
    const [row] = await d
      .select({ sha256: mediaAssets.checksumSha256 })
      .from(mediaAssets)
      .where(eq(mediaAssets.runtimeUrl, videoUrl))
      .orderBy(desc(mediaAssets.createdAt))
      .limit(1);
    const sha = row?.sha256;
    return typeof sha === "string" && /^[0-9a-f]{64}$/i.test(sha) ? sha.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** One row of the autonomous publish queue, as an operator needs to see it. */
export interface ReelPublishQueueEntry extends ReelPublishSubject {
  /** Approved-pack provenance + diagnostic structure fatigue, never a gate. */
  approvedPackSlug: string | null;
  productionGrammarNovelty: {
    similarity: number | null;
    isProductionTwin: boolean;
    collisions: string[];
    nearestSignature: string | null;
  } | null;
  /** Null when this job may publish; otherwise exactly why the cron holds it. */
  approvalProblem: ApprovalProblem | null;
  approvedBy: string | null;
  approvedAt: Date | string | null;
  expiresAt: Date | string | null;
  /** Set when the claim audit permanently condemns this reel. Never approvable. */
  vetoReason: string | null;
  /**
   * Set when the reel's Queue inventory row forbids an autonomous publish:
   * rejected by the operator, or already published / publishing / ambiguous
   * through another door. "unreadable" when that could not be checked.
   * Never auto-approvable.
   */
  inventoryHold: string | null;
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
  const { parseReelJobPayload } = await import("@shared/reelJobPayload");

  const rows = await d
    .select()
    .from(reelJobs)
    .where(and(eq(reelJobs.status, "assembled"), isNotNull(reelJobs.mp4Url), ne(reelJobs.mp4Url, "")))
    .orderBy(desc(reelJobs.createdAt), desc(reelJobs.id))
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

  // Inventory holds, read once for the page. A failed read marks every row
  // "unreadable" — fail closed: auto-approval must not act on an unchecked row.
  let holdByBriefId = new Map<string, string>();
  let holdsReadable = true;
  try {
    const { reelInventoryHolds } = await import("./reelInventoryLink");
    holdByBriefId = await reelInventoryHolds(d, [...new Set(rows.map((r: typeof rows[number]) => r.briefId).filter(Boolean))] as string[]);
  } catch {
    holdsReadable = false;
  }

  const entries: ReelPublishQueueEntry[] = [];
  for (const row of rows) {
    const caption = row.caption ?? "";
    const videoUrl = row.mp4Url ?? "";
    const approval = await findLiveApproval(row.id);
    // findLiveApproval skips revoked rows, so a human's withdrawal would read as
    // "no approval recorded" — the one code auto-approval approves. Report it as
    // what it is.
    const revokedBy = approval ? null : await humanRevocationOf(row.id);
    const parsed = parseReelJobPayload(row.payload);
    const noveltyRaw = parsed.productionGrammarNovelty;
    const productionGrammarNovelty = noveltyRaw && typeof noveltyRaw === "object"
      ? {
          similarity: typeof (noveltyRaw as { similarity?: unknown }).similarity === "number"
            ? (noveltyRaw as { similarity: number }).similarity
            : null,
          isProductionTwin: (noveltyRaw as { isProductionTwin?: unknown }).isProductionTwin === true,
          collisions: Array.isArray((noveltyRaw as { collisions?: unknown }).collisions)
            ? (noveltyRaw as { collisions: unknown[] }).collisions.filter((v): v is string => typeof v === "string").slice(0, 5)
            : [],
          nearestSignature: typeof (noveltyRaw as { nearestSignature?: unknown }).nearestSignature === "string"
            ? (noveltyRaw as { nearestSignature: string }).nearestSignature
            : null,
        }
      : null;
    entries.push({
      jobId: row.id,
      status: String(row.status),
      caption,
      captionSha: captionFingerprint(caption),
      videoUrl,
      approvedPackSlug: parsed.approvedPackSlug ?? null,
      productionGrammarNovelty,
      holdReason: row.error ?? null,
      approvalProblem: revokedBy
        ? {
            code: APPROVAL_BLOCK.revoked,
            reason: revokedBy === "unreadable"
              ? `could not read the approval history for reel job ${row.id}; treating it as withdrawn until it can be read.`
              : `the approval for reel job ${row.id} was withdrawn by ${revokedBy}. A withdrawn yes is a no.`,
          }
        : approvalProblem(
            {
              jobId: row.id,
              captionFingerprint: captionFingerprint(caption),
              videoUrl,
              // The digest the publish door compares (reelApprovalProblem). Without it every
              // approval bound to a digest listed as asset_digest_unverifiable: approved reels
              // looked unapproved in the Queue, and auto-approval logged that code every pass.
              assetSha256: approval?.assetSha256 ? await loadAssetDigest(videoUrl) : null,
            },
            approval,
          ),
      approvedBy: approval?.approvedBy ?? null,
      approvedAt: approval?.approvedAt ?? null,
      expiresAt: approval?.expiresAt ?? null,
      vetoReason: auditPublishBlock(row.id),
      inventoryHold: holdsReadable ? (row.briefId ? holdByBriefId.get(row.briefId) ?? null : null) : "unreadable",
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
