/**
 * Shared D&K Tire B2B API client.
 *
 * As of 2026-05 D&K Tire migrated b2b.dktire.com from server-rendered
 * auth (POST /auth-signin → cookie) to a SPA backed by
 * api-b2b.dktire.com with OAuth2 password grant → JWT bearer. Every
 * caller in this codebase must use this module instead of hand-rolling
 * the old cookie flow (the legacy /auth-signin URL now serves a static
 * S3 HTML page — auth attempts silently 401, downstream code falls
 * through to a stale catalog).
 *
 * Module-level session cache is shared across callers (gatewayTire
 * router · dataPipelines refresh cron · vendorHealth probe), so we
 * mint one JWT per ~30 min regardless of how many services need it.
 *
 * Surface:
 * - getGatewayToken()       → JWT or null
 * - gatewayFetch(path, opt) → Response or null (auto-attaches Bearer)
 * - searchTiresBySize(size) → tire array or null (POST /quicksearch/cache)
 * - pickWholesaleCost(item) → wholesale cost number (cents-free)
 * - getLastGatewayFailure() → structured failure for diagnostics
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:gatewayClient");

export const GATEWAY_API_BASE = "https://api-b2b.dktire.com";
export const GATEWAY_PORTAL_BASE = "https://b2b.dktire.com";

interface GatewaySession { token: string; expiresAt: number }
interface GatewayFailure { at: string; reason: string; detail?: string }

let session: GatewaySession | null = null;
let lastFailure: GatewayFailure | null = null;

export function getLastGatewayFailure(): GatewayFailure | null { return lastFailure; }

/** Force-invalidate the cached session (test helper / 401 recovery). */
export function invalidateGatewaySession(): void { session = null; }

/** Mint or reuse the cached OAuth2 password-grant bearer token. */
export async function getGatewayToken(): Promise<string | null> {
  if (session && Date.now() < session.expiresAt) return session.token;

  const username = process.env.GATEWAY_TIRE_USERNAME;
  const password = process.env.GATEWAY_TIRE_PASSWORD;
  if (!username || !password) {
    const reason = "GATEWAY_TIRE_USERNAME / GATEWAY_TIRE_PASSWORD env vars not set";
    log.error(`[gatewayClient] AUTH BLOCKED — ${reason}`);
    lastFailure = { at: new Date().toISOString(), reason };
    return null;
  }

  try {
    // 2026-05 NOTE — D&K's API has a server bug where /token returns
    // HTTP 500 "Internal Server Error" instead of a clean 401/422 when
    // the request lacks an Origin header. The same body that 500s
    // without Origin returns a valid access_token WITH Origin set.
    // The Origin header is required by their CORS/security layer even
    // for server-to-server callers — without it auth silently breaks
    // and our search falls through to the curated catalog.
    // Discovered: 2026-05-23 after a 2-hour root-cause hunt.
    const res = await fetch(`${GATEWAY_API_BASE}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "Origin": GATEWAY_PORTAL_BASE,
        "Referer": `${GATEWAY_PORTAL_BASE}/`,
        "User-Agent": "Mozilla/5.0 (compatible; NicksTire/1.0; +https://nickstire.org)",
      },
      body: `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const reason = `Auth /token returned HTTP ${res.status}`;
      let detail = "";
      try { detail = (await res.text()).slice(0, 240); } catch { /* body read failed */ }
      log.error(`[gatewayClient] AUTH BLOCKED — ${reason}. ${detail}`);
      lastFailure = { at: new Date().toISOString(), reason, detail };
      return null;
    }

    const data = await res.json() as { access_token?: string; token_type?: string };
    if (!data.access_token) {
      const reason = "Auth /token returned 200 but no access_token in response";
      log.error(`[gatewayClient] AUTH BLOCKED — ${reason}`);
      lastFailure = { at: new Date().toISOString(), reason };
      return null;
    }

    // 30-min cap to bound staleness in case the token is silently revoked.
    session = { token: data.access_token, expiresAt: Date.now() + 30 * 60 * 1000 };
    lastFailure = null;
    return data.access_token;
  } catch (err) {
    const reason = "Auth request threw";
    const detail = err instanceof Error ? err.message : String(err);
    log.error(`[gatewayClient] AUTH BLOCKED — ${reason}: ${detail}`);
    lastFailure = { at: new Date().toISOString(), reason, detail };
    return null;
  }
}

/** Authenticated fetch against api-b2b.dktire.com. Returns null if auth fails. */
export async function gatewayFetch(path: string, options: RequestInit = {}): Promise<Response | null> {
  const token = await getGatewayToken();
  if (!token) return null;
  try {
    return await fetch(`${GATEWAY_API_BASE}${path}`, {
      ...options,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
        // Mirror the same browser-context headers we send to /token —
        // D&K's API layer rejects non-browser-shaped requests at every
        // endpoint, not just /token. Search calls without Origin
        // return HTTP 500 the same way auth does.
        "Origin": GATEWAY_PORTAL_BASE,
        "Referer": `${GATEWAY_PORTAL_BASE}/`,
        "User-Agent": "Mozilla/5.0 (compatible; NicksTire/1.0; +https://nickstire.org)",
        ...options.headers,
      },
    });
  } catch (err) {
    log.error("[gatewayClient] fetch threw:", err);
    return null;
  }
}

/**
 * Search D&K inventory by tire size. Returns the raw array from the
 * /quicksearch/cache endpoint (one element per tire offering, with
 * nested pricing_data per shipping location), or null on auth/search
 * failure. Requires GATEWAY_TIRE_SHIP_TO env var (account-specific
 * global_address_id UUID).
 *
 * Size accepted in any common form ("215/60R16" or "2156016") — we
 * normalize to D&K's "215/60R16" canonical format.
 */
export async function searchTiresBySize(rawSize: string): Promise<Record<string, unknown>[] | null> {
  const shipTo = process.env.GATEWAY_TIRE_SHIP_TO;
  if (!shipTo) {
    const reason = "GATEWAY_TIRE_SHIP_TO env var not set";
    const detail = "The /quicksearch/cache endpoint requires the account's global_address_id (UUID). Find it in the b2b.dktire.com dashboard state after sign-in, or contact D&K support. Set GATEWAY_TIRE_SHIP_TO on Railway.";
    log.error(`[gatewayClient] SEARCH BLOCKED — ${reason}`);
    lastFailure = { at: new Date().toISOString(), reason, detail };
    return null;
  }

  const sizeClean = rawSize.replace(/[\/Rr\s-]/g, "");
  const sizeFormatted = sizeClean.length >= 7
    ? `${sizeClean.slice(0, 3)}/${sizeClean.slice(3, 5)}R${sizeClean.slice(5)}`
    : rawSize;

  const res = await gatewayFetch("/quicksearch/cache", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dk_size_number: sizeFormatted,
      ship_to: shipTo,
      sorting_order: "default",
      dk_part_number: null,
      dk_major_rec_id: null,
      search_category: null,
      rim_size: null,
      search_on: null,
      dk_part_number_list: [],
      user_agent: null,
      user_agent_os: null,
      user_agent_browser: null,
      add_to_search_history: null,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res) return null;
  if (!res.ok) {
    log.warn(`[gatewayClient] /quicksearch/cache returned HTTP ${res.status} for ${sizeFormatted}`);
    // Re-auth on 401 in case the JWT was silently revoked; next call retries.
    if (res.status === 401) {
      session = null;
      lastFailure = { at: new Date().toISOString(), reason: "Search 401 — token expired/revoked, retry on next call" };
    }
    return null;
  }

  try {
    const data = await res.json();
    if (!Array.isArray(data)) {
      log.warn("[gatewayClient] /quicksearch/cache returned non-array shape");
      return null;
    }
    return data as Record<string, unknown>[];
  } catch (err) {
    log.error("[gatewayClient] /quicksearch/cache JSON parse failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Pull wholesale cost from a D&K /quicksearch/cache item. The endpoint
 * nests pricing under `pricing_data[]` (one entry per shipping
 * location). We pick the first entry's cost_price.
 */
export function pickWholesaleCost(item: Record<string, unknown>): number {
  const pricing = item.pricing_data;
  if (Array.isArray(pricing) && pricing.length > 0) {
    const first = pricing[0] as Record<string, unknown>;
    const cost = first.cost_price;
    if (typeof cost === "number" && cost > 0) return cost;
  }
  return 0;
}
