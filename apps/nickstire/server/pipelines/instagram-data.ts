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
import { instagramAnalytics, igMetricSnapshots, igAutopostLog } from "../../drizzle/schema";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getInstagramPosts, getInstagramAccount } from "../instagram";

import { db } from "../lib/db-helper";

import { createLogger } from "../lib/logger";

const log = createLogger("pipelines:instagram-data");
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
  /** Live Graph insights — null until captured for that post. Null is UNKNOWN, never zero. */
  reach: number | null;
  saved: number | null;
  views: number | null;
  shares: number | null;
  /** Graph media_product_type (REELS/FEED/…) — null until captured. */
  mediaProductType: string | null;
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
  /**
   * Why `recommendations` is empty, or null when it is empty for the honest
   * reason (nothing to say).
   *
   * The LLM failure used to be CAUGHT here and returned as
   * `recommendations: ["Unable to generate recommendations. Check pipeline
   * logs."]` — a successful HTTP 200 whose payload rendered a pipeline error as
   * a bullet in a list titled "Evidence-based recommendations". The client could
   * not tell failure from advice: `isError` was never true, so its unavailable
   * branch was unreachable for the failure that actually happens.
   */
  recommendationsError: string | null;
}

// ─── DAY NAMES ──────────────────────────────────────────

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ─── SYNC POSTS ─────────────────────────────────────────

/**
 * Sync Instagram posts into the analytics table with AI scoring.
 *
 * Source order: live Graph first (media list + account profile), the JSON
 * cache as fallback. Until 2026-07 this read ONLY instagram-cache.json — a
 * file whose sole writer was archived — so the loop below processed zero rows
 * on every run while the endpoint reported success. The returned `source`
 * makes that failure mode visible instead of silent: "none" means the
 * pipeline is starved and every downstream analytics read is empty.
 *
 * After a successful Graph fetch the cache file is refreshed (best-effort) so
 * the cache readers — admin live feed, account header — heal for free.
 *
 * Metrics are written ONLY from live Graph data (F10, 2026-09-29). The fallback
 * `getInstagramPosts` is either the file cache (a copy of an earlier Graph read)
 * or, on a fresh container with no cache file, stand-in posts built from
 * social_content_inventory with 0 likes/comments and inventory ids as post ids.
 * Syncing those inserted fake analytics rows, appended copies to the snapshot
 * history, and zeroed engagementRate/followerSnapshot on every tracked post.
 * A non-Graph run now reports its source and writes nothing.
 */
export async function syncInstagramPosts(): Promise<{
  processed: number;
  newPosts: number;
  errors: number;
  source: "graph" | "cache" | "none";
  /** Append-only history rows written this sync — 0 with errors>0 means the snapshot lane is failing, not idle. */
  snapshotsWritten: number;
  snapshotErrors: number;
  /** Facebook cross-post insights (Wave C): rows written as `fb:<postId>` into ig_metric_snapshots. */
  fbSnapshotsWritten: number;
  fbErrors: number;
}> {
  const d = await db();
  if (!d) throw new Error("Database not available");

  const { fetchInstagramMedia, fetchInstagramAccountProfile } = await import("../services/metaSocial");
  const liveMedia = await fetchInstagramMedia(25);
  const liveAccount = liveMedia.ok ? await fetchInstagramAccountProfile() : { ok: false as const, error: "skipped" };

  const posts = liveMedia.ok ? liveMedia.posts : await getInstagramPosts(25);
  const account = liveAccount.ok ? liveAccount.account : await getInstagramAccount();
  const source: "graph" | "cache" | "none" = liveMedia.ok ? "graph" : posts.length > 0 ? "cache" : "none";

  if (source === "none") {
    log.error(
      `[Instagram Pipeline] STARVED: Graph unavailable (${liveMedia.ok ? "" : liveMedia.error}) and the JSON cache is empty/absent — 0 posts to sync; analytics reads will be empty`,
    );
  }
  if (source === "cache") {
    log.error(
      `[Instagram Pipeline] Graph unavailable (${liveMedia.ok ? "" : liveMedia.error}) — ${posts.length} fallback posts NOT synced: fallback rows are copies or stand-ins, not observations; analytics unchanged this run`,
    );
  }
  if (source !== "graph") {
    return { processed: 0, newPosts: 0, errors: 0, source, snapshotsWritten: 0, snapshotErrors: 0, fbSnapshotsWritten: 0, fbErrors: 0 };
  }

  const { writeInstagramCache } = await import("../instagram");
  await writeInstagramCache(posts, account); // best-effort; logs on failure

  // Unknown is never zero: only a live profile read counts as a follower
  // observation. Without one, engagementRate/followerSnapshot are left alone
  // on tracked rows and new posts wait for a run that can compute a real rate.
  const followers: number | null = liveAccount.ok && liveAccount.account.followers > 0 ? liveAccount.account.followers : null;
  if (followers === null) {
    log.error(
      `[Instagram Pipeline] follower count unknown (${liveAccount.ok ? "profile reported 0" : liveAccount.error}) — engagement rates not refreshed and new posts deferred this run`,
    );
  }

  let newPosts = 0;
  let errors = 0;
  let snapshotsWritten = 0;
  let snapshotErrors = 0;
  // Only refresh live insights for posts whose metrics are still moving — older
  // posts are stable, so skipping them keeps Graph calls well under rate limits.
  const INSIGHTS_REFRESH_DAYS = 14;

  for (const post of posts) {
    try {
      const existing = await d
        .select({ id: instagramAnalytics.id })
        .from(instagramAnalytics)
        .where(eq(instagramAnalytics.postId, post.id))
        .limit(1);

      // Calculate engagement rate
      const totalEngagement = post.likes + post.comments;
      const engagementRate = followers !== null
        ? Math.round((totalEngagement / followers) * 10000) // Store as *10000
        : null;

      // Live Graph insights — real reach/saved/views/shares — but only while the
      // post is recent enough that its metrics still move; older posts skip the
      // call to stay under the Graph per-token rate limit. Never throws; on error
      // metricCols stays empty so the row keeps its prior values.
      const postedDate = new Date(post.posted);
      const ageDays = (Date.now() - postedDate.getTime()) / 86_400_000;
      const { getMediaInsights } = await import("../services/metaSocial");
      const insights = Number.isFinite(ageDays) && ageDays <= INSIGHTS_REFRESH_DAYS
        ? await getMediaInsights(post.id)
        : { ok: false as const };
      // avgWatchTimeMs/skipRate are REELS-ONLY and absent for images — they stay
      // null rather than 0, because "Instagram did not report this" and "nobody
      // watched" are different facts and a DISCOVERY score built on the latter
      // would be fabricated.
      const metricCols: {
        reach?: number | null; saved?: number | null; views?: number | null; shares?: number | null;
        avgWatchTimeMs?: number | null; skipRate?: string | null;
      } =
        insights.ok
          ? {
              reach: insights.reach ?? null,
              saved: insights.saved ?? null,
              views: insights.views ?? null,
              shares: insights.shares ?? null,
              avgWatchTimeMs: insights.avgWatchTimeMs ?? null,
              skipRate: insights.skipRate === undefined ? null : String(insights.skipRate),
            }
          : {};

      // Append-only history (Wave C substrate): one row per post per sync tick.
      // 24h/7d/30d windows need what the numbers WERE; the analytics row only
      // knows what they ARE. A snapshot failure degrades history and is counted
      // LOUDLY in the result — it never aborts the sync itself.
      const writeSnapshot = async () => {
        try {
          await d.insert(igMetricSnapshots).values({
            postId: post.id,
            likes: post.likes,
            comments: post.comments,
            reach: metricCols.reach ?? null,
            saved: metricCols.saved ?? null,
            views: metricCols.views ?? null,
            shares: metricCols.shares ?? null,
            avgWatchTimeMs: metricCols.avgWatchTimeMs ?? null,
            skipRate: metricCols.skipRate ?? null,
            followerSnapshot: followers,
          });
          snapshotsWritten++;
        } catch (snapErr) {
          snapshotErrors++;
          if (snapshotErrors === 1) {
            log.warn("[Instagram Pipeline] metric-snapshot insert failed (history degrades; sync continues):", snapErr);
          }
        }
      };

      // Already tracked: refresh the live-growing metrics (don't re-score — that's
      // an LLM call, and the AI content score doesn't change after publish).
      if (existing.length > 0) {
        await d
          .update(instagramAnalytics)
          .set({
            likes: post.likes,
            comments: post.comments,
            ...(engagementRate !== null ? { engagementRate, followerSnapshot: followers } : {}),
            ...metricCols,
            // Never clobber a known product type with null when Graph omits it.
            ...(post.mediaProductType ? { mediaProductType: post.mediaProductType } : {}),
          })
          .where(eq(instagramAnalytics.id, existing[0].id));
        await writeSnapshot();
        continue;
      }

      // engagementRate is NOT NULL: inserting now would store a fabricated 0.
      if (engagementRate === null || followers === null) continue;

      // Parse posting time in ET (the business timezone) — getDay()/getHours() use
      // the server's UTC clock, which would shift the best-hour cadence (Phase 5.3
      // feeds hourOfDay into the ET-based posting cron) and skew the analytics.
      const hourOfDay = parseInt(postedDate.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }), 10) || 0;
      const dayOfWeek = Math.max(
        0,
        ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
          postedDate.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short" }),
        ),
      );

      // AI content scoring (new posts only)
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
        ...metricCols,
        mediaProductType: post.mediaProductType ?? null,
      });
      await writeSnapshot();

      newPosts++;
    } catch (error) {
      log.error("[Instagram Pipeline] Error processing post:", error);
      errors++;
    }
  }

  if (posts.length > 0 && snapshotsWritten === 0) {
    // 0-written over a non-empty sync is the silent-IDLE class — say it loudly.
    log.error(`[Instagram Pipeline] snapshot lane wrote NOTHING across ${posts.length} posts (${snapshotErrors} errors) — history is not accruing`);
  }

  // Facebook cross-posts: the SAME token, a different Graph node. Runs after the
  // IG loop so an FB failure can never cost an IG row; its own counters keep it
  // from hiding inside the IG ones.
  const fb = await syncFacebookPostInsights(d);

  return { processed: posts.length, newPosts, errors, source, snapshotsWritten, snapshotErrors, fbSnapshotsWritten: fb.written, fbErrors: fb.errors };
}

/** Prefix that keeps Facebook ids apart from IG media ids in the shared snapshot table. */
export const FB_SNAPSHOT_PREFIX = "fb:";

/**
 * Facebook post insights → ig_metric_snapshots (Wave C "Facebook branch").
 *
 * WHY THIS TABLE, STATED PLAINLY: there is no Facebook metrics table and no
 * schema change in this wave. `ig_metric_snapshots.postId` is varchar(100)
 * and carries no platform column, so FB rows are written with the `fb:`
 * prefix — the IG readers (instagramAdminStrategy, reelStructurePrior,
 * contentExperimentStore) all select by `inArray(postId, <IG ids>)`, so a
 * prefixed id never joins into an IG read. Column mapping, native units:
 *   likes    ← post_reactions_by_type_total (sum)   comments ← NOT available
 *   reach    ← post_impressions_unique              views    ← post_video_views
 *   saved    ← NULL (Facebook has no save metric)   shares   ← NULL (not on the ladder)
 * `comments`/`likes` are NOT NULL in the table; a row is written only when the
 * reactions sum is reported (comments stays 0 and is documented here as
 * UNOBSERVED for FB rows — the Graph post object, not /insights, carries it
 * and that read is deliberately out of this slice).
 *
 * Source rows: ig_autopost_log entries with a live fbPostId (`status='posted'`)
 * from the last INSIGHTS_REFRESH_DAYS, same window as the IG refresh.
 */
export async function syncFacebookPostInsights(d: Awaited<ReturnType<typeof db>>): Promise<{ written: number; errors: number; candidates: number }> {
  if (!d) return { written: 0, errors: 0, candidates: 0 };
  const FB_REFRESH_DAYS = 14;
  let written = 0;
  let errors = 0;
  let rows: Array<{ fbPostId: string | null; createdAt: Date | string | null }> = [];
  try {
    const since = new Date(Date.now() - FB_REFRESH_DAYS * 86_400_000);
    rows = await d
      .select({ fbPostId: igAutopostLog.fbPostId, createdAt: igAutopostLog.createdAt })
      .from(igAutopostLog)
      .where(and(isNotNull(igAutopostLog.fbPostId), eq(igAutopostLog.status, "posted"), gte(igAutopostLog.createdAt, since)))
      .orderBy(desc(igAutopostLog.createdAt))
      .limit(50);
  } catch (err) {
    log.warn("[Instagram Pipeline] FB candidate read failed — FB insights skipped this run", { err: err instanceof Error ? err.message : String(err) });
    return { written: 0, errors: 1, candidates: 0 };
  }
  const ids = Array.from(new Set(rows.map((r) => r.fbPostId).filter((x): x is string => !!x)));
  if (ids.length === 0) return { written: 0, errors: 0, candidates: 0 };

  const { fetchFacebookPostInsights } = await import("../services/metaSocial");
  for (const fbPostId of ids) {
    try {
      const ins = await fetchFacebookPostInsights(fbPostId);
      if (!ins.ok) { errors++; continue; }
      if (ins.reactions === undefined) {
        // likes is NOT NULL — without a reactions count the row would store a
        // fabricated 0. Count it, do not write it.
        errors++;
        log.warn("[Instagram Pipeline] FB insights without reactions — snapshot skipped", { fbPostId, rung: ins.rung });
        continue;
      }
      await d.insert(igMetricSnapshots).values({
        postId: `${FB_SNAPSHOT_PREFIX}${fbPostId}`.slice(0, 100),
        likes: ins.reactions,
        comments: 0,
        reach: ins.reach ?? null,
        saved: null,
        views: ins.videoViews ?? null,
        shares: null,
        avgWatchTimeMs: null,
        skipRate: null,
        followerSnapshot: null,
      });
      written++;
    } catch (err) {
      errors++;
      if (errors === 1) log.warn("[Instagram Pipeline] FB snapshot write failed (continuing):", err);
    }
  }
  if (ids.length > 0 && written === 0) {
    log.error(`[Instagram Pipeline] FB snapshot lane wrote NOTHING across ${ids.length} cross-posts (${errors} errors)`);
  }
  return { written, errors, candidates: ids.length };
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
    log.error("[Instagram Pipeline] Content scoring failed:", error);
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

// ─── REEL GENERATION SIGNAL (Phase 5.4 feedback loop) ───

/** Pure: the most-frequent AI-tagged themes across rows (highest-engagement first). */
/** How many joined posts to consider. 60 covers ~6 months at this cadence. */
const DISTRIBUTION_SAMPLE_LIMIT = 60;

/** Tolerant themesJson parse, shared by both ranking paths. */
function parseThemes(themesJson?: string | null): string[] {
  try {
    const t = JSON.parse(themesJson || "[]");
    return Array.isArray(t) ? t.map(String) : [];
  } catch {
    return [];
  }
}

export function pickTopThemes(rows: Array<{ themesJson?: string | null }>, limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    let themes: unknown = [];
    try {
      themes = JSON.parse(r.themesJson || "[]");
    } catch {
      themes = [];
    }
    for (const t of Array.isArray(themes) ? themes : []) {
      const k = String(t).trim().toLowerCase();
      if (k && k !== "no-caption") counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t);
}

/**
 * What's working, fed back into reel generation/cadence. topThemes = most frequent
 * themes among the highest-engagement posts; bestPostHour = the top posting slot's
 * hour (getBestPostingTimes needs >=2 posts/slot, so this is null until data
 * accumulates). Graceful: empty themes + null hour → generation/cadence keep their
 * defaults with ZERO behavior change until the analytics table fills.
 *
 * NT-002 (flagged 2026-07-31, fixed 2026-08-13): this ranked the top 8 posts by
 * engagementRate with NO media filter — measured 5/8 of the "reel" training
 * signal was carousels/images, whose winning behaviors (saves) are the wrong
 * objective for reels (sends/watch-time). Now REELS-first: rank reels only,
 * and only when fewer than MIN_REEL_SIGNAL_ROWS reels exist fall back to
 * all-media — DISCLOSED via signalSource so a caller/log can tell a reel-taught
 * brief from a carousel-taught one. mediaProductType is null on pre-0106 rows;
 * those are not reels-confirmed, so they only participate in the fallback.
 */
export const MIN_REEL_SIGNAL_ROWS = 4;

export async function getReelGenerationSignal(): Promise<{
  topThemes: string[];
  bestPostHour: number | null;
  signalSource: "reels" | "all_media" | "none" | "distribution";
  /** Set when ranking used ig_metric_snapshots rather than engagementRate. */
  distributionBasis?: string[];
}> {
  // Preferred path: rank by what actually earned DISTRIBUTION — saves, shares,
  // retention — from ig_metric_snapshots. `engagementRate` below is
  // (likes + comments) / followers, which on Reels mostly measures the audience
  // Instagram ALREADY delivered to; it answers "what did our followers react
  // to" when the question is "what gets pushed to strangers". The richer
  // metrics have been collected since migration 0108 and nothing ranked on
  // them. Falls through to the legacy ordering when too few posts carry them,
  // and SAYS which it used rather than hiding the difference.
  try {
    const distribution = await getDistributionRankedThemes();
    if (distribution.themes.length) {
      const times = await getBestPostingTimes({ limit: 1 });
      return {
        topThemes: distribution.themes,
        bestPostHour: times.length && Number.isFinite(times[0].hourOfDay) ? times[0].hourOfDay : null,
        signalSource: "distribution",
        distributionBasis: distribution.basis,
      };
    }
    log.info("distribution signal unavailable, falling back to engagementRate ordering", {
      reason: distribution.reason,
    });
  } catch (err) {
    log.warn("distribution signal threw, falling back to engagementRate ordering", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return getEngagementRateSignal();
}

/**
 * Join instagram_analytics (themes) to ig_metric_snapshots (real metrics) on
 * postId, newest snapshot per post, and rank with the pure scorer.
 */
async function getDistributionRankedThemes(): Promise<{
  themes: string[];
  basis: string[];
  reason?: string;
}> {
  const d = await db();
  if (!d) return { themes: [], basis: [], reason: "no_db" };

  const { rankThemesByDistribution } = await import("@shared/reelPerformancePrior");

  // ONE ROW PER POST, via a WINDOW FUNCTION over a derived table — NOT a
  // subquery in the ON clause. TiDB rejects that outright:
  // "ON condition doesn't support subqueries yet" (ER 1105). Caught by running
  // it against prod rather than trusting it to parse; the catch below would
  // otherwise have swallowed the error and silently reverted this whole path to
  // the engagementRate ordering it exists to replace.
  //
  // `ig_metric_snapshots` is APPEND-ONLY — the sync writes a
  // new row for a post every time it refreshes, so a naive join plus a global
  // "newest 60" returns the same Reel many times. Two consequences, both
  // corrupting: a single post refreshed twice satisfies MIN_POSTS_PER_THEME on
  // its own, and frequently-refreshed recent posts crowd older distinct posts
  // out of the sample entirely. Deduplicate to each post's LATEST snapshot
  // before the limit applies, so the sample is 60 posts and not 60 rows.
  const rows = await d.execute(sql`
    SELECT a.themesJson         AS themesJson,
           m.reach              AS reach,
           m.saved              AS saved,
           m.views              AS views,
           m.shares             AS shares,
           m.avg_watch_time_ms  AS avgWatchTimeMs,
           m.skip_rate          AS skipRate
    FROM instagram_analytics a
    JOIN (
      SELECT s.*,
             ROW_NUMBER() OVER (PARTITION BY s.postId ORDER BY s.capturedAt DESC, s.id DESC) AS rn
      FROM ig_metric_snapshots s
    ) m ON m.postId = a.postId AND m.rn = 1
    WHERE a.mediaProductType = 'REELS'
    ORDER BY m.capturedAt DESC
    LIMIT ${DISTRIBUTION_SAMPLE_LIMIT}
  `);

  // mysql2 returns [rows, fields]; drizzle's execute passes that through.
  const joined = (Array.isArray(rows) ? rows[0] : rows) as unknown[];
  if (!Array.isArray(joined) || joined.length === 0) {
    return { themes: [], basis: [], reason: "no_joined_rows" };
  }

  // Explicit row type: the innerJoin widens drizzle's inference enough that `r`
  // lands as implicit any, and an untyped mapper here would silently pass
  // undefined into the scorer.
  type JoinedRow = {
    themesJson: string | null;
    reach: number | null;
    saved: number | null;
    views: number | null;
    shares: number | null;
    avgWatchTimeMs: number | null;
    skipRate: string | null;
  };

  const scored = rankThemesByDistribution(
    (joined as JoinedRow[]).map((r) => ({
      themes: parseThemes(r.themesJson),
      reach: r.reach,
      saved: r.saved,
      views: r.views,
      shares: r.shares,
      avgWatchTimeMs: r.avgWatchTimeMs,
      // decimal comes back as a string from mysql2
      skipRate: r.skipRate == null ? null : Number(r.skipRate),
    })),
  );
  if (scored.length === 0) return { themes: [], basis: [], reason: "no_theme_met_minimum" };

  return {
    themes: scored.map((t) => t.theme),
    basis: [...new Set(scored.flatMap((t) => t.basis))],
  };
}

/** Legacy ordering, kept as the fallback. See the note in the caller. */
async function getEngagementRateSignal(): Promise<{
  topThemes: string[];
  bestPostHour: number | null;
  signalSource: "reels" | "all_media" | "none";
}> {
  try {
    const d = await db();
    if (!d) return { topThemes: [], bestPostHour: null, signalSource: "none" };
    let rows: Array<{ themesJson?: string | null }> = await d
      .select({ themesJson: instagramAnalytics.themesJson })
      .from(instagramAnalytics)
      .where(eq(instagramAnalytics.mediaProductType, "REELS"))
      .orderBy(desc(instagramAnalytics.engagementRate))
      .limit(8);
    let signalSource: "reels" | "all_media" = "reels";
    if (rows.length < MIN_REEL_SIGNAL_ROWS) {
      const reelRows = rows.length;
      rows = await d
        .select({ themesJson: instagramAnalytics.themesJson })
        .from(instagramAnalytics)
        .orderBy(desc(instagramAnalytics.engagementRate))
        .limit(8);
      signalSource = "all_media";
      log.info("reel generation signal falling back to all-media (too few reel rows)", { reelRows });
    }
    const topThemes = pickTopThemes(rows);
    const times = await getBestPostingTimes({ limit: 1 });
    const bestPostHour = times.length && Number.isFinite(times[0].hourOfDay) ? times[0].hourOfDay : null;
    return { topThemes, bestPostHour, signalSource };
  } catch (err) {
    log.warn("reel generation signal unavailable", { err: err instanceof Error ? err.message : String(err) });
    return { topThemes: [], bestPostHour: null, signalSource: "none" };
  }
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

  // Raw SQL, deliberately, so the grouped expression is byte-identical in all
  // three clauses.
  //
  // The Drizzle builder emitted an UNQUALIFIED `DATE(\`createdAt\`)` in the
  // SELECT list but a TABLE-QUALIFIED `DATE(\`instagram_analytics\`.\`createdAt\`)`
  // in the GROUP BY. Production runs with only_full_group_by, which compares
  // those expressions textually, does not match them, and REJECTS the
  // statement. getFollowerGrowth therefore threw on every single call.
  //
  // It is awaited inside runInstagramPipeline() and sits in the Promise.all of
  // both instagramAdmin.getAnalytics and getPerformanceReport — so this one
  // mismatch took down the entire admin Learn tab (top posts, best posting
  // times, follower growth, AI recommendations) and kept the IG analytics
  // pipeline permanently red. The 2,791-test suite passes with it fully broken.
  // Column names here are camelCase IN THE DATABASE (`createdAt`,
  // `followerSnapshot`) — this table does not follow the snake_case convention
  // that cron_log and alg_estimates use. Verified against drizzle/schema.ts:2977.
  const [snapshotRows] = await d.execute(sql`
    SELECT DATE(createdAt) AS date, MAX(followerSnapshot) AS followers
    FROM instagram_analytics
    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    GROUP BY DATE(createdAt)
    ORDER BY DATE(createdAt) DESC
    LIMIT 90
  `);
  const snapshots = (snapshotRows as Array<Record<string, unknown>>).map((r) => ({
    date: String(r.date),
    followers: Number(r.followers ?? 0),
  }));

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
    themes: r.themesJson ? (() => { try { return JSON.parse(r.themesJson); } catch (e) { log.warn("[pipelines/instagram-data] operation failed:", e); return []; } })() : [],
    // The sync loop has stored these since the live-Graph wave; the reader
    // dropped them on the floor, so Learn could never show saves or reach.
    // `?? null` keeps "never captured" distinct from a real zero.
    reach: r.reach ?? null,
    saved: r.saved ?? null,
    views: r.views ?? null,
    shares: r.shares ?? null,
    mediaProductType: r.mediaProductType ?? null,
  }));
}

/**
 * Account-wide averages over EVERY stored analytics row (Wave 7). The Learn
 * screen's headline stats previously averaged only getTopPosts(5) — an
 * average of winners presented as the account's baseline. null = the table
 * could not be read (unknown, never zero).
 */
export async function getAccountAverages(): Promise<{
  postCount: number;
  avgEngagementRate: number | null;
  avgContentScore: number | null;
  scoredCount: number;
} | null> {
  const d = await db();
  if (!d) return null;
  const rows = await d
    .select({ engagementRate: instagramAnalytics.engagementRate, contentScore: instagramAnalytics.contentScore })
    .from(instagramAnalytics);
  type AvgRow = { engagementRate: number | null; contentScore: number | null };
  const typedRows = rows as AvgRow[];
  const postCount = typedRows.length;
  if (postCount === 0) return { postCount: 0, avgEngagementRate: null, avgContentScore: null, scoredCount: 0 };
  const avgEngagementRate = typedRows.reduce((sum: number, r: AvgRow) => sum + (r.engagementRate ?? 0), 0) / postCount / 100;
  const scored = typedRows.filter((r: AvgRow) => (r.contentScore ?? 0) > 0);
  const avgContentScore = scored.length
    ? Math.round(scored.reduce((sum: number, r: AvgRow) => sum + (r.contentScore ?? 0), 0) / scored.length)
    : null;
  return { postCount, avgEngagementRate, avgContentScore, scoredCount: scored.length };
}

// ─── FULL PIPELINE ──────────────────────────────────────

/**
 * Run the full Instagram analytics pipeline.
 */
export async function runInstagramPipeline(): Promise<{
  sync: { processed: number; newPosts: number; errors: number };
  followerGrowth: FollowerGrowth;
  topPostType: string | null;
  deliveredQa: { checked: number; issues: number; unmeasured: number; jobs: string[] } | { error: string };
}> {
  const sync = await syncInstagramPosts();
  const followerGrowth = await getFollowerGrowth();

  // Determine top-performing post type
  const byType = await getEngagementByType();
  const topPostType = byType.length > 0 ? byType[0].type : null;

  // QA on the copy Instagram delivers, for Reels posted since the last pass
  // (services/deliveredReelQa.ts). Bounded to two Reels; its failure is
  // reported in the result, never allowed to fail the analytics sync.
  let deliveredQa: { checked: number; issues: number; unmeasured: number; jobs: string[] } | { error: string };
  try {
    const { runDeliveredReelQaPass } = await import("../services/deliveredReelQa");
    const d = await db();
    deliveredQa = d ? await runDeliveredReelQaPass(d) : { error: "no database" };
  } catch (err) {
    deliveredQa = { error: err instanceof Error ? err.message.slice(0, 200) : String(err) };
  }

  return { sync, followerGrowth, topPostType, deliveredQa };
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
  let recommendationsError: string | null = null;
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
    log.error("[Instagram Pipeline] Recommendation generation failed:", error);
    // Report the failure AS a failure. Leaving the array empty and naming the
    // cause lets the surface distinguish "the model could not answer" from "the
    // model had nothing to add" — previously identical to the operator.
    recommendations = [];
    recommendationsError = error instanceof Error ? error.message : String(error);
  }

  return {
    topPosts,
    engagementByType,
    bestTimes,
    followerGrowth,
    recommendations,
    recommendationsError,
  };
}
