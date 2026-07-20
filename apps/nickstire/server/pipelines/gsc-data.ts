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

import { db } from "../lib/db-helper";

import { createLogger } from "../lib/logger";

const log = createLogger("pipelines:gsc-data");
// ─── TYPES ───────────────────────────────────────────────

export interface SearchPerformanceRow {
  query: string;
  page?: string;
  clicks: number;
  impressions: number;
  ctr: number;    // percentage (e.g. 5.5)
  position: number; // average position (e.g. 3.2)
  date: string;   // YYYY-MM-DD
  device: string;
  country: string;
  searchType: string;
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

// URL-prefix property, not sc-domain. Reason: the teezy-491218 service account
// is only registered as siteOwner on the URL-prefix property. The sc-domain
// property would need DNS TXT re-verification at globaldomaingroup.com which
// we don't control. nickstire.org redirects www/http → apex https, so the
// URL-prefix captures all organic search traffic without loss.
const GSC_SITE_URL = "https://nickstire.org/";

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

  // TIMEOUT IS LOAD-BEARING. This was the only unbounded fetch in the file, and
  // it is the one every other GSC call depends on — nothing can run without a
  // token first.
  //
  // Evidence (production cron_log, 2026-07-20): gsc-pipeline failed 6/6 runs and
  // pipelines-auto-run 7/8, EVERY one with details="timeout" and duration_ms
  // between 240133 and 240172 — the scheduler's hard 4-minute cap at
  // scheduler.ts:235, hit to the millisecond. Not a throw: the handler's catch
  // would have written "GSC pipeline skipped" instead. The promise simply never
  // settled.
  //
  // Worse, scheduler.ts:225-228 deliberately does NOT release the job lock on
  // timeout, because the handler is still running as a zombie. So each hang
  // burned four minutes and left something behind.
  //
  // pipelines-auto-run's single success in that window took 381ms and ran
  // nothing — "Ran: none, skipped: gbp-reviews, gsc-data, instagram". It only
  // passes when it skips this path.
  //
  // 20s is generous: this exchange normally answers in under a second, and its
  // siblings below already use 30-45s for much larger payloads.
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(20_000),
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
  searchType: "web" | "discover" = "web",
): Promise<SearchPerformanceRow[]> {
  if (!hasGscCredentials()) {
    log.warn("[GSC Pipeline] Service account credentials not configured — skipping fetch");
    return [];
  }

  try {
    const token = await getAccessToken();

    const dimensions =
      searchType === "web"
        ? ["query", "page", "date", "device", "country"]
        : ["page", "date", "device", "country"];

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
          dimensions,
          type: searchType,
          rowLimit: 25000,
        }),
        signal: AbortSignal.timeout(45000),
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

    return (data.rows || []).map((row) => {
      let query = "";
      let page = "";
      let date = "";
      let device = "desktop";
      let country = "usa";

      if (searchType === "web") {
        query = row.keys[0] || "";
        page = row.keys[1] || "";
        date = row.keys[2] || "";
        device = row.keys[3] || "desktop";
        country = row.keys[4] || "usa";
      } else {
        // Discover: dimensions are [page, date, device, country]
        query = "";
        page = row.keys[0] || "";
        date = row.keys[1] || "";
        device = row.keys[2] || "desktop";
        country = row.keys[3] || "usa";
      }

      return {
        query,
        page,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: Math.round(row.ctr * 10000), // 0.055 -> 550 (5.5%)
        position: Math.round(row.position * 100), // 3.2 -> 320
        date,
        device,
        country,
        searchType,
      };
    });
  } catch (error) {
    log.error(`[GSC Pipeline] Fetch failed for ${searchType}:`, error);
    return [];
  }
}

/**
 * Pull a live GSC report straight from the Search Console API —
 * totals + top queries + top pages — without touching the DB. Three
 * single-dimension calls so each table reconciles to the GSC UI.
 * Powers `scripts/gsc-report.ts` (the `pnpm gsc:report` one-command).
 */
export async function getGscReport(dateRange: DateRange): Promise<{
  summary: { clicks: number; impressions: number; ctr: number; position: number };
  topQueries: Array<{ key: string; clicks: number; impressions: number; ctr: number; position: number }>;
  topPages: Array<{ key: string; clicks: number; impressions: number; ctr: number; position: number }>;
}> {
  if (!hasGscCredentials()) {
    throw new Error(
      "GSC service account credentials not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_KEY)",
    );
  }
  const token = await getAccessToken();
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE_URL)}/searchAnalytics/query`;

  type ApiRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };
  async function query(body: Record<string, unknown>): Promise<ApiRow[]> {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: dateRange.startDate, endDate: dateRange.endDate, ...body }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      throw new Error(`GSC API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return ((await res.json()) as { rows?: ApiRow[] }).rows ?? [];
  }

  // No dimensions → one grand-total row. Dimension calls default-sort
  // by clicks desc, so rowLimit 25 yields the top 25.
  const [totalRows, queryRows, pageRows] = await Promise.all([
    query({}),
    query({ dimensions: ["query"], rowLimit: 25 }),
    query({ dimensions: ["page"], rowLimit: 25 }),
  ]);

  const total = totalRows[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const shape = (r: ApiRow) => ({
    key: r.keys?.[0] ?? "",
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  });
  return {
    summary: {
      clicks: total.clicks,
      impressions: total.impressions,
      ctr: total.ctr,
      position: total.position,
    },
    topQueries: queryRows.map(shape),
    topPages: pageRows.map(shape),
  };
}

/**
 * Fallback to query GSC data from local TiDB/MySQL database table `search_performance`.
 * Replicates the exact schema/structure and units returned by getGscReport.
 */
export async function getGscDbReport(dateRange: DateRange): Promise<{
  summary: { clicks: number; impressions: number; ctr: number; position: number };
  topQueries: Array<{ key: string; clicks: number; impressions: number; ctr: number; position: number }>;
  topPages: Array<{ key: string; clicks: number; impressions: number; ctr: number; position: number }>;
}> {
  const d = await db();
  if (!d) {
    throw new Error("Database not available");
  }

  // 1. Fetch total/summary from DB (filter to searchType = 'web' to match default API report)
  const summaryRows = await d
    .select({
      clicks: sql<number>`COALESCE(SUM(${searchPerformance.clicks}), 0)`,
      impressions: sql<number>`COALESCE(SUM(${searchPerformance.impressions}), 0)`,
      posSum: sql<number>`COALESCE(SUM(${searchPerformance.position} * ${searchPerformance.impressions}), 0)`,
    })
    .from(searchPerformance)
    .where(
      and(
        sql`${searchPerformance.date} BETWEEN ${dateRange.startDate} AND ${dateRange.endDate}`,
        eq(searchPerformance.searchType, "web"),
      ),
    );

  const s = summaryRows[0] ?? { clicks: 0, impressions: 0, posSum: 0 };
  const summaryClicks = Number(s.clicks);
  const summaryImpressions = Number(s.impressions);
  const posSum = Number(s.posSum);
  const summaryCtr = summaryImpressions > 0 ? (summaryClicks / summaryImpressions) : 0;
  const summaryPosition = summaryImpressions > 0 ? (posSum / summaryImpressions) / 100 : 0;

  // 2. Fetch top queries from DB (web searchType only)
  const queryRows = await d
    .select({
      key: searchPerformance.query,
      clicks: sql<number>`SUM(${searchPerformance.clicks})`,
      impressions: sql<number>`SUM(${searchPerformance.impressions})`,
      posSum: sql<number>`SUM(${searchPerformance.position} * ${searchPerformance.impressions})`,
    })
    .from(searchPerformance)
    .where(
      and(
        sql`${searchPerformance.date} BETWEEN ${dateRange.startDate} AND ${dateRange.endDate}`,
        eq(searchPerformance.searchType, "web"),
      ),
    )
    .groupBy(searchPerformance.query)
    .orderBy(sql`SUM(${searchPerformance.clicks}) DESC`)
    .limit(25);

  const topQueries = queryRows.map((q: any) => {
    const cl = Number(q.clicks);
    const imp = Number(q.impressions);
    const posS = Number(q.posSum);
    return {
      key: q.key,
      clicks: cl,
      impressions: imp,
      ctr: imp > 0 ? cl / imp : 0,
      position: imp > 0 ? (posS / imp) / 100 : 0,
    };
  });

  // 3. Fetch top pages from DB (web searchType only)
  const pageRows = await d
    .select({
      key: searchPerformance.page,
      clicks: sql<number>`SUM(${searchPerformance.clicks})`,
      impressions: sql<number>`SUM(${searchPerformance.impressions})`,
      posSum: sql<number>`SUM(${searchPerformance.position} * ${searchPerformance.impressions})`,
    })
    .from(searchPerformance)
    .where(
      and(
        sql`${searchPerformance.date} BETWEEN ${dateRange.startDate} AND ${dateRange.endDate}`,
        eq(searchPerformance.searchType, "web"),
      ),
    )
    .groupBy(searchPerformance.page)
    .orderBy(sql`SUM(${searchPerformance.clicks}) DESC`)
    .limit(25);

  const topPages = pageRows.map((p: any) => {
    const cl = Number(p.clicks);
    const imp = Number(p.impressions);
    const posS = Number(p.posSum);
    return {
      key: p.key || "",
      clicks: cl,
      impressions: imp,
      ctr: imp > 0 ? cl / imp : 0,
      position: imp > 0 ? (posS / imp) / 100 : 0,
    };
  });

  return {
    summary: {
      clicks: summaryClicks,
      impressions: summaryImpressions,
      ctr: summaryCtr,
      position: summaryPosition,
    },
    topQueries,
    topPages,
  };
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

  // Generate list of dates to query day-by-day to avoid sampling and truncation
  const dates: string[] = [];
  let current = new Date(dateRange.startDate);
  const end = new Date(dateRange.endDate);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }

  let totalFetched = 0;
  let totalStored = 0;

  for (const dateStr of dates) {
    const dailyRange = { startDate: dateStr, endDate: dateStr };
    
    // Fetch both web and discover in parallel for this day
    const [webRows, discoverRows] = await Promise.all([
      fetchSearchPerformance(dailyRange, "web"),
      fetchSearchPerformance(dailyRange, "discover"),
    ]);

    const allRows = [...webRows, ...discoverRows];
    totalFetched += allRows.length;

    for (const row of allRows) {
      try {
        await d.insert(searchPerformance).values({
          query: row.query,
          page: row.page || "",
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
          date: row.date,
          device: row.device,
          country: row.country,
          searchType: row.searchType,
        }).onDuplicateKeyUpdate({
          set: {
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
          },
        });
        totalStored++;
      } catch (error) {
        log.error("[GSC Pipeline] Upsert error:", error);
      }
    }
  }

  return { fetched: totalFetched, stored: totalStored };
}

// ─── QUERY FUNCTIONS ─────────────────────────────────────

/**
 * Get top search queries by clicks for a date range.
 */
export async function getTopQueries(opts?: {
  startDate?: string;
  endDate?: string;
  limit?: number;
  searchType?: string;
}): Promise<Array<{ query: string; clicks: number; impressions: number; ctr: number; avgPosition: number }>> {
  const d = await db();
  if (!d) return [];

  const limit = opts?.limit ?? 20;
  const startDate = opts?.startDate ?? getDefaultStartDate();
  const endDate = opts?.endDate;
  const searchType = opts?.searchType ?? "web";

  // Build WHERE: start always present, end only if supplied
  const whereClause = and(
    endDate
      ? sql`${searchPerformance.date} BETWEEN ${startDate} AND ${endDate}`
      : gte(searchPerformance.date, startDate),
    eq(searchPerformance.searchType, searchType),
  );

  const rows = await d
    .select({
      query: searchPerformance.query,
      clicks: sql<number>`SUM(${searchPerformance.clicks})`,
      impressions: sql<number>`SUM(${searchPerformance.impressions})`,
      // CTR recomputed from sums (more accurate than averaging stored CTRs)
      ctr: sql<number>`CASE WHEN SUM(${searchPerformance.impressions}) > 0
        THEN ROUND((SUM(${searchPerformance.clicks}) * 100.0) / SUM(${searchPerformance.impressions}), 2)
        ELSE 0 END`,
      avgPosition: sql<number>`ROUND(AVG(${searchPerformance.position}) / 100, 1)`,
    })
    .from(searchPerformance)
    .where(whereClause)
    .groupBy(searchPerformance.query)
    .orderBy(sql`SUM(${searchPerformance.clicks}) DESC`)
    .limit(limit);

  return rows.map((r: any) => ({
    query: r.query,
    clicks: Number(r.clicks),
    impressions: Number(r.impressions),
    ctr: Number(r.ctr),
    avgPosition: Number(r.avgPosition),
  }));
}

/**
 * Aggregate GSC summary across a date range (totals + derived CTR + impression-weighted position).
 * Wave-110 (2026-05-09): backs the statenour bridge `gsc_summary` action so
 * the AI COO has a single number for "how is SEO doing this month" instead
 * of fabricating one. Same data source as `getTopQueries()` so totals reconcile.
 */
export async function getGscSummary(opts: {
  startDate: string;
  endDate?: string;
  searchType?: string;
}): Promise<{
  from: string;
  to: string;
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
}> {
  const d = await db();
  const today = new Date().toISOString().slice(0, 10);
  const from = opts.startDate;
  const to = opts.endDate ?? today;
  const searchType = opts.searchType ?? "web";
  if (!d) return { from, to, totalClicks: 0, totalImpressions: 0, avgCtr: 0, avgPosition: 0 };

  const rows = await d
    .select({
      totalClicks: sql<number>`COALESCE(SUM(${searchPerformance.clicks}), 0)`,
      totalImpressions: sql<number>`COALESCE(SUM(${searchPerformance.impressions}), 0)`,
      // Position is impression-weighted (more accurate than straight average across days)
      posSum: sql<number>`COALESCE(SUM(${searchPerformance.position} * ${searchPerformance.impressions}), 0)`,
    })
    .from(searchPerformance)
    .where(
      and(
        sql`${searchPerformance.date} BETWEEN ${from} AND ${to}`,
        eq(searchPerformance.searchType, searchType),
      )
    );

  const r = rows[0] || { totalClicks: 0, totalImpressions: 0, posSum: 0 };
  const totalClicks = Number(r.totalClicks);
  const totalImpressions = Number(r.totalImpressions);
  const posSum = Number(r.posSum);
  const avgCtr = totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0;
  // posSum is in stored *100 units; divide by impressions (weighting) then by 100 (units)
  const avgPosition = totalImpressions > 0 ? Number((posSum / totalImpressions / 100).toFixed(2)) : 0;
  return { from, to, totalClicks, totalImpressions, avgCtr, avgPosition };
}

/**
 * Get page-level performance.
 */
export async function getPagePerformance(opts?: {
  startDate?: string;
  limit?: number;
  searchType?: string;
}): Promise<Array<{ page: string; clicks: number; impressions: number; avgCtr: number }>> {
  const d = await db();
  if (!d) return [];

  const limit = opts?.limit ?? 20;
  const startDate = opts?.startDate ?? getDefaultStartDate();
  const searchType = opts?.searchType ?? "web";

  const rows = await d
    .select({
      page: searchPerformance.page,
      clicks: sql<number>`SUM(${searchPerformance.clicks})`,
      impressions: sql<number>`SUM(${searchPerformance.impressions})`,
      avgCtr: sql<number>`ROUND(AVG(${searchPerformance.ctr}) / 100, 1)`,
    })
    .from(searchPerformance)
    .where(
      and(
        gte(searchPerformance.date, startDate),
        eq(searchPerformance.searchType, searchType),
      )
    )
    .groupBy(searchPerformance.page)
    .orderBy(sql`SUM(${searchPerformance.clicks}) DESC`)
    .limit(limit);

  return rows.map((r: any) => ({
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
export async function clusterQueries(opts?: { startDate?: string; searchType?: string }): Promise<QueryCluster[]> {
  const d = await db();
  if (!d) return [];

  const startDate = opts?.startDate ?? getDefaultStartDate();
  const searchType = opts?.searchType ?? "web";

  // Get all queries with aggregated metrics
  const rows = await d
    .select({
      query: searchPerformance.query,
      clicks: sql<number>`SUM(${searchPerformance.clicks})`,
      impressions: sql<number>`SUM(${searchPerformance.impressions})`,
      avgPosition: sql<number>`ROUND(AVG(${searchPerformance.position}) / 100, 1)`,
    })
    .from(searchPerformance)
    .where(
      and(
        gte(searchPerformance.date, startDate),
        eq(searchPerformance.searchType, searchType),
      )
    )
    .groupBy(searchPerformance.query)
    .orderBy(sql`SUM(${searchPerformance.impressions}) DESC`)
    .limit(100);

  if (rows.length === 0) return [];

  const queryList = rows.map((r: any) => `"${r.query}" (${r.clicks} clicks, ${r.impressions} imp, pos ${r.avgPosition})`).join("\n");

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
    const queryMetrics = new Map(rows.map((r: any) => [r.query, r as any]));

    return parsed.clusters.map((cluster: { theme: string; queries: string[] }) => {
      let totalClicks = 0;
      let totalImpressions = 0;
      let posSum = 0;
      let posCount = 0;

      for (const q of cluster.queries) {
        const m: any = queryMetrics.get(q);
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
    log.error("[GSC Pipeline] Query clustering failed:", error);
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
  searchType?: string;
}): Promise<RankingChange[]> {
  const d = await db();
  if (!d) return [];

  const minDelta = opts?.minDelta ?? 300; // 3 positions (stored * 100)
  const limit = opts?.limit ?? 30;
  const searchType = opts?.searchType ?? "web";

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
    .where(
      and(
        gte(searchPerformance.date, sevenDaysAgo),
        eq(searchPerformance.searchType, searchType),
      )
    )
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
      eq(searchPerformance.searchType, searchType),
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
  searchType?: string;
}): Promise<CtrOpportunity[]> {
  const d = await db();
  if (!d) return [];

  const startDate = opts?.startDate ?? getDefaultStartDate();
  const minImpressions = opts?.minImpressions ?? 50;
  const limit = opts?.limit ?? 15;
  const searchType = opts?.searchType ?? "web";

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
    .where(
      and(
        gte(searchPerformance.date, startDate),
        eq(searchPerformance.searchType, searchType),
      )
    )
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
  searchType?: string;
}): Promise<CannibalizationIssue[]> {
  const d = await db();
  if (!d) return [];

  const startDate = opts?.startDate ?? getDefaultStartDate();
  const limit = opts?.limit ?? 15;
  const searchType = opts?.searchType ?? "web";

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
    .where(
      and(
        gte(searchPerformance.date, startDate),
        eq(searchPerformance.searchType, searchType),
      )
    )
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
  searchType?: string;
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
  const searchType = opts?.searchType ?? "web";

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
      .where(and(
        gte(searchPerformance.date, currentStart), 
        lte(searchPerformance.date, currentEnd),
        eq(searchPerformance.searchType, searchType),
      ))
      .groupBy(searchPerformance.query)
      .orderBy(sql`SUM(${searchPerformance.clicks}) DESC`)
      .limit(200),
    d.select({
      query: searchPerformance.query,
      clicks: sql<number>`SUM(${searchPerformance.clicks})`,
    })
      .from(searchPerformance)
      .where(and(
        gte(searchPerformance.date, previousStart), 
        lte(searchPerformance.date, previousEnd),
        eq(searchPerformance.searchType, searchType),
      ))
      .groupBy(searchPerformance.query),
  ]);

  const prevMap = new Map<string, number>(previousData.map((r: any) => [r.query, Number(r.clicks)]));

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
    if (!currentData.find((r: any) => r.query === query)) {
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
  const endDate = new Date(now.getTime() - 1 * 86400000).toISOString().slice(0, 10); // GSC data has 1-day lag
  const startDate = new Date(now.getTime() - 8 * 86400000).toISOString().slice(0, 10);

  const sync = await syncSearchPerformance({ startDate, endDate });

  // Run analysis in parallel
  const [rankingChanges, ctrOpportunities, cannibalization] = await Promise.all([
    detectRankingChanges(),
    findCtrOpportunities(),
    detectCannibalization(),
  ]);

  // self-improving loop (phase 3 · GSC Learn) · persist the buried-money-page
  // opportunities as reinforcing memories instead of reducing them to a count.
  // Lives INSIDE the pipeline (reusing ctrOpportunities above) so it runs
  // wherever the pipeline runs — the orchestrator's 12h `gsc-data` job AND the
  // scheduler cron — independent of any env gate. type:'pattern' (NOT 'lesson')
  // so the VOICE receptionist prompt, which reads only lessons, is never polluted
  // with SEO advice; the chat/reasoning brain (getMemoryContext) still sees them.
  // Content is STABLE per page so remember() reinforces chronic offenders day over
  // day; a later phase drafts the title/meta fix behind a two-tap.
  try {
    const { remember } = await import("../services/nickMemory");
    const impressionsByPage = new Map<string, number>();
    for (const o of ctrOpportunities) {
      if (!o.page || o.avgPosition < 15) continue; // only genuinely buried (page 2+)
      impressionsByPage.set(o.page, (impressionsByPage.get(o.page) ?? 0) + o.impressions);
    }
    const buriedPages = [...impressionsByPage.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    for (const [page] of buriedPages) {
      await remember({
        type: "pattern",
        content: `SEO opportunity: "${page}" draws high search impressions but ranks on page 2+, so it earns almost no clicks. Improve its title/meta and on-page depth to climb toward page 1.`,
        source: "gsc_pipeline",
        confidence: 0.6,
      });
    }
  } catch (oppErr) {
    log.error("[GSC Pipeline] opportunity-learn failed:", oppErr);
  }

  // self-improving loop (phase 5 · GSC Verify) · record WINS, not just problems.
  // A page that WAS buried (page 2+) and has now climbed to page 1 is the loop
  // paying off — its "SEO opportunity" pattern decays naturally (it stops being
  // flagged), so we stamp a positive, stable win memory the brain/operator can see
  // and Telegram the recovery. Reinforce/decay for the rest is already emergent:
  // a persistent problem keeps recurring (reinforces), a solved one stops (decays
  // via decayMemories). Reuses the detectRankingChanges result computed above.
  try {
    const recovered = new Map<string, { from: number; to: number }>();
    for (const c of rankingChanges) {
      if (c.direction !== "improved" || !c.page) continue;
      if (c.previousPosition < 15 || c.currentPosition >= 11) continue; // was buried -> now page 1
      const prev = recovered.get(c.page);
      const climb = c.previousPosition - c.currentPosition;
      if (!prev || climb > prev.from - prev.to) {
        recovered.set(c.page, { from: Math.round(c.previousPosition), to: Math.round(c.currentPosition) });
      }
    }
    if (recovered.size > 0) {
      const { remember } = await import("../services/nickMemory");
      for (const [page] of recovered) {
        await remember({
          type: "pattern",
          content: `SEO win: "${page}" climbed from page 2+ to page 1 — the title/meta + on-page work is paying off. Keep what worked.`,
          source: "gsc_pipeline",
          confidence: 0.7,
        });
      }
      try {
        const { sendTelegram } = await import("../services/telegram");
        const lines = [...recovered.entries()].slice(0, 5).map(([page, r]) => `"${page}" · #${r.from} → #${r.to}`);
        await sendTelegram(`📈 SEO WINS · ${recovered.size} page(s) climbed to page 1:\n\n${lines.join("\n")}\n\nThe self-improving loop is paying off.`);
      } catch { /* telegram is best-effort */ }
    }
  } catch (winErr) {
    log.error("[GSC Pipeline] win-detection failed:", winErr);
  }

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
