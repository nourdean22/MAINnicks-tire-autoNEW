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
      const claim = await step.run("claim-social-draft", async () => {
        return prisma.socialPublishQueue.updateMany({
          where: {
            id: draftId,
            status: { in: ["pending", "approved", "scheduled"] },
          },
          data: {
            status: "rendering",
          },
        });
      });

      if (claim.count !== 1) {
        log.warn("social_publish_already_claimed", { draftId });
        return { ok: true, skipped: "already_claimed_or_completed" };
      }
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
      let igResult: { platform: string; ok: boolean; postId?: string; permalink?: string; error?: string };

      if (videoUrl) {
        // Instagram Video/Reel publishing with polling loop (flat steps)
        const creds = {
          pageAccessToken: process.env.META_PAGE_ACCESS_TOKEN?.trim() || "",
          instagramAccountId: process.env.META_IG_USER_ID?.trim() || process.env.META_INSTAGRAM_ACCOUNT_ID?.trim() || "",
        };

        if (!creds.pageAccessToken || !creds.instagramAccountId) {
          igResult = {
            platform: "instagram",
            ok: false,
            error: "Missing Meta credentials for Instagram",
          };
        } else {
          // Step A: Create container (retriable step)
          const containerId = await step.run("create-instagram-container", async () => {
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
              signal: AbortSignal.timeout(30_000),
              body: JSON.stringify(containerPayload),
            });
            if (!containerRes.ok) {
              const errText = await containerRes.text();
              throw new Error(`Reel container init failed (${containerRes.status}): ${errText.slice(0, 200)}`);
            }
            const containerData = await containerRes.json();
            const cid = containerData.id;
            if (!cid) {
              throw new Error("No container ID returned from Meta API");
            }
            return cid as string;
          });

          // Step B: Durable Polling Loop inside Inngest workflow (without blocking Node thread!)
          let isReady = false;
          let attempts = 0;
          const maxAttempts = 30;
          let pollError: string | null = null;

          while (!isReady && attempts < maxAttempts) {
            attempts++;
            // Native durable sleep checkpoint
            await step.sleep(`sleep-poll-${attempts}`, "5s");

            const status = await step.run(`check-container-status-${attempts}`, async () => {
              const GRAPH_BASE = "https://graph.facebook.com/v20.0";
              const statusRes = await fetch(
                `${GRAPH_BASE}/${containerId}?fields=status_code&access_token=${creds.pageAccessToken}`,
                { signal: AbortSignal.timeout(10_000) }
              );
              const statusData = await statusRes.json().catch(() => null);
              if (!statusRes.ok || !statusData) {
                return { code: "RETRY" as const };
              }
              if (statusData.error) {
                return { code: "ERROR" as const, message: statusData.error.message as string };
              }
              return { code: statusData.status_code as string, message: "" };
            });

            if (status.code === "FINISHED") {
              isReady = true;
            } else if (status.code === "ERROR") {
              pollError = `Meta video processing failed: ${status.message || "status_code: ERROR"}`;
              break;
            }
          }

          if (pollError) {
            igResult = {
              platform: "instagram",
              ok: false,
              error: pollError,
            };
          } else if (!isReady) {
            igResult = {
              platform: "instagram",
              ok: false,
              error: "Meta video processing timed out (still IN_PROGRESS after 150s)",
            };
          } else {
            // Step C: Publish container (retriable step)
            const postId = await step.run("publish-instagram-container", async () => {
              const GRAPH_BASE = "https://graph.facebook.com/v20.0";
              const publishRes = await fetch(
                `${GRAPH_BASE}/${creds.instagramAccountId}/media_publish`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  signal: AbortSignal.timeout(30_000),
                  body: JSON.stringify({
                    creation_id: containerId,
                    access_token: creds.pageAccessToken,
                  }),
                }
              );
              if (!publishRes.ok) {
                const errText = await publishRes.text();
                throw new Error(`Reel publish failed (${publishRes.status}): ${errText.slice(0, 200)}`);
              }
              const publishData = await publishRes.json();
              const pid = publishData.id;
              if (!pid) {
                throw new Error("No publish ID returned from Meta API");
              }
              return pid as string;
            });

            // Optional fetch permalink (retriable step)
            const permalink = await step.run("fetch-instagram-permalink", async () => {
              const GRAPH_BASE = "https://graph.facebook.com/v20.0";
              const permalinkRes = await fetch(
                `${GRAPH_BASE}/${postId}?fields=permalink&access_token=${creds.pageAccessToken}`,
                { signal: AbortSignal.timeout(10_000) }
              );
              if (permalinkRes.ok) {
                const permData = await permalinkRes.json();
                return permData.permalink as string;
              }
              return undefined;
            });

            igResult = {
              platform: "instagram",
              ok: true,
              postId,
              permalink: permalink ?? undefined,
            };
          }
        }
      } else {
        // Standard Image upload to Instagram
        igResult = await step.run("publish-instagram-image", async () => {
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
        });
      }
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
