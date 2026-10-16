/**
 * The /api/health feed for NourStateProvider.
 *
 * The route answers 503 whenever the system is not "healthy" (it is also Railway's eviction signal), with
 * the health object as the body. apiFetch turns any non-2xx into a thrown ApiError, so a merely degraded
 * system used to read as a FAILED feed and the state word said "State unknown". This reads the body
 * whatever the status: a body with a `status` string is a reading; no usable body is a failed read (null).
 */
export interface HealthFeed {
  status: string;
  [key: string]: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * The unresolved alert count, or null when the alerts MetricResult carries no value (status
 * "unavailable", or "degraded" without a value). Null is not zero: the count is the drift signal.
 */
export function healthAlertsUnresolved(feed: HealthFeed | null): number | null {
  const metric = feed?.alerts;
  if (!isRecord(metric) || !isRecord(metric.value)) return null;
  const n = metric.value.unresolved;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export interface FeedSummary {
  systemStatus: string;
  /** null when the health feed or its alerts metric did not deliver a count. */
  driftAlerts: number | null;
  /** Feeds that returned nothing, plus one when the alert count is unavailable. 0 means every input was read. */
  failedFeeds: number;
}

/** The pure step of NourStateProvider.loadAll: what the four feeds add up to for the state word. */
export function summarizeFeeds(feeds: { health: HealthFeed | null; habitsData: unknown; streaksData: unknown; cmd: unknown }): FeedSummary {
  const { health, habitsData, streaksData, cmd } = feeds;
  const driftAlerts = healthAlertsUnresolved(health);
  const missing = [health, habitsData, streaksData, cmd].filter((x) => x === null || x === undefined).length;
  // A health body without an alert count is a reading with a hole where the drift signal should be.
  const alertsMissing = health !== null && driftAlerts === null ? 1 : 0;
  return { systemStatus: health?.status ?? "unknown", driftAlerts, failedFeeds: missing + alertsMissing };
}

export async function readHealthFeed(fetchImpl: typeof fetch = fetch): Promise<HealthFeed | null> {
  try {
    const res = await fetchImpl("/api/health", { credentials: "include" });
    const raw: unknown = await res.json();
    // apiHandler envelopes a normal answer; the 503 branch passes the health object through bare.
    const body = isRecord(raw) && "ok" in raw && "meta" in raw && isRecord(raw.data) ? raw.data : raw;
    return isRecord(body) && typeof body.status === "string" ? (body as HealthFeed) : null;
  } catch {
    return null;
  }
}
