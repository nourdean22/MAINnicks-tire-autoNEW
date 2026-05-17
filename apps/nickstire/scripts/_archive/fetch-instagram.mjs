#!/usr/bin/env node
/**
 * Fetch Instagram data via MCP CLI and save to instagram-cache.json
 * This script runs in the sandbox environment where MCP is available.
 * It should be run periodically (e.g., via scheduled task) to keep data fresh.
 */

import { execSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const CACHE_PATH = join(PROJECT_ROOT, "instagram-cache.json");

function runMcp(tool, input) {
  try {
    const result = execSync(
      `manus-mcp-cli tool call ${tool} --server instagram --input '${JSON.stringify(input)}'`,
      { timeout: 30000, encoding: "utf-8" }
    );
    const fileMatch = result.match(/saved to:\s*(\S+)/);
    if (fileMatch) {
      return readFileSync(fileMatch[1], "utf-8");
    }
    return result;
  } catch (err) {
    console.error(`[Instagram] MCP call failed for ${tool}:`, err.message);
    return null;
  }
}

function parsePostList(text) {
  const posts = [];
  const postBlocks = text.split(/--- Post \d+ ---/).filter(Boolean);

  for (const block of postBlocks) {
    const id = block.match(/ID:\s*(\S+)/)?.[1] || "";
    const type = block.match(/Type:\s*(\S+)/)?.[1] || "IMAGE";
    const captionMatch = block.match(/Caption:\s*([\s\S]*?)(?=\nLink:)/);
    const caption = captionMatch?.[1]?.trim() || "";
    const link = block.match(/Link:\s*(\S+)/)?.[1] || "";
    const likes = parseInt(block.match(/Likes:\s*(\d+)/)?.[1] || "0", 10);
    const comments = parseInt(block.match(/Comments:\s*(\d+)/)?.[1] || "0", 10);
    const posted = block.match(/Posted:\s*(\S+)/)?.[1] || "";

    if (id) {
      posts.push({ id, type, caption, link, likes, comments, posted });
    }
  }

  return posts;
}

function parseAccountInfo(text) {
  const username = text.match(/Username:\s*@?(\S+)/)?.[1] || "";
  const name = text.match(/Name:\s*(.*)/)?.[1]?.trim() || "";
  const bio = text.match(/Bio:\s*([\s\S]*?)(?=\nFollowers:)/)?.[1]?.trim() || "";
  const followers = parseInt(text.match(/Followers:\s*([\d,]+)/)?.[1]?.replace(/,/g, "") || "0", 10);
  const following = parseInt(text.match(/Following:\s*([\d,]+)/)?.[1]?.replace(/,/g, "") || "0", 10);
  const posts = parseInt(text.match(/Posts:\s*([\d,]+)/)?.[1]?.replace(/,/g, "") || "0", 10);
  const profilePicture = text.match(/Profile Picture:\s*(\S+)/)?.[1] || "";
  const website = text.match(/Website:\s*(\S+)/)?.[1] || "";

  if (!username) return null;
  return { username, name, bio, followers, following, posts, profilePicture, website };
}

console.log("[Instagram] Fetching posts...");
const postsRaw = runMcp("get_post_list", { limit: 12 });
const posts = postsRaw ? parsePostList(postsRaw) : [];
console.log(`[Instagram] Got ${posts.length} posts`);

console.log("[Instagram] Fetching account info...");
const accountRaw = runMcp("get_account_info", {});
const account = accountRaw ? parseAccountInfo(accountRaw) : null;
console.log(`[Instagram] Account: ${account?.username || "unavailable"}`);

const cache = {
  posts,
  account,
  lastUpdated: new Date().toISOString(),
};

writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
console.log(`[Instagram] Cache saved to ${CACHE_PATH}`);
console.log(`[Instagram] ${posts.length} posts, account: ${account ? "yes" : "no"}`);
