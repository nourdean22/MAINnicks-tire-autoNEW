/**
 * lib/services/venice-status.ts · cross-domain residuals slice
 * (2026-05-22 · legacy-modernizer REST→tRPC · chat cross-domain
 * residuals).
 *
 * The live Venice API status + balance probe · lifted verbatim from
 * app/api/ai/venice-status/route.ts so the legacy REST endpoint AND the
 * new `system.veniceStatus` tRPC procedure call the SAME function ·
 * drift between consumers structurally impossible.
 *
 * Returns an explicit, shallow `VeniceStatus` shape — no Prisma row, no
 * Json column · the TS2589 firewall is satisfied trivially. The probe
 * itself is a single bounded `fetch` to api.venice.ai (10s timeout) so
 * it can't hang a consumer.
 */

/** Live Venice API status snapshot · balance + rate limits + model counts. */
export interface VeniceStatus {
  ok: boolean;
  /** Present only on a failed probe. */
  error?: string;
  balance?: { usd: string | null; diem: string | null };
  rateLimits?: {
    requestsRemaining: string | null;
    requestsLimit: string | null;
    tokensRemaining: string | null;
    tokensLimit: string | null;
  };
  api?: { version: string | null; requestId: string | null };
  models?: { total: number; chat: number; image: number };
}

interface VeniceModel {
  id?: string;
  type?: string;
}

/**
 * Probe Venice for live balance + rate-limit headers. The REST route
 * and the tRPC `system.veniceStatus` procedure both call this.
 *
 * Never throws · a missing key or a network failure resolves to
 * `{ ok: false, error }` so the consumer's health dot just goes amber
 * (the legacy route returned the same shape with a non-2xx status; the
 * tRPC procedure cannot vary HTTP status so the `ok` boolean carries
 * the signal — `useVeniceHealth` already reads `data.healthy !== false`
 * style, and reads `ok` here).
 */
export async function probeVeniceStatus(): Promise<VeniceStatus> {
  const key = process.env.VENICE_API_KEY;
  if (!key) {
    return { ok: false, error: "VENICE_API_KEY not set" };
  }

  try {
    // Minimal request — just enough to get response headers with balance.
    const res = await fetch("https://api.venice.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return { ok: false, error: `Venice API returned ${res.status}` };
    }

    const models = (await res.json()) as { data?: VeniceModel[] };
    const list = Array.isArray(models?.data) ? models.data : [];

    return {
      ok: true,
      balance: {
        usd: res.headers.get("x-venice-balance-usd"),
        diem: res.headers.get("x-venice-balance-diem"),
      },
      rateLimits: {
        requestsRemaining: res.headers.get("x-ratelimit-remaining-requests"),
        requestsLimit: res.headers.get("x-ratelimit-limit-requests"),
        tokensRemaining: res.headers.get("x-ratelimit-remaining-tokens"),
        tokensLimit: res.headers.get("x-ratelimit-limit-tokens"),
      },
      api: {
        version: res.headers.get("x-venice-version"),
        requestId: res.headers.get("CF-RAY"),
      },
      models: {
        total: list.length,
        chat: list.filter(
          (m) =>
            m.type === "chat" ||
            (m.id?.includes("llama") ?? false) ||
            (m.id?.includes("glm") ?? false),
        ).length,
        image: list.filter(
          (m) =>
            m.type === "image" ||
            (m.id?.includes("banana") ?? false) ||
            (m.id?.includes("flux") ?? false),
        ).length,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to reach Venice API",
    };
  }
}
