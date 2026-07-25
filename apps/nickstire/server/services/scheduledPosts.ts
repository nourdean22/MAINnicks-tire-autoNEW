import { createLogger } from "../lib/logger";
import { publishToSocial } from "./socialPublish";
import { recordPublishAttempt, recordPublishOutcome, OUTCOME } from "./publishAttemptLedger";
import type { db as dbFactory } from "../lib/db-helper";

type Database = NonNullable<Awaited<ReturnType<typeof dbFactory>>>;

const log = createLogger("services:scheduledPosts");

/**
 * scheduled_posts.status is varchar(16) and MySQL runs with STRICT_TRANS_TABLES,
 * so an over-length value is REJECTED (the write errors, the row is not updated)
 * rather than truncated. That rules out the names the inventory table uses for
 * the same concepts — "published_partial" and "publish_ambiguous" are both 17
 * characters. Shipping those would have made a partial publish throw, then made
 * the catch throw while recording the failure, wedging the row in "publishing"
 * permanently.
 *
 * These fit. Widening the column to match social_content_inventory's varchar(32)
 * and unifying the vocabulary is deliberately deferred: the migration ledger is
 * currently known-drifted (nine hand-applied migrations invisible to drizzle), and
 * the agreed order is to establish a safe schema baseline before adding schema.
 */
const STATUS = {
  pending: "pending",
  publishing: "publishing", // 10
  posted: "posted",
  partial: "partial", // 7  — == inventory's "published_partial"
  ambiguous: "ambiguous", // 9  — == reel_jobs' "publish_ambiguous"
  failed: "failed",
} as const;

/** Guard the invariant at module load rather than discovering it in production. */
for (const v of Object.values(STATUS)) {
  if (v.length > 16) throw new Error(`scheduled_posts.status value "${v}" exceeds varchar(16)`);
}

/**
 * Write the fire-time outcome back onto the inventory row that scheduled this
 * post (scheduled_posts.inventoryId, migration 0096). Before the link existed
 * the inventory row said "scheduled" FOREVER — a failed 3am fire was invisible
 * on the Queue, and a published one never showed as published. Predicated on
 * status='scheduled' so we never clobber a row the operator meanwhile touched.
 * Best-effort: the scheduled_posts row already carries the authoritative
 * outcome; a writeback failure must not turn a successful publish into a
 * cron error.
 */
async function syncInventoryOutcome(
  database: Database,
  inventoryId: string | null,
  status: "published" | "failed" | "ambiguous",
  detail: string | null,
): Promise<void> {
  if (!inventoryId) return;
  try {
    const { socialContentInventory } = await import("../../drizzle/schema");
    const { and, eq } = await import("drizzle-orm");
    await database.update(socialContentInventory).set({
      status,
      ...(status === "published" ? { publishedAt: new Date() } : {}),
      errorMessage: detail
        ? `${status === "ambiguous" ? "scheduled publish AMBIGUOUS (may be LIVE — verify before retrying): " : "scheduled publish: "}${detail}`.slice(0, 500)
        : null,
      updatedAt: new Date(),
    }).where(and(eq(socialContentInventory.id, inventoryId), eq(socialContentInventory.status, "scheduled")));
  } catch (err) {
    log.error("failed to sync scheduled-post outcome onto inventory row", { inventoryId, status, err });
  }
}

/**
 * Fire all due scheduled posts (status='pending' AND scheduledAt<=now) through
 * the shared publish path, marking each posted/failed. Only ever publishes rows
 * the owner EXPLICITLY scheduled via the admin UI — deferred execution of an
 * owner action, not autonomous AI posting. Never throws (a missing table before
 * migration 0071 is applied is logged and treated as "nothing to do").
 */
export async function runScheduledPosts(): Promise<{ recordsProcessed: number; details: string }> {
  try {
    const { db } = await import("../lib/db-helper");
    const database = await db();
    if (!database) return { recordsProcessed: 0, details: "no database" };

    const { scheduledPosts } = await import("../../drizzle/schema");
    const { and, eq, lte } = await import("drizzle-orm");

    const due = await database
      .select()
      .from(scheduledPosts)
      .where(and(eq(scheduledPosts.status, STATUS.pending), lte(scheduledPosts.scheduledAt, new Date())))
      .limit(10);

    const { affectedRowCount } = await import("../lib/db-affected");

    let posted = 0;
    let partial = 0;
    let failed = 0;
    let skipped = 0;
    // Distinct from `skipped`: "another runner has it" and "we refused to publish
    // unrecorded" are different operator situations and must not share a label.
    let unrecordable = 0;
    for (const row of due) {
      // CLAIM BEFORE PUBLISHING. The select above and the status write below used
      // to be separated by an irreversible external call with nothing in between,
      // so two scheduler instances that read the same pending row would both post
      // it. The pending -> publishing compare-and-set makes the claim atomic: the
      // loser sees 0 affected rows and skips. Same pattern as the reel path.
      const claim = await database
        .update(scheduledPosts)
        .set({ status: STATUS.publishing })
        // `lte(scheduledAt, now)` is part of the CLAIM, not just the select:
        // an operator reschedule between the select and this CAS moves the
        // fire time but leaves status pending, so a status-only claim would
        // still win and publish at the OLD time while the reschedule UI had
        // already reported success. Whoever moves the time first owns the row.
        .where(and(
          eq(scheduledPosts.id, row.id),
          eq(scheduledPosts.status, STATUS.pending),
          lte(scheduledPosts.scheduledAt, new Date()),
        ));
      if (affectedRowCount(claim) === 0) {
        skipped++;
        log.warn("scheduled post already claimed by another runner — skipping", { id: row.id });
        continue;
      }

      // Durable attempt record before the irreversible call. The CAS claim above
      // stops two runners racing; it does not survive a process death, and a
      // redeploy landing mid-publish is routine here. A null id means the ledger
      // is unavailable: release the claim and leave the row pending rather than
      // publish unrecorded.
      const attemptId = await recordPublishAttempt({
        kind: "scheduled_post",
        scheduledPostId: row.id,
        platforms: row.platforms,
        mediaUrl: row.videoUrl ?? row.imageUrl ?? null,
      });
      if (!attemptId) {
        await database.update(scheduledPosts).set({ status: STATUS.pending })
          .where(and(eq(scheduledPosts.id, row.id), eq(scheduledPosts.status, STATUS.publishing)));
        unrecordable++;
        log.error("publish-attempt ledger unavailable — released the claim, leaving row pending", { id: row.id });
        continue;
      }

      try {
        const { results, igPostId } = await publishToSocial({
          platforms: row.platforms,
          caption: row.caption,
          imageUrl: row.imageUrl ?? undefined,
          imageUrls: row.imageUrls ?? undefined,
          videoUrl: row.videoUrl ?? undefined,
        });
        const succeeded = results.filter((r) => r.success);
        const failures = results.filter((r) => !r.success);
        // A dispatched-but-unanswered media_publish is NOT a plain failure —
        // the post may be live, and "failed" is the status that invites the
        // retry that duplicates it. ANY ambiguous platform parks the WHOLE
        // row: the first version required every platform to fail, so a
        // Facebook success beside an unanswered Instagram call was recorded
        // as PARTIAL — whose meaning ("post the missing platform manually")
        // is precisely the duplicate this state exists to prevent.
        const dispatchAmbiguous = failures.some((r) => r.ambiguous);
        const failureDetail = failures.map((r) => `${r.platform}: ${r.error}`).join("; ").slice(0, 500);
        await recordPublishOutcome(
          attemptId,
          dispatchAmbiguous ? OUTCOME.ambiguous : succeeded.length === 0 ? OUTCOME.failed : OUTCOME.confirmed,
          { igPostId: igPostId ?? null, error: failureDetail || null, platformResults: results },
        );

        if (dispatchAmbiguous) {
          failed++;
          const confirmedNote = succeeded.length ? `CONFIRMED on ${succeeded.map((r) => r.platform).join(", ")}; ` : "";
          await database
            .update(scheduledPosts)
            .set({
              status: STATUS.ambiguous,
              error: `${confirmedNote}publish dispatched but unanswered — reconcile with Meta before retrying (may be LIVE): ${failureDetail}`.slice(0, 500),
              ...(igPostId ? { igPostId } : {}),
            })
            .where(eq(scheduledPosts.id, row.id));
          await syncInventoryOutcome(database, row.inventoryId, "ambiguous", `${confirmedNote}${failureDetail}`);
        } else if (succeeded.length === 0) {
          failed++;
          await database
            .update(scheduledPosts)
            .set({ status: STATUS.failed, error: failureDetail })
            .where(eq(scheduledPosts.id, row.id));
          await syncInventoryOutcome(database, row.inventoryId, "failed", failureDetail);
        } else if (failures.length > 0) {
          // PARTIAL, not posted. This branch did not exist: any single success
          // marked the whole row "posted", so a Facebook success alongside an
          // Instagram failure was recorded as a clean publish and the missing
          // platform was invisible. The immediate-publish route already had
          // published_partial; the scheduler silently disagreed with it.
          partial++;
          await database
            .update(scheduledPosts)
            .set({ status: STATUS.partial, postedAt: new Date(), igPostId: igPostId ?? null, error: failureDetail })
            .where(eq(scheduledPosts.id, row.id));
          log.warn("scheduled post published to SOME platforms only", { id: row.id, ok: succeeded.map((r) => r.platform), failed: failureDetail });
          await syncInventoryOutcome(database, row.inventoryId, "published", `partial: ${failureDetail}`);
        } else {
          posted++;
          await database
            .update(scheduledPosts)
            .set({ status: STATUS.posted, postedAt: new Date(), igPostId: igPostId ?? null })
            .where(eq(scheduledPosts.id, row.id));
          await syncInventoryOutcome(database, row.inventoryId, "published", null);
        }
      } catch (err) {
        // A throw is NOT proof nothing was posted — the call may have reached Meta
        // before dying. Park it for reconciliation rather than releasing the claim
        // back to "pending", which would invite a duplicate on the next tick.
        failed++;
        await recordPublishOutcome(attemptId, OUTCOME.ambiguous, { error: err instanceof Error ? err.message : String(err) });
        log.error("scheduled post threw mid-publish — parking as ambiguous (may be LIVE)", { id: row.id, err });
        await database
          .update(scheduledPosts)
          .set({
            status: STATUS.ambiguous,
            error: `threw mid-publish, reconcile with Meta before retrying (may be LIVE): ${(err instanceof Error ? err.message : String(err)).slice(0, 400)}`,
          })
          .where(eq(scheduledPosts.id, row.id));
        await syncInventoryOutcome(database, row.inventoryId, "ambiguous", err instanceof Error ? err.message : String(err));
      }
    }
    const detail = `${posted} posted, ${partial} partial, ${failed} failed, ${skipped} claimed-elsewhere`
      + (unrecordable ? `, ${unrecordable} HELD (attempt ledger unavailable)` : "")
      + ` of ${due.length} due`;
    return { recordsProcessed: posted + partial + failed, details: detail };
  } catch (err) {
    log.error("runScheduledPosts failed (scheduled_posts table missing? migration 0071 not applied yet?)", err);
    return { recordsProcessed: 0, details: "error (see logs)" };
  }
}
