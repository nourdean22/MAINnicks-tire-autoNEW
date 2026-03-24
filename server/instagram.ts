/**
 * Instagram Feed Integration
 * Uses cached data from a JSON file that is populated by the scheduled task.
 * The MCP CLI can only run in the sandbox, not on the deployed server,
 * so we pre-fetch and store the data as a static JSON cache.
 */

import * as fs from "fs";
import * as path from "path";

interface InstagramPost {
  id: string;
  type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  caption: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  link: string;
  likes: number;
  comments: number;
  posted: string;
}

interface InstagramAccount {
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
    console.error("[Instagram] Failed to read cache:", err);
  }
  return null;
}

/**
 * Get recent Instagram posts from cache.
 */
export async function getInstagramPosts(limit: number = 6): Promise<InstagramPost[]> {
  const cache = loadCache();
  if (!cache) return [];
  return cache.posts.slice(0, limit);
}

/**
 * Get Instagram account info from cache.
 */
export async function getInstagramAccount(): Promise<InstagramAccount | null> {
  const cache = loadCache();
  if (!cache) return null;
  return cache.account;
}
