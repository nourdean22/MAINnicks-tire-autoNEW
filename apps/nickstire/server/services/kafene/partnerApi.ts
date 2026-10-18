/**
 * Kafene Partner API (server side). Shapes from Kafene's own WooCommerce plugin v2.0.0:
 *   POST /v2/auth/token   header kafene_api_key, body { merchant_id } -> data.access_token
 *   GET  /v2/me           Bearer -> { merchant: { max_approval_amount } } (dollars, may be null)
 *   POST /v2/applications/{uid}/activate  Bearer, { delivery_date: "YYYY-MM-DD" }
 *   POST /v2/applications/{uid}/cancel    Bearer, { reason }
 * Base: https://partner-api.kafene.com (production) or https://staging-partner-api.kafene.com.
 *
 * Off unless KAFENE_MERCHANT_ID, KAFENE_STORE_ID and KAFENE_API_KEY are all set. Log lines carry
 * the path and the HTTP status only: never the API key, the bearer token or a response body.
 */
import { createLogger } from "../../lib/logger";

const log = createLogger("services:kafene:partnerApi");

const TIMEOUT_MS = 10_000;
const TOKEN_TTL_MS = 10 * 60_000; // the plugin does not publish the lifetime; re-auth on 401 anyway
const LIMIT_TTL_MS = 60 * 60_000;
const LIMIT_FAILURE_TTL_MS = 60_000; // config is public: a Kafene outage must not become a call per page view

export interface KafeneEnv { merchantId: string; storeId: string; apiKey: string; environment: "sandbox" | "production" }
/** `message`: the error text Kafene sent with a non-2xx (message / detail / error), for the caller to read; never logged. */
export type KafeneCall = { ok: true; body: unknown } | { ok: false; status: number | null; message?: string };

/** The env, or null when any of the three ids is missing or blank (Kafene is then off). */
export function kafeneEnv(): KafeneEnv | null {
  const merchantId = process.env.KAFENE_MERCHANT_ID?.trim();
  const storeId = process.env.KAFENE_STORE_ID?.trim();
  const apiKey = process.env.KAFENE_API_KEY?.trim();
  if (!merchantId || !storeId || !apiKey) return null;
  const environment = process.env.KAFENE_ENVIRONMENT?.trim().toLowerCase() === "production" ? "production" : "sandbox";
  return { merchantId, storeId, apiKey, environment };
}

const baseUrl = (env: KafeneEnv) =>
  env.environment === "production" ? "https://partner-api.kafene.com" : "https://staging-partner-api.kafene.com";

let token: { value: string; expiresAt: number; owner: string } | null = null;
let tokenInFlight: Promise<string | null> | null = null;
const ownerOf = (env: KafeneEnv) => `${env.environment}|${env.merchantId}`;

async function mintToken(env: KafeneEnv): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl(env)}/v2/auth/token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", kafene_api_key: env.apiKey },
      body: JSON.stringify({ merchant_id: env.merchantId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) {
      log.warn(`/v2/auth/token -> ${res.status}`);
      return null;
    }
    const body = (await res.json()) as Record<string, unknown> | null;
    const data = body?.data as Record<string, unknown> | undefined;
    const found = [data?.access_token, body?.token, body?.access_token, body?.bearer_token].find((v) => typeof v === "string" && v !== "");
    if (!found) log.warn("/v2/auth/token -> 200 without a token");
    return (found as string | undefined) ?? null;
  } catch (err) {
    log.warn(`/v2/auth/token failed: ${err instanceof Error ? err.name : "unknown"}`);
    return null;
  }
}

/** The bearer, cached 10 min; concurrent callers share one /v2/auth/token call. */
async function bearer(env: KafeneEnv): Promise<string | null> {
  if (token && token.owner === ownerOf(env) && Date.now() < token.expiresAt) return token.value;
  if (tokenInFlight) return tokenInFlight;
  tokenInFlight = mintToken(env).then((t) => {
    if (t) token = { value: t, expiresAt: Date.now() + TOKEN_TTL_MS, owner: ownerOf(env) };
    return t;
  }).finally(() => { tokenInFlight = null; });
  return tokenInFlight;
}

/**
 * One authenticated call. A 401 means Kafene did not act on it, so it re-authenticates and
 * sends it once more; any other failure is returned as-is, never retried.
 */
async function call(env: KafeneEnv, method: "GET" | "POST", path: string, body?: unknown): Promise<KafeneCall> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await bearer(env);
    if (!t) return { ok: false, status: null };
    let res: Response;
    try {
      res = await fetch(`${baseUrl(env)}${path}`, {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${t}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      log.warn(`${path} failed: ${err instanceof Error ? err.name : "unknown"}`);
      return { ok: false, status: null };
    }
    if (res.status === 401 && attempt === 0) {
      if (token?.value === t) token = null;
      continue;
    }
    if (!res.ok) {
      log.warn(`${path} -> ${res.status}`);
      let message: string | undefined;
      try {
        const b = (await res.json()) as Record<string, unknown> | null;
        const m = [b?.message, b?.detail, b?.error].find((v) => typeof v === "string" && v !== "");
        message = typeof m === "string" ? m.slice(0, 300) : undefined;
      } catch { /* no JSON body */ }
      return { ok: false, status: res.status, message };
    }
    try {
      return { ok: true, body: await res.json() };
    } catch {
      return { ok: true, body: null };
    }
  }
  return { ok: false, status: 401 };
}

let limit: { cents: number | null; expiresAt: number; owner: string } | null = null;

/**
 * The merchant's maximum approval, in cents. null = unknown (failed read) OR Kafene publishes
 * none: either way the caller must not treat it as a limit of 0.
 */
export async function maxApprovalCents(env: KafeneEnv): Promise<number | null> {
  if (limit && limit.owner === ownerOf(env) && Date.now() < limit.expiresAt) return limit.cents;
  const r = await call(env, "GET", "/v2/me");
  const merchant = r.ok ? ((r.body as Record<string, unknown> | null)?.merchant as Record<string, unknown> | undefined) : undefined;
  const raw = merchant?.max_approval_amount;
  const known = r.ok && merchant !== undefined && "max_approval_amount" in merchant && (raw === null || typeof raw === "number");
  if (!known) {
    if (r.ok) log.warn("/v2/me -> 200 without merchant.max_approval_amount");
    limit = { cents: null, expiresAt: Date.now() + LIMIT_FAILURE_TTL_MS, owner: ownerOf(env) };
    return null;
  }
  const cents = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw * 100) : null;
  limit = { cents, expiresAt: Date.now() + LIMIT_TTL_MS, owner: ownerOf(env) };
  return cents;
}

export function activateLease(env: KafeneEnv, uid: string, deliveryDate: string): Promise<KafeneCall> {
  return call(env, "POST", `/v2/applications/${encodeURIComponent(uid)}/activate`, { delivery_date: deliveryDate });
}

export function cancelLease(env: KafeneEnv, uid: string, reason: string): Promise<KafeneCall> {
  return call(env, "POST", `/v2/applications/${encodeURIComponent(uid)}/cancel`, { reason });
}
