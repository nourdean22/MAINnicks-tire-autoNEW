/**
 * DB-backed wrapper for shared/multilingualCandidates.ts — reuses the same
 * getTopPosts() read instagramAdmin.ts's recentWinners already runs, so this
 * costs one extra pure filter, not a second query.
 */
import { createLogger } from "../lib/logger";
import { selectMultilingualCandidates, type DubCandidate } from "../../shared/multilingualCandidates";

const log = createLogger("services:multilingual-candidates");

export async function getMultilingualDubCandidates(limit = 3): Promise<DubCandidate[]> {
  try {
    const { getTopPosts } = await import("../pipelines/instagram-data");
    const posts = await getTopPosts({ limit: 25 });
    return selectMultilingualCandidates(
      posts.map((p) => ({
        postId: p.postId,
        mediaProductType: p.mediaProductType,
        caption: p.caption,
        engagementRate: p.engagementRate,
        reach: p.reach,
        saved: p.saved,
        shares: p.shares,
      })),
      { limit },
    );
  } catch (e) {
    log.warn("multilingual dub candidates unavailable — reporting empty rather than throwing", {
      e: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}
