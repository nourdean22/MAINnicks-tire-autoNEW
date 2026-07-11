/**
 * apps/statenour/src/inngest/functions/social-publish.ts
 *
 * Durable background task for executing Facebook & Instagram dispatches.
 * Avoids HTTP route timeouts by moving slow API integrations into checkpointed steps.
 */

import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { prisma } from "@/lib/prisma";
import {
  publishToInstagram,
  publishToFacebook,
  publishReelToInstagram,
} from "@/lib/social/meta-publish";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("inngest/social-publish");
const inngest = getInngest();

export const socialPublishQueue = inngest.createFunction(
  {
    id: "social-publish",
    name: "Social Publication durable worker",
    triggers: [{ event: "social/publish" }],
    onFailure: onInngestFailure,
    // 2026-07-10 review fix · was the ONLY function without an explicit
    // retries value (SDK default = 4). External publishes must be
    // at-most-once: a retry after Meta accepted the publish (but the
    // response was lost — Railway restart, network blip) would create a
    // NEW container and post the same content AGAIN. A missed post is
    // recoverable (status "rejected" + Telegram onFailure alert);
    // a double-post to the business Instagram is not. Same reasoning as
    // nick-action-approved.ts retries:0.
    retries: 0,
  },
  async ({ event, step }) => {
    const { draftId, platforms, imageUrl, videoUrl, caption, message, linkUrl } = event.data as {
      draftId?: string;
      platforms: string[];
      imageUrl?: string | null;
      videoUrl?: string | null;
      caption?: string;
      message?: string;
      linkUrl?: string | null;
    };

    // 1. Update draft status to "rendering" (publishing underway) in DB if draftId provided
    if (draftId) {
      await step.run("set-rendering-status", async () => {
        return prisma.socialPublishQueue.update({
          where: { id: draftId },
          data: { status: "rendering" },
        });
      });
    }

    const publishResults: Array<{ platform: string; ok: boolean; postId?: string; permalink?: string; error?: string }> = [];

    // 2. Facebook Step (checkpointed for idempotency)
    if (platforms.includes("facebook")) {
      const fbResult = await step.run("publish-facebook", async () => {
        const res = await publishToFacebook({
          message: message || caption || "",
          imageUrl: imageUrl || undefined,
          linkUrl: linkUrl || undefined,
        });
        return {
          platform: "facebook",
          ok: res.ok,
          postId: res.postId,
          permalink: res.permalink,
          error: res.error,
        };
      });
      publishResults.push(fbResult);
    }

    // 3. Instagram Step (checkpointed for idempotency)
    if (platforms.includes("instagram")) {
      const igResult = await step.run("publish-instagram", async () => {
        if (videoUrl) {
          // 2026-07-10 review fix · the Reel flow was reimplemented inline
          // here with NO try/catch and NO fetch timeouts (a thrown fetch
          // propagated out of step.run -> step retry -> duplicate Reel),
          // and it nested step.sleep inside step.run (Inngest anti-
          // pattern). The hardened helper is the same 3-step flow with
          // AbortSignal.timeout on every call and a full try/catch that
          // always returns { ok: false } instead of throwing. Test path
          // (lib/services/social-actions.ts) already used it.
          const res = await publishReelToInstagram({
            videoUrl,
            caption: caption || message || "",
            coverUrl: imageUrl || undefined,
          });
          return {
            platform: "instagram",
            ok: res.ok,
            postId: res.postId,
            permalink: res.permalink,
            error: res.error,
          };
        } else {
          // Standard Image upload to Instagram
          const res = await publishToInstagram({
            imageUrl: imageUrl!,
            caption: caption || message || "",
          });
          return {
            platform: "instagram",
            ok: res.ok,
            postId: res.postId,
            permalink: res.permalink,
            error: res.error,
          };
        }
      });
      publishResults.push(igResult);
    }

    // 4. Update Database Row state with optimistic lock check
    if (draftId) {
      await step.run("finalize-draft-db-state", async () => {
        const existing = await prisma.socialPublishQueue.findUnique({
          where: { id: draftId },
          select: { status: true },
        });

        // Optimistic lock check: if draft was deleted or edited manually by operator, skip
        if (existing && existing.status !== "rendering" && existing.status !== "pending") {
          log.warn("social_publish_db_lock_abort", { draftId, status: existing.status });
          return;
        }

        const allSucceeded = publishResults.every((r) => r.ok);
        const publishUrls = publishResults.map((r) => r.permalink || r.postId || "").filter(Boolean);
        const errors = publishResults.map((r) => r.error).filter(Boolean);

        // AG-44 · stash raw postIds in sourceMetadata — the weekly
        // content-performance fn needs Graph ids, and permalinks in
        // publishUrls shadow them. Merge, never clobber existing meta.
        const currentRow = await prisma.socialPublishQueue.findUnique({
          where: { id: draftId },
          select: { sourceMetadata: true },
        });
        const currentMeta =
          currentRow?.sourceMetadata && typeof currentRow.sourceMetadata === "object"
            ? (currentRow.sourceMetadata as Record<string, unknown>)
            : {};

        return prisma.socialPublishQueue.update({
          where: { id: draftId },
          data: {
            status: allSucceeded ? "published" : "rejected",
            publishedAt: allSucceeded ? new Date() : null,
            publishUrls,
            rejectionReason: allSucceeded ? null : errors.join(" | "),
            sourceMetadata: {
              ...currentMeta,
              publishResults: publishResults.map((r) => ({
                platform: r.platform,
                postId: r.postId ?? null,
                ok: r.ok,
              })),
            },
          },
        });
      });
    }

    // 5. Create Audit Event Logs
    await step.run("log-audit-events", async () => {
      for (const r of publishResults) {
        await prisma.auditEvent.create({
          data: {
            actor: "social-publish-queue",
            eventType: r.ok ? `published_${r.platform}` : `publish_failed_${r.platform}`,
            detail: r.ok
              ? `[Inngest Background] Posted to ${r.platform} · ${r.permalink ?? r.postId}`
              : `[Inngest Background] Failed ${r.platform}: ${r.error}`,
            payload: {
              platform: r.platform,
              postId: r.postId,
              permalink: r.permalink,
              error: r.error,
              caption: (caption || message || "").slice(0, 500),
            },
          },
        });
      }
    });

    return { ok: true, publishResults };
  }
);
