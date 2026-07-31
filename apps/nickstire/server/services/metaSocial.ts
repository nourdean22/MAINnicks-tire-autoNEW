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
let metaPageId: string | null = null;
let metaIgUserId: string | null = null;
let metaAppId: string | null = null;
let metaAppSecret: string | null = null;
let configLoadAttempted = false;

export function setRuntimePageToken(token: string): void {
  runtimePageToken = token;
}

export function clearRuntimeMetaConfigCache(): void {
  configLoadAttempted = false;
  metaPageId = null;
  metaIgUserId = null;
  metaAppId = null;
  metaAppSecret = null;
  // A config change invalidates any cached live verdict — the old ids' result
  // must not answer for the new ids.
  liveCache = null;
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
  // The latch is set only on a COMPLETED read. It used to be set before the
  // attempt with a log-only catch — one DB blip on first use (routine during a
  // redeploy) permanently stranded the persisted token for the process
  // lifetime, and every publish failed "not configured" until a restart.
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
    persistedLoadAttempted = true;
  } catch (err) {
    log.error("Failed to load persisted Meta page token (will retry on next use):", { error: err instanceof Error ? err.message : String(err) });
  }
}

async function ensureMetaConfigLoaded(): Promise<void> {
  if (configLoadAttempted) return;
  // Latch on COMPLETION only — same stranding bug as ensurePageTokenLoaded.
  try {
    const { db } = await import("../lib/db-helper");
    const d = await db();
    if (!d) return;
    const { appSecretKv } = await import("../../drizzle/schema");
    const { inArray } = await import("drizzle-orm");
    const rows = await d
      .select()
      .from(appSecretKv)
      .where(
        inArray(appSecretKv.k, [
          "meta_page_id",
          "meta_ig_user_id",
          "meta_app_id",
          "meta_app_secret",
        ])
      );
    for (const r of rows) {
      if (r.k === "meta_page_id") metaPageId = r.v;
      if (r.k === "meta_ig_user_id") metaIgUserId = r.v;
      if (r.k === "meta_app_id") metaAppId = r.v;
      if (r.k === "meta_app_secret") metaAppSecret = r.v;
    }
    configLoadAttempted = true;
    log.info("Loaded persisted Meta configuration from database");
  } catch (err) {
    log.error("Failed to load persisted Meta config (will retry on next use):", { error: err instanceof Error ? err.message : String(err) });
  }
}

export async function getPageId(): Promise<string | null> {
  await ensureMetaConfigLoaded();
  return metaPageId || process.env.META_PAGE_ID || null;
}

export async function getIgUserId(): Promise<string | null> {
  await ensureMetaConfigLoaded();
  return metaIgUserId || process.env.META_IG_USER_ID || null;
}

export async function getAppId(): Promise<string | null> {
  await ensureMetaConfigLoaded();
  return metaAppId || process.env.META_APP_ID || null;
}

export async function getAppSecret(): Promise<string | null> {
  await ensureMetaConfigLoaded();
  return metaAppSecret || process.env.META_APP_SECRET || process.env.FB_APP_SECRET || null;
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
  const pageId = await getPageId();
  const igUserId = await getIgUserId();

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

// ─── Live connection verification ──────────────────────
// getMetaSocialStatus above is PRESENCE-only (token and IDs exist) — it stays
// that way because publish paths and cron call it on hot paths. A token can be
// present and dead (revoked permissions, password reset, page unlinked,
// platform action), which used to leave Settings showing "ready" while every
// publish failed. This live probe asks the Graph API itself, with a short
// cache so an admin panel poll can't burn rate limit.

export interface MetaLiveStatus {
  ok: boolean;
  checkedAt: string;
  igUsername: string | null;
  pageName: string | null;
  error: string | null;
  /**
   * We could not ASK Meta (DNS/timeout/connection drop) — a third state that
   * is neither "Meta accepted" nor "Meta rejected". Consumers must render it
   * as unknown, not as a dead token. Never cached: the next poll should
   * actually re-ask instead of replaying a transport blip for 5 minutes.
   */
  unknown?: boolean;
}

let liveCache: { at: number; result: MetaLiveStatus } | null = null;
const LIVE_CACHE_TTL_MS = 5 * 60 * 1000;

/** Test hook — the cache is module state and singleFork shares the process. */
export function __resetMetaLiveCacheForTests(): void {
  liveCache = null;
}

export async function verifyMetaConnectionLive(opts?: { force?: boolean }): Promise<MetaLiveStatus> {
  if (!opts?.force && liveCache && Date.now() - liveCache.at < LIVE_CACHE_TTL_MS) {
    return liveCache.result;
  }

  const checkedAt = new Date().toISOString();
  await ensurePageTokenLoaded();
  const token = getPageToken();
  const pageId = await getPageId();
  const igUserId = await getIgUserId();

  const fail = (error: string): MetaLiveStatus => {
    const result: MetaLiveStatus = { ok: false, checkedAt, igUsername: null, pageName: null, error };
    liveCache = { at: Date.now(), result };
    return result;
  };

  if (!token) return fail("No Meta access token available");
  if (!igUserId && !pageId) return fail("Neither META_IG_USER_ID nor META_PAGE_ID is configured");

  /**
   * "Could not reach Meta" and "Meta rejected the credentials" are different
   * facts. The old catch routed BOTH through fail(), so a 10s network blip was
   * negative-cached as ok:false for 5 minutes and every consumer's carefully
   * built third state (live: null) was unreachable — a transport error read as
   * a dead token. Transport failures are tagged and NEVER cached.
   */
  class MetaTransportError extends Error {}

  try {
    const probe = async (id: string, fields: string) => {
      let res: Response;
      try {
        res = await fetch(`${GRAPH_URL}/${id}?fields=${fields}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
      } catch (err) {
        throw new MetaTransportError(err instanceof Error ? err.message : String(err));
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) {
        throw new Error(data?.error?.message || `HTTP ${res.status}`);
      }
      return data as Record<string, string>;
    };

    const [ig, page] = await Promise.all([
      igUserId ? probe(igUserId, "id,username") : Promise.resolve(null),
      pageId ? probe(pageId, "id,name") : Promise.resolve(null),
    ]);

    const result: MetaLiveStatus = {
      ok: true,
      checkedAt,
      igUsername: ig?.username ?? null,
      pageName: page?.name ?? null,
      error: null,
    };
    liveCache = { at: Date.now(), result };
    return result;
  } catch (err) {
    if (err instanceof MetaTransportError) {
      return { ok: false, unknown: true, checkedAt, igUsername: null, pageName: null, error: `Could not reach Meta to verify: ${err.message}` };
    }
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ─── Container readiness polling ────────────────────────
// Meta processes every uploaded media container asynchronously; publishing
// before status_code=FINISHED intermittently fails or posts broken media.
// This loop existed as three inline copies (image, story, reel) and was
// MISSING entirely from the carousel path — now all four share it.

export async function pollContainerReady(
  creationId: string,
  token: string,
  opts: { what: string; maxAttempts?: number; intervalMs?: number },
): Promise<{ ready: true } | { ready: false; error: string }> {
  const maxAttempts = opts.maxAttempts ?? 12;
  const intervalMs = opts.intervalMs ?? 5000;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

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
      return { ready: true };
    }
    if (statusCode === "ERROR") {
      return { ready: false, error: `Meta ${opts.what} processing failed (status_code: ERROR)` };
    }
  }

  return {
    ready: false,
    error: `Meta ${opts.what} processing timed out (still IN_PROGRESS after ${(maxAttempts * intervalMs) / 1000}s)`,
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
  const appId = await getAppId();
  const appSecret = await getAppSecret();
  const pageId = await getPageId();

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
    // The dead-token verdict must not outlive the reconnect that fixed it —
    // without this, Settings kept saying "disconnected" for up to 5 minutes
    // after a WORKING reconnect, inviting a second panic reconnect.
    liveCache = null;
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
  const pageId = await getPageId();

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

/**
 * The media_publish POST is the irreversible step: once it is dispatched, a
 * timeout or dropped connection is NOT proof of failure — Meta may have
 * published. Every result from this helper distinguishes "Meta answered no"
 * (plain failure, safe to retry) from "the request left and no answer came
 * back" (`ambiguous: true` — retrying can duplicate a live post). Callers park
 * ambiguous results for reconciliation instead of resetting to a retryable
 * state. Container creation and readiness polling stay OUTSIDE this helper:
 * failures there are provably pre-publish and must remain plain failures.
 */
async function publishMediaContainer(
  igUserId: string,
  creationId: string,
  authHeaders: Record<string, string>,
  what: string,
): Promise<{ success: boolean; postId?: string; error?: string; ambiguous?: boolean }> {
  let publishRes: Response;
  try {
    publishRes = await fetch(`${GRAPH_URL}/${igUserId}/media_publish`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ creation_id: creationId }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error(`Instagram ${what} publish DISPATCHED but no response — AMBIGUOUS, may be live:`, { error: errMsg });
    return { success: false, ambiguous: true, error: `media_publish sent but no response (${errMsg}) — the ${what} may be LIVE` };
  }
  const publishData = await publishRes.json().catch(() => null);
  if (!publishRes.ok) {
    const errMsg = publishData?.error?.message || `${what} publish failed: HTTP ${publishRes.status}`;
    log.error(`Instagram ${what} publish error:`, { error: errMsg });
    return { success: false, error: errMsg };
  }
  const postId = publishData?.id;
  log.info(`Instagram ${what} published: ${postId}`);
  return { success: true, postId };
}

export async function postToInstagram(params: {
  imageUrl: string;
  caption: string;
}): Promise<{ success: boolean; postId?: string; error?: string; ambiguous?: boolean }> {
  await ensurePageTokenLoaded();
  const token = getPageToken();
  const igUserId = await getIgUserId();

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
    const readiness = await pollContainerReady(creationId, token, { what: "image" });
    if (!readiness.ready) {
      return { success: false, error: readiness.error };
    }

    // Step 3: Publish the container (ambiguity-aware — see publishMediaContainer)
    return await publishMediaContainer(igUserId, creationId, authHeaders, "image");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error("Instagram post error:", { error: errMsg });
    return { success: false, error: errMsg };
  }
}

// ─── Instagram Story Post ─────────────────────────────

export async function postInstagramStory(params: {
  imageUrl?: string;
  videoUrl?: string;
}): Promise<{ success: boolean; postId?: string; error?: string; ambiguous?: boolean }> {
  await ensurePageTokenLoaded();
  const token = getPageToken();
  const igUserId = await getIgUserId();

  if (!token || !igUserId) {
    return { success: false, error: "Instagram not configured" };
  }

  if (!params.imageUrl && !params.videoUrl) {
    return { success: false, error: "Must provide either imageUrl or videoUrl" };
  }

  try {
    const authHeaders = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    };

    // Step 1: Create media container
    const containerRes = await fetch(`${GRAPH_URL}/${igUserId}/media`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        media_type: "STORIES",
        ...(params.imageUrl ? { image_url: params.imageUrl } : {}),
        ...(params.videoUrl ? { video_url: params.videoUrl } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });

    const containerData = await containerRes.json();

    if (!containerRes.ok) {
      const errMsg = containerData?.error?.message || `Story container creation failed: HTTP ${containerRes.status}`;
      log.error("Instagram story container error:", { error: errMsg });
      return { success: false, error: errMsg };
    }

    const creationId = containerData.id;
    if (!creationId) {
      return { success: false, error: "No container ID returned from Meta" };
    }

    // Step 2: Poll container status until it is FINISHED (or ERROR)
    const readiness = await pollContainerReady(creationId, token, { what: "story" });
    if (!readiness.ready) {
      return { success: false, error: readiness.error };
    }

    // Step 3: Publish the container (ambiguity-aware — see publishMediaContainer)
    return await publishMediaContainer(igUserId, creationId, authHeaders, "story");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error("Instagram story post error:", { error: errMsg });
    return { success: false, error: errMsg };
  }
}

// ─── Instagram Carousel Post ──────────────────────────

export async function postInstagramCarousel(params: {
  imageUrls: string[];
  caption: string;
}): Promise<{ success: boolean; postId?: string; error?: string; ambiguous?: boolean }> {
  await ensurePageTokenLoaded();
  const token = getPageToken();
  const igUserId = await getIgUserId();

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

    // Step 3: Poll the carousel container until Meta reports FINISHED. Every
    // other format polled before publishing; carousel went straight to
    // media_publish, which intermittently failed (or published broken media)
    // when children were still processing. The parent container's status
    // reflects child readiness, so one poll covers all of them.
    const readiness = await pollContainerReady(containerData.id, token, { what: "carousel" });
    if (!readiness.ready) {
      return { success: false, error: readiness.error };
    }

    // Step 4: Publish (ambiguity-aware — see publishMediaContainer)
    return await publishMediaContainer(igUserId, containerData.id, authHeaders, "carousel");
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
  /** Hosted branded cover image URL. Wins over thumbOffsetMs when set. */
  coverUrl?: string;
  /** Fallback cover: ms into the reel to grab the cover frame. Default 0 = the centered Anton hook first frame. */
  thumbOffsetMs?: number;
}): Promise<{ success: boolean; postId?: string; error?: string; ambiguous?: boolean }> {
  await ensurePageTokenLoaded();
  const token = getPageToken();
  const igUserId = await getIgUserId();

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
        // Branded cover: prefer an explicit hosted image; otherwise pull a frame
        // from the reel. The generated reel's first frame is the centered Anton
        // hook overlay, so thumb_offset=0 yields an on-brand cover with no hosting.
        ...(params.coverUrl
          ? { cover_url: params.coverUrl }
          : { thumb_offset: params.thumbOffsetMs ?? 0 }),
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

    // Step 3: Publish the Reel container (ambiguity-aware — see publishMediaContainer)
    return await publishMediaContainer(igUserId, creationId, authHeaders, "Reel");
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
  /** Number of replies on this comment (0 if the Graph didn't return the edge). */
  replyCount: number;
  /** True if WE (the connected IG account) have replied. Graceful: false when
   *  the replies edge or from-id isn't available, so it never shows a false
   *  "answered". */
  replied: boolean;
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
      `?fields=id,text,username,timestamp,like_count,replies{id,from}&limit=50`;
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

    // Our own account id, to detect comments WE've already replied to.
    const ourId = await getIgUserId();
    const rows: unknown[] = Array.isArray(data.data) ? data.data : [];
    const comments: IgComment[] = rows.map((raw) => {
      const c = raw as Record<string, unknown>;
      const repliesData = (c.replies as { data?: unknown[] } | undefined)?.data;
      const replyArr = Array.isArray(repliesData) ? repliesData : [];
      const replied = ourId
        ? replyArr.some((rep) => {
            const from = (rep as Record<string, unknown>)?.from as Record<string, unknown> | undefined;
            return from?.id != null && String(from.id) === String(ourId);
          })
        : false;
      return {
        id: String(c.id ?? ""),
        text: typeof c.text === "string" ? c.text : "",
        username: typeof c.username === "string" ? c.username : "",
        timestamp: typeof c.timestamp === "string" ? c.timestamp : "",
        likeCount: typeof c.like_count === "number" ? c.like_count : 0,
        replyCount: replyArr.length,
        replied,
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
 * Pure: map an IG /insights Graph response (`{data:[{name,values:[{value}]}]}`)
 * to the metric fields we store. Tolerates missing/extra metrics and bad shapes.
 */
export function parseInsights(data: unknown): {
  reach?: number;
  saved?: number;
  views?: number;
  shares?: number;
  avgWatchTimeMs?: number;
  skipRate?: number;
} {
  const out: Record<string, number> = {};
  const rows = (data as { data?: unknown[] } | null)?.data;
  for (const raw of Array.isArray(rows) ? rows : []) {
    const m = raw as Record<string, unknown>;
    const name = typeof m.name === "string" ? m.name : "";
    const values = m.values as Array<{ value?: unknown }> | undefined;
    const v = values?.[0]?.value;
    if (name && typeof v === "number") out[name] = v;
  }
  return {
    reach: out.reach,
    saved: out.saved,
    views: out.views,
    shares: out.shares,
    // Reels-only. `ig_reels_avg_watch_time` is returned in MILLISECONDS — kept
    // in its native unit and named accordingly, because a silent ms→s guess is
    // how a metric ends up wrong by 1000x with nothing to catch it.
    // Absent stays UNDEFINED, never 0: "not reported" and "nobody watched" are
    // different facts, and collapsing them fabricates a measurement.
    avgWatchTimeMs: out.ig_reels_avg_watch_time,
    skipRate: out.reels_skip_rate,
  };
}

/**
 * Fetch LIVE engagement insights for one of our media objects (reel/post).
 * Real Graph data — reach/saved/views/shares — for the analytics table and the
 * data-driven generation loop (replaces the Studio's fabricated metrics).
 * Read-only, never throws (returns ok:false on any config/Graph error).
 * `views` replaces the deprecated `plays` metric; image media reject `views`, so
 * a metric-validation error retries with the universally-supported subset.
 */
export async function getMediaInsights(
  mediaId: string,
): Promise<{
  ok: boolean;
  reach?: number;
  saved?: number;
  views?: number;
  shares?: number;
  avgWatchTimeMs?: number;
  skipRate?: number;
  error?: string;
}> {
  await ensurePageTokenLoaded();
  const token = getPageToken();
  if (!token) {
    return { ok: false, error: "Instagram not configured (need META_PAGE_ACCESS_TOKEN)" };
  }
  const fetchMetrics = async (metrics: string) => {
    const url = `${GRAPH_URL}/${encodeURIComponent(mediaId)}/insights?metric=${metrics}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    return { res, data };
  };
  try {
    // Ladder, widest first. Reel-only metrics fail the WHOLE call on an image or
    // carousel, so each rung drops the tier above it rather than losing
    // everything. `ig_reels_avg_watch_time` and `reels_skip_rate` are the
    // distribution signals for DISCOVERY content — the objective score cannot be
    // computed without them, and nothing collected them before.
    let { res, data } = await fetchMetrics("reach,saved,views,shares,ig_reels_avg_watch_time,reels_skip_rate");
    if (!res.ok) ({ res, data } = await fetchMetrics("reach,saved,views,shares"));
    // Image/carousel media reject `views` (reels-only) and fail the whole call;
    // retry once with the universally-supported subset on ANY further failure.
    if (!res.ok) {
      ({ res, data } = await fetchMetrics("reach,saved,shares"));
    }
    if (!res.ok) {
      const errMsg = data?.error?.message || `HTTP ${res.status}`;
      log.error("Instagram insights fetch failed:", { error: errMsg });
      return { ok: false, error: errMsg };
    }
    return { ok: true, ...parseInsights(data) };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error("Instagram insights error:", { error: errMsg });
    return { ok: false, error: errMsg };
  }
}

// ─── Live feed reads (media list + account profile) ─────
// These are the READ half the integration never had: posting and per-media
// insights existed, but the media LIST and account profile only ever came from
// instagram-cache.json — a file with no writer — so the analytics pipeline
// processed zero rows while looking healthy. Both return the same shapes the
// cache readers produce (server/instagram.ts), so callers can fall back
// transparently.

type GraphMediaNode = {
  id: string;
  media_type?: string;
  /** REELS vs FEED — media_type alone says VIDEO for a published reel (IG-037). */
  media_product_type?: string;
  caption?: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
  timestamp?: string;
  media_url?: string;
  thumbnail_url?: string;
};

export async function fetchInstagramMedia(
  limit = 25,
): Promise<{ ok: true; posts: import("../instagram").InstagramPost[] } | { ok: false; error: string }> {
  await ensurePageTokenLoaded();
  const token = getPageToken();
  const igUserId = await getIgUserId();
  if (!token || !igUserId) {
    return { ok: false, error: "Instagram not configured (need META_PAGE_ACCESS_TOKEN + META_IG_USER_ID)" };
  }
  try {
    const fields = "id,media_type,media_product_type,caption,permalink,like_count,comments_count,timestamp,media_url,thumbnail_url";
    const url = `${GRAPH_URL}/${igUserId}/media?fields=${fields}&limit=${Math.min(Math.max(limit, 1), 100)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) {
      const errMsg = data?.error?.message || `HTTP ${res.status}`;
      log.error("Instagram media list fetch failed:", { error: errMsg });
      return { ok: false, error: errMsg };
    }
    const nodes: GraphMediaNode[] = Array.isArray(data.data) ? data.data : [];
    const posts = nodes.map((n) => ({
      id: n.id,
      // Graph's media_type values match the cache enum exactly; anything novel
      // degrades to IMAGE rather than dropping the row.
      type: (n.media_type === "VIDEO" || n.media_type === "CAROUSEL_ALBUM" ? n.media_type : "IMAGE") as
        | "IMAGE"
        | "VIDEO"
        | "CAROUSEL_ALBUM",
      caption: n.caption ?? "",
      link: n.permalink ?? "",
      likes: n.like_count ?? 0,
      comments: n.comments_count ?? 0,
      posted: n.timestamp ?? "",
      mediaUrl: n.media_url,
      thumbnailUrl: n.thumbnail_url,
      mediaProductType: n.media_product_type ?? null,
    }));
    return { ok: true, posts };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error("Instagram media list error:", { error: errMsg });
    return { ok: false, error: errMsg };
  }
}

export async function fetchInstagramAccountProfile(): Promise<
  { ok: true; account: import("../instagram").InstagramAccount } | { ok: false; error: string }
> {
  await ensurePageTokenLoaded();
  const token = getPageToken();
  const igUserId = await getIgUserId();
  if (!token || !igUserId) {
    return { ok: false, error: "Instagram not configured (need META_PAGE_ACCESS_TOKEN + META_IG_USER_ID)" };
  }
  try {
    const fields = "username,name,biography,followers_count,follows_count,media_count,profile_picture_url,website";
    const res = await fetch(`${GRAPH_URL}/${igUserId}?fields=${fields}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) {
      const errMsg = data?.error?.message || `HTTP ${res.status}`;
      log.error("Instagram account profile fetch failed:", { error: errMsg });
      return { ok: false, error: errMsg };
    }
    return {
      ok: true,
      account: {
        username: data.username ?? "",
        name: data.name ?? "",
        bio: data.biography ?? "",
        followers: data.followers_count ?? 0,
        following: data.follows_count ?? 0,
        posts: data.media_count ?? 0,
        profilePicture: data.profile_picture_url ?? "",
        website: data.website ?? "",
      },
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error("Instagram account profile error:", { error: errMsg });
    return { ok: false, error: errMsg };
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


export async function getInstagramPermalink(postId: string): Promise<string | null> {
  await ensurePageTokenLoaded();
  const token = getPageToken();
  if (!token) return null;
  try {
    const res = await fetch(`${GRAPH_URL}/${postId}?fields=permalink&access_token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (res.ok && data.permalink) {
      return data.permalink;
    } else {
      log.error("Failed to retrieve Instagram permalink", { data });
      return null;
    }
  } catch (err) {
    log.error("Error retrieving Instagram permalink:", err);
    return null;
  }
}


