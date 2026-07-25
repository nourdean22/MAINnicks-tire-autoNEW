/**
 * reelInventoryLink — the one place that guarantees an assembled reel has a
 * draft row in the publish gate.
 *
 * Verified live 2026-07-25: three assembled jobs (canary + autopost briefIds)
 * had NO social_content_inventory row, so the pipeline's assembly-time
 * `UPDATE … WHERE id = briefId` matched zero rows and nobody checked — the
 * jobs sat "assembled" forever with the Action Center's Publish button dead,
 * because "publish through the normal gates" pointed at an empty gate.
 * Same defect class as ROS-020/ROS-045: an unchecked affectedRows write.
 */
import { eq } from "drizzle-orm";
import { socialContentInventory } from "../../drizzle/schema";
import { affectedRowCount } from "../lib/db-affected";
import type { getDb } from "../db";

type DB = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Coerce loosely-shaped brief payloads (pipeline object vs stored JSON). */
function briefString(brief: unknown, key: string): string | undefined {
  if (typeof brief !== "object" || brief === null) return undefined;
  const value = (brief as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Update-then-insert: move the linked draft to review_ready with the fresh
 * master; when no row exists (canary/autopost briefs), CREATE it so the reel
 * enters the normal approve → publish flow instead of stranding.
 * Returns what happened so callers can log/act honestly.
 */
export async function ensureReelDraftForJob(
  d: DB,
  args: { briefId: string; mp4Url: string; brief: unknown },
): Promise<"updated" | "created"> {
  const updated = await d
    .update(socialContentInventory)
    .set({
      status: "review_ready",
      assetPaths: [args.mp4Url],
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(socialContentInventory.id, args.briefId));
  if (affectedRowCount(updated) > 0) return "updated";

  await d.insert(socialContentInventory).values({
    id: args.briefId,
    platform: "instagram",
    contentType: "reel",
    topic: (briefString(args.brief, "topic") ?? `Reel ${args.briefId}`).slice(0, 128),
    seriesName: "reel_pipeline",
    hookCategory: "reel",
    hookText: briefString(args.brief, "selectedCaption") ?? briefString(args.brief, "topic") ?? "",
    bodyText: "",
    visualStyle: "reel",
    persona: "nick",
    status: "review_ready",
    assetPaths: [args.mp4Url],
    briefJson: JSON.stringify(args.brief ?? {}),
    version: 1,
  });
  return "created";
}
