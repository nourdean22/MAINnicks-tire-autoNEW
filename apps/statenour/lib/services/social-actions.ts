/**
 * lib/services/social-actions.ts · misc-pages slice (2026-05-22 ·
 * legacy-modernizer REST→tRPC).
 *
 * The /social surface's four endpoints, extracted so the legacy REST
 * routes AND the new `operator.*` tRPC procedures call the SAME
 * functions · drift between consumers structurally impossible:
 *
 *   · GET  /api/social/schedule       → getSocialSchedule
 *   · GET  /api/social/recent-images  → getRecentImages
 *   · POST /api/social/publish        → publishSocialPost
 *   · POST /api/social/schedule       → scheduleSocialPost
 *
 * The publish/schedule legs resolve a relative `imageUrl` (e.g.
 * `/api/images/abc`) to an absolute URL — Meta + Buffer need a public
 * URL. The legacy routes derived the host from the request's `host`
 * header; both callers now pass an explicit `requestHost` so the
 * service has no `Request` dependency (the tRPC procedure passes
 * `ctx.headers?.get("host")`).
 *
 * Each function returns an EXPLICIT, shallow shape. `getRecentImages`
 * reads `AuditEvent` rows and projects them to a flat
 * `RecentImageRow` (no Json column reaches the return type — the
 * TS2589 firewall, the same discipline as `TaskEventRow` in
 * lib/trpc/routers/task.ts).
 */

import { prisma } from "@/lib/prisma";
import {
  scheduleBufferPost,
  listBufferProfiles,
  checkBufferConnection,
  type BufferProfile,
  type ScheduleResult,
} from "@/lib/social/buffer";
import {
  publishToInstagram,
  publishReelToInstagram,
  publishToFacebook,
  checkMetaConnection,
  type PublishResult,
} from "@/lib/social/meta-publish";
import { sanitizeError } from "@/lib/utils/sanitize-error";

// ──────────────── GET /api/social/schedule ────────────────

export interface SocialScheduleView {
  ok: boolean;
  connection?: {
    ok: boolean;
    email?: string;
    plan?: string;
    profileCount?: number;
    error?: string;
  };
  profiles?: BufferProfile[];
  meta?: {
    instagram: string;
    facebook: string;
  };
  error?: string;
}

/**
 * Buffer connection status + connected profiles for the schedule UI.
 * Mirrors the legacy GET — a thrown failure degrades to
 * `{ ok: false, error }` rather than surfacing.
 */
export async function getSocialSchedule(): Promise<SocialScheduleView> {
  try {
    const [connection, profiles, metaConn] = await Promise.all([
      checkBufferConnection(),
      listBufferProfiles().catch(() => []),
      checkMetaConnection().catch((err) => ({ ok: false, error: sanitizeError(err) })),
    ]);
    const hasMetaIg = !!(
      process.env.META_PAGE_ACCESS_TOKEN?.trim() && 
      (process.env.META_IG_USER_ID?.trim() || process.env.META_INSTAGRAM_ACCOUNT_ID?.trim())
    );
    const hasMetaFb = !!(
      process.env.META_PAGE_ACCESS_TOKEN?.trim() && 
      (process.env.META_PAGE_ID?.trim() || process.env.META_FACEBOOK_PAGE_ID?.trim())
    );
    return {
      ok: true,
      connection,
      profiles,
      meta: {
        instagram: metaConn.ok && hasMetaIg
          ? "connected"
          : !hasMetaIg
            ? "missing credentials"
            : `error: ${metaConn.error || "failed"}`,
        facebook: metaConn.ok && hasMetaFb
          ? "connected"
          : !hasMetaFb
            ? "missing credentials"
            : `error: ${metaConn.error || "failed"}`,
      },
    };
  } catch (err) {
    return { ok: false, error: sanitizeError(err) };
  }
}

// ──────────────── GET /api/social/recent-images ────────────────

/** Flat recent-image row · AuditEvent projected to scalars. */
export interface RecentImageRow {
  id: string;
  detail: string;
  createdAt: string;
  eventType: string;
}

export interface RecentImagesView {
  ok: true;
  images: RecentImageRow[];
}

/**
 * Last 24 generated/upscaled images for the publish picker. The page
 * reads `{ id, detail, createdAt }` per row.
 */
export async function getRecentImages(): Promise<RecentImagesView> {
  const rows = await prisma.auditEvent
    .findMany({
      where: {
        OR: [
          { eventType: "generated_image" },
          { eventType: "upscaled_image" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: { id: true, detail: true, createdAt: true, eventType: true },
    })
    .catch(
      () =>
        [] as Array<{
          id: string;
          detail: string | null;
          createdAt: Date;
          eventType: string;
        }>,
    );

  return {
    ok: true,
    images: rows.map((r) => ({
      id: r.id,
      detail: r.detail ?? "",
      createdAt: r.createdAt.toISOString(),
      eventType: r.eventType,
    })),
  };
}

// ──────────────── shared · relative-URL resolution ────────────────

/**
 * Resolve a relative `imageUrl` (`/api/images/abc`) to an absolute
 * URL. Meta + Buffer need a public URL. Prefers the configured app
 * URL env, falls back to the request's host. Returns the input
 * unchanged when it's already absolute or empty.
 */
function resolveImageUrl(
  imageUrl: string | undefined,
  requestHost: string | undefined,
): { url: string | undefined; unresolved: boolean } {
  if (!imageUrl || !imageUrl.startsWith("/")) {
    return { url: imageUrl, unresolved: false };
  }
  const host =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (requestHost ? `https://${requestHost}` : "");
  if (!host) {
    return { url: undefined, unresolved: true };
  }
  const url = host.startsWith("http")
    ? `${host}${imageUrl}`
    : `https://${host}${imageUrl}`;
  return { url, unresolved: false };
}

// ──────────────── POST /api/social/publish ────────────────

/** Bad publish input · the legacy route's 400 branches. */
export class SocialPublishInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialPublishInputError";
  }
}

/** Relative imageUrl could not be resolved to a public URL · the
 *  legacy route's 500 `cannot_resolve_image_url` branch. */
export class SocialImageUrlUnresolvedError extends Error {
  constructor() {
    super(
      "cannot_resolve_image_url — set NEXT_PUBLIC_APP_URL or VERCEL_PROJECT_PRODUCTION_URL",
    );
    this.name = "SocialImageUrlUnresolvedError";
  }
}

export interface PublishSocialInput {
  platforms: Array<"instagram" | "facebook">;
  imageUrl?: string;
  videoUrl?: string;
  caption?: string;
  message?: string;
  linkUrl?: string;
}

export interface PublishSocialResult {
  ok: boolean;
  succeeded: number;
  failed: number;
  results: PublishResult[];
}

/**
 * Direct publish to Meta IG + FB. POST IS IRREVERSIBLE — the caller
 * MUST have shown explicit confirmation. Throws
 * `SocialPublishInputError` for the legacy 400 branches and
 * `SocialImageUrlUnresolvedError` for the unresolved-URL 500 branch.
 */
export async function publishSocialPost(
  input: PublishSocialInput,
  requestHost: string | undefined,
): Promise<PublishSocialResult> {
  const platforms = (input.platforms ?? []).filter(
    (p) => p === "instagram" || p === "facebook",
  );
  if (platforms.length === 0) {
    throw new SocialPublishInputError("no_platforms");
  }
  if (!input.caption && !input.message) {
    throw new SocialPublishInputError("missing_text");
  }
  if (platforms.includes("instagram") && !input.imageUrl && !input.videoUrl) {
    throw new SocialPublishInputError("instagram_requires_media");
  }

  const resolvedImg = resolveImageUrl(input.imageUrl, requestHost);
  if (resolvedImg.unresolved) {
    throw new SocialImageUrlUnresolvedError();
  }
  const absoluteImageUrl = resolvedImg.url;

  const resolvedVid = resolveImageUrl(input.videoUrl, requestHost);
  if (resolvedVid.unresolved) {
    throw new SocialImageUrlUnresolvedError();
  }
  const absoluteVideoUrl = resolvedVid.url;

  // Run publishes in parallel — IG and FB are independent paths.
  const tasks: Promise<PublishResult>[] = [];
  if (platforms.includes("instagram")) {
    if (absoluteVideoUrl) {
      tasks.push(
        publishReelToInstagram({
          videoUrl: absoluteVideoUrl,
          caption: input.caption || input.message || "",
          coverUrl: absoluteImageUrl,
        }),
      );
    } else {
      tasks.push(
        publishToInstagram({
          imageUrl: absoluteImageUrl!,
          caption: input.caption || input.message || "",
        }),
      );
    }
  }
  if (platforms.includes("facebook")) {
    tasks.push(
      publishToFacebook({
        message: input.message || input.caption || "",
        imageUrl: absoluteImageUrl,
        linkUrl: input.linkUrl,
      }),
    );
  }

  const results = await Promise.all(tasks);

  // Audit each publish so /system/events shows it
  for (const r of results) {
    void prisma.auditEvent
      .create({
        data: {
          actor: "social-publish",
          eventType: r.ok
            ? `published_${r.platform}`
            : `publish_failed_${r.platform}`,
          detail: r.ok
            ? `Posted to ${r.platform} · ${r.permalink ?? r.postId}`
            : `Failed ${r.platform}: ${r.error}`,
          payload: {
            platform: r.platform,
            postId: r.postId,
            permalink: r.permalink,
            error: r.error,
            caption: (input.caption ?? input.message ?? "").slice(0, 500),
            videoUrl: input.videoUrl ? input.videoUrl.slice(0, 500) : undefined,
          },
        },
      })
      .catch(() => {});
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  return { ok: failed === 0, succeeded, failed, results };
}

// ──────────────── POST /api/social/schedule ────────────────

/** Empty schedule text · the legacy route's 400 `missing_text`. */
export class SocialScheduleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialScheduleInputError";
  }
}

export interface ScheduleSocialInput {
  text: string;
  imageUrl?: string;
  videoUrl?: string;
  linkUrl?: string;
  profileIds?: string[];
  scheduledAt?: string;
  shareNow?: boolean;
}

/**
 * Schedule a post via Buffer. Reversible (Buffer holds the queue).
 * Throws `SocialScheduleInputError` for the empty-text 400 branch.
 * Returns the full `ScheduleResult` envelope (the legacy route
 * returned it verbatim).
 */
export async function scheduleSocialPost(
  input: ScheduleSocialInput,
  requestHost: string | undefined,
): Promise<ScheduleResult> {
  if (!input.text || input.text.trim().length === 0) {
    throw new SocialScheduleInputError("missing_text");
  }

  // Resolve relative URL like publishSocialPost does. Schedule does
  // NOT 500 on an unresolved URL — it just drops the (relative) image,
  // mirroring the legacy route's non-throwing resolution branch.
  const resolved = resolveImageUrl(input.imageUrl, requestHost);
  const absoluteImageUrl = resolved.unresolved ? input.imageUrl : resolved.url;

  const resolvedVid = resolveImageUrl(input.videoUrl, requestHost);
  const absoluteVideoUrl = resolvedVid.unresolved ? input.videoUrl : resolvedVid.url;

  const result = await scheduleBufferPost({
    text: input.text,
    imageUrl: absoluteImageUrl,
    videoUrl: absoluteVideoUrl,
    linkUrl: input.linkUrl,
    profileIds: input.profileIds,
    scheduledAt: input.scheduledAt,
    shareNow: input.shareNow,
  });

  void prisma.auditEvent
    .create({
      data: {
        actor: "social-schedule",
        eventType: result.ok ? "scheduled_buffer" : "schedule_buffer_failed",
        detail: result.ok
          ? `Queued ${result.bufferUpdateIds.length} updates · for ${result.scheduledFor}`
          : `Buffer schedule failed: ${result.error}`,
        payload: {
          bufferUpdateIds: result.bufferUpdateIds,
          scheduledFor: result.scheduledFor,
          error: result.error,
          text: input.text.slice(0, 500),
          videoUrl: input.videoUrl ? input.videoUrl.slice(0, 500) : undefined,
        },
      },
    })
    .catch(() => {});

  return result;
}
