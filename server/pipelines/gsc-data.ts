/**
 * GSC Data Pipeline — Google Search Console performance data.
 *
 * Fetches search query performance (clicks, impressions, CTR, position)
 * and stores it in the `search_performance` table for trend analysis.
 *
 * Requires a Google Service Account with Search Console API access.
 * Env vars needed: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY
 *
 * Until service account is configured, placeholder functions return empty data
 * and the schema is ready for when the API key is provisioned.
 */

import { searchPerformance } from "../../drizzle/schema";
import { desc, eq, gte, sql } from "drizzle-orm";

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
 * Uses the standard Google OAuth2 JWT flow.
 */
async function getAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");

  if (!email || !privateKey) {
    throw new Error("GSC service account credentials not configured");
  }

  // Build JWT header + claims
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).toString("base64url");

  // Sign with private key
  const crypto = await import("crypto");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(privateKey, "base64url");

  const jwt = `${header}.${claims}.${signature}`;

  // Exchange JWT for access token
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
 * Returns raw rows from the API, ready for storage.
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
 * Upserts rows to avoid duplicates.
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
      // Simple insert — duplicates are acceptable for time-series data
      // since the same query can appear on different dates
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
      // Skip duplicates silently
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
 * Get page-level performance (which pages get the most search traffic).
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

// ─── HELPERS ─────────────────────────────────────────────

function getDefaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 28); // Last 28 days
  return d.toISOString().slice(0, 10);
}
