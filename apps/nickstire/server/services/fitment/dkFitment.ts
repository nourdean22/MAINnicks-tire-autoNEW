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
/** D&K values carry spaces and punctuation ("Alfa Romeo", "CR-V", "Type R"); anything else is refused. */
export const VALUE_RE = /^[A-Za-z0-9 .&'/+-]{1,40}$/;
/** The makes input range; years outside it are not offered. */
export const MIN_YEAR = 1980;
export const MAX_YEAR = 2030;

type FitmentFailure = "unconfigured" | "upstream_error" | "not_found";
type FitmentResult<T> = ({ ok: true } & T) | { ok: false; reason: FitmentFailure };
interface FitmentOption { slug: string; name: string }
interface FitmentTrim { slug: string; label: string }
interface FitmentSize { size: string; rimDiameter: number | null; rearSize: null }

const cache = new Map<string, { expiresAt: number; value: unknown }>();
let loginFailedUntil = 0;

/** Test seam: drop the cache and the remembered login failure. */
export function __resetFitmentForTest(): void {
  cache.clear();
  loginFailedUntil = 0;
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

/** GET a quicksearch path and return its array body. Never throws; every failure is a reason. */
async function getArray(path: string, params: Params): Promise<Fetched> {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await gatewayFetch(query ? `${path}?${query}` : path, {
      signal: controller.signal,
      headers: { Timezone: BUSINESS.timezone },
    });
    // null = the request threw (timeout, network) or the session vanished since token(); gatewayClient logged it.
    if (!res) return { ok: false, reason: "upstream_error" };
    // D&K answers 400 {"detail":"Invalid submodel value"} for a value it does not know.
    if (res.status === 400 || res.status === 404) {
      log.info(`${path} -> ${res.status}`);
      return { ok: false, reason: "not_found" };
    }
    if (!res.ok) {
      if (res.status === 401) invalidateGatewaySession();
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

/**
 * Login check, cache, fetch, map, cache: the one path every read takes.
 * Only ok results are cached, and only after mapping, so a failure or a throw cannot stick.
 */
async function cached<T extends object>(
  path: string,
  params: Params,
  ttlMs: number,
  map: (data: unknown[]) => T,
): Promise<FitmentResult<T>> {
  if (!(await token())) return { ok: false, reason: "unconfigured" };

  const cacheKey = `${path}?${Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&")}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.value as FitmentResult<T>;
  if (hit) cache.delete(cacheKey);

  const fetched = await getArray(path, params);
  if (!fetched.ok) return fetched;
  const value: FitmentResult<T> = { ok: true, ...map(fetched.data) };

  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey, { expiresAt: Date.now() + ttlMs, value });
  return value;
}

/** D&K's { value, label } items, trimmed, keeping only values the router would accept back. */
function pairs(data: unknown[]): { value: string; label: string }[] {
  return data
    .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
    .map((d) => ({
      value: typeof d.value === "string" ? d.value.trim() : "",
      label: typeof d.label === "string" ? d.label.trim() : "",
    }))
    .filter((p) => VALUE_RE.test(p.value) && p.label !== "");
}

/**
 * "WWW/AARDD" for metric sizes, so the chosen size feeds gatewayTire.publicSearch as is:
 * that normaliser strips only "/", "R" and spaces, so "LT245/75R16" or "225/40ZR18" would come
 * out malformed. Anything else (flotation "31X10.50R15") is returned uppercased, unchanged.
 */
function normalizeTireSize(raw: string): string {
  const s = raw.trim().toUpperCase();
  const m = /^(?:P|LT)?\s*(\d{3})\s*\/\s*(\d{2,3})\s*Z?R\s*(\d{2}(?:\.\d)?)/.exec(s);
  return m ? `${m[1]}/${m[2]}R${m[3]}` : s;
}

// ── Public reads (fitment v1) ───────────────────────────────────────

/** Model years D&K knows, newest first. */
export function getYears(): Promise<FitmentResult<{ years: number[] }>> {
  return cached("/quicksearch/list-all-year", {}, LIST_TTL_MS, (data) => ({
    years: Array.from(new Set(pairs(data).map((p) => Number(p.value))))
      .filter((y) => Number.isInteger(y) && y >= MIN_YEAR && y <= MAX_YEAR)
      .sort((a, b) => b - a),
  }));
}

export function getMakes(year: number): Promise<FitmentResult<{ makes: FitmentOption[] }>> {
  return cached("/quicksearch/get-make-by-year", { year }, LIST_TTL_MS, (data) => ({
    makes: pairs(data).map((p) => ({ slug: p.value, name: p.label })),
  }));
}

export function getModels(year: number, make: string): Promise<FitmentResult<{ models: FitmentOption[] }>> {
  return cached("/quicksearch/get-model-by-year-make", { year, make }, LIST_TTL_MS, (data) => ({
    models: pairs(data).map((p) => ({ slug: p.value, name: p.label })),
  }));
}

export function getTrims(year: number, make: string, model: string): Promise<FitmentResult<{ trims: FitmentTrim[] }>> {
  return cached("/quicksearch/get-sub-model-by-year-make", { year, make, model }, LIST_TTL_MS, (data) => ({
    trims: pairs(data).map((p) => ({ slug: p.value, label: p.label })),
  }));
}

export function getSizes(
  year: number,
  make: string,
  model: string,
  submodel: string,
): Promise<FitmentResult<{ sizes: FitmentSize[] }>> {
  const path = "/quicksearch/get-tire-size-by-year-make-model-submodel";
  return cached(path, { year, make, model, submodel }, SIZES_TTL_MS, (data) => {
    const seen = new Set<string>();
    const sizes: FitmentSize[] = [];
    for (const item of data) {
      const raw = typeof item === "object" && item !== null ? (item as Record<string, unknown>).value : undefined;
      if (typeof raw !== "string" || raw.trim() === "") continue;
      const size = normalizeTireSize(raw);
      if (seen.has(size)) continue;
      seen.add(size);
      const rim = /R(\d{2}(?:\.\d)?)/.exec(size);
      // D&K returns no stock flag and no rear size; neither is invented here.
      sizes.push({ size, rimDiameter: rim ? Number(rim[1]) : null, rearSize: null });
    }
    return { sizes };
  });
}
