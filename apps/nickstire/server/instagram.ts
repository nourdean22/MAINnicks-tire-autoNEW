/**
 * Instagram Feed Integration
 * Uses cached data from a JSON file that is populated by the scheduled task.
 * The MCP CLI can only run in the sandbox, not on the deployed server,
 * so we pre-fetch and store the data as a static JSON cache.
 */

import * as fs from "fs";
import * as path from "path";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { instagramAnalytics, reelJobs, socialContentInventory } from "../drizzle/schema";
import { getDb } from "./db";
import { createLogger } from "./lib/logger";

const log = createLogger("instagram");
export interface InstagramPost {
  id: string;
  type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  caption: string;
  link: string;
  likes: number;
  comments: number;
  posted: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  /** Graph media_product_type (REELS/FEED/…) — media_type says VIDEO for reels. */
  mediaProductType?: string | null;
}

export interface InstagramAccount {
  username: string;
  name: string;
  bio: string;
  followers: number;
  following: number;
  posts: number;
  profilePicture: string;
  website: string;
}

interface InstagramCache {
  posts: InstagramPost[];
  account: InstagramAccount | null;
  lastUpdated: string;
}

// Path to the cached Instagram data
const CACHE_PATH = path.join(process.cwd(), "instagram-cache.json");

// In-memory cache to avoid repeated file reads
let memoryCache: InstagramCache | null = null;
let memoryCacheTime = 0;
const MEMORY_TTL = 5 * 60 * 1000; // Re-read file every 5 minutes

function loadCache(): InstagramCache | null {
  const now = Date.now();
  if (memoryCache && now - memoryCacheTime < MEMORY_TTL) {
    return memoryCache;
  }

  try {
    if (fs.existsSync(CACHE_PATH)) {
      const raw = fs.readFileSync(CACHE_PATH, "utf-8");
      memoryCache = JSON.parse(raw);
      memoryCacheTime = now;
      return memoryCache;
    }
  } catch (err) {
    log.error("[Instagram] Failed to read cache:", err);
  }
  return null;
}

function firstAssetUrl(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.find((entry): entry is string => typeof entry === "string" && /^https?:\/\//i.test(entry));
}

/**
 * Durable fallback for fresh Railway containers.
 *
 * instagram-cache.json is intentionally an optimization, not an authority: the
 * file is ephemeral and disappears on every deploy. The publication/analytics
 * tables survive deploys and already carry the exact Reel identity chain.
 */
async function getInstagramPostsFromDb(limit: number): Promise<InstagramPost[]> {
  try {
    const db = await getDb();
    if (!db) return [];

    const rows = await db
      .select({
        inventoryId: socialContentInventory.id,
        contentType: socialContentInventory.contentType,
        hookText: socialContentInventory.hookText,
        bodyText: socialContentInventory.bodyText,
        assetPaths: socialContentInventory.assetPaths,
        publishedAt: socialContentInventory.publishedAt,
        igPostId: reelJobs.igPostId,
        caption: instagramAnalytics.caption,
        postType: instagramAnalytics.postType,
        postedAt: instagramAnalytics.postedAt,
        likes: instagramAnalytics.likes,
        comments: instagramAnalytics.comments,
        mediaProductType: instagramAnalytics.mediaProductType,
      })
      .from(socialContentInventory)
      .leftJoin(reelJobs, eq(reelJobs.briefId, socialContentInventory.id))
      .leftJoin(instagramAnalytics, eq(instagramAnalytics.postId, reelJobs.igPostId))
      .where(and(
        eq(socialContentInventory.status, "published"),
        inArray(socialContentInventory.platform, ["instagram", "both"]),
        inArray(socialContentInventory.contentType, ["reel", "carousel", "post"]),
        isNotNull(socialContentInventory.publishedAt),
      ))
      .orderBy(desc(socialContentInventory.publishedAt))
      .limit(Math.max(limit * 3, limit));

    const seen = new Set<string>();
    const posts: InstagramPost[] = [];
    for (const row of rows) {
      const id = row.igPostId || row.inventoryId;
      if (seen.has(id)) continue;
      seen.add(id);

      const type: InstagramPost["type"] =
        row.contentType === "reel" || row.postType === "VIDEO"
          ? "VIDEO"
          : row.contentType === "carousel" || row.postType === "CAROUSEL_ALBUM"
            ? "CAROUSEL_ALBUM"
            : "IMAGE";
      posts.push({
        id,
        type,
        caption: row.caption?.trim() || row.hookText?.trim() || row.bodyText?.trim() || "",
        // The persistent tables have the durable Graph media id but not the
        // shortcode permalink. Falling back to the canonical profile is honest;
        // the file cache still supplies exact per-post links when available.
        link: "https://www.instagram.com/nicks_tire_euclid/",
        likes: row.likes ?? 0,
        comments: row.comments ?? 0,
        posted: row.postedAt || row.publishedAt?.toISOString() || "",
        mediaUrl: firstAssetUrl(row.assetPaths),
        mediaProductType: row.mediaProductType || (type === "VIDEO" ? "REELS" : "FEED"),
      });
      if (posts.length >= limit) break;
    }
    return posts;
  } catch (err) {
    log.warn("[Instagram] Durable DB fallback unavailable:", err);
    return [];
  }
}

/**
 * Get recent Instagram posts. Prefer the Graph-synced file cache when present,
 * then fall back to persistent publication/analytics rows on a fresh container.
 */
export async function getInstagramPosts(limit: number = 6): Promise<InstagramPost[]> {
  const cache = loadCache();
  if (cache?.posts?.length) return cache.posts.slice(0, limit);
  return getInstagramPostsFromDb(limit);
}

/**
 * Get Instagram account info from cache.
 */
export async function getInstagramAccount(): Promise<InstagramAccount | null> {
  const cache = loadCache();
  if (!cache) return null;
  return cache.account;
}

/**
 * Persist a fresh feed snapshot so the cache readers above (admin live feed,
 * account header, public widgets) serve real data without their own Graph
 * calls. Until 2026-07 nothing ever wrote this file — its only writer was an
 * archived sandbox script, so every reader returned empty forever (the starved
 * analytics pipeline). The Graph-backed sync now refreshes it on each run.
 *
 * Best-effort: an unwritable disk must not fail a sync whose DB writes
 * already landed. Write-then-rename keeps a crash from leaving a torn file.
 */
export async function writeInstagramCache(posts: InstagramPost[], account: InstagramAccount | null): Promise<boolean> {
  const cache: InstagramCache = { posts, account, lastUpdated: new Date().toISOString() };
  try {
    const tmp = `${CACHE_PATH}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(cache, null, 2), "utf-8");
    await fs.promises.rename(tmp, CACHE_PATH);
    memoryCache = cache;
    memoryCacheTime = Date.now();
    return true;
  } catch (err) {
    log.warn("[Instagram] Failed to write feed cache (readers keep prior data):", err);
    return false;
  }
}
