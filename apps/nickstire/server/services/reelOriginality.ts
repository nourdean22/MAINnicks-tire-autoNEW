/**
 * The published corpus the originality gate compares against.
 *
 * TWO SOURCES, because neither alone is the account's history:
 *
 *   1. `reel_jobs` rows carrying an `igPostId` — full fidelity. These give the
 *      on-screen text (from the storyboard beats), the caption and the video
 *      URL, so all three comparison surfaces are available.
 *
 *   2. `instagram_analytics` captions — broader coverage, caption only. This
 *      matters: `reel_jobs` accounts for 29 distinct published post ids while
 *      the analytics cache holds 39 REELS, so roughly a dozen reels the account
 *      published never came through this pipeline. Comparing only against our
 *      own rows would call those originals.
 *
 * The corpus is bounded by ALL history, not a recent window. The duplicate that
 * prompted this gate was twelve days old; a 7-day window would have missed it,
 * and a 30-day one would miss the next.
 *
 * FAILURE POSTURE, deliberately different from the approval gate. Approval
 * fails CLOSED because absence of consent must never be read as consent. This
 * one fails OPEN and says so loudly: an unreadable corpus is not evidence that
 * a reel is a duplicate, and refusing every publish because the analytics table
 * is briefly unavailable would make the gate the thing that gets switched off.
 * The publish door is already default-deny on approval, so an open failure here
 * cannot by itself put anything live.
 */
import { createLogger } from "../lib/logger";
import type { PublishedRecord } from "@shared/reelOriginality";

const log = createLogger("services:reel-originality");

/** Beat on-screen text, in order, from a reel_jobs payload. */
function onScreenTextFromPayload(payload: string | null): string {
  if (!payload) return "";
  try {
    const p = JSON.parse(payload) as { storyboardBeats?: Array<{ onScreenText?: string }> };
    return (p.storyboardBeats ?? []).map((b) => b?.onScreenText ?? "").filter(Boolean).join(" ");
  } catch {
    return "";
  }
}

function topicFromPayload(payload: string | null): string {
  if (!payload) return "";
  try {
    return String((JSON.parse(payload) as { topic?: string }).topic ?? "");
  } catch {
    return "";
  }
}

/**
 * Everything the account is known to have published.
 *
 * `excludeJobId` keeps a job from matching itself when the gate runs on a row
 * that already carries a post id (re-publish attempts, reconciliation).
 */
export async function loadPublishedCorpus(excludeJobId?: number): Promise<PublishedRecord[]> {
  const out: PublishedRecord[] = [];
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) {
      log.warn("originality corpus unavailable (no database) — gate will not block");
      return out;
    }

    const { reelJobs, instagramAnalytics } = await import("../../drizzle/schema");
    const { isNotNull, ne, and } = await import("drizzle-orm");

    const jobRows: Array<{ id: number; igPostId: string | null; caption: string | null; payload: string | null; mp4Url: string | null }> =
      await d
        .select({
          id: reelJobs.id,
          igPostId: reelJobs.igPostId,
          caption: reelJobs.caption,
          payload: reelJobs.payload,
          mp4Url: reelJobs.mp4Url,
        })
        .from(reelJobs)
        .where(
          excludeJobId
            ? and(isNotNull(reelJobs.igPostId), ne(reelJobs.id, excludeJobId))
            : isNotNull(reelJobs.igPostId),
        );

    for (const r of jobRows) {
      out.push({
        label: `reel job ${r.id} (post ${r.igPostId})`,
        onScreenText: onScreenTextFromPayload(r.payload),
        caption: r.caption,
        videoUrl: r.mp4Url,
        topic: topicFromPayload(r.payload),
      });
    }

    // Caption-only, and that is the honest limit of this source: the cache
    // records what was posted, not the storyboard behind it.
    const cacheRows: Array<{ postId: string; caption: string | null }> = await d
      .select({ postId: instagramAnalytics.postId, caption: instagramAnalytics.caption })
      .from(instagramAnalytics);

    const seen = new Set(jobRows.map((r) => r.igPostId).filter(Boolean) as string[]);
    for (const r of cacheRows) {
      if (seen.has(r.postId)) continue; // already covered at full fidelity
      out.push({ label: `published post ${r.postId}`, caption: r.caption, onScreenText: null });
    }
  } catch (err) {
    // FAIL OPEN, LOUDLY. See the module header for why this differs from the
    // approval gate's fail-closed posture.
    log.error("originality corpus could not be loaded — the gate cannot block this run", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return out;
}
