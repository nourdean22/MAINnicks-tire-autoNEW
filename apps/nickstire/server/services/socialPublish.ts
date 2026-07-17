/**
 * Shared social publish path — used by the Direct Publisher (publishPost) AND
 * the scheduled-posts cron, so both go through one branch set and one
 * claim-safety rule. Posting to Meta is owner-gated upstream (the proc is
 * adminProcedure; the cron only fires rows the owner explicitly scheduled).
 */
import { checkReviewReply } from "@shared/reviewReplyQa";
import { createLogger } from "../lib/logger";

const log = createLogger("services:social-publish");

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

/**
 * Enforce permanent URLs for reel publish paths to prevent scheduled reels from
 * silently failing after 24 hours.
 */
export function assertPermanentPublicMediaUrl(url?: string | null): void {
  if (!url) throw new Error("media URL missing");
  if (/X-Amz-|Expires=|Signature=|AWSAccessKeyId/i.test(url)) {
    throw new Error("media URL is presigned/temporary; configure CLOUDFRONT_DOMAIN before publishing");
  }
}

/** Run the actual publish across the selected platforms. No claim-safety here —
 *  callers MUST gate on captionClaimBlockers() first. */
export async function publishToSocial(input: PublishInput): Promise<PublishOutcome> {
  const { postToFacebook, postToInstagram, postInstagramReel, postInstagramCarousel, postInstagramStory } = await import("./metaSocial");
  const results: PublishOutcome["results"] = [];

  // Autonomy kill switches at THE publish choke point (fresh read, 2s cache):
  // global + publishing + per-platform. Defense-in-depth alongside the
  // existing claim-safety and REEL_PUBLISH_ENABLED gates below — the policy
  // engine adds an instant, versioned, audited emergency stop that covers
  // EVERY publish shape (static, carousel, reel, story, Facebook).
  try {
    const { getEmergencyControlsFresh } = await import("./autonomyControl");
    const { controls: ec, source } = await getEmergencyControlsFresh();
    if (source === "fallback_unreachable") {
      log.warn("kill-switch state unverifiable (storage unreachable) — existing gates govern");
    }
    const blockedPlatforms = input.platforms.filter(
      (p) => ec.globalKillSwitch || ec.publishingKillSwitch || ec.platformKillSwitches[p],
    );
    if (blockedPlatforms.length) {
      const { recordAuditEvent } = await import("./autonomyControl");
      await recordAuditEvent({
        actionType: "publish",
        decision: "DENY",
        reasoningCodes: [
          ec.globalKillSwitch ? "GLOBAL_KILL_SWITCH" : ec.publishingKillSwitch ? "PUBLISHING_KILL_SWITCH" : "PLATFORM_KILL_SWITCH",
          ...blockedPlatforms.map((p) => `platform:${p}`),
        ],
        policyVersion: 0,
        context: { platforms: input.platforms, isStory: input.isStory, hasVideo: !!input.videoUrl },
      });
      for (const p of blockedPlatforms) {
        results.push({ platform: p, success: false, error: "Publishing is paused by the autonomy kill switch." });
      }
      const remaining = input.platforms.filter((p) => !blockedPlatforms.includes(p));
      if (remaining.length === 0) return { results };
      input = { ...input, platforms: remaining };
    }
  } catch (err) {
    // The switch check itself must never make publishing MORE dangerous:
    // on infra failure the existing gates below still govern.
    log.warn("kill-switch check unavailable — existing gates govern", { err: err instanceof Error ? err.message : String(err) });
  }

  // Content governor at the publish door: daily caps + spacing hold against
  // ACTUALLY PUBLISHED inventory for every caller (scheduled posts,
  // autoposters, admin), reservation or not.
  try {
    const { assertPublishCadence } = await import("./contentGovernor");
    const format = input.isStory
      ? ("story" as const)
      : input.imageUrls && input.imageUrls.length >= 2
        ? ("carousel" as const)
        : input.videoUrl
          ? ("reel" as const)
          : ("photo" as const);
    await assertPublishCadence({ format });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Blocked by content governor")) {
      for (const p of input.platforms) {
        results.push({ platform: p, success: false, error: err.message });
      }
      return { results };
    }
    log.warn("publish cadence check errored — proceeding", { err: err instanceof Error ? err.message : String(err) });
  }

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
