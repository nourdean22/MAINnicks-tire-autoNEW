import { createLogger } from "../lib/logger";
import { publishToSocial } from "./socialPublish";

const log = createLogger("services:scheduledPosts");

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
      .where(and(eq(scheduledPosts.status, "pending"), lte(scheduledPosts.scheduledAt, new Date())))
      .limit(10);

    let posted = 0;
    let failed = 0;
    for (const row of due) {
      try {
        const { results, igPostId } = await publishToSocial({
          platforms: row.platforms,
          caption: row.caption,
          imageUrl: row.imageUrl ?? undefined,
          imageUrls: row.imageUrls ?? undefined,
          videoUrl: row.videoUrl ?? undefined,
        });
        const allFailed = results.length > 0 && results.every((r) => !r.success);
        if (allFailed) {
          failed++;
          await database
            .update(scheduledPosts)
            .set({ status: "failed", error: results.map((r) => `${r.platform}: ${r.error}`).join("; ").slice(0, 500) })
            .where(eq(scheduledPosts.id, row.id));
        } else {
          posted++;
          await database
            .update(scheduledPosts)
            .set({ status: "posted", postedAt: new Date(), igPostId: igPostId ?? null })
            .where(eq(scheduledPosts.id, row.id));
        }
      } catch (err) {
        failed++;
        log.error("scheduled post failed", { id: row.id, err });
        await database
          .update(scheduledPosts)
          .set({ status: "failed", error: (err instanceof Error ? err.message : String(err)).slice(0, 500) })
          .where(eq(scheduledPosts.id, row.id));
      }
    }
    return { recordsProcessed: posted + failed, details: `${posted} posted, ${failed} failed of ${due.length} due` };
  } catch (err) {
    log.error("runScheduledPosts failed (scheduled_posts table missing? migration 0071 not applied yet?)", err);
    return { recordsProcessed: 0, details: "error (see logs)" };
  }
}
