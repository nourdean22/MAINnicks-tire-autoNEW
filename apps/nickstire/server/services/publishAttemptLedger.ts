/**
 * A durable record of every publish ATTEMPT, written before the irreversible call.
 *
 * WHY
 * The compare-and-set claims added earlier stop two runners publishing the same
 * reel concurrently. They do not survive a process death: if the container is
 * killed between Meta accepting the post and the database being updated, nothing
 * anywhere records that an attempt was made. The job looks unpublished, a retry
 * double-posts, and no operator can tell which happened without checking
 * Instagram by hand. `publish_ambiguous` marks that a job MIGHT be live — this is
 * what it gets reconciled against.
 *
 * NO NEW SCHEMA, DELIBERATELY
 * This writes to autonomy_audit_events, which already exists in production. The
 * migration ledger is currently drifted (nine hand-applied migrations invisible to
 * drizzle), and adding a table to a ledger that cannot be trusted would deepen the
 * problem this is meant to make recoverable. The table's shape already fits:
 * an id, a timestamp, an action type, a decision, and a JSON context.
 *
 * ATTEMPT vs OUTCOME are two APPEND-ONLY rows, never one row updated in place.
 * An attempt with no outcome is precisely the thing needing reconciliation, so
 * their absence has to be observable — an in-place update would erase the
 * evidence that a crash happened at all.
 */
import { randomUUID } from "crypto";
import { createLogger } from "../lib/logger";

const log = createLogger("services:publish-attempt-ledger");

const ATTEMPT_ACTION = "publish_attempt";
const OUTCOME_ACTION = "publish_outcome";

/** Fits autonomy_audit_events.decision varchar(24) — all values checked. */
export const OUTCOME = {
  attempted: "ATTEMPTED",
  confirmed: "CONFIRMED",
  failed: "FAILED",
  ambiguous: "AMBIGUOUS",
} as const;
export type PublishOutcome = (typeof OUTCOME)[keyof typeof OUTCOME];

for (const v of Object.values(OUTCOME)) {
  if (v.length > 24) throw new Error(`publish outcome "${v}" exceeds decision varchar(24)`);
}

/**
 * WHAT is being published. Reel jobs and scheduled posts live in different tables
 * with independent id spaces, so an attempt that records only a bare id cannot be
 * reconciled — the reconciler would not know which table to write. That gap was
 * real: scheduled posts recorded no id at all, so an ambiguous scheduled post
 * appeared in the Action Center with every resolve action disabled.
 */
export type PublishTargetKind = "reel_job" | "scheduled_post";

export interface PublishTarget {
  /** Defaults to reel_job so existing callers keep their meaning. */
  kind?: PublishTargetKind;
  jobId?: number | null;
  /** scheduled_posts.id — same numeric space as jobId but a DIFFERENT table. */
  scheduledPostId?: number | null;
  inventoryId?: string | null;
  platforms: string[];
  mediaUrl?: string | null;
}

/**
 * Record that a publish is ABOUT to happen. Returns the attempt id, or null if
 * the record could not be written.
 *
 * A null return is a REFUSAL SIGNAL, not a warning. Unlike recordAuditEvent —
 * which deliberately swallows failures because losing one audit row must never
 * block an action — this record IS the safety property. Publishing without it
 * reintroduces exactly the unrecoverable ambiguity the ledger exists to prevent,
 * so callers should treat null as "do not publish".
 */
export async function recordPublishAttempt(target: PublishTarget): Promise<string | null> {
  const attemptId = `pub_${randomUUID()}`;
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) throw new Error("no database");
    const { autonomyAuditEvents } = await import("../../drizzle/schema");
    await d.insert(autonomyAuditEvents).values({
      id: attemptId,
      actionType: ATTEMPT_ACTION,
      decision: OUTCOME.attempted,
      reasoningCodes: target.platforms.join(",").slice(0, 1024),
      policyVersion: 0,
      contextJson: JSON.stringify({
        attemptId,
        kind: target.kind ?? "reel_job",
        jobId: target.jobId ?? null,
        scheduledPostId: target.scheduledPostId ?? null,
        inventoryId: target.inventoryId ?? null,
        platforms: target.platforms,
        mediaUrl: (target.mediaUrl ?? "").slice(0, 500),
        requestedAt: new Date().toISOString(),
      }).slice(0, 60_000),
      campaignId: target.inventoryId ?? null,
    });
    return attemptId;
  } catch (err) {
    log.error("could not record publish attempt — caller should NOT publish unrecorded", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      jobId: target.jobId ?? null,
    });
    return null;
  }
}

/**
 * Close out an attempt.
 *
 * Best-effort by necessity: by the time this runs the external call has already
 * happened, so refusing to proceed would change nothing. A lost outcome row
 * leaves the attempt open, which the reconciler reports — the safe direction,
 * since it prompts a human to check rather than assuming success.
 */
export async function recordPublishOutcome(
  attemptId: string,
  outcome: PublishOutcome,
  detail: { igPostId?: string | null; error?: string | null; platformResults?: unknown } = {},
): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) throw new Error("no database");
    const { autonomyAuditEvents } = await import("../../drizzle/schema");
    await d.insert(autonomyAuditEvents).values({
      id: `res_${randomUUID()}`,
      actionType: OUTCOME_ACTION,
      decision: outcome,
      reasoningCodes: attemptId.slice(0, 1024),
      policyVersion: 0,
      contextJson: JSON.stringify({
        attemptId,
        outcome,
        igPostId: detail.igPostId ?? null,
        error: detail.error ? String(detail.error).slice(0, 500) : null,
        platformResults: detail.platformResults ?? null,
        settledAt: new Date().toISOString(),
      }).slice(0, 60_000),
    });
  } catch (err) {
    log.error("could not record publish OUTCOME — attempt stays open for reconciliation", {
      attemptId, outcome, err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }
}

export interface UnreconciledAttempt {
  attemptId: string;
  occurredAt: Date;
  /** Which table the id belongs to. Legacy rows without it are reel jobs. */
  kind: PublishTargetKind;
  jobId: number | null;
  scheduledPostId: number | null;
  inventoryId: string | null;
  platforms: string[];
  ageMinutes: number;
}

/**
 * Attempts with no recorded outcome — every publish that may or may not be live.
 *
 * `olderThanMinutes` avoids reporting a publish that is simply still in flight;
 * a Meta call that has not settled in 15 minutes is not in flight.
 */
export async function findUnreconciledAttempts(olderThanMinutes = 15): Promise<UnreconciledAttempt[]> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return [];
  const { autonomyAuditEvents } = await import("../../drizzle/schema");
  const { eq, lt, and, desc } = await import("drizzle-orm");

  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const attempts = await d
    .select()
    .from(autonomyAuditEvents)
    .where(and(eq(autonomyAuditEvents.actionType, ATTEMPT_ACTION), lt(autonomyAuditEvents.occurredAt, cutoff)))
    .orderBy(desc(autonomyAuditEvents.occurredAt))
    .limit(200);
  if (!attempts.length) return [];

  // Outcomes carry their attemptId in reasoningCodes, so settled attempts are a
  // set membership test rather than a per-attempt query.
  const outcomes = await d
    .select({ codes: autonomyAuditEvents.reasoningCodes })
    .from(autonomyAuditEvents)
    .where(eq(autonomyAuditEvents.actionType, OUTCOME_ACTION))
    .limit(2000);
  const settled = new Set(outcomes.map((o: { codes: string }) => o.codes));

  const open: UnreconciledAttempt[] = [];
  for (const a of attempts) {
    if (settled.has(a.id)) continue;
    let ctx: { kind?: string; jobId?: number | null; scheduledPostId?: number | null; inventoryId?: string | null; platforms?: string[] } = {};
    try { ctx = JSON.parse(a.contextJson ?? "{}"); } catch { /* keep the row: an unreadable context is still an open attempt */ }
    const occurredAt = new Date(a.occurredAt);
    open.push({
      attemptId: a.id,
      occurredAt,
      // Attempts written before `kind` existed are all reel jobs — that was the
      // only caller at the time.
      kind: ctx.kind === "scheduled_post" ? "scheduled_post" : "reel_job",
      jobId: ctx.jobId ?? null,
      scheduledPostId: ctx.scheduledPostId ?? null,
      inventoryId: ctx.inventoryId ?? null,
      platforms: Array.isArray(ctx.platforms) ? ctx.platforms : [],
      ageMinutes: Math.round((Date.now() - occurredAt.getTime()) / 60_000),
    });
  }
  return open;
}
