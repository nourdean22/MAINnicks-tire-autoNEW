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
          // Instagram Video/Reel publishing with polling loop
          const creds = {
            pageAccessToken: process.env.META_PAGE_ACCESS_TOKEN?.trim() || "",
            instagramAccountId: process.env.META_IG_USER_ID?.trim() || process.env.META_INSTAGRAM_ACCOUNT_ID?.trim() || "",
          };
          if (!creds.pageAccessToken || !creds.instagramAccountId) {
            return {
              platform: "instagram",
              ok: false,
              error: "Missing Meta credentials for Instagram",
            };
          }

          // Step A: Create container
          const GRAPH_BASE = "https://graph.facebook.com/v20.0";
          const containerUrl = `${GRAPH_BASE}/${creds.instagramAccountId}/media`;
          const containerPayload: Record<string, string> = {
            media_type: "REELS",
            video_url: videoUrl,
            caption: caption || message || "",
            access_token: creds.pageAccessToken,
          };
          if (imageUrl) {
            containerPayload.cover_url = imageUrl;
          }

          const containerRes = await fetch(containerUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(containerPayload),
          });
          if (!containerRes.ok) {
            const errText = await containerRes.text();
            return {
              platform: "instagram",
              ok: false,
              error: `Reel container init failed (${containerRes.status}): ${errText.slice(0, 200)}`,
            };
          }
          const containerData = await containerRes.json();
          const containerId = containerData.id;
          if (!containerId) {
            return {
              platform: "instagram",
              ok: false,
              error: "No container ID returned from Meta API",
            };
          }

          // Step B: Durable Polling Loop inside Inngest workflow (without blocking Node thread!)
          let isReady = false;
          let attempts = 0;
          const maxAttempts = 30;

          while (!isReady && attempts < maxAttempts) {
            attempts++;
            // Native durable sleep checkpoint
            await step.sleep(`sleep-poll-${attempts}`, "5s");

            const statusRes = await fetch(
              `${GRAPH_BASE}/${containerId}?fields=status_code&access_token=${creds.pageAccessToken}`
            );
            const statusData = await statusRes.json().catch(() => null);
            if (!statusRes.ok || !statusData) {
              continue;
            }
            if (statusData.error) {
              return {
                platform: "instagram",
                ok: false,
                error: `Meta Reel status check error: ${statusData.error.message}`,
              };
            }
            const statusCode = statusData.status_code;
            if (statusCode === "FINISHED") {
              isReady = true;
            } else if (statusCode === "ERROR") {
              return {
                platform: "instagram",
                ok: false,
                error: "Meta video processing failed (status_code: ERROR)",
              };
            }
          }

          if (!isReady) {
            return {
              platform: "instagram",
              ok: false,
              error: "Meta video processing timed out (still IN_PROGRESS after 150s)",
            };
          }

          // Step C: Publish container
          const publishRes = await fetch(
            `${GRAPH_BASE}/${creds.instagramAccountId}/media_publish`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                creation_id: containerId,
                access_token: creds.pageAccessToken,
              }),
            }
          );
          if (!publishRes.ok) {
            const errText = await publishRes.text();
            return {
              platform: "instagram",
              ok: false,
              error: `Reel publish failed (${publishRes.status}): ${errText.slice(0, 200)}`,
            };
          }
          const publishData = await publishRes.json();
          const postId = publishData.id;

          // Optional fetch permalink
          const permalinkRes = await fetch(
            `${GRAPH_BASE}/${postId}?fields=permalink&access_token=${creds.pageAccessToken}`
          );
          let permalink: string | undefined;
          if (permalinkRes.ok) {
            const permData = await permalinkRes.json();
            permalink = permData.permalink;
          }

          return {
            platform: "instagram",
            ok: true,
            postId,
            permalink,
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
