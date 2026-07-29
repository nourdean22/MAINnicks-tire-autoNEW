/**
 * GBP Performance ingestion (WP-22 GBP leg, 2026-07-29).
 *
 * Read-only reads from the Business Profile Performance API using the
 * SAME OAuth grant the post publisher holds (`business.manage` covers
 * it) — zero new credentials. The router owns secrets + auth; this
 * module is pure transport + mapping, injectable for tests.
 *
 * Fail-closed posture upstream: until the operator completes the
 * one-time Connect flow (Admin → Content → GBP Posts → Connect), the
 * router returns connected:false with that exact instruction — this
 * service is only called with a live token.
 *
 * Source labels + fetchedAt travel in the payload (register rules).
 */

const PERF_BASE = "https://businessprofileperformance.googleapis.com/v1";
const TIMEOUT_MS = 15_000;
const SOURCE_LABEL = "Google Business Profile Performance API";

export const GBP_DAILY_METRICS = [
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
] as const;

export interface GbpDailySeries {
  metric: string;
  points: Array<{ date: string; value: number }>;
  total: number;
}

export interface GbpPerformanceResult {
  ok: true;
  source: string;
  fetchedAt: string;
  locationId: string;
  rangeDays: number;
  series: GbpDailySeries[];
  topSearchKeywords: Array<{ keyword: string; impressions: number | string }>;
}

export interface GbpPerformanceError {
  ok: false;
  error: string;
  source: string;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** locations rows are stored either bare ("123…") or as "locations/123…". */
export function normalizeLocationId(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("locations/") ? trimmed.slice("locations/".length) : trimmed;
}

function dateParts(d: Date): { year: number; month: number; day: number } {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export async function fetchGbpPerformance(args: {
  locationId: string;
  accessToken: string;
  days?: number;
  fetchImpl?: FetchLike;
}): Promise<GbpPerformanceResult | GbpPerformanceError> {
  const days = Math.min(Math.max(args.days ?? 30, 7), 90);
  const locationId = normalizeLocationId(args.locationId);
  const doFetch: FetchLike = args.fetchImpl ?? (fetch as unknown as FetchLike);
  const headers = { Authorization: `Bearer ${args.accessToken}` };

  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const s = dateParts(start);
  const e = dateParts(end);

  try {
    // Daily metrics — one multi-metric time-series call.
    const metricParams = GBP_DAILY_METRICS.map((m) => `dailyMetrics=${m}`).join("&");
    const rangeParams =
      `dailyRange.start_date.year=${s.year}&dailyRange.start_date.month=${s.month}&dailyRange.start_date.day=${s.day}` +
      `&dailyRange.end_date.year=${e.year}&dailyRange.end_date.month=${e.month}&dailyRange.end_date.day=${e.day}`;
    const seriesRes = await doFetch(
      `${PERF_BASE}/locations/${encodeURIComponent(locationId)}:fetchMultiDailyMetricsTimeSeries?${metricParams}&${rangeParams}`,
      { headers, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!seriesRes.ok) {
      return { ok: false, error: `performance API ${seriesRes.status} (daily metrics)`, source: SOURCE_LABEL };
    }
    const seriesBody = (await seriesRes.json()) as {
      multiDailyMetricTimeSeries?: Array<{
        dailyMetricTimeSeries?: Array<{
          dailyMetric?: string;
          timeSeries?: { datedValues?: Array<{ date?: { year: number; month: number; day: number }; value?: string }> };
        }>;
      }>;
    };
    const series: GbpDailySeries[] = [];
    for (const outer of seriesBody.multiDailyMetricTimeSeries ?? []) {
      for (const ts of outer.dailyMetricTimeSeries ?? []) {
        const points = (ts.timeSeries?.datedValues ?? [])
          .filter((p) => p.date)
          .map((p) => ({
            date: `${p.date!.year}-${String(p.date!.month).padStart(2, "0")}-${String(p.date!.day).padStart(2, "0")}`,
            value: Number(p.value ?? 0),
          }));
        series.push({
          metric: ts.dailyMetric ?? "unknown",
          points,
          total: points.reduce((a, p) => a + p.value, 0),
        });
      }
    }

    // Search keywords — monthly impressions (API returns current window).
    const kwStart = dateParts(new Date(end.getTime() - 60 * 86_400_000));
    const kwRes = await doFetch(
      `${PERF_BASE}/locations/${encodeURIComponent(locationId)}/searchkeywords/impressions/monthly` +
        `?monthlyRange.start_month.year=${kwStart.year}&monthlyRange.start_month.month=${kwStart.month}` +
        `&monthlyRange.end_month.year=${e.year}&monthlyRange.end_month.month=${e.month}&pageSize=20`,
      { headers, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    let topSearchKeywords: GbpPerformanceResult["topSearchKeywords"] = [];
    if (kwRes.ok) {
      const kwBody = (await kwRes.json()) as {
        searchKeywordsCounts?: Array<{ searchKeyword?: string; insightsValue?: { value?: string; threshold?: string } }>;
      };
      topSearchKeywords = (kwBody.searchKeywordsCounts ?? []).slice(0, 20).map((k) => ({
        keyword: k.searchKeyword ?? "unknown",
        // Google returns either an exact value or a "<N" threshold —
        // keep the threshold STRING rather than fabricating a number.
        impressions: k.insightsValue?.value != null ? Number(k.insightsValue.value) : `<${k.insightsValue?.threshold ?? "?"}`,
      }));
    }

    return {
      ok: true,
      source: SOURCE_LABEL,
      fetchedAt: new Date().toISOString(),
      locationId,
      rangeDays: days,
      series,
      topSearchKeywords,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      source: SOURCE_LABEL,
    };
  }
}
