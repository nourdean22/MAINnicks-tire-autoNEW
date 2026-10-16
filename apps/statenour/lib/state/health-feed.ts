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
