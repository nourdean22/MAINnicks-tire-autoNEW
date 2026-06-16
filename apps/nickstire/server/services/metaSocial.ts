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
 *   META_PAGE_ACCESS_TOKEN — Long-lived Page Access Token (pages_manage_posts,
 *     instagram_content_publish, instagram_manage_comments — the last is
 *     required for getMediaComments/replyToComment; without it the Graph API
 *     returns 403 on the comment edges even though posting still works)
 *   META_PAGE_ID — Facebook Page ID
 *   META_IG_USER_ID — Instagram Business Account ID (linked to FB page)
 */

import { createLogger } from "../lib/logger";

const log = createLogger("meta-social");

const API_VERSION = "v25.0";
const GRAPH_URL = `https://graph.facebook.com/${API_VERSION}`;

// Runtime Page token — set by reconnectMetaFromUserToken() after a
// server-side token exchange. Takes precedence over the env var so a
// freshly-minted token works immediately, without waiting on a redeploy.
let runtimePageToken: string | null = null;

export function setRuntimePageToken(token: string): void {
  runtimePageToken = token;
}

function getPageToken(): string | null {
  return runtimePageToken || process.env.META_PAGE_ACCESS_TOKEN || process.env.FB_PAGE_ACCESS_TOKEN || null;
}

// ─── Durable token store (survives pod restart) ───────
// The minted Page token never expires but lives only in memory after a
// reconnect. We mirror it into the app_secret_kv table so a cold boot can
// reload it without re-minting — and the token never leaves the server.
// All DB access is best-effort: failures log but never block posting.
const TOKEN_KV_KEY = "meta_page_access_token";
let persistedLoadAttempted = false;

async function persistPageToken(token: string): Promise<void> {
  try {
    const { db } = await import("../lib/db-helper");
    const d = await db();
    if (!d) return;
    const { appSecretKv } = await import("../../drizzle/schema");
    await d.insert(appSecretKv).values({ k: TOKEN_KV_KEY, v: token })
      .onDuplicateKeyUpdate({ set: { v: token } });
    log.info("Persisted Meta page token to durable store");
  } catch (err) {
    log.error("Failed to persist Meta page token:", { error: err instanceof Error ? err.message : String(err) });
  }
}

async function ensurePageTokenLoaded(): Promise<void> {
  if (runtimePageToken || persistedLoadAttempted) return;
  persistedLoadAttempted = true;
  try {
    const { db } = await import("../lib/db-helper");
    const d = await db();
    if (!d) return;
    const { appSecretKv } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await d.select().from(appSecretKv).where(eq(appSecretKv.k, TOKEN_KV_KEY)).limit(1);
    if (rows.length && rows[0].v) {
      runtimePageToken = rows[0].v;
      log.info("Loaded persisted Meta page token from durable store");
    }
  } catch (err) {
    log.error("Failed to load persisted Meta page token:", { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Verification helper — confirms a token round-tripped through app_secret_kv.
 * Returns only a fingerprint (length + last 6 chars), never the token itself.
 */
export async function getPersistedTokenMeta(): Promise<{ present: boolean; len: number; last6: string }> {
  try {
    const { db } = await import("../lib/db-helper");
    const d = await db();
    if (!d) return { present: false, len: 0, last6: "" };
    const { appSecretKv } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await d.select().from(appSecretKv).where(eq(appSecretKv.k, TOKEN_KV_KEY)).limit(1);
    const v = rows.length ? rows[0].v : "";
    return { present: !!v, len: v.length, last6: v ? v.slice(-6) : "" };
  } catch {
    return { present: false, len: 0, last6: "" };
  }
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
  await ensurePageTokenLoaded();
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

// ─── Token Reconnect (User token → never-expiring Page token) ───

/**
 * Mint a never-expiring Page access token from a freshly-generated
 * (short-lived) User access token — e.g. one created in the Graph API
 * Explorer with pages_manage_posts + instagram_content_publish.
 *
 * Runs server-side because graph.facebook.com is reachable from Railway
 * (it is DNS-blocked on the operator's local machine). Two steps:
 *   1. short-lived user token → long-lived user token (60d) via
 *      fb_exchange_token (needs META_APP_ID + META_APP_SECRET).
 *   2. long-lived user token → Page token for META_PAGE_ID. Page tokens
 *      derived from a long-lived user token do not expire.
 *
 * On success the Page token is cached in-process (setRuntimePageToken)
 * so postToFacebook / postToInstagram work immediately. The caller may
 * also persist it to META_PAGE_ACCESS_TOKEN for cross-restart durability.
 */
export async function reconnectMetaFromUserToken(userToken: string): Promise<{
  ok: boolean;
  pageToken?: string;
  error?: string;
}> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET || process.env.FB_APP_SECRET;
  const pageId = getPageId();

  if (!appId || !appSecret) return { ok: false, error: "META_APP_ID / META_APP_SECRET not set" };
  if (!pageId) return { ok: false, error: "META_PAGE_ID not set" };

  try {
    // Step 1 — exchange short-lived user token for a long-lived one.
    const exchangeUrl =
      `${GRAPH_URL}/oauth/access_token?grant_type=fb_exchange_token` +
      `&client_id=${encodeURIComponent(appId)}` +
      `&client_secret=${encodeURIComponent(appSecret)}` +
      `&fb_exchange_token=${encodeURIComponent(userToken)}`;
    const llRes = await fetch(exchangeUrl, { signal: AbortSignal.timeout(15000) });
    const llData = await llRes.json();
    if (!llRes.ok || !llData.access_token) {
      const errMsg = llData?.error?.message || `long-lived exchange failed: HTTP ${llRes.status}`;
      log.error("Meta long-lived exchange failed:", { error: errMsg });
      return { ok: false, error: errMsg };
    }
    const longLivedUserToken: string = llData.access_token;

    // Step 2 — fetch the Page access token (non-expiring) for our page.
    const pageRes = await fetch(
      `${GRAPH_URL}/${pageId}?fields=access_token&access_token=${encodeURIComponent(longLivedUserToken)}`,
      { signal: AbortSignal.timeout(15000) },
    );
    const pageData = await pageRes.json();
    if (!pageRes.ok || !pageData.access_token) {
      const errMsg = pageData?.error?.message || `page token fetch failed: HTTP ${pageRes.status}`;
      log.error("Meta page token fetch failed:", { error: errMsg });
      return { ok: false, error: errMsg };
    }

    const pageToken: string = pageData.access_token;
    setRuntimePageToken(pageToken);
    await persistPageToken(pageToken);
    log.info("Meta page token reconnected (never-expiring) for page", { pageId });
    return { ok: true, pageToken };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error("Meta reconnect error:", { error: errMsg });
    return { ok: false, error: errMsg };
  }
}

// ─── Facebook Page Post ───────────────────────────────

export async function postToFacebook(params: {
  message: string;
  link?: string;
  imageUrl?: string;
}): Promise<{ success: boolean; postId?: string; error?: string }> {
  await ensurePageTokenLoaded();
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
      };
    } else {
      // Text/link post
      endpoint = `${GRAPH_URL}/${pageId}/feed`;
      body = {
        message: params.message,
      };
      if (params.link) {
        body.link = params.link;
      }
    }

    // v1.7 audit fix · 15s timeout (was 2min Node default).
    // v1.7 follow-up · token migrated from JSON body to Authorization
    // Bearer header. Meta Graph supports both; header is preferred per
    // Meta docs and keeps the token out of any future request-body
    // logging path on Railway / proxies.
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
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
  await ensurePageTokenLoaded();
  const token = getPageToken();
  const igUserId = getIgUserId();

  if (!token || !igUserId) {
    return { success: false, error: "Instagram posting not configured (need META_PAGE_ACCESS_TOKEN + META_IG_USER_ID)" };
  }

  try {
    // v1.7 follow-up · token via Authorization header (was in body).
    const authHeaders = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    };

    // Step 1: Create media container
    const containerRes = await fetch(`${GRAPH_URL}/${igUserId}/media`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        image_url: params.imageUrl,
        caption: params.caption,
      }),
      signal: AbortSignal.timeout(15000),
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

    // Step 2: Poll container status until it is FINISHED (or ERROR)
    let isReady = false;
    let attempts = 0;
    const maxAttempts = 12; // 12 attempts * 5s = 60 seconds (1 minute)

    while (!isReady && attempts < maxAttempts) {
      attempts++;
      // Wait 5 seconds between checks
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const statusRes = await fetch(
        `${GRAPH_URL}/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(10000) }
      );

      const statusData = await statusRes.json().catch(() => null);
      if (!statusRes.ok || !statusData) {
        const errMsg = statusData?.error?.message || `HTTP ${statusRes.status}`;
        log.warn(`Failed to check container status (attempt ${attempts}): ${errMsg}`);
        continue;
      }

      if (statusData.error) {
        log.warn(`Meta status check returned error: ${statusData.error.message}`);
        continue;
      }

      const statusCode = statusData.status_code;
      log.info(`Instagram container status check (attempt ${attempts}): ${statusCode}`);

      if (statusCode === "FINISHED") {
        isReady = true;
      } else if (statusCode === "ERROR") {
        return { success: false, error: "Meta image processing failed (status_code: ERROR)" };
      }
    }

    if (!isReady) {
      return { success: false, error: "Meta image processing timed out (still IN_PROGRESS after 60s)" };
    }

    // Step 3: Publish the container
    const publishRes = await fetch(`${GRAPH_URL}/${igUserId}/media_publish`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        creation_id: creationId,
      }),
      signal: AbortSignal.timeout(15000),
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
  await ensurePageTokenLoaded();
  const token = getPageToken();
  const igUserId = getIgUserId();

  if (!token || !igUserId) {
    return { success: false, error: "Instagram not configured" };
  }

  if (params.imageUrls.length < 2 || params.imageUrls.length > 10) {
    return { success: false, error: "Carousel needs 2-10 images" };
  }

  try {
    // v1.7 follow-up · token via Authorization header (was in body).
    const authHeaders = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    };

    // Step 1: Create child containers for each image
    const childIds: string[] = [];
    for (const url of params.imageUrls) {
      const res = await fetch(`${GRAPH_URL}/${igUserId}/media`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          image_url: url,
          is_carousel_item: true,
        }),
        signal: AbortSignal.timeout(15000),
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
      headers: authHeaders,
      body: JSON.stringify({
        media_type: "CAROUSEL",
        children: childIds.join(","),
        caption: params.caption,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const containerData = await containerRes.json();
    if (!containerRes.ok || !containerData.id) {
      return { success: false, error: `Carousel container failed: ${containerData?.error?.message || "unknown"}` };
    }

    // Step 3: Publish
    const publishRes = await fetch(`${GRAPH_URL}/${igUserId}/media_publish`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        creation_id: containerData.id,
      }),
      signal: AbortSignal.timeout(15000),
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

// ─── Instagram Reel Post (Video Required) ──────────────

export async function postInstagramReel(params: {
  videoUrl: string;
  caption: string;
}): Promise<{ success: boolean; postId?: string; error?: string }> {
  await ensurePageTokenLoaded();
  const token = getPageToken();
  const igUserId = getIgUserId();

  if (!token || !igUserId) {
    return { success: false, error: "Instagram posting not configured (need META_PAGE_ACCESS_TOKEN + META_IG_USER_ID)" };
  }

  try {
    const authHeaders = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    };

    // Step 1: Create Reel container
    const containerRes = await fetch(`${GRAPH_URL}/${igUserId}/media`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        media_type: "REELS",
        video_url: params.videoUrl,
        caption: params.caption,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const containerData = await containerRes.json();
    if (!containerRes.ok || !containerData.id) {
      return { success: false, error: `Reel container failed: ${containerData?.error?.message || "unknown"}` };
    }

    const creationId = containerData.id;

    // Step 2: Poll container status until it is FINISHED (or ERROR)
    let isReady = false;
    let attempts = 0;
    const maxAttempts = 30; // 30 attempts * 5s = 150 seconds (2.5 minutes)

    while (!isReady && attempts < maxAttempts) {
      attempts++;
      // Wait 5 seconds between checks
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const statusRes = await fetch(
        `${GRAPH_URL}/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(10000) }
      );

      const statusData = await statusRes.json().catch(() => null);
      if (!statusRes.ok || !statusData) {
        const errMsg = statusData?.error?.message || `HTTP ${statusRes.status}`;
        log.warn(`Failed to check Reel container status (attempt ${attempts}): ${errMsg}`);
        continue;
      }

      if (statusData.error) {
        return { success: false, error: `Meta status check failed: ${statusData.error.message}` };
      }

      const statusCode = statusData.status_code;
      log.info(`Reel container status check (attempt ${attempts}): ${statusCode}`);

      if (statusCode === "FINISHED") {
        isReady = true;
      } else if (statusCode === "ERROR") {
        return { success: false, error: "Meta video processing failed (status_code: ERROR)" };
      }
    }

    if (!isReady) {
      return { success: false, error: "Meta video processing timed out (still IN_PROGRESS after 150s)" };
    }

    // Step 3: Publish the Reel container
    const publishRes = await fetch(`${GRAPH_URL}/${igUserId}/media_publish`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        creation_id: creationId,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const publishData = await publishRes.json();
    if (!publishRes.ok) {
      return { success: false, error: `Reel publish failed: ${publishData?.error?.message || "unknown"}` };
    }

    const postId = publishData.id;
    log.info(`Instagram Reel published: ${postId}`);
    return { success: true, postId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error("Instagram Reel error:", { error: errMsg });
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
  await ensurePageTokenLoaded();
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

// ─── Comment Moderation (read + reply) ────────────────
// Live Graph reads/writes for the admin Instagram console. The 4 fetch
// helpers the original plan wanted to ADD already exist as cache readers
// (server/instagram.ts getInstagramPosts/getInstagramAccount); only the
// comment-moderation pair is genuinely new, and it belongs here next to
// the token + Graph plumbing it depends on.

export interface IgComment {
  id: string;
  text: string;
  username: string;
  timestamp: string;
  likeCount: number;
}

/**
 * Fetch recent comments on one of our own IG media objects.
 * Read-only. Returns ok:false (never throws) so the router/UI can render
 * a clear "not configured / Graph error" state instead of a 500.
 */
export async function getMediaComments(
  mediaId: string,
): Promise<{ ok: boolean; comments: IgComment[]; error?: string }> {
  await ensurePageTokenLoaded();
  const token = getPageToken();
  if (!token) {
    return { ok: false, comments: [], error: "Instagram not configured (need META_PAGE_ACCESS_TOKEN)" };
  }

  try {
    const url =
      `${GRAPH_URL}/${encodeURIComponent(mediaId)}/comments` +
      `?fields=id,text,username,timestamp,like_count&limit=50`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();

    if (!res.ok) {
      const errMsg = data?.error?.message || `HTTP ${res.status}`;
      log.error("Instagram comments fetch failed:", { error: errMsg });
      return { ok: false, comments: [], error: errMsg };
    }

    const rows: unknown[] = Array.isArray(data.data) ? data.data : [];
    const comments: IgComment[] = rows.map((raw) => {
      const c = raw as Record<string, unknown>;
      return {
        id: String(c.id ?? ""),
        text: typeof c.text === "string" ? c.text : "",
        username: typeof c.username === "string" ? c.username : "",
        timestamp: typeof c.timestamp === "string" ? c.timestamp : "",
        likeCount: typeof c.like_count === "number" ? c.like_count : 0,
      };
    });
    return { ok: true, comments };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error("Instagram comments error:", { error: errMsg });
    return { ok: false, comments: [], error: errMsg };
  }
}

/**
 * Post a reply to a specific comment on our own media. LIVE Graph write,
 * so callers MUST claim-safety-check the message and gate it behind an
 * explicit per-action admin confirmation (see instagramAdminRouter.postReply).
 */
export async function replyToComment(
  commentId: string,
  message: string,
): Promise<{ success: boolean; replyId?: string; error?: string }> {
  await ensurePageTokenLoaded();
  const token = getPageToken();
  if (!token) {
    return { success: false, error: "Instagram not configured (need META_PAGE_ACCESS_TOKEN)" };
  }
  const text = message.trim();
  if (!text) return { success: false, error: "Reply message is empty" };

  try {
    const res = await fetch(`${GRAPH_URL}/${encodeURIComponent(commentId)}/replies`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ message: text }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();

    if (!res.ok) {
      const errMsg = data?.error?.message || `HTTP ${res.status}`;
      log.error("Instagram comment reply failed:", { error: errMsg });
      return { success: false, error: errMsg };
    }

    const replyId = typeof data.id === "string" ? data.id : undefined;
    log.info(`Instagram comment reply posted: ${replyId}`);
    return { success: true, replyId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error("Instagram comment reply error:", { error: errMsg });
    return { success: false, error: errMsg };
  }
}
