import { createLogger } from "../../lib/logger";
import { getDbTyped } from "../../db";
import { socialContentInventory } from "../../../drizzle/schema";
import { eq, and, lte, sql } from "drizzle-orm";
import { publishToSocial } from "../../services/socialPublish";
import { affectedRowCount } from "../../lib/db-affected";

const log = createLogger("cron:social-inventory-publisher");

/**
 * Checks if any approved or scheduled posts in socialContentInventory are due for publishing,
 * and publishes them to the targeted social platforms.
 */
export async function runSocialInventoryPublisher(): Promise<{ recordsProcessed: number; details: string }> {
  if (process.env.REEL_PUBLISH_ENABLED !== "true") {
    return { recordsProcessed: 0, details: "disabled (REEL_PUBLISH_ENABLED != true)" };
  }

  try {
    const db = await getDbTyped();
    if (!db) return { recordsProcessed: 0, details: "Database not available" };

    const now = new Date();
    // Fetch up to 5 due drafts from socialContentInventory
    const due = await db
      .select()
      .from(socialContentInventory)
      .where(
        and(
          sql`${socialContentInventory.status} IN ('approved', 'scheduled')`,
          lte(socialContentInventory.scheduledAt, now)
        )
      )
      .limit(5);

    let posted = 0;
    let failed = 0;

    for (const item of due) {
      try {
        // At-most-once claim before the irreversible send — same idiom as
        // cron/jobs/crudAutomation.ts:507. The select above and the publish below are
        // separate statements: without this CAS a retry, an overlapping tick, or an
        // operator hitting Publish on the same row all reach Meta twice.
        const claim = await db
          .update(socialContentInventory)
          .set({ status: "publishing", updatedAt: new Date() })
          .where(and(
            eq(socialContentInventory.id, item.id),
            eq(socialContentInventory.status, item.status),
          ));
        if (affectedRowCount(claim) === 0) {
          log.info(`Skipping ${item.id}: status moved from "${item.status}" since select — another worker owns it`);
          continue;
        }

        log.info(`Publishing inventory item: ${item.id} (topic: ${item.topic})`);
        
        const isReel = item.contentType === "reel";
        const isCarousel = item.contentType === "carousel";
        
        const platformString = item.platform as string;
        const platformsToPublish = platformString === "both" || platformString === "all" ? ["facebook", "instagram", "google"] : [item.platform];
        
        const mediaInput: any = {
          platforms: platformsToPublish,
          caption: `${item.hookText}\n\n${item.bodyText}`,
        };

        const assets = Array.isArray(item.assetPaths) ? (item.assetPaths as string[]) : [];
        const { assertPermanentPublicMediaUrl, captionClaimBlockers } = await import("../../services/socialPublish");
        
        if (isReel) {
          if (!assets[0]) {
            throw new Error("no reel MP4 asset — generation incomplete");
          }
          if (!assets[0].toLowerCase().endsWith(".mp4")) {
            throw new Error(`reel asset is not an MP4 video (got: ${assets[0]})`);
          }
          assertPermanentPublicMediaUrl(assets[0]);
          mediaInput.videoUrl = assets[0];
        } else if (isCarousel) {
          if (assets.length < 2) {
            throw new Error(`carousel requires at least 2 assets, found ${assets.length}`);
          }
          mediaInput.imageUrls = assets;
        } else {
          if (!assets[0]) {
            throw new Error("no image asset — generation incomplete");
          }
          mediaInput.imageUrl = assets[0];
        }

        const blockers = captionClaimBlockers(mediaInput.caption);
        if (blockers.length > 0) {
          throw new Error(`Caption blocked due to unsafe claims: ${blockers.join(", ")}`);
        }

        // Integrity: if this row was approved with a provenance record, the
        // media/brief being published must still hash to what the human saw.
        // Rows approved before provenance existed have no record — let those
        // through with a warning rather than bricking the whole queue.
        const { verifyApprovalRecord } = await import("../../services/contentApprovals");
        const verdict = await verifyApprovalRecord(db, {
          inventoryId: item.id,
          version: (item.version ?? 1) - 1,
          briefJson: item.briefJson,
          mediaUrls: assets,
        });
        if (!verdict.ok && verdict.reason !== "no_record") {
          throw new Error(
            `Integrity breach: ${verdict.reason === "brief_mismatch" ? "content" : "media"} changed after approval — re-approve before publishing`,
          );
        }
        if (!verdict.ok) {
          log.warn(`No approval record for ${item.id} v${(item.version ?? 1) - 1} (pre-provenance row) — publishing without integrity check`);
        }

        // "automated": unattended queue drain — an unreadable kill-switch state
        // stops it instead of publishing blind.
        const { results } = await publishToSocial({ ...mediaInput, actor: "automated" });
        const succeeded = results.filter((r) => r.success);
        const failedResults = results.filter((r) => !r.success);
        const errors = failedResults.map((r) => `${r.platform}: ${r.error}`).join("; ");

        if (succeeded.length === 0) {
          failed++;
          await db
            .update(socialContentInventory)
            .set({ status: "failed", errorMessage: errors.slice(0, 500) })
            .where(eq(socialContentInventory.id, item.id));
        } else if (failedResults.length > 0) {
          // Partial: at least one platform is LIVE. The old branch recorded this as
          // "published", hiding the failure entirely — the run reported a clean post
          // while Instagram never received it. Not "failed" either: that invites a
          // retry which would duplicate the platform that did succeed.
          failed++;
          log.warn(`Partial publish for ${item.id}: live on ${succeeded.map((r) => r.platform).join(", ")}; failed on ${errors}`);
          await db
            .update(socialContentInventory)
            .set({ status: "published_partial", publishedAt: new Date(), errorMessage: errors.slice(0, 500) })
            .where(eq(socialContentInventory.id, item.id));
        } else {
          posted++;
          await db
            .update(socialContentInventory)
            .set({ status: "published", publishedAt: new Date() })
            .where(eq(socialContentInventory.id, item.id));
        }
      } catch (err) {
        failed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        log.error(`Failed to publish inventory item ${item.id}:`, err);
        await db
          .update(socialContentInventory)
          .set({ status: "failed", errorMessage: errorMsg.slice(0, 500) })
          .where(eq(socialContentInventory.id, item.id));
      }
    }

    // Self-learning attribution loopback
    try {
      const { syncSocialMetrics, attributeRevenueToSocial } = await import("../../services/contentManufacturing");
      const syncResult = await syncSocialMetrics();
      const attribResult = await attributeRevenueToSocial();
      log.info(`Self-learning loop: matched=${syncResult.matched} updated=${syncResult.updated} attributedBookings=${attribResult.bookingsAttributed}`);
    } catch (e) {
      log.warn("Self-learning loop failed (non-blocking):", e);
    }

    return {
      recordsProcessed: posted + failed,
      details: `${posted} published, ${failed} failed`
    };
  } catch (err) {
    log.error("runSocialInventoryPublisher failed:", err);
    return { recordsProcessed: 0, details: String(err) };
  }
}
