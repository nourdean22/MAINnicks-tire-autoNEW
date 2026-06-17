/**
 * META GRAPH PUBLISH — direct Instagram + Facebook publishing.
 *
 * v6 · BATCH 4 · Apr 28. Wraps the Meta Graph API for direct publish
 * to Nick's Tire's IG Business + FB Page. Two-step flow per Meta's
 * spec:
 *   1. Create media container (uploads image, returns container id)
 *   2. Publish container (commits to feed)
 *
 * Required env vars (set in Vercel + .env.local):
 *   META_PAGE_ACCESS_TOKEN — long-lived page access token (60 days,
 *     renewable; required scopes: instagram_basic + instagram_content_publish
 *     + pages_manage_posts + pages_read_engagement)
 *   META_IG_USER_ID — IG Business account ID (numeric). Falls back to
 *     META_INSTAGRAM_ACCOUNT_ID if you set that name instead.
 *   META_PAGE_ID — Facebook Page ID. Falls back to META_FACEBOOK_PAGE_ID.
 *
 * ── Apr 28 alignment ─────────────────────────────────────────────────
 * The nickstire repo (/c/Users/nourd/MAINnicks-tire-autoNEW/.env) uses
 * META_PAGE_ID + META_IG_USER_ID. statenour reads either name so a
 * single Meta App can power both repos without re-issuing tokens.
 *
 * Setup notes (one-time, do via Meta Developer console):
 *   1. Create a Meta App (Business type)
 *   2. Add Instagram Graph API + Pages products
 *   3. Generate page access token from Graph API Explorer
 *   4. Convert short-lived → long-lived: GET /v21.0/oauth/access_token?grant_type=fb_exchange_token&...
 *   5. Save the long-lived token to env; auto-renew via cron in v7
 *
 * IMPORTANT — POST IS IRREVERSIBLE.
 * The endpoint that calls these helpers MUST require explicit user
 * confirmation in chat ("yes, publish to Instagram"). Never auto-publish
 * based on observed content alone.
 */

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

interface MetaCredentials {
  pageAccessToken: string;
  instagramAccountId?: string;
  facebookPageId?: string;
}

function getCreds(): MetaCredentials {
  const pageAccessToken = process.env.META_PAGE_ACCESS_TOKEN?.trim() ?? "";
  // Accept both the nickstire convention (META_IG_USER_ID + META_PAGE_ID)
  // and the more verbose names (META_INSTAGRAM_ACCOUNT_ID + META_FACEBOOK_PAGE_ID).
  const instagramAccountId = (
    process.env.META_IG_USER_ID
    ?? process.env.META_INSTAGRAM_ACCOUNT_ID
    ?? ""
  ).trim() || undefined;
  const facebookPageId = (
    process.env.META_PAGE_ID
    ?? process.env.META_FACEBOOK_PAGE_ID
    ?? ""
  ).trim() || undefined;
  if (!pageAccessToken) {
    throw new Error("META_PAGE_ACCESS_TOKEN not set");
  }
  return { pageAccessToken, instagramAccountId, facebookPageId };
}

export interface PublishResult {
  ok: boolean;
  platform: "instagram" | "facebook";
  postId?: string;
  permalink?: string;
  error?: string;
}

/**
 * Publish to Instagram. Two-step: create container, then publish.
 * imageUrl must be a publicly-accessible URL (Meta won't accept base64
 * or localhost). Use the existing /api/images/{id} endpoint with a
 * production host.
 */
export async function publishToInstagram(args: {
  imageUrl: string;
  caption: string;
}): Promise<PublishResult> {
  const creds = getCreds();
  if (!creds.instagramAccountId) {
    return {
      ok: false,
      platform: "instagram",
      error: "META_INSTAGRAM_ACCOUNT_ID not set",
    };
  }
  const { imageUrl, caption } = args;

  try {
    // Step 1 — create media container
    const containerRes = await fetch(
      `${GRAPH_BASE}/${creds.instagramAccountId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000), // wave-181.92 · image upload can be slow
        body: JSON.stringify({
          image_url: imageUrl,
          caption,
          access_token: creds.pageAccessToken,
        }),
      },
    );
    if (!containerRes.ok) {
      const errText = await containerRes.text();
      return {
        ok: false,
        platform: "instagram",
        error: `container failed (${containerRes.status}): ${errText.slice(0, 200)}`,
      };
    }
    const containerData = await containerRes.json();
    const containerId = containerData.id;

    // Step 2 — publish container
    const publishRes = await fetch(
      `${GRAPH_BASE}/${creds.instagramAccountId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000), // wave-181.92
        body: JSON.stringify({
          creation_id: containerId,
          access_token: creds.pageAccessToken,
        }),
      },
    );
    if (!publishRes.ok) {
      const errText = await publishRes.text();
      return {
        ok: false,
        platform: "instagram",
        error: `publish failed (${publishRes.status}): ${errText.slice(0, 200)}`,
      };
    }
    const publishData = await publishRes.json();
    const postId = publishData.id;

    // Optional: fetch permalink for confirmation
    const permalinkRes = await fetch(
      `${GRAPH_BASE}/${postId}?fields=permalink&access_token=${creds.pageAccessToken}`,
      { signal: AbortSignal.timeout(10_000) }, // wave-181.92
    );
    let permalink: string | undefined;
    if (permalinkRes.ok) {
      const data = await permalinkRes.json();
      permalink = data.permalink;
    }

    return {
      ok: true,
      platform: "instagram",
      postId,
      permalink,
    };
  } catch (err) {
    return {
      ok: false,
      platform: "instagram",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Publish a Reel to Instagram. Reels publishing is asynchronous on Meta:
 *   1. Create media container with media_type=REELS and video_url (and optionally cover_url)
 *   2. Poll the container status code until it is FINISHED
 *   3. Publish the container
 */
export async function publishReelToInstagram(args: {
  videoUrl: string;
  caption: string;
  coverUrl?: string;
}): Promise<PublishResult> {
  const creds = getCreds();
  if (!creds.instagramAccountId) {
    return {
      ok: false,
      platform: "instagram",
      error: "META_INSTAGRAM_ACCOUNT_ID not set",
    };
  }
  const { videoUrl, caption, coverUrl } = args;

  try {
    // Step 1 — create Reels media container
    const payload: Record<string, any> = {
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      access_token: creds.pageAccessToken,
    };
    if (coverUrl) {
      payload.cover_url = coverUrl;
    }

    const containerRes = await fetch(
      `${GRAPH_BASE}/${creds.instagramAccountId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify(payload),
      },
    );
    if (!containerRes.ok) {
      const errText = await containerRes.text();
      return {
        ok: false,
        platform: "instagram",
        error: `Reel container failed (${containerRes.status}): ${errText.slice(0, 200)}`,
      };
    }
    const containerData = await containerRes.json();
    const containerId = containerData.id;
    if (!containerId) {
      return {
        ok: false,
        platform: "instagram",
        error: "No container ID returned from Meta",
      };
    }

    // Step 2 — poll container status until FINISHED
    let isReady = false;
    let attempts = 0;
    const maxAttempts = 30; // 30 attempts * 5s = 150s (2.5 minutes)

    while (!isReady && attempts < maxAttempts) {
      attempts++;
      // Wait 5 seconds
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const statusRes = await fetch(
        `${GRAPH_BASE}/${containerId}?fields=status_code&access_token=${creds.pageAccessToken}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      const statusData = await statusRes.json().catch(() => null);
      if (!statusRes.ok || !statusData) {
        continue;
      }
      if (statusData.error) {
        return {
          ok: false,
          platform: "instagram",
          error: `Meta Reel status check error: ${statusData.error.message}`,
        };
      }
      const statusCode = statusData.status_code;
      if (statusCode === "FINISHED") {
        isReady = true;
      } else if (statusCode === "ERROR") {
        return {
          ok: false,
          platform: "instagram",
          error: "Meta video processing failed (status_code: ERROR)",
        };
      }
    }

    if (!isReady) {
      return {
        ok: false,
        platform: "instagram",
        error: "Meta video processing timed out (still IN_PROGRESS after 150s)",
      };
    }

    // Step 3 — publish container
    const publishRes = await fetch(
      `${GRAPH_BASE}/${creds.instagramAccountId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          creation_id: containerId,
          access_token: creds.pageAccessToken,
        }),
      },
    );
    if (!publishRes.ok) {
      const errText = await publishRes.text();
      return {
        ok: false,
        platform: "instagram",
        error: `Reel publish failed (${publishRes.status}): ${errText.slice(0, 200)}`,
      };
    }
    const publishData = await publishRes.json();
    const postId = publishData.id;

    // Optional: fetch permalink
    const permalinkRes = await fetch(
      `${GRAPH_BASE}/${postId}?fields=permalink&access_token=${creds.pageAccessToken}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    let permalink: string | undefined;
    if (permalinkRes.ok) {
      const data = await permalinkRes.json();
      permalink = data.permalink;
    }

    return {
      ok: true,
      platform: "instagram",
      postId,
      permalink,
    };
  } catch (err) {
    return {
      ok: false,
      platform: "instagram",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Publish to Facebook Page. Single-step (no container required).
 * Supports text-only posts (no link/image), text+image, and text+link.
 */
export async function publishToFacebook(args: {
  message: string;
  imageUrl?: string;
  linkUrl?: string;
}): Promise<PublishResult> {
  const creds = getCreds();
  if (!creds.facebookPageId) {
    return {
      ok: false,
      platform: "facebook",
      error: "META_FACEBOOK_PAGE_ID not set",
    };
  }

  try {
    // Endpoint differs based on whether we have an image:
    //   image → /{page_id}/photos with `url` + `caption`
    //   no image (text/link) → /{page_id}/feed with `message` + optional `link`
    const endpoint = args.imageUrl
      ? `${GRAPH_BASE}/${creds.facebookPageId}/photos`
      : `${GRAPH_BASE}/${creds.facebookPageId}/feed`;
    const payload: Record<string, string> = {
      access_token: creds.pageAccessToken,
    };
    if (args.imageUrl) {
      payload.url = args.imageUrl;
      payload.caption = args.message;
    } else {
      payload.message = args.message;
      if (args.linkUrl) payload.link = args.linkUrl;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(args.imageUrl ? 30_000 : 15_000), // wave-181.92 · image post slower
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errText = await res.text();
      return {
        ok: false,
        platform: "facebook",
        error: `publish failed (${res.status}): ${errText.slice(0, 200)}`,
      };
    }
    const data = await res.json();
    // Photos return `post_id`, feed returns `id`
    const postId = data.post_id ?? data.id;

    // Permalink for FB:
    // posts have URL form: https://www.facebook.com/{post_id_full}
    // The post_id from /photos comes as "{page_id}_{post_id}", suitable for permalink.
    const permalink = postId ? `https://www.facebook.com/${postId}` : undefined;

    return {
      ok: true,
      platform: "facebook",
      postId,
      permalink,
    };
  } catch (err) {
    return {
      ok: false,
      platform: "facebook",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Quick smoke-test that the env is set up correctly. Calls the /me
 * endpoint with the page token — should return the page name + id.
 * Used by the publish UI to detect "is publishing actually wired up?"
 * before showing the publish button.
 */
export async function checkMetaConnection(): Promise<{
  ok: boolean;
  pageName?: string;
  pageId?: string;
  igAccountId?: string;
  error?: string;
}> {
  try {
    const creds = getCreds();
    const res = await fetch(
      `${GRAPH_BASE}/me?fields=id,name&access_token=${creds.pageAccessToken}`,
      { signal: AbortSignal.timeout(10_000) }, // wave-181.92
    );
    if (!res.ok) {
      const errText = await res.text();
      return {
        ok: false,
        error: `Meta /me failed (${res.status}): ${errText.slice(0, 200)}`,
      };
    }
    const data = await res.json();
    return {
      ok: true,
      pageName: data.name,
      pageId: data.id,
      igAccountId: creds.instagramAccountId,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
