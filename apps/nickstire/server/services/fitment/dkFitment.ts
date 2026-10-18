/**
 * Vehicle fitment for the public tire finder (fitment v1), from D&K's b2b quicksearch API:
 * year > make > model > submodel -> OE tire sizes. Same login as the tire search
 * (gatewayClient.ts: GATEWAY_TIRE_USERNAME / GATEWAY_TIRE_PASSWORD), no per-call billing.
 *
 * Every read returns { ok: true, ... } or { ok: false, reason }; an upstream failure is never
 * an empty list. No working login is "unconfigured" and makes no data call; a failed login is
 * remembered for 60 s so public reads cannot turn into a /token call each. Results are cached
 * in memory only (lists 24 h, sizes 7 d, ok results only, bounded). Log lines carry the path
 * and status only; the bearer token lives in a header and is never logged.
 */
import { BUSINESS } from "@shared/business";
import { createLogger } from "../../lib/logger";
import { getGatewayToken, gatewayFetch, invalidateGatewaySession } from "../gatewayClient";

const log = createLogger("services:fitment:dkFitment");

const TIMEOUT_MS = 6_000;
const LOGIN_FAILURE_TTL_MS = 60_000;
const LIST_TTL_MS = 24 * 60 * 60 * 1000;
const SIZES_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2_000;
const NEGATIVE_TTL_MS = 30_000;
/** D&K values carry spaces and punctuation ("Alfa Romeo", "CR-V", "Type R"); anything else is refused. */
export const VALUE_RE = /^[A-Za-z0-9 .&'/+-]{1,40}$/;
/** The makes input range; years outside it are not offered. */
export const MIN_YEAR = 1980;
export const MAX_YEAR = 2030;

type FitmentFailure = "unconfigured" | "upstream_error" | "not_found" | "rate_limited";
type FitmentResult<T> = ({ ok: true } & T) | { ok: false; reason: FitmentFailure };
interface FitmentOption { slug: string; name: string }
interface FitmentTrim { slug: string; label: string }
/** size: WWW/AARDD when metric (feeds publicSearch), else the raw size; label: the raw size as D&K wrote it. */
interface FitmentSize { size: string; label: string; rimDiameter: number | null; rearSize: null; searchable: boolean }

const cache = new Map<string, { expiresAt: number; value: unknown }>();
/** One D&K call per cache key at a time: N identical in-flight reads share it. */
const inFlight = new Map<string, Promise<unknown>>();
let loginFailedUntil = 0;

// ── Per-call rate limit ─────────────────────────────────────────────
// The app-wide apiLimiter counts HTTP requests, and one batched request
// (/api/trpc/fitment.sizes,fitment.sizes,...?batch=1) carries N calls, so the
// fitment reads are limited per CALL here, per client IP.
const LIMITS = [
  { windowMs: 60_000, max: 20 },
  { windowMs: 15 * 60_000, max: 120 },
] as const;
const MAX_TRACKED_IPS = 5_000;
const callsByIp = new Map<string, number[]>();

/** Count one fitment call for this IP; false when it is over either window. */
export function takeFitmentCall(ip: string): boolean {
  const now = Date.now();
  const longest = LIMITS[LIMITS.length - 1].windowMs;
  const recent = (callsByIp.get(ip) ?? []).filter((t) => now - t < longest);
  if (LIMITS.some((l) => recent.filter((t) => now - t < l.windowMs).length >= l.max)) {
    callsByIp.set(ip, recent);
    return false;
  }
  recent.push(now);
  callsByIp.delete(ip); // re-insert so the oldest-active IP is evicted first
  callsByIp.set(ip, recent);
  if (callsByIp.size > MAX_TRACKED_IPS) callsByIp.delete(callsByIp.keys().next().value as string);
  return true;
}

/** The bearer token, or null. A null is remembered for 60 s; a token is cached by gatewayClient. */
async function token(): Promise<string | null> {
  if (Date.now() < loginFailedUntil) return null;
  const t = await getGatewayToken();
  if (!t) loginFailedUntil = Date.now() + LOGIN_FAILURE_TTL_MS;
  return t;
}

export async function isFitmentAvailable(): Promise<boolean> {
  return (await token()) !== null;
}

type Params = Record<string, string | number>;
type Fetched = { ok: true; data: unknown[] } | { ok: false; reason: FitmentFailure };

/**
 * GET a quicksearch path and return its array body. Never throws; every failure is a reason.
 * `notFoundOk`: only the reads whose input can be stale (trims, sizes) may answer not_found;
 * a 4xx on years/makes/models is D&K breaking the contract, so it is upstream_error.
 */
async function getArray(path: string, params: Params, notFoundOk: boolean): Promise<Fetched> {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const used = await getGatewayToken(); // the token gatewayFetch will send (cached session)
    const res = await gatewayFetch(query ? `${path}?${query}` : path, {
      signal: controller.signal,
      headers: { Timezone: BUSINESS.timezone },
    });
    // null = the request threw (timeout, network) or the session vanished since token(); gatewayClient logged it.
    if (!res) return { ok: false, reason: "upstream_error" };
    // D&K answers 400 {"detail":"Invalid submodel value"} for a value it does not know.
    if (notFoundOk && (res.status === 400 || res.status === 404)) {
      log.info(`${path} -> ${res.status}`);
      return { ok: false, reason: "not_found" };
    }
    if (!res.ok) {
      if (res.status === 401) invalidateGatewaySession(used ?? undefined);
      log.warn(`${path} -> ${res.status}`);
      return { ok: false, reason: "upstream_error" };
    }
    const body: unknown = await res.json();
    if (!Array.isArray(body)) {
      log.warn(`${path} -> ${res.status} without an array body`);
      return { ok: false, reason: "upstream_error" };
    }
    return { ok: true, data: body };
  } catch (err) {
    log.warn(`${path} failed: ${err instanceof Error ? err.name : "unknown"}`);
    return { ok: false, reason: "upstream_error" };
  } finally {
    clearTimeout(timer);
  }
}

function remember(cacheKey: string, value: unknown, ttlMs: number): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey, { expiresAt: Date.now() + ttlMs, value });
}

/**
 * Login check, cache, single flight, fetch, map, cache: the one path every read takes.
 * An ok result is cached for its TTL; not_found and upstream_error for 30 s, so a repeated bad
 * input or a D&K outage does not re-hit D&K on every call.
 */
async function cached<T extends object>(
  path: string,
  params: Params,
  ttlMs: number,
  notFoundOk: boolean,
  map: (data: unknown[]) => T | null,
): Promise<FitmentResult<T>> {
  if (!(await token())) return { ok: false, reason: "unconfigured" };

  const cacheKey = `${path}?${Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&")}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.value as FitmentResult<T>;
  if (hit) cache.delete(cacheKey);

  const running = inFlight.get(cacheKey);
  if (running) return running as Promise<FitmentResult<T>>;
  const work = (async (): Promise<FitmentResult<T>> => {
    const fetched = await getArray(path, params, notFoundOk);
    if (!fetched.ok) {
      remember(cacheKey, fetched, NEGATIVE_TTL_MS);
      return fetched;
    }
    const mapped = map(fetched.data);
    if (mapped === null) {
      // D&K sent rows but none we can use (missing fields, wrong types, values outside VALUE_RE):
      // that is a broken answer, not "D&K has none" (an empty array stays ok with []).
      log.warn(`${path} -> ${fetched.data.length} rows, none usable`);
      const failed = { ok: false as const, reason: "upstream_error" as const };
      remember(cacheKey, failed, NEGATIVE_TTL_MS);
      return failed;
    }
    const value: FitmentResult<T> = { ok: true, ...mapped };
    remember(cacheKey, value, ttlMs);
    return value;
  })().finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, work);
  return work;
}

/**
 * D&K's { value, label } items, trimmed, keeping only values the router would accept back.
 * null when D&K sent rows and none survive: the caller reports that as upstream_error.
 */
function pairs(data: unknown[]): { value: string; label: string }[] | null {
  const kept = data
    .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
    .map((d) => ({
      value: typeof d.value === "string" ? d.value.trim() : "",
      label: typeof d.label === "string" ? d.label.trim() : "",
    }))
    .filter((p) => VALUE_RE.test(p.value) && p.label !== "");
  return data.length > 0 && kept.length === 0 ? null : kept;
}

/**
 * "WWW/AARDD" for metric sizes, so the chosen size feeds gatewayTire.publicSearch as is:
 * that normaliser strips only "/", "R" and spaces, so "LT245/75R16" or "225/40ZR18" would come
 * out malformed. Anything else (flotation "31X10.50R15") is not searchable there: null.
 * `prefix` is the service class before the width ("LT", "ST", "P"), or "" when there is none.
 */
function metricSize(label: string): { size: string; prefix: string } | null {
  const m = /^([A-Z]{1,3})?\s*(\d{3})\s*\/\s*(\d{2,3})\s*Z?R\s*(\d{2}(?:\.\d)?)/.exec(label);
  return m ? { size: `${m[2]}/${m[3]}R${m[4]}`, prefix: m[1] ?? "" } : null;
}

// ── Public reads (fitment v1) ───────────────────────────────────────

/** Model years D&K knows, newest first. */
export function getYears(): Promise<FitmentResult<{ years: number[] }>> {
  return cached("/quicksearch/list-all-year", {}, LIST_TTL_MS, false, (data) => {
    const p = pairs(data);
    return p && {
      years: Array.from(new Set(p.map((x) => Number(x.value))))
        .filter((y) => Number.isInteger(y) && y >= MIN_YEAR && y <= MAX_YEAR)
        .sort((a, b) => b - a),
    };
  });
}

export function getMakes(year: number): Promise<FitmentResult<{ makes: FitmentOption[] }>> {
  return cached("/quicksearch/get-make-by-year", { year }, LIST_TTL_MS, false, (data) => {
    const p = pairs(data);
    return p && { makes: p.map((x) => ({ slug: x.value, name: x.label })) };
  });
}

export function getModels(year: number, make: string): Promise<FitmentResult<{ models: FitmentOption[] }>> {
  return cached("/quicksearch/get-model-by-year-make", { year, make }, LIST_TTL_MS, false, (data) => {
    const p = pairs(data);
    return p && { models: p.map((x) => ({ slug: x.value, name: x.label })) };
  });
}

export function getTrims(year: number, make: string, model: string): Promise<FitmentResult<{ trims: FitmentTrim[] }>> {
  return cached("/quicksearch/get-sub-model-by-year-make", { year, make, model }, LIST_TTL_MS, true, (data) => {
    const p = pairs(data);
    return p && { trims: p.map((x) => ({ slug: x.value, label: x.label })) };
  });
}

export function getSizes(
  year: number,
  make: string,
  model: string,
  submodel: string,
): Promise<FitmentResult<{ sizes: FitmentSize[] }>> {
  const path = "/quicksearch/get-tire-size-by-year-make-model-submodel";
  return cached(path, { year, make, model, submodel }, SIZES_TTL_MS, true, (data) => {
    const seen = new Set<string>();
    const sizes: FitmentSize[] = [];
    for (const item of data) {
      const raw = typeof item === "object" && item !== null ? (item as Record<string, unknown>).value : undefined;
      if (typeof raw !== "string" || raw.trim() === "") continue;
      const label = raw.trim().toUpperCase();
      const metric = metricSize(label);
      const size = metric?.size ?? label;
      // Not searchable, so the client shows a call-us row: a decimal rim (22.5) because the size
      // search drops the dot (R225); an LT/ST (any non-P) service class because the search cannot
      // filter by construction or load range and would offer passenger tires for a truck size.
      // shortcut: LT/ST sizes are call-us only; filter publicSearch results by D&K's LT/load-range field to make them searchable again.
      const searchable = metric !== null && !metric.size.includes(".") && (metric.prefix === "" || metric.prefix === "P");
      const key = `${size}|${searchable}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const rim = /R(\d{2}(?:\.\d)?)/.exec(size);
      // D&K returns no stock flag and no rear size; neither is invented here.
      sizes.push({ size, label, rimDiameter: rim ? Number(rim[1]) : null, rearSize: null, searchable });
    }
    return data.length > 0 && sizes.length === 0 ? null : { sizes };
  });
}
