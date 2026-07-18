/**
 * Resolve a publish whose outcome was never recorded — by ASKING META, not guessing.
 *
 * The attempt ledger records that a publish was about to happen. When the process
 * dies between Meta accepting the post and the database being updated, the attempt
 * stays open and the reel job sits in `publish_ambiguous`. Until now the admin
 * could LIST those; it could not resolve one, so the only answer was for the
 * operator to open Instagram and compare by eye.
 *
 * WHAT THIS DOES NOT DO
 * It does not decide on a hunch. It fetches the account's recent media and looks
 * for a post that plausibly IS this attempt. A confident match resolves
 * automatically; anything less is handed to the operator with the candidates and
 * the reasoning, because the cost of being wrong is asymmetric: mark it published
 * when it is not and the reel is silently dropped; mark it unpublished when it IS
 * live and the retry double-posts to a real audience.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:publish-reconciler");

/** Meta's timestamp vs our attempt time: a container can take a while to settle. */
const MATCH_WINDOW_MINUTES = 90;

export interface ReconcileCandidate {
  igPostId: string;
  permalink: string;
  caption: string;
  postedAt: string;
  minutesFromAttempt: number;
  /** Why this is (or is not) a convincing match, in the operator's words. */
  reasoning: string;
  confident: boolean;
}

export type ReconcileResult =
  | { status: "resolved_published"; igPostId: string; permalink: string; detail: string }
  | { status: "resolved_not_published"; detail: string }
  | { status: "needs_operator"; candidates: ReconcileCandidate[]; detail: string }
  | { status: "cannot_check"; detail: string };

/** Compare captions ignoring whitespace/case — Meta normalises some whitespace. */
function captionMatches(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // A published caption can be truncated or have the CTA appended; compare the
  // opening, which is the part the compiler fixes.
  const head = (s: string) => s.slice(0, 60);
  return head(x) === head(y);
}

/**
 * Decide what happened to one open attempt.
 *
 * `expectedCaption` is what we tried to publish; without it the matcher falls back
 * to the time window alone, which is much weaker and will usually ask the operator.
 */
export async function reconcileAttempt(args: {
  attemptId: string;
  attemptedAt: Date;
  expectedCaption?: string | null;
}): Promise<ReconcileResult> {
  const { fetchInstagramMedia } = await import("./metaSocial");
  const media = await fetchInstagramMedia(25);
  if (!media.ok) {
    // Not knowing is a legitimate outcome and must not look like "not published".
    return { status: "cannot_check", detail: `Could not read the Instagram account: ${media.error}` };
  }

  const attemptMs = args.attemptedAt.getTime();
  const candidates: ReconcileCandidate[] = [];

  for (const post of media.posts) {
    const postedMs = post.posted ? Date.parse(post.posted) : NaN;
    if (!Number.isFinite(postedMs)) continue;
    const deltaMin = Math.round((postedMs - attemptMs) / 60_000);
    // Only posts at or after the attempt, inside the settle window. A post from
    // before the attempt cannot be this attempt.
    if (deltaMin < -2 || deltaMin > MATCH_WINDOW_MINUTES) continue;

    const capMatch = args.expectedCaption ? captionMatches(args.expectedCaption, post.caption) : false;
    const reasoning = capMatch
      ? `Caption matches and it was posted ${deltaMin} minute(s) after the attempt.`
      : args.expectedCaption
        ? `Posted ${deltaMin} minute(s) after the attempt, but the caption differs.`
        : `Posted ${deltaMin} minute(s) after the attempt. No caption was recorded for the attempt, so this is timing evidence only.`;

    candidates.push({
      igPostId: post.id,
      permalink: post.link,
      caption: (post.caption || "").slice(0, 200),
      postedAt: post.posted,
      minutesFromAttempt: deltaMin,
      reasoning,
      confident: capMatch,
    });
  }

  const confident = candidates.filter((c) => c.confident);
  if (confident.length === 1) {
    return {
      status: "resolved_published",
      igPostId: confident[0].igPostId,
      permalink: confident[0].permalink,
      detail: `This attempt IS live: ${confident[0].reasoning}`,
    };
  }
  if (confident.length > 1) {
    // Two matching captions in the window means we may have double-posted. Never
    // auto-resolve that — it is exactly the situation an operator must see.
    return {
      status: "needs_operator",
      candidates: confident,
      detail: `${confident.length} posts in the window match this caption — the publish may have run twice. Review both before acting.`,
    };
  }
  if (candidates.length === 0) {
    return {
      status: "resolved_not_published",
      detail: `No post appeared on the account within ${MATCH_WINDOW_MINUTES} minutes of the attempt. The publish did not reach Instagram, so it is safe to retry.`,
    };
  }
  return {
    status: "needs_operator",
    candidates,
    detail: `${candidates.length} post(s) landed near the attempt time but none match the caption. Confirm whether one of these is it.`,
  };
}

/**
 * Apply the operator's (or the matcher's) decision to the reel job and close the
 * attempt in the ledger.
 *
 * `published` marks the job posted with the real igPostId — the reel is live and
 * must never be retried. `not_published` releases it back to "assembled" for a
 * normal retry through the full gate.
 */
export async function applyReconciliation(args: {
  jobId: number;
  attemptId: string;
  decision: "published" | "not_published";
  igPostId?: string | null;
  operatorNote?: string | null;
}): Promise<{ ok: boolean; detail: string }> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return { ok: false, detail: "Database not available" };

  const { reelJobs } = await import("../../drizzle/schema");
  const { eq, and, inArray } = await import("drizzle-orm");
  const { affectedRowCount } = await import("../lib/db-affected");
  const { recordPublishOutcome, OUTCOME } = await import("./publishAttemptLedger");

  // Only a job that is actually ambiguous (or still claimed) may be reconciled —
  // never one that already reached a terminal state by another route.
  const RECONCILABLE = ["publish_ambiguous", "publishing"];

  if (args.decision === "published") {
    const res = await d
      .update(reelJobs)
      .set({ status: "posted", igPostId: args.igPostId ?? null, error: null })
      .where(and(eq(reelJobs.id, args.jobId), inArray(reelJobs.status, RECONCILABLE)));
    if (affectedRowCount(res) !== 1) {
      return { ok: false, detail: "Job is no longer in a reconcilable state — refresh and look again." };
    }
    await recordPublishOutcome(args.attemptId, OUTCOME.confirmed, {
      igPostId: args.igPostId ?? null,
      error: args.operatorNote ? `reconciled by operator: ${args.operatorNote}` : "reconciled: confirmed live",
    });
    log.warn("ambiguous publish reconciled as LIVE", { jobId: args.jobId, igPostId: args.igPostId });
    return { ok: true, detail: "Marked as published. This reel will not be retried." };
  }

  const res = await d
    .update(reelJobs)
    .set({ status: "assembled", error: "reconciled: did not reach Instagram — safe to retry" })
    .where(and(eq(reelJobs.id, args.jobId), inArray(reelJobs.status, RECONCILABLE)));
  if (affectedRowCount(res) !== 1) {
    return { ok: false, detail: "Job is no longer in a reconcilable state — refresh and look again." };
  }
  await recordPublishOutcome(args.attemptId, OUTCOME.failed, {
    error: args.operatorNote ? `reconciled by operator: ${args.operatorNote}` : "reconciled: never reached Instagram",
  });
  log.warn("ambiguous publish reconciled as NOT published — released for retry", { jobId: args.jobId });
  return { ok: true, detail: "Released for retry. It will go through the full quality gate again." };
}
