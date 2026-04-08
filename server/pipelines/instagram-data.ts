/**
 * Instagram Data Pipeline — Track and analyze Instagram performance.
 *
 * Reads from the existing instagram.ts cache infrastructure and enriches with:
 * 1. Follower growth rate tracking
 * 2. Engagement rate per post type (IMAGE, VIDEO, CAROUSEL_ALBUM)
 * 3. Best posting times from engagement data
 * 4. Content performance scoring (AI-powered)
 *
 * Data stored in `instagram_analytics` table for trend analysis.
 * Source: instagram-cache.json populated by scheduled task.
 */

import { invokeLLM } from "../_core/llm";
import { instagramAnalytics } from "../../drizzle/schema";
import { desc, eq, gte, sql } from "drizzle-orm";
import { getInstagramPosts, getInstagramAccount } from "../instagram";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

// ─── TYPES ───────────────────────────────────────────────

export interface PostAnalysis {
  postId: string;
  postType: string;
  caption: string;
  likes: number;
  comments: number;
  engagementRate: number;
  postedAt: string;
  dayOfWeek: number;
  hourOfDay: number;
  contentScore: number;
  themes: string[];
}

export interface EngagementByType {
  type: string;
  postCount: number;
  avgLikes: number;
  avgComments: number;
  avgEngagementRate: number;
}

export interface BestPostingTime {
  dayOfWeek: number;
  dayName: string;
  hourOfDay: number;
  avgEngagement: number;
  postCount: number;
}

export interface FollowerGrowth {
  currentFollowers: number;
  snapshots: Array<{ date: string; followers: number }>;
  growthRate7d: number;
  growthRate30d: number;
  trend: "growing" | "declining" | "stable";
}

export interface ContentPerformanceReport {
  topPosts: PostAnalysis[];
  engagementByType: EngagementByType[];
  bestTimes: BestPostingTime[];
  followerGrowth: FollowerGrowth;
  recommendations: string[];
}

// ─── DAY NAMES ──────────────────────────────────────────

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ─── SYNC POSTS ─────────────────────────────────────────

/**
 * Sync Instagram posts from cache into analytics table with AI scoring.
 */
export async function syncInstagramPosts(): Promise<{
  processed: number;
  newPosts: number;
  errors: number;
}> {
  const d = await db();
  if (!d) throw new Error("Database not available");

  const posts = await getInstagramPosts(25); // Get up to 25 recent posts
  const account = await getInstagramAccount();
  const followers = account?.followers || 0;

  let newPosts = 0;
  let errors = 0;

  for (const post of posts) {
    try {
      // Check if already processed
      const existing = await d
        .select({ id: instagramAnalytics.id })
        .from(instagramAnalytics)
        .where(eq(instagramAnalytics.postId, post.id))
        .limit(1);

      if (existing.length > 0) continue;

      // Calculate engagement rate
      const totalEngagement = post.likes + post.comments;
      const engagementRate = followers > 0
        ? Math.round((totalEngagement / followers) * 10000) // Store as *10000
        : 0;

      // Parse posting time
      const postedDate = new Date(post.posted);
      const dayOfWeek = postedDate.getDay();
      const hourOfDay = postedDate.getHours();

      // AI content scoring
      const { score, themes } = await scoreContent(post.caption, post.type, post.likes, post.comments, followers);

      await d.insert(instagramAnalytics).values({
        postId: post.id,
        postType: post.type,
        caption: post.caption?.slice(0, 2000) || null,
        likes: post.likes,
        comments: post.comments,
        engagementRate,
        postedAt: post.posted,
        dayOfWeek,
        hourOfDay,
        contentScore: score,
        themesJson: JSON.stringify(themes),
        followerSnapshot: followers,
      });

      newPosts++;
    } catch (error) {
      console.error("[Instagram Pipeline] Error processing post:", error);
      errors++;
    }
  }

  return { processed: posts.length, newPosts, errors };
}

// ─── AI CONTENT SCORING ─────────────────────────────────

/**
 * Score a post's content quality and extract themes using AI.
 */
async function scoreContent(
  caption: string,
  type: string,
  likes: number,
  comments: number,
  followers: number,
): Promise<{ score: number; themes: string[] }> {
  if (!caption || caption.trim().length < 5) {
    return { score: 3, themes: ["no-caption"] };
  }

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a social media analyst for Nick's Tire & Auto, a Cleveland auto repair shop.
Score this Instagram post and extract themes. Return JSON with:
- score: 1-10 rating of content quality for a local auto shop (10 = excellent engagement potential)
  Consider: relevance to auto repair, call-to-action presence, local appeal, visual potential, customer engagement hooks
- themes: array of 1-3 content themes (e.g., "before-after", "customer-story", "promo", "team-spotlight", "educational", "behind-scenes", "seasonal", "community")

Scoring guide:
- 8-10: Strong CTA, customer story, before/after, local community tie-in
- 5-7: Decent content but missing engagement hooks or CTA
- 1-4: Generic, no CTA, off-brand, or too salesy`,
        },
        {
          role: "user",
          content: `Post type: ${type}\nCaption: ${caption.slice(0, 500)}\nLikes: ${likes}, Comments: ${comments}, Followers: ${followers}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "content_score",
          strict: true,
          schema: {
            type: "object",
            properties: {
              score: { type: "number", description: "Content quality score 1-10" },
              themes: { type: "array", items: { type: "string" }, description: "Content themes" },
            },
            required: ["score", "themes"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (content && typeof content === "string") {
      const parsed = JSON.parse(content);
      const score = typeof parsed.score === "number" ? Math.min(10, Math.max(1, Math.round(parsed.score))) : 5;
      const themes = Array.isArray(parsed.themes) ? parsed.themes.slice(0, 3) : [];
      return { score, themes };
    }
  } catch (error) {
    console.error("[Instagram Pipeline] Content scoring failed:", error);
  }

  return { score: 5, themes: [] };
}

// ─── ENGAGEMENT BY POST TYPE ────────────────────────────

/**
 * Get average engagement broken down by post type.
 */
export async function getEngagementByType(): Promise<EngagementByType[]> {
  const d = await db();
  if (!d) return [];

  const rows = await d
    .select({
      postType: instagramAnalytics.postType,
      postCount: sql<number>`COUNT(*)`,
      avgLikes: sql<number>`ROUND(AVG(${instagramAnalytics.likes}))`,
      avgComments: sql<number>`ROUND(AVG(${instagramAnalytics.comments}))`,
      avgEngagementRate: sql<number>`ROUND(AVG(${instagramAnalytics.engagementRate}))`,
    })
    .from(instagramAnalytics)
    .groupBy(instagramAnalytics.postType)
    .orderBy(sql`AVG(${instagramAnalytics.engagementRate}) DESC`);

  return rows.map((r: any) => ({
    type: r.postType || "UNKNOWN",
    postCount: Number(r.postCount),
    avgLikes: Number(r.avgLikes),
    avgComments: Number(r.avgComments),
    avgEngagementRate: Number(r.avgEngagementRate) / 100, // Convert from stored format to percentage
  }));
}

// ─── BEST POSTING TIMES ─────────────────────────────────

/**
 * Identify best posting times based on engagement data.
 */
export async function getBestPostingTimes(opts?: { limit?: number }): Promise<BestPostingTime[]> {
  const d = await db();
  if (!d) return [];

  const limit = opts?.limit ?? 10;

  const rows = await d
    .select({
      dayOfWeek: instagramAnalytics.dayOfWeek,
      hourOfDay: instagramAnalytics.hourOfDay,
      avgEngagement: sql<number>`ROUND(AVG(${instagramAnalytics.engagementRate}))`,
      postCount: sql<number>`COUNT(*)`,
    })
    .from(instagramAnalytics)
    .groupBy(instagramAnalytics.dayOfWeek, instagramAnalytics.hourOfDay)
    .having(sql`COUNT(*) >= 2`) // Need at least 2 posts to be meaningful
    .orderBy(sql`AVG(${instagramAnalytics.engagementRate}) DESC`)
    .limit(limit);

  return rows.map((r: any) => ({
    dayOfWeek: Number(r.dayOfWeek),
    dayName: DAY_NAMES[Number(r.dayOfWeek)] || "Unknown",
    hourOfDay: Number(r.hourOfDay),
    avgEngagement: Number(r.avgEngagement) / 100,
    postCount: Number(r.postCount),
  }));
}

// ─── FOLLOWER GROWTH ────────────────────────────────────

/**
 * Track follower growth using snapshots stored with each post analysis.
 */
export async function getFollowerGrowth(): Promise<FollowerGrowth> {
  const d = await db();
  const account = await getInstagramAccount();
  const currentFollowers = account?.followers || 0;

  if (!d) return { currentFollowers, snapshots: [], growthRate7d: 0, growthRate30d: 0, trend: "stable" };

  // Get follower snapshots over time (one per day, from post analyses)
  const snapshots = await d
    .select({
      date: sql<string>`DATE(${instagramAnalytics.createdAt})`,
      followers: sql<number>`MAX(${instagramAnalytics.followerSnapshot})`,
    })
    .from(instagramAnalytics)
    .where(gte(instagramAnalytics.createdAt, new Date(Date.now() - 90 * 86400000)))
    .groupBy(sql`DATE(${instagramAnalytics.createdAt})`)
    .orderBy(sql`DATE(${instagramAnalytics.createdAt}) DESC`)
    .limit(90);

  if (snapshots.length < 2) {
    return { currentFollowers, snapshots: [], growthRate7d: 0, growthRate30d: 0, trend: "stable" };
  }

  const snapshotData = snapshots.map((s: any) => ({
    date: String(s.date),
    followers: Number(s.followers),
  }));

  // Calculate growth rates
  const latest = snapshotData[0]?.followers || currentFollowers;
  const sevenDaysAgo = snapshotData.find((_: any, i: any) => i >= 6)?.followers || latest;
  const thirtyDaysAgo = snapshotData.find((_: any, i: any) => i >= 29)?.followers || latest;

  const growthRate7d = sevenDaysAgo > 0
    ? Math.round(((latest - sevenDaysAgo) / sevenDaysAgo) * 10000) / 100
    : 0;

  const growthRate30d = thirtyDaysAgo > 0
    ? Math.round(((latest - thirtyDaysAgo) / thirtyDaysAgo) * 10000) / 100
    : 0;

  const trend: "growing" | "declining" | "stable" =
    growthRate30d > 1 ? "growing" : growthRate30d < -1 ? "declining" : "stable";

  return {
    currentFollowers,
    snapshots: snapshotData.slice(0, 30),
    growthRate7d,
    growthRate30d,
    trend,
  };
}

// ─── TOP POSTS ──────────────────────────────────────────

/**
 * Get top-performing posts by engagement rate.
 */
export async function getTopPosts(opts?: { limit?: number }): Promise<PostAnalysis[]> {
  const d = await db();
  if (!d) return [];

  const rows = await d
    .select()
    .from(instagramAnalytics)
    .orderBy(desc(instagramAnalytics.engagementRate))
    .limit(opts?.limit ?? 10);

  return rows.map((r: any) => ({
    postId: r.postId,
    postType: r.postType || "UNKNOWN",
    caption: r.caption || "",
    likes: r.likes,
    comments: r.comments,
    engagementRate: r.engagementRate / 100,
    postedAt: r.postedAt || "",
    dayOfWeek: r.dayOfWeek || 0,
    hourOfDay: r.hourOfDay || 0,
    contentScore: r.contentScore || 0,
    themes: r.themesJson ? (() => { try { return JSON.parse(r.themesJson); } catch (e) { console.warn("[pipelines/instagram-data] operation failed:", e); return []; } })() : [],
  }));
}

// ─── FULL PIPELINE ──────────────────────────────────────

/**
 * Run the full Instagram analytics pipeline.
 */
export async function runInstagramPipeline(): Promise<{
  sync: { processed: number; newPosts: number; errors: number };
  followerGrowth: FollowerGrowth;
  topPostType: string | null;
}> {
  const sync = await syncInstagramPosts();
  const followerGrowth = await getFollowerGrowth();

  // Determine top-performing post type
  const byType = await getEngagementByType();
  const topPostType = byType.length > 0 ? byType[0].type : null;

  return { sync, followerGrowth, topPostType };
}

/**
 * Generate a full content performance report with AI recommendations.
 */
export async function generatePerformanceReport(): Promise<ContentPerformanceReport> {
  const [topPosts, engagementByType, bestTimes, followerGrowth] = await Promise.all([
    getTopPosts({ limit: 5 }),
    getEngagementByType(),
    getBestPostingTimes({ limit: 5 }),
    getFollowerGrowth(),
  ]);

  // Generate AI recommendations based on the data
  let recommendations: string[] = [];
  try {
    const dataContext = JSON.stringify({
      topPostThemes: topPosts.flatMap(p => p.themes),
      bestType: engagementByType[0]?.type || "unknown",
      bestDay: bestTimes[0]?.dayName || "unknown",
      bestHour: bestTimes[0]?.hourOfDay ?? "unknown",
      followerTrend: followerGrowth.trend,
      avgScores: topPosts.map(p => p.contentScore),
    });

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a social media strategist for Nick's Tire & Auto, a Cleveland auto repair shop.
Based on the Instagram analytics data, provide 3-5 specific, actionable recommendations.
Return JSON with a "recommendations" array of strings.
Focus on: posting frequency, content types, timing, engagement tactics, and content themes that work.`,
        },
        { role: "user", content: `Instagram analytics summary:\n${dataContext}` },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ig_recommendations",
          strict: true,
          schema: {
            type: "object",
            properties: {
              recommendations: { type: "array", items: { type: "string" } },
            },
            required: ["recommendations"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (content && typeof content === "string") {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed.recommendations)) {
        recommendations = parsed.recommendations.slice(0, 5);
      }
    }
  } catch (error) {
    console.error("[Instagram Pipeline] Recommendation generation failed:", error);
    recommendations = ["Unable to generate recommendations. Check pipeline logs."];
  }

  return {
    topPosts,
    engagementByType,
    bestTimes,
    followerGrowth,
    recommendations,
  };
}
