import { logger as rootLogger } from "@/lib/logger";
import { getAccessToken, isGoogleOauthConfigured } from "@/lib/services/google-oauth";

const log = rootLogger.withSurface("intelligence/connectors/gsc");

export interface GSCMetrics {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GBPMetrics {
  rating: number;
  totalReviews: number;
  recentReviewText: string;
}

export async function fetchGSCAndGBPMetrics(): Promise<{ gsc: GSCMetrics[]; gbp: GBPMetrics | null; error?: string }> {
  const isConfigured = await isGoogleOauthConfigured("primary").catch(() => false);

  if (!isConfigured) {
    log.warn("Google OAuth is not configured, returning empty metrics.");
    return {
      gsc: [],
      gbp: null
    };
  }

  try {
    const accessToken = await getAccessToken("primary");
    // forensic-audit HIGH · the endpoint is /sites/{encodeURIComponent(siteUrl)}/
    // searchAnalytics/query. Previously 'searchAnalytics' was encoded INTO the
    // site id (site became '...bdnick.info/searchAnalytics', path became just
    // '/query'), so every call 404'd and silently fell back to fabricated
    // "realistic mock" metrics that were written to OpportunityLog/intelligence
    // docs as real business data.
    const siteUrl = "https://bdnick.info/";
    const gscUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    
    // Call Google Search Console API for last 14 days metrics
    const gscRes = await fetch(gscUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        startDate: new Date(Date.now() - 14 * 86400 * 1000).toISOString().split("T")[0],
        endDate: new Date().toISOString().split("T")[0],
        dimensions: ["query"],
        rowLimit: 5
      }),
      signal: AbortSignal.timeout(10000)
    });

    let gscData: GSCMetrics[] = [];
    if (gscRes.ok) {
      const payload = await gscRes.json() as { rows?: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; keys_1?: string; position: number }> };
      gscData = (payload.rows || []).map((row) => ({
        query: row.keys[0] || "",
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position
      }));
    } else {
      // A failed read is not an empty one: the status goes back so the caller can refuse to store "no data".
      const error = `GSC API request failed with status ${gscRes.status}`;
      log.warn(`${error}, returning no GSC metrics.`);
      return { gsc: [], gbp: null, error };
    }

    // Call GBP API or fall back cleanly
    return {
      gsc: gscData,
      gbp: null
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error("Failed to query Google API, returning empty metrics.", { error });
    return { gsc: [], gbp: null, error };
  }
}
