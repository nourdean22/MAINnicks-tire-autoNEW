/**
 * Multilingual variant candidate selection (ScanFinish NT-015).
 *
 * WHAT THIS IS NOT: an API integration. Verified before writing any code
 * (brief's own "web search before hard-coding a platform assumption"
 * mandate, 2026-08-13):
 *
 *  - Meta's Reels AI translation/dub/lip-sync (about.fb.com, Oct 2025 →
 *    14 languages by July 2026) is a Creator Studio / Instagram-app publish-
 *    time OPT-IN TOGGLE, not a parameter on the Graph API's Content
 *    Publishing endpoints (`/media`, `/media_publish`) — the exact API
 *    `metaSocial.ts` uses to publish autonomously. No documented Graph API
 *    field triggers it. There is nothing this codebase's automation can call.
 *  - YouTube's auto-dub (ghacks.net, socialmediatoday.com — global rollout
 *    2026-02-04) is automatic and CHANNEL-WIDE on every upload — not a
 *    per-video, selectively-triggerable feature, and moot regardless:
 *    nickstire has NO YouTube channel or publish integration anywhere in
 *    this repo (grepped — the only 3 "YouTube" hits are incidental blog/
 *    voice-line copy, not a channel).
 *
 * So this builds the one honest, useful piece: SELECTING which published
 * reels are strong enough to be worth the manual few minutes in Creator
 * Studio, reusing the "top performer" signal that already existed
 * (instagramAdmin.ts's recentWinners) and was never used to trigger
 * anything. The output is an operator worklist, not an automated action —
 * exactly the "Build preview/draft/copy-only" rule for anything
 * customer/publish-facing, applied here to a feature this repo cannot
 * legally automate rather than one it merely chooses not to.
 */

export interface DubCandidateInput {
  postId: string;
  mediaProductType: string | null;
  caption: string;
  engagementRate: number;
  reach: number | null;
  saved: number | null;
  shares: number | null;
}

export interface DubCandidate extends DubCandidateInput {
  reason: string;
}

/** Minimum reach before a post's engagement rate is trusted at all — the
 *  same floor philosophy MIN_GROUP_N/MIN_SAMPLES_PER_ARM use elsewhere:
 *  a 100% engagement rate off 3 viewers is not a signal. */
const MIN_REACH_TO_QUALIFY = 200;

export function selectMultilingualCandidates(
  posts: DubCandidateInput[],
  opts: { limit?: number } = {},
): DubCandidate[] {
  const limit = opts.limit ?? 3;
  return posts
    .filter((p) => p.mediaProductType === "REELS")
    .filter((p) => (p.reach ?? 0) >= MIN_REACH_TO_QUALIFY)
    .sort((a, b) => b.engagementRate - a.engagementRate)
    .slice(0, limit)
    .map((p) => ({
      ...p,
      reason: `top performer by engagement rate (${(p.engagementRate * 100).toFixed(2)}%, reach ${p.reach})`,
    }));
}
