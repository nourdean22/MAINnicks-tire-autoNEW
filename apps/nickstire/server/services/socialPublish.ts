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
  /**
   * Facebook-only link attachment. Present so callers that need it do not have
   * to reach around this choke point to `metaSocial.socialPost` — which is
   * exactly how `nickActions.socialPost` came to bypass the kill switch.
   * Instagram ignores it (the Graph API has no link field for feed posts).
   */
  link?: string;
  /**
   * Who is publishing. Decides what happens when the kill-switch state cannot
   * be READ (storage down or unreachable):
   *
   *   "operator"  (default) — proceed. A human is watching, can see the
   *                situation, and a storage blip must not take manual
   *                publishing down.
   *   "automated" — STOP. Nobody is watching an unattended cron, so
   *                "we could not check" must not mean "publish".
   *
   * Defaults to "operator" so every existing caller keeps today's behaviour;
   * the crons opt in explicitly. Same rule autonomyControl applies at its own
   * boundary: automated actors fail CLOSED, operators proceed loud.
   */
  actor?: "operator" | "automated";
}

export interface PublishOutcome {
  results: Array<{
    platform: "facebook" | "instagram";
    success: boolean;
    postId?: string;
    error?: string;
    /**
     * The publish request was DISPATCHED to Meta and no answer came back
     * (timeout/connection drop after media_publish left). The post may be
     * LIVE. Callers must park these for reconciliation — a retry can
     * duplicate a live post. Absent/false means Meta definitively answered.
     */
    ambiguous?: boolean;
  }>;
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

export const KILL_SWITCH_ERROR = "Publishing is paused by the autonomy kill switch.";

/**
 * Which of these platforms the operator's emergency controls currently stop,
 * recording the DENY audit event when any are.
 *
 * Extracted from publishToSocial so it can be SHARED rather than re-implemented.
 * igAutopost is an autonomous cron that posts to IG+FB on its own schedule and
 * does its own two-platform dispatch, so it cannot simply call publishToSocial
 * without also inheriting the feed cap — a separate, live policy question. It
 * can, and now does, honour the same emergency stop through this function.
 *
 * Never throws. On infra failure it returns [] and the caller's other gates
 * govern — matching the behaviour publishToSocial already had, because a
 * telemetry-ish read must not make publishing MORE fragile than it was.
 */
export async function killSwitchBlockedPlatforms(
  platforms: ("facebook" | "instagram")[],
  context: Record<string, unknown> = {},
  actor: "operator" | "automated" = "operator",
): Promise<("facebook" | "instagram")[]> {
  /**
   * Unknowable switch state. An operator's emergency stop may be sitting in
   * storage right now, invisible to this read.
   *
   * A human publishing by hand can see the situation and decide — so they
   * proceed loud. An unattended cron cannot, so it STOPS. This mirrors the
   * rule autonomyControl already applies at its own boundary: "Automated
   * actors fail CLOSED; operators proceed loud."
   */
  const unknowable = (): ("facebook" | "instagram")[] => {
    log.warn("kill-switch state unverifiable (storage unreachable)", { actor });
    return actor === "automated" ? [...platforms] : [];
  };

  try {
    const { getEmergencyControlsFresh, recordAuditEvent } = await import("./autonomyControl");
    const { controls: ec, source } = await getEmergencyControlsFresh();
    if (source === "fallback_unreachable" && actor === "automated") {
      const stopped = unknowable();
      // Audited, but a failing audit must not flip the decision back to open.
      try {
        await recordAuditEvent({
          actionType: "publish",
          decision: "DENY",
          reasoningCodes: ["KILL_SWITCH_STATE_UNKNOWN", ...stopped.map((p) => `platform:${p}`)],
          policyVersion: 0,
          context: { platforms, ...context },
        });
      } catch (err) {
        log.warn("could not audit the fail-closed stop", { err: err instanceof Error ? err.message : String(err) });
      }
      return stopped;
    }
    if (source === "fallback_unreachable") {
      log.warn("kill-switch state unverifiable (storage unreachable) — operator proceeds, other gates govern");
    }
    const blocked = platforms.filter(
      (p) => ec.globalKillSwitch || ec.publishingKillSwitch || ec.platformKillSwitches[p],
    );
    if (blocked.length) {
      await recordAuditEvent({
        actionType: "publish",
        decision: "DENY",
        reasoningCodes: [
          ec.globalKillSwitch
            ? "GLOBAL_KILL_SWITCH"
            : ec.publishingKillSwitch
              ? "PUBLISHING_KILL_SWITCH"
              : "PLATFORM_KILL_SWITCH",
          ...blocked.map((p) => `platform:${p}`),
        ],
        policyVersion: 0,
        context: { platforms, ...context },
      });
    }
    return blocked;
  } catch (err) {
    // Same rule as an unreadable policy row: the state is unknown, so an
    // unattended cron stops and a human proceeds. For the operator this keeps
    // the original promise that the switch check never makes publishing MORE
    // fragile than it was; for the cron, "we could not check" is not a reason
    // to publish.
    log.warn("kill-switch check unavailable", { err: err instanceof Error ? err.message : String(err), actor });
    return unknowable();
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
  const blockedPlatforms = await killSwitchBlockedPlatforms(
    input.platforms,
    { isStory: input.isStory, hasVideo: !!input.videoUrl, actor: input.actor ?? "operator" },
    input.actor ?? "operator",
  );
  if (blockedPlatforms.length) {
    for (const p of blockedPlatforms) {
      results.push({ platform: p, success: false, error: KILL_SWITCH_ERROR });
    }
    const remaining = input.platforms.filter((p) => !blockedPlatforms.includes(p));
    if (remaining.length === 0) return { results };
    input = { ...input, platforms: remaining };
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
      link: input.link,
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
