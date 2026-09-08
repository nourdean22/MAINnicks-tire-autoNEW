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
 * `social_content_inventory.brief_json` is TEXT — 65,535 bytes. The authoritative
 * brief lives in `reel_jobs.payload` (MEDIUMTEXT) and, since 2026-09-07, carries
 * the IMMUTABLE production-pack snapshot the episode contract verifies against,
 * plus two compiled prompt packs. Measured 2026-09-08 on the first job to reach
 * this insert since that change: 95,351 bytes → ER_DATA_TOO_LONG, assembly
 * reported failed after the master had been stored, vaulted and registered, and
 * the job bounced back to assets_ready to burn its remaining attempts re-rendering
 * a reel it had already finished. Nothing had assembled since 08-30, so the
 * regression sat unhit for a day.
 *
 * The inventory row is a MIRROR for the Studio lane's gate; it needs the copy the
 * operator reads and the publisher hashes — not the evidence snapshot. So the
 * mirror carries the brief minus the bulk, and is REFUSED, loudly and by name,
 * if it is still too large. A truncated JSON blob would parse as nothing and
 * fail later, somewhere that cannot say why.
 */
const INVENTORY_BRIEF_OMIT = ["approvedProductionPack", "promptPack", "higgsfieldPromptPack", "observedVisualBible"] as const;
export const INVENTORY_BRIEF_MAX_BYTES = 65_535;

export function inventoryBriefJson(brief: unknown): string {
  const src = typeof brief === "object" && brief !== null ? (brief as Record<string, unknown>) : {};
  const slim: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if ((INVENTORY_BRIEF_OMIT as readonly string[]).includes(k)) continue;
    slim[k] = v;
  }
  slim.inventoryBriefNote = `omitted for the TEXT column: ${INVENTORY_BRIEF_OMIT.join(", ")}; authoritative brief is reel_jobs.payload`;
  const json = JSON.stringify(slim);
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > INVENTORY_BRIEF_MAX_BYTES) {
    throw new Error(
      `INVENTORY_BRIEF_TOO_LARGE: slimmed brief is ${bytes} bytes, column holds ${INVENTORY_BRIEF_MAX_BYTES}. ` +
        "Refusing to write a truncated blob; the reel_jobs row is intact.",
    );
  }
  return json;
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
    briefJson: inventoryBriefJson(args.brief ?? {}),
    version: 1,
  });
  return "created";
}
