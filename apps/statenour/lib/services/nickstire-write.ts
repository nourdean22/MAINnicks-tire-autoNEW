/**
 * nickstire-write — bridge writes from statenour-os to nickstire.org admin.
 *
 * v10.0.270 · companion to lib/services/bridge.ts (which is read-only).
 * VAPI tool handlers and any future write-side flows go through here so
 * the canonical record lives where it belongs:
 *
 *   statenour-os (bdnick.info) · personal OS · brain memory + dashboards
 *   nickstire.org/admin           · BUSINESS OPS · Auto Labor Guide CRM
 *
 * Pattern · "forward first, fall back to brainMemory" so a temporary
 * nickstire outage doesn't drop incoming voice / chat data.
 *
 * Required nickstire endpoints (to be implemented in the nickstire repo) ·
 *   POST /api/bridge/dropoff           · log a drop-off request
 *   POST /api/bridge/callback          · log a callback request
 *   GET  /api/bridge/customer-lookup   · look up by phone (returns name + visit count)
 *
 * All bridge writes authenticate via X-Bridge-Key header (BRIDGE_API_KEY
 * env var · same key the read-bridge uses).
 *
 * On success · returns { ok: true, ...response }.
 * On failure · returns { ok: false, reason } so the caller can fall
 * back to local persistence + log the bridge miss.
 */

import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/nickstire-write");

const TIMEOUT_MS = 5_000;

interface BridgeResult<T> {
  ok: true;
  data: T;
  via: "bridge";
}
interface BridgeMiss {
  ok: false;
  reason: string;
  via: "bridge-miss";
}
type BridgeOutcome<T> = BridgeResult<T> | BridgeMiss;

function bridgeConfig(): { url: string; key: string } | null {
  const url = process.env.NICKS_ADMIN_URL || process.env.NICKSTIRE_BRIDGE_URL;
  const key = process.env.BRIDGE_API_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

async function bridgePost<T>(
  path: string,
  body: unknown,
): Promise<BridgeOutcome<T>> {
  const cfg = bridgeConfig();
  if (!cfg) {
    return { ok: false, reason: "bridge_env_unset", via: "bridge-miss" };
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.url}${path}`, {
      method: "POST",
      headers: {
        "X-Bridge-Key": cfg.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ac.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.warn("bridge_post_http_error", { path, status: res.status, body: text.slice(0, 200) });
      return { ok: false, reason: `http_${res.status}`, via: "bridge-miss" };
    }
    const data = (await res.json()) as T;
    return { ok: true, data, via: "bridge" };
  } catch (err) {
    clearTimeout(t);
    log.warn("bridge_post_fetch_error", {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "network_error", via: "bridge-miss" };
  }
}

async function bridgeGet<T>(
  path: string,
  query?: Record<string, string>,
): Promise<BridgeOutcome<T>> {
  const cfg = bridgeConfig();
  if (!cfg) {
    return { ok: false, reason: "bridge_env_unset", via: "bridge-miss" };
  }
  const qs = query
    ? "?" +
      Object.entries(query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&")
    : "";
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.url}${path}${qs}`, {
      headers: { "X-Bridge-Key": cfg.key },
      signal: ac.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (!res.ok) {
      log.warn("bridge_get_http_error", { path, status: res.status });
      return { ok: false, reason: `http_${res.status}`, via: "bridge-miss" };
    }
    const data = (await res.json()) as T;
    return { ok: true, data, via: "bridge" };
  } catch (err) {
    clearTimeout(t);
    log.warn("bridge_get_fetch_error", {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "network_error", via: "bridge-miss" };
  }
}

// ── Public surface ─────────────────────────────────────────────────

export interface DropoffPayload {
  source: string;
  vapiCallId?: string | null;
  capturedAt: string;
  name: string | null;
  phone: string | null;
  vehicle: { year: string | number | null; make: string | null; model: string | null };
  concern: string | null;
  preferredTime: string | null;
  driveable: boolean | string | null;
  returningCustomer: boolean | string | null;
}

export async function postDropoffToNickstire(
  payload: DropoffPayload,
): Promise<BridgeOutcome<{ id?: string; ticketUrl?: string }>> {
  return bridgePost("/api/bridge/dropoff", payload);
}

export interface CallbackPayload {
  source: string;
  vapiCallId?: string | null;
  capturedAt: string;
  name: string | null;
  phone: string | null;
  reason: string | null;
  urgency: string;
  preferredTime: string | null;
  language: string;
}

export async function postCallbackToNickstire(
  payload: CallbackPayload,
): Promise<BridgeOutcome<{ id?: string; ticketUrl?: string }>> {
  return bridgePost("/api/bridge/callback", payload);
}

export interface CustomerLookupResult {
  found: boolean;
  name?: string | null;
  phone?: string | null;
  visitCount?: number;
  lastVisitAt?: string | null;
  notes?: string | null;
}

export async function lookupCustomerOnNickstire(
  phoneE164OrLast10: string,
): Promise<BridgeOutcome<CustomerLookupResult>> {
  return bridgeGet("/api/bridge/customer-lookup", { phone: phoneE164OrLast10 });
}
