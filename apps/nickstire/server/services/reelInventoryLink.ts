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
import { and, asc, eq, gt, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { reelJobs, socialContentInventory } from "../../drizzle/schema";
import { affectedRowCount } from "../lib/db-affected";
import { createLogger } from "../lib/logger";
import type { getDb } from "../db";

const log = createLogger("services:reel-inventory-link");

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

/**
 * Mirror CONFIRMED publication truth from the Reel authority into the universal
 * social inventory. The external Meta receipt/reel_jobs row remains the source
 * of truth; this mirror exists so Queue, creative memory, metric sync, and
 * learning do not keep describing a live Reel as "review_ready".
 *
 * Idempotent and repair-friendly: if the inventory row somehow never existed,
 * create it directly as published rather than manufacturing an intermediate
 * review state for media that is already live.
 */
export async function markReelInventoryPublished(
  d: DB,
  args: {
    briefId: string;
    publishedAt?: Date | null;
    mp4Url?: string | null;
    caption?: string | null;
    brief?: unknown;
  },
): Promise<"updated" | "created" | "conflict_rejected"> {
  const publishedAt = args.publishedAt ?? new Date();
  const patch = {
    status: "published",
    publishedAt,
    errorMessage: null,
    ...(args.mp4Url ? { assetPaths: [args.mp4Url] } : {}),
    updatedAt: new Date(),
  };

  // NEVER overwrite an operator's rejection. The unguarded update turned a
  // rejected row into "published" and nulled the rejection reason, so a reel
  // the owner said no to went live AND the record of the no disappeared.
  // If a rejected reel is live anyway, that is a conflict for a human, and the
  // row keeps saying "rejected" so the Queue shows it.
  const updated = await d
    .update(socialContentInventory)
    .set(patch)
    .where(and(eq(socialContentInventory.id, args.briefId), ne(socialContentInventory.status, "rejected")));
  if (affectedRowCount(updated) > 0) return "updated";

  const [existing] = await d
    .select({ status: socialContentInventory.status })
    .from(socialContentInventory)
    .where(eq(socialContentInventory.id, args.briefId))
    .limit(1);
  if (existing) {
    log.error("REJECTED reel is confirmed LIVE — inventory left as rejected; operator must decide (delete the post or un-reject)", {
      inventoryId: args.briefId,
      status: existing.status,
    });
    return "conflict_rejected";
  }

  const brief = args.brief ?? {};
  await d.insert(socialContentInventory).values({
    id: args.briefId,
    platform: "instagram",
    contentType: "reel",
    topic: (briefString(brief, "topic") ?? `Reel ${args.briefId}`).slice(0, 128),
    seriesName: "reel_pipeline",
    hookCategory: "reel",
    hookText: args.caption?.trim() || briefString(brief, "selectedCaption") || briefString(brief, "topic") || "",
    bodyText: "",
    visualStyle: "reel",
    persona: "nick",
    status: "published",
    publishedAt,
    assetPaths: args.mp4Url ? [args.mp4Url] : [],
    briefJson: inventoryBriefJson(brief),
    version: 1,
  });
  return "created";
}

/**
 * Inventory states in which the autonomous lane must not publish (or
 * auto-approve) the reel behind the row: an operator said no, or it is already
 * live / being published / possibly live through another door.
 */
const REEL_INVENTORY_HOLD_STATUSES = new Set(["rejected", "published", "published_partial", "publishing", "ambiguous"]);

/**
 * Why the inventory row behind a reel job forbids an autonomous publish, or
 * null. No row means no objection (canary/autopost briefs get one at assembly).
 * A read failure THROWS: callers must fail closed on it, never treat it as clear.
 */
export async function reelInventoryHold(d: DB, briefId: string): Promise<string | null> {
  const [row] = await d
    .select({ status: socialContentInventory.status })
    .from(socialContentInventory)
    .where(eq(socialContentInventory.id, briefId))
    .limit(1);
  return row && REEL_INVENTORY_HOLD_STATUSES.has(row.status) ? row.status : null;
}

/** reelInventoryHold for many rows in one read: briefId -> hold, holds only. Throws on a read error. */
export async function reelInventoryHolds(d: DB, briefIds: string[]): Promise<Map<string, string>> {
  const holds = new Map<string, string>();
  if (!briefIds.length) return holds;
  const rows = await d
    .select({ id: socialContentInventory.id, status: socialContentInventory.status })
    .from(socialContentInventory)
    .where(inArray(socialContentInventory.id, briefIds));
  for (const r of rows) if (REEL_INVENTORY_HOLD_STATUSES.has(r.status)) holds.set(r.id, r.status);
  return holds;
}

function parseStoredBrief(payload: string | null): unknown {
  if (!payload) return {};
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return {};
  }
}

/** Repair one confirmed-live Reel mirror by durable job id. */
export async function markReelInventoryPublishedByJobId(
  d: DB,
  reelJobId: number,
  publishedAt?: Date | null,
): Promise<boolean> {
  const [job] = await d
    .select({
      briefId: reelJobs.briefId,
      payload: reelJobs.payload,
      mp4Url: reelJobs.mp4Url,
      caption: reelJobs.caption,
      publicationScheduledAt: reelJobs.publicationScheduledAt,
      updatedAt: reelJobs.updatedAt,
      igPostId: reelJobs.igPostId,
      status: reelJobs.status,
    })
    .from(reelJobs)
    .where(eq(reelJobs.id, reelJobId))
    .limit(1);

  if (!job?.igPostId || !["posted", "published"].includes(job.status)) return false;

  await markReelInventoryPublished(d, {
    briefId: job.briefId,
    publishedAt: publishedAt ?? job.publicationScheduledAt ?? job.updatedAt ?? new Date(),
    mp4Url: job.mp4Url,
    caption: job.caption,
    brief: parseStoredBrief(job.payload),
  });
  return true;
}

/**
 * Self-heal historical/future split-brain publication state.
 *
 * A live Reel is proven by BOTH a terminal live reel_jobs status and a durable
 * Instagram media id. We never promote from captions, filenames, or guesses.
 * This lets the recurring metrics loop repair old rows safely while the direct
 * publish path keeps new rows correct immediately.
 */
export async function reconcilePublishedReelInventoryTruth(
  d: DB,
  batchSize = 250,
): Promise<{ examined: number; repaired: number; created: number; failed: number }> {
  const pageSize = Math.max(1, Math.min(500, batchSize));
  let cursorId = 0;
  let examined = 0;
  let repaired = 0;
  let created = 0;
  let failed = 0;

  // Select ONLY rows whose universal mirror is absent or still not published.
  // Page oldest-first by durable reel_jobs.id so every run drains the entire
  // historical backlog instead of rereading the same newest N rows forever.
  for (;;) {
    const mismatch = or(
      isNull(socialContentInventory.id),
      ne(socialContentInventory.status, "published"),
      isNull(socialContentInventory.publishedAt),
    );
    const liveConfirmed = and(
      inArray(reelJobs.status, ["posted", "published"]),
      isNotNull(reelJobs.igPostId),
      mismatch,
    );
    const page = await d
      .select({
        id: reelJobs.id,
        briefId: reelJobs.briefId,
        payload: reelJobs.payload,
        mp4Url: reelJobs.mp4Url,
        caption: reelJobs.caption,
        publicationScheduledAt: reelJobs.publicationScheduledAt,
        updatedAt: reelJobs.updatedAt,
      })
      .from(reelJobs)
      .leftJoin(socialContentInventory, eq(socialContentInventory.id, reelJobs.briefId))
      .where(cursorId > 0 ? and(liveConfirmed, gt(reelJobs.id, cursorId)) : liveConfirmed)
      .orderBy(asc(reelJobs.id))
      .limit(pageSize);

    if (page.length === 0) break;

    for (const job of page) {
      examined += 1;
      cursorId = Math.max(cursorId, job.id);
      try {
        const outcome = await markReelInventoryPublished(d, {
          briefId: job.briefId,
          publishedAt: job.publicationScheduledAt ?? job.updatedAt ?? new Date(),
          mp4Url: job.mp4Url,
          caption: job.caption,
          brief: parseStoredBrief(job.payload),
        });
        // A rejected-but-live reel is not repaired; it stays visible (and logged) until a human acts.
        if (outcome === "conflict_rejected") {
          failed += 1;
          continue;
        }
        repaired += 1;
        if (outcome === "created") created += 1;
      } catch (err) {
        failed += 1;
        log.warn("failed to self-heal one confirmed-live Reel inventory mirror", {
          reelJobId: job.id,
          briefId: job.briefId,
          err: err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240),
        });
      }
    }

    if (page.length < pageSize) break;
  }

  return { examined, repaired, created, failed };
}
