/**
 * Shared social publish path — used by the Direct Publisher (publishPost) AND
 * the scheduled-posts cron, so both go through one branch set and one
 * claim-safety rule. Posting to Meta is owner-gated upstream (the proc is
 * adminProcedure; the cron only fires rows the owner explicitly scheduled).
 */
import { checkReviewReply } from "@shared/reviewReplyQa";

export interface PublishInput {
  platforms: ("facebook" | "instagram")[];
  caption: string;
  imageUrl?: string;
  imageUrls?: string[];
  videoUrl?: string;
  isStory?: boolean;
}

export interface PublishOutcome {
  results: Array<{ platform: "facebook" | "instagram"; success: boolean; postId?: string; error?: string }>;
  igPostId?: string;
}

/**
 * Claim-safety blockers for a public caption. Excludes no-price-talk because
 * advertised prices ("from $60 installed") are legitimate on IG ads, unlike
 * Google review replies. Returns [] when the caption is clean.
 */
export function captionClaimBlockers(caption: string) {
  return checkReviewReply(caption).filter((f) => f.severity === "block" && f.rule !== "no-price-talk");
}

/** Run the actual publish across the selected platforms. No claim-safety here —
 *  callers MUST gate on captionClaimBlockers() first. */
export async function publishToSocial(input: PublishInput): Promise<PublishOutcome> {
  const { postToFacebook, postToInstagram, postInstagramReel, postInstagramCarousel, postInstagramStory } = await import("./metaSocial");
  const results: PublishOutcome["results"] = [];

  if (input.platforms.includes("facebook")) {
    const fbRes = await postToFacebook({
      message: input.caption,
      imageUrl: input.imageUrl ?? input.imageUrls?.[0],
    });
    results.push({ platform: "facebook", ...fbRes });
  }

  if (input.platforms.includes("instagram")) {
    if (input.isStory) {
      const r = await postInstagramStory({ imageUrl: input.imageUrl, videoUrl: input.videoUrl });
      results.push({ platform: "instagram", ...r });
    } else if (input.imageUrls && input.imageUrls.length >= 2) {
      const r = await postInstagramCarousel({ imageUrls: input.imageUrls, caption: input.caption });
      results.push({ platform: "instagram", ...r });
    } else if (input.videoUrl) {
      // Reels are the most dangerous publish path (autonomously assembled video).
      // publishToSocial is the ONE gated door to postInstagramReel — never call
      // that directly. Two gates enforced here, at the choke point:
      //  1. an explicit, default-OFF kill switch (REEL_PUBLISH_ENABLED), and
      //  2. full caption claim-safety INCLUDING no-price-talk — unlike ad
      //     captions, reels never allow price claims.
      if (process.env.REEL_PUBLISH_ENABLED !== "true") {
        results.push({ platform: "instagram", success: false, error: "Reel publishing is disabled (set REEL_PUBLISH_ENABLED=true to arm)." });
      } else {
        const reelBlockers = checkReviewReply(input.caption).filter((f) => f.severity === "block");
        if (reelBlockers.length) {
          results.push({ platform: "instagram", success: false, error: `Reel caption blocked by claim-safety: ${reelBlockers.map((b) => b.rule).join(", ")}` });
        } else {
          const r = await postInstagramReel({ videoUrl: input.videoUrl, caption: input.caption });
          results.push({ platform: "instagram", ...r });
        }
      }
    } else if (input.imageUrl) {
      const r = await postToInstagram({ imageUrl: input.imageUrl, caption: input.caption });
      results.push({ platform: "instagram", ...r });
    } else {
      results.push({
        platform: "instagram",
        success: false,
        error: "Instagram requires media (imageUrl, imageUrls, or videoUrl)",
      });
    }
  }

  const igPostId = results.find((r) => r.platform === "instagram" && r.success)?.postId;
  return { results, igPostId };
}
