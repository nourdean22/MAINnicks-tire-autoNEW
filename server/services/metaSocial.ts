/**
 * Meta Social Posting — Instagram + Facebook via Graph API
 *
 * Lets Nick AI post to Instagram and Facebook Page via Meta Business Suite.
 *
 * Instagram flow (image required):
 *   1. POST /{ig-user-id}/media  → container ID
 *   2. POST /{ig-user-id}/media_publish → published
 *
 * Facebook Page flow:
 *   POST /{page-id}/feed → post ID
 *
 * Required env vars:
 *   META_PAGE_ACCESS_TOKEN — Long-lived Page Access Token (pages_manage_posts, instagram_content_publish)
 *   META_PAGE_ID — Facebook Page ID
 *   META_IG_USER_ID — Instagram Business Account ID (linked to FB page)
 */

import { createLogger } from "../lib/logger";

const log = createLogger("meta-social");

const API_VERSION = "v25.0";
const GRAPH_URL = `https://graph.facebook.com/${API_VERSION}`;

function getPageToken(): string | null {
  return process.env.META_PAGE_ACCESS_TOKEN || process.env.FB_PAGE_ACCESS_TOKEN || null;
}

function getPageId(): string | null {
  return process.env.META_PAGE_ID || null;
}

function getIgUserId(): string | null {
  return process.env.META_IG_USER_ID || null;
}

// ─── Status Check ─────────────────────────────────────

export async function getMetaSocialStatus(): Promise<{
  configured: boolean;
  facebookReady: boolean;
  instagramReady: boolean;
  pageId: string | null;
  igUserId: string | null;
  error: string | null;
}> {
  const token = getPageToken();
  const pageId = getPageId();
  const igUserId = getIgUserId();

  if (!token) {
    return {
      configured: false,
      facebookReady: false,
      instagramReady: false,
      pageId,
      igUserId,
      error: "META_PAGE_ACCESS_TOKEN not set",
    };
  }

  return {
    configured: true,
    facebookReady: !!pageId && !!token,
    instagramReady: !!igUserId && !!token,
    pageId,
    igUserId,
    error: null,
  };
}

// ─── Facebook Page Post ───────────────────────────────

export async function postToFacebook(params: {
  message: string;
  link?: string;
  imageUrl?: string;
}): Promise<{ success: boolean; postId?: string; error?: string }> {
  const token = getPageToken();
  const pageId = getPageId();

  if (!token || !pageId) {
    return { success: false, error: "Facebook posting not configured (need META_PAGE_ACCESS_TOKEN + META_PAGE_ID)" };
  }

  try {
    let endpoint: string;
    let body: Record<string, string>;

    if (params.imageUrl) {
      // Photo post
      endpoint = `${GRAPH_URL}/${pageId}/photos`;
      body = {
        url: params.imageUrl,
        caption: params.message,
        access_token: token,
      };
    } else {
      // Text/link post
      endpoint = `${GRAPH_URL}/${pageId}/feed`;
      body = {
        message: params.message,
        access_token: token,
      };
      if (params.link) {
        body.link = params.link;
      }
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      const errMsg = data?.error?.message || `HTTP ${res.status}`;
      log.error("Facebook post failed:", { error: errMsg });
      return { success: false, error: errMsg };
    }

    const postId = data.id || data.post_id;
    log.info(`Facebook post created: ${postId}`);
    return { success: true, postId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error("Facebook post error:", { error: errMsg });
    return { success: false, error: errMsg };
  }
}

// ─── Instagram Post (Image Required) ──────────────────

export async function postToInstagram(params: {
  imageUrl: string;
  caption: string;
}): Promise<{ success: boolean; postId?: string; error?: string }> {
  const token = getPageToken();
  const igUserId = getIgUserId();

  if (!token || !igUserId) {
    return { success: false, error: "Instagram posting not configured (need META_PAGE_ACCESS_TOKEN + META_IG_USER_ID)" };
  }

  try {
    // Step 1: Create media container
    const containerRes = await fetch(`${GRAPH_URL}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: params.imageUrl,
        caption: params.caption,
        access_token: token,
      }),
    });

    const containerData = await containerRes.json();

    if (!containerRes.ok) {
      const errMsg = containerData?.error?.message || `Container creation failed: HTTP ${containerRes.status}`;
      log.error("Instagram container error:", { error: errMsg });
      return { success: false, error: errMsg };
    }

    const creationId = containerData.id;
    if (!creationId) {
      return { success: false, error: "No container ID returned from Meta" };
    }

    // Step 2: Publish the container
    const publishRes = await fetch(`${GRAPH_URL}/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: creationId,
        access_token: token,
      }),
    });

    const publishData = await publishRes.json();

    if (!publishRes.ok) {
      const errMsg = publishData?.error?.message || `Publish failed: HTTP ${publishRes.status}`;
      log.error("Instagram publish error:", { error: errMsg });
      return { success: false, error: errMsg };
    }

    const postId = publishData.id;
    log.info(`Instagram post published: ${postId}`);
    return { success: true, postId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error("Instagram post error:", { error: errMsg });
    return { success: false, error: errMsg };
  }
}

// ─── Instagram Carousel Post ──────────────────────────

export async function postInstagramCarousel(params: {
  imageUrls: string[];
  caption: string;
}): Promise<{ success: boolean; postId?: string; error?: string }> {
  const token = getPageToken();
  const igUserId = getIgUserId();

  if (!token || !igUserId) {
    return { success: false, error: "Instagram not configured" };
  }

  if (params.imageUrls.length < 2 || params.imageUrls.length > 10) {
    return { success: false, error: "Carousel needs 2-10 images" };
  }

  try {
    // Step 1: Create child containers for each image
    const childIds: string[] = [];
    for (const url of params.imageUrls) {
      const res = await fetch(`${GRAPH_URL}/${igUserId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: url,
          is_carousel_item: true,
          access_token: token,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.id) {
        return { success: false, error: `Failed to create carousel item: ${data?.error?.message || "unknown"}` };
      }
      childIds.push(data.id);
    }

    // Step 2: Create carousel container
    const containerRes = await fetch(`${GRAPH_URL}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "CAROUSEL",
        children: childIds.join(","),
        caption: params.caption,
        access_token: token,
      }),
    });
    const containerData = await containerRes.json();
    if (!containerRes.ok || !containerData.id) {
      return { success: false, error: `Carousel container failed: ${containerData?.error?.message || "unknown"}` };
    }

    // Step 3: Publish
    const publishRes = await fetch(`${GRAPH_URL}/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerData.id,
        access_token: token,
      }),
    });
    const publishData = await publishRes.json();
    if (!publishRes.ok) {
      return { success: false, error: `Carousel publish failed: ${publishData?.error?.message || "unknown"}` };
    }

    log.info(`Instagram carousel published: ${publishData.id}`);
    return { success: true, postId: publishData.id };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error("Instagram carousel error:", { error: errMsg });
    return { success: false, error: errMsg };
  }
}

// ─── Unified Post (Nick AI interface) ─────────────────

export async function socialPost(params: {
  platforms: ("facebook" | "instagram")[];
  message: string;
  imageUrl?: string;
  link?: string;
}): Promise<{
  results: Array<{ platform: string; success: boolean; postId?: string; error?: string }>;
}> {
  const results: Array<{ platform: string; success: boolean; postId?: string; error?: string }> = [];

  for (const platform of params.platforms) {
    if (platform === "facebook") {
      const r = await postToFacebook({
        message: params.message,
        link: params.link,
        imageUrl: params.imageUrl,
      });
      results.push({ platform: "facebook", ...r });
    } else if (platform === "instagram") {
      if (!params.imageUrl) {
        results.push({ platform: "instagram", success: false, error: "Instagram requires an image URL" });
      } else {
        const r = await postToInstagram({
          imageUrl: params.imageUrl,
          caption: params.message,
        });
        results.push({ platform: "instagram", ...r });
      }
    }
  }

  return { results };
}
