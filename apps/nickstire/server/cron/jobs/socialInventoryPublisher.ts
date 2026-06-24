import { createLogger } from "../../lib/logger";
import { getDbTyped } from "../../db";
import { socialContentInventory } from "../../../drizzle/schema";
import { eq, and, lte, sql } from "drizzle-orm";
import { publishToSocial } from "../../services/socialPublish";

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
        log.info(`Publishing inventory item: ${item.id} (topic: ${item.topic})`);
        
        const isReel = item.contentType === "reel";
        const isCarousel = item.contentType === "carousel";
        
        const platformsToPublish = item.platform === "both" || item.platform === "all" ? ["facebook", "instagram", "google"] : [item.platform];
        
        const mediaInput: any = {
          platforms: platformsToPublish,
          caption: `${item.hookText}\n\n${item.bodyText}`,
        };

        const assets = Array.isArray(item.assetPaths) ? (item.assetPaths as string[]) : [];
        if (isReel) {
          mediaInput.videoUrl = assets[0] || "https://assets.mixkit.co/videos/preview/mixkit-car-mechanic-working-on-a-wheel-42289-large.mp4";
        } else if (isCarousel) {
          mediaInput.imageUrls = assets.length >= 2 ? assets : [
            "https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&q=80&w=800",
            "https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?auto=format&fit=crop&q=80&w=800"
          ];
        } else {
          mediaInput.imageUrl = assets[0] || "https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&q=80&w=800";
        }

        const { results } = await publishToSocial(mediaInput);
        const allFailed = results.length > 0 && results.every((r) => !r.success);

        if (allFailed) {
          failed++;
          const errors = results.map(r => `${r.platform}: ${r.error}`).join("; ");
          await db
            .update(socialContentInventory)
            .set({ status: "failed", errorMessage: errors.slice(0, 500) })
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
