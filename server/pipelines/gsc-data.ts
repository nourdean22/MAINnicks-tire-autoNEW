/**
 * GSC Data Pipeline — Google Search Console performance data.
 *
 * Fetches search query performance (clicks, impressions, CTR, position)
 * and stores it in the `search_performance` table for trend analysis.
 *
 * Upgraded capabilities:
 * 1. Query clustering — group similar queries into themes
 * 2. Position tracking — detect ranking jumps and drops
 * 3. CTR optimization — flag high-impression/low-CTR opportunities
 * 4. Cannibalization detection — multiple pages ranking for same query
 * 5. Seasonal pattern detection — compare to prior periods
 *
 * Requires a Google Service Account with Search Console API access.
 * Env vars needed: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY
 */

import { invokeLLM } from "../_core/llm";
import { searchPerformance } from "../../drizzle/schema";
import { desc, eq, gte, lte, sql, and } from "drizzle-orm";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

// ─── TYPES ───────────────────────────────────────────────

export interface SearchPerformanceRow {
  query: string;
  page?: string;
  clicks: number;
  impressions: number;
  ctr: number;    // percentage (e.g. 5.5)
  position: number; // average position (e.g. 3.2)
  date: string;   // YYYY-MM-DD
}

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export interface QueryCluster {
  theme: string;
  queries: string[];
  totalClicks: number;
  totalImpressions: number;
  avgPosition: number;
}

export interface RankingChange {
  query: string;
  page: string;
  previousPosition: number;
  currentPosition: number;
  delta: number;
  direction: "improved" | "dropped";
}

export interface CtrOpportunity {
  query: string;
  page: string;
  impressions: number;
  currentCtr: number;
  avgPosition: number;
  suggestedAction: string;
}

export interface CannibalizationIssue {
  query: string;
  pages: Array<{ page: string; clicks: number; impressions: number; position: number }>;
  recommendation: string;
}

export interface SeasonalComparison {
  query: string;
  currentClicks: number;
  previousClicks: number;
  changePercent: number;
  trend: "up" | "down" | "stable";
}

// ─── GSC API CLIENT ──────────────────────────────────────

const GSC_SITE_URL = "sc-domain:nickstire.org";

/**
 * Check if GSC API credentials are configured.
 */
function hasGscCredentials(): boolean {
  return !!(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  );
}

/**
 * Get a Google API access token using service account JWT.
 */
async function getAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");

  if (!email || !privateKey) {
    throw new Error("GSC service account credentials not configured");
  }

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).toString("base64url");

  const crypto = await import("crypto");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(privateKey, "base64url");

  const jwt = `${header}.${claims}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GSC token exchange failed: ${response.status} ${error}`);
  }

  const data = await response.json() as { access_token: string };
  return data.access_token;
}

// ─── FETCH FUNCTIONS ─────────────────────────────────────

/**
 * Fetch search performance data from Google Search Console API.
 */
export async function fetchSearchPerformance(
  dateRange: DateRange,
): Promise<SearchPerformanceRow[]> {
  if (!hasGscCredentials()) {
    console.warn("[GSC Pipeline] Service account credentials not configured — skipping fetch");
    return [];
  }

  try {
    const token = await getAccessToken();

    const response = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE_URL)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          dimensions: ["query", "page", "date"],
          rowLimit: 1000,
        }),
        signal: AbortSignal.timeout(30000),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GSC API failed: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      rows?: Array<{
        keys: string[];
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
      }>;
    };

    return (data.rows || []).map((row) => ({
      query: row.keys[0],
      page: row.keys[1],
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: Math.round(row.ctr * 10000), // 0.055 -> 550 (5.5%)
      position: Math.round(row.position * 100), // 3.2 -> 320
      date: row.keys[2],
    }));
  } catch (error) {
    console.error("[GSC Pipeline] Fetch failed:", error);
    return [];
  }
}

/**
 * Fetch and store GSC data for a date range.
 */
export async function syncSearchPerformance(dateRange: DateRange): Promise<{
  fetched: number;
  stored: number;
}> {
  const d = await db();
  if (!d) throw new Error("Database not available");

  const rows = await fetchSearchPerformance(dateRange);
  let stored = 0;

  for (const row of rows) {
    try {
      await d.insert(searchPerformance).values({
        query: row.query,
        page: row.page || null,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        date: row.date,
      });
      stored++;
    } catch (error) {
      console.error("[GSC Pipeline] Insert error:", error);
    }
  }

  return { fetched: rows.length, stored };
}

// ─── QUERY FUNCTIONS ─────────────────────────────────────

/**
 * Get top search queries by clicks for a date range.
 */
export async function getTopQueries(opts?: {
  startDate?: string;
  limit?: number;
}): Promise<Array<{ query: string; clicks: number; impressions: number; avgPosition: number }>> {
  const d = await db();
  if (!d) return [];

  const limit = opts?.limit ?? 20;
  const startDate = opts?.startDate ?? getDefaultStartDate();

  const rows = await d
    .select({
      query: searchPerformance.query,
      clicks: sql<number>`SUM(${searchPerformance.clicks})`,
      impressions: sql<number>`SUM(${searchPerformance.impressions})`,
      avgPosition: sql<number>`ROUND(AVG(${searchPerformance.position}) / 100, 1)`,
    })
    .from(searchPerformance)
    .where(gte(searchPerformance.date, startDate))
    .groupBy(searchPerformance.query)
    .orderBy(sql`SUM(${searchPerformance.clicks}) DESC`)
    .limit(limit);

  return rows.map(r => ({
    query: r.query,
    clicks: Number(r.clicks),
    impressions: Number(r.impressions),
    avgPosition: Number(r.avgPosition),
  }));
}

/**
 * Get page-level performance.
 */
export async function getPagePerformance(opts?: {
  startDate?: string;
  limit?: number;
}): Promise<Array<{ page: string; clicks: number; impressions: number; avgCtr: number }>> {
  const d = await db();
  if (!d) return [];

  const limit = opts?.limit ?? 20;
  const startDate = opts?.startDate ?? getDefaultStartDate();

  const rows = await d
    .select({
      page: searchPerformance.page,
      clicks: sql<number>`SUM(${searchPerformance.clicks})`,
      impressions: sql<number>`SUM(${searchPerformance.impressions})`,
      avgCtr: sql<number>`ROUND(AVG(${searchPerformance.ctr}) / 100, 1)`,
    })
    .from(searchPerformance)
    .where(gte(searchPerformance.date, startDate))
    .groupBy(searchPerformance.page)
    .orderBy(sql`SUM(${searchPerformance.clicks}) DESC`)
    .limit(limit);

  return rows.map(r => ({
    page: r.page || "",
    clicks: Number(r.clicks),
    impressions: Number(r.impressions),
    avgCtr: Number(r.avgCtr),
  }));
}

// ─── QUERY CLUSTERING ───────────────────────────────────

/**
 * Group search queries into thematic clusters using AI.
 * Helps identify which topics drive the most traffic.
 */
export async function clusterQueries(opts?: { startDate?: string }): Promise<QueryCluster[]> {
  const d = await db();
  if (!d) return [];

  const startDate = opts?.startDate ?? getDefaultStartDate();

  // Get all queries with aggregated metrics
  const rows = await d
    .select({
      query: searchPerformance.query,
      clicks: sql<number>`SUM(${searchPerformance.clicks})`,
      impressions: sql<number>`SUM(${searchPerformance.impressions})`,
      avgPosition: sql<number>`ROUND(AVG(${searchPerformance.position}) / 100, 1)`,
    })
    .from(searchPerformance)
    .where(gte(searchPerformance.date, startDate))
    .groupBy(searchPerformance.query)
    .orderBy(sql`SUM(${searchPerformance.impressions}) DESC`)
    .limit(100);

  if (rows.length === 0) return [];

  const queryList = rows.map(r => `"${r.query}" (${r.clicks} clicks, ${r.impressions} imp, pos ${r.avgPosition})`).join("\n");

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are an SEO analyst for Nick's Tire & Auto, a Cleveland auto repair shop.
Group these search queries into thematic clusters. Return JSON array of clusters.
Each cluster should have:
- theme: a descriptive name for the cluster (e.g., "Tire Services", "Brake Repair", "General Auto Repair", "Location-Based", "Brand Searches")
- queries: array of the exact query strings that belong to this cluster

Group by SERVICE TYPE or INTENT, not by volume. Every query must appear in exactly one cluster.
Aim for 4-8 clusters. Don't create clusters with only 1 query unless it's truly unique.`,
        },
        { role: "user", content: queryList },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "query_clusters",
          strict: true,
          schema: {
            type: "object",
            properties: {
              clusters: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    theme: { type: "string" },
                    queries: { type: "array", items: { type: "string" } },
                  },
                  required: ["theme", "queries"],
                  additionalProperties: false,
                },
              },
            },
            required: ["clusters"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") return [];

    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.clusters)) return [];

    // Enrich clusters with aggregated metrics
    const queryMetrics = new Map(rows.map(r => [r.query, r]));

    return parsed.clusters.map((cluster: { theme: string; queries: string[] }) => {
      let totalClicks = 0;
      let totalImpressions = 0;
      let posSum = 0;
      let posCount = 0;

      for (const q of cluster.queries) {
        const m = queryMetrics.get(q);
        if (m) {
          totalClicks += Number(m.clicks);
          totalImpressions += Number(m.impressions);
          posSum += Number(m.avgPosition);
          posCount++;
        }
      }

      return {
        theme: cluster.theme,
        queries: cluster.queries,
        totalClicks,
        totalImpressions,
        avgPosition: posCount > 0 ? Math.round((posSum / posCount) * 10) / 10 : 0,
      };
    });
  } catch (error) {
    console.error("[GSC Pipeline] Query clustering failed:", error);
    return [];
  }
}

// ─── POSITION TRACKING ──────────────────────────────────

/**
 * Detect significant ranking changes between two periods.
 * Compares last 7 days to the prior 7 days.
 */
export async function detectRankingChanges(opts?: {
  minDelta?: number;
  limit?: number;
}): Promise<RankingChange[]> {
  const d = await db();
  if (!d) return [];

  const minDelta = opts?.minDelta ?? 300; // 3 positions (stored * 100)
  const limit = opts?.limit ?? 30;

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10);

  // Current period average positions
  const currentPositions = await d
    .select({
      query: searchPerformance.query,
      page: searchPerformance.page,
      avgPosition: sql<number>`AVG(${searchPerformance.position})`,
    })
    .from(searchPerformance)
    .where(gte(searchPerformance.date, sevenDaysAgo))
    .groupBy(searchPerformance.query, searchPerformance.page);

  // Previous period average positions
  const previousPositions = await d
    .select({
      query: searchPerformance.query,
      page: searchPerformance.page,
      avgPosition: sql<number>`AVG(${searchPerformance.position})`,
    })
    .from(searchPerformance)
    .where(and(
      gte(searchPerformance.date, fourteenDaysAgo),
      lte(searchPerformance.date, sevenDaysAgo),
    ))
    .groupBy(searchPerformance.query, searchPerformance.page);

  // Build lookup for previous positions
  const prevMap = new Map<string, number>();
  for (const row of previousPositions) {
    const key = `${row.query}||${row.page || ""}`;
    prevMap.set(key, Number(row.avgPosition));
  }

  // Find significant changes
  const changes: RankingChange[] = [];
  for (const row of currentPositions) {
    const key = `${row.query}||${row.page || ""}`;
    const prev = prevMap.get(key);
    if (prev === undefined) continue;

    const current = Number(row.avgPosition);
    const delta = prev - current; // positive = improved (lower position number = higher rank)

    if (Math.abs(delta) >= minDelta) {
      changes.push({
        query: row.query,
        page: row.page || "",
        previousPosition: Math.round(prev) / 100,
        currentPosition: Math.round(current) / 100,
        delta: Math.round(delta) / 100,
        direction: delta > 0 ? "improved" : "dropped",
      });
    }
  }

  // Sort by absolute delta (biggest changes first)
  changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return changes.slice(0, limit);
}

// ─── CTR OPTIMIZATION ───────────────────────────────────

/**
 * Find queries with high impressions but low CTR — optimization opportunities.
 * Suggests title/meta changes for underperforming pages.
 */
export async function findCtrOpportunities(opts?: {
  startDate?: string;
  minImpressions?: number;
  limit?: number;
}): Promise<CtrOpportunity[]> {
  const d = await db();
  if (!d) return [];

  const startDate = opts?.startDate ?? getDefaultStartDate();
  const minImpressions = opts?.minImpressions ?? 50;
  const limit = opts?.limit ?? 15;

  const rows = await d
    .select({
      query: searchPerformance.query,
      page: searchPerformance.page,
      clicks: sql<number>`SUM(${searchPerformance.clicks})`,
      impressions: sql<number>`SUM(${searchPerformance.impressions})`,
      avgCtr: sql<number>`AVG(${searchPerformance.ctr})`,
      avgPosition: sql<number>`AVG(${searchPerformance.position})`,
    })
    .from(searchPerformance)
    .where(gte(searchPerformance.date, startDate))
    .groupBy(searchPerformance.query, searchPerformance.page)
    .having(sql`SUM(${searchPerformance.impressions}) >= ${minImpressions}`)
    .orderBy(sql`AVG(${searchPerformance.ctr}) ASC`)
    .limit(limit * 2); // Fetch extra to filter

  // Filter to queries with below-average CTR for their position
  // Position 1-3: expect 5%+ CTR. Position 4-10: expect 2%+. Position 11+: expect 1%+.
  const opportunities: CtrOpportunity[] = [];

  for (const row of rows) {
    const avgPos = Number(row.avgPosition) / 100;
    const ctr = Number(row.avgCtr) / 100; // Convert from stored format to percentage
    const impressions = Number(row.impressions);

    let expectedMinCtr: number;
    if (avgPos <= 3) expectedMinCtr = 5;
    else if (avgPos <= 10) expectedMinCtr = 2;
    else expectedMinCtr = 0.5;

    if (ctr < expectedMinCtr) {
      let suggestedAction: string;
      if (avgPos <= 3 && ctr < 5) {
        suggestedAction = "High ranking but low CTR. Rewrite title tag and meta description to be more compelling. Add power words and clear value proposition.";
      } else if (avgPos <= 10 && ctr < 2) {
        suggestedAction = "Page 1 visibility but poor CTR. Review title tag for keyword match. Add structured data (FAQ, review stars) for rich snippets.";
      } else {
        suggestedAction = "Consider improving content depth to boost ranking, then optimize title/meta once position improves.";
      }

      opportunities.push({
        query: row.query,
        page: row.page || "",
        impressions,
        currentCtr: Math.round(ctr * 100) / 100,
        avgPosition: Math.round(avgPos * 10) / 10,
        suggestedAction,
      });
    }

    if (opportunities.length >= limit) break;
  }

  return opportunities;
}

// ─── CANNIBALIZATION DETECTION ──────────────────────────

/**
 * Detect keyword cannibalization — multiple pages ranking for the same query.
 * This splits ranking signals and hurts both pages.
 */
export async function detectCannibalization(opts?: {
  startDate?: string;
  limit?: number;
}): Promise<CannibalizationIssue[]> {
  const d = await db();
  if (!d) return [];

  const startDate = opts?.startDate ?? getDefaultStartDate();
  const limit = opts?.limit ?? 15;

  // Find queries that have multiple distinct pages ranking
  const rows = await d
    .select({
      query: searchPerformance.query,
      page: searchPerformance.page,
      clicks: sql<number>`SUM(${searchPerformance.clicks})`,
      impressions: sql<number>`SUM(${searchPerformance.impressions})`,
      avgPosition: sql<number>`ROUND(AVG(${searchPerformance.position}) / 100, 1)`,
    })
    .from(searchPerformance)
    .where(gte(searchPerformance.date, startDate))
    .groupBy(searchPerformance.query, searchPerformance.page)
    .orderBy(searchPerformance.query, sql`SUM(${searchPerformance.clicks}) DESC`);

  // Group by query to find multi-page rankings
  const queryPages = new Map<string, Array<{ page: string; clicks: number; impressions: number; position: number }>>();

  for (const row of rows) {
    const query = row.query;
    if (!queryPages.has(query)) queryPages.set(query, []);
    queryPages.get(query)!.push({
      page: row.page || "",
      clicks: Number(row.clicks),
      impressions: Number(row.impressions),
      position: Number(row.avgPosition),
    });
  }

  // Filter to queries with 2+ pages
  const issues: CannibalizationIssue[] = [];
  for (const [query, pages] of queryPages) {
    if (pages.length < 2) continue;

    // Sort pages by clicks (the "winner")
    pages.sort((a, b) => b.clicks - a.clicks);

    const winner = pages[0];
    const losers = pages.slice(1).map(p => p.page).join(", ");

    const recommendation = `Consolidate content. Keep "${winner.page}" as the primary page for "${query}" (${winner.clicks} clicks). Consider redirecting or deoptimizing: ${losers}`;

    issues.push({ query, pages, recommendation });
  }

  // Sort by total wasted impressions
  issues.sort((a, b) => {
    const aWaste = a.pages.slice(1).reduce((s, p) => s + p.impressions, 0);
    const bWaste = b.pages.slice(1).reduce((s, p) => s + p.impressions, 0);
    return bWaste - aWaste;
  });

  return issues.slice(0, limit);
}

// ─── SEASONAL PATTERNS ──────────────────────────────────

/**
 * Compare current performance to same period in previous month.
 * Detects seasonal patterns and growth/decline.
 */
export async function detectSeasonalPatterns(opts?: {
  limit?: number;
}): Promise<{
  comparisons: SeasonalComparison[];
  overallTrend: "growing" | "declining" | "stable";
  totalCurrentClicks: number;
  totalPreviousClicks: number;
  changePercent: number;
}> {
  const d = await db();
  if (!d) return { comparisons: [], overallTrend: "stable", totalCurrentClicks: 0, totalPreviousClicks: 0, changePercent: 0 };

  const limit = opts?.limit ?? 20;

  // Current period: last 28 days
  const now = new Date();
  const currentStart = new Date(now.getTime() - 28 * 86400000).toISOString().slice(0, 10);
  const currentEnd = now.toISOString().slice(0, 10);

  // Previous period: 56-28 days ago
  const previousStart = new Date(now.getTime() - 56 * 86400000).toISOString().slice(0, 10);
  const previousEnd = currentStart;

  const [currentData, previousData] = await Promise.all([
    d.select({
      query: searchPerformance.query,
      clicks: sql<number>`SUM(${searchPerformance.clicks})`,
    })
      .from(searchPerformance)
      .where(and(gte(searchPerformance.date, currentStart), lte(searchPerformance.date, currentEnd)))
      .groupBy(searchPerformance.query)
      .orderBy(sql`SUM(${searchPerformance.clicks}) DESC`)
      .limit(200),
    d.select({
      query: searchPerformance.query,
      clicks: sql<number>`SUM(${searchPerformance.clicks})`,
    })
      .from(searchPerformance)
      .where(and(gte(searchPerformance.date, previousStart), lte(searchPerformance.date, previousEnd)))
      .groupBy(searchPerformance.query),
  ]);

  const prevMap = new Map(previousData.map(r => [r.query, Number(r.clicks)]));

  let totalCurrentClicks = 0;
  let totalPreviousClicks = 0;

  const comparisons: SeasonalComparison[] = [];
  for (const row of currentData) {
    const currentClicks = Number(row.clicks);
    const previousClicks = prevMap.get(row.query) || 0;
    totalCurrentClicks += currentClicks;
    totalPreviousClicks += previousClicks;

    if (currentClicks === 0 && previousClicks === 0) continue;

    const changePercent = previousClicks > 0
      ? Math.round(((currentClicks - previousClicks) / previousClicks) * 100)
      : currentClicks > 0 ? 100 : 0;

    const trend: "up" | "down" | "stable" =
      changePercent > 20 ? "up" : changePercent < -20 ? "down" : "stable";

    comparisons.push({
      query: row.query,
      currentClicks,
      previousClicks,
      changePercent,
      trend,
    });
  }

  // Add queries that existed before but disappeared
  for (const [query, clicks] of prevMap) {
    if (!currentData.find(r => r.query === query)) {
      totalPreviousClicks += clicks;
      comparisons.push({
        query,
        currentClicks: 0,
        previousClicks: clicks,
        changePercent: -100,
        trend: "down",
      });
    }
  }

  // Sort by absolute change
  comparisons.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

  const overallChange = totalPreviousClicks > 0
    ? ((totalCurrentClicks - totalPreviousClicks) / totalPreviousClicks) * 100
    : 0;

  return {
    comparisons: comparisons.slice(0, limit),
    overallTrend: overallChange > 10 ? "growing" : overallChange < -10 ? "declining" : "stable",
    totalCurrentClicks,
    totalPreviousClicks,
    changePercent: Math.round(overallChange),
  };
}

// ─── FULL PIPELINE RUN ──────────────────────────────────

/**
 * Run the full GSC pipeline: sync data + generate insights.
 */
export async function runGscPipeline(): Promise<{
  sync: { fetched: number; stored: number };
  insights: {
    rankingChanges: number;
    ctrOpportunities: number;
    cannibalizationIssues: number;
  };
}> {
  // Default to last 7 days for sync
  const now = new Date();
  const endDate = new Date(now.getTime() - 2 * 86400000).toISOString().slice(0, 10); // GSC data has 2-day delay
  const startDate = new Date(now.getTime() - 9 * 86400000).toISOString().slice(0, 10);

  const sync = await syncSearchPerformance({ startDate, endDate });

  // Run analysis in parallel
  const [rankingChanges, ctrOpportunities, cannibalization] = await Promise.all([
    detectRankingChanges(),
    findCtrOpportunities(),
    detectCannibalization(),
  ]);

  return {
    sync,
    insights: {
      rankingChanges: rankingChanges.length,
      ctrOpportunities: ctrOpportunities.length,
      cannibalizationIssues: cannibalization.length,
    },
  };
}

// ─── HELPERS ─────────────────────────────────────────────

function getDefaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 28); // Last 28 days
  return d.toISOString().slice(0, 10);
}
