/**
 * Wheel-Size API client for the public vehicle tire finder (fitment v1).
 *
 * Paid quota, public callers. Three guards keep the bill bounded and the answer honest:
 *   - no WHEEL_SIZE_API_KEY: "unconfigured", and no request is made at all;
 *   - an in-memory cache (24 h for lists, 7 d for sizes), ok results only;
 *   - a per-shop-day cap on upstream calls (WHEEL_SIZE_DAILY_CAP, default 4,500 of the
 *     Basic plan's 5,000), counted before the call so a burst cannot overshoot it.
 * An upstream failure is reported as a reason, never as an empty list.
 *
 * In memory only: licence terms for bulk caching are unconfirmed, so nothing is persisted.
 * The key goes into the URL as `user_key` (the API's only auth), so URLs are never logged;
 * log lines carry the path and status only.
 */
import { createLogger } from "../../lib/logger";
import { getBusinessDateKey } from "../../lib/timezoneAssert";

const log = createLogger("services:fitment:wheelSize");

const BASE_URL = "https://api.wheel-size.com/v2";
const REGION = "usdm";
const TIMEOUT_MS = 6_000;
const DEFAULT_DAILY_CAP = 4_500;
const LIST_TTL_MS = 24 * 60 * 60 * 1000;
const SIZES_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2_000;
/** The slug shape the router accepts; upstream items outside it could never be sent back. */
export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** The makes input range; years outside it are not offered. */
export const MIN_YEAR = 1980;
export const MAX_YEAR = 2030;

type FitmentFailure = "unconfigured" | "daily_cap" | "upstream_error" | "not_found";
type FitmentResult<T> = ({ ok: true } & T) | { ok: false; reason: FitmentFailure };

interface FitmentOption { slug: string; name: string }
interface FitmentTrim { slug: string; label: string }
interface FitmentSize { size: string; rimDiameter: number | null; isStock: boolean; rearSize: string | null }

const cache = new Map<string, { expiresAt: number; value: unknown }>();
let usage = { day: "", count: 0 };

/** Test seam: drop the cache and the daily counter. */
export function __resetFitmentForTest(): void {
  cache.clear();
  usage = { day: "", count: 0 };
}

function apiKey(): string | null {
  const key = process.env.WHEEL_SIZE_API_KEY?.trim();
  return key ? key : null;
}

export function isFitmentConfigured(): boolean {
  return apiKey() !== null;
}

function dailyCap(): number {
  const n = Number.parseInt(process.env.WHEEL_SIZE_DAILY_CAP ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_CAP;
}

/** Reserve one upstream call against today's shop-day budget; false when it is spent. */
function reserveCall(): boolean {
  const day = getBusinessDateKey();
  if (usage.day !== day) usage = { day, count: 0 };
  if (usage.count >= dailyCap()) return false;
  usage.count += 1;
  return true;
}

type Params = Record<string, string | number>;
type Fetched = { ok: true; data: unknown[] } | { ok: false; reason: FitmentFailure };

/** GET `path` and return its `data` array. Never throws; every failure is a reason. */
async function getData(path: string, params: Params, key: string): Promise<Fetched> {
  if (!reserveCall()) {
    log.warn(`daily cap reached, ${path} not called`, { cap: dailyCap() });
    return { ok: false, reason: "daily_cap" };
  }
  const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), user_key: key });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}?${query.toString()}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (res.status === 404) {
      log.info(`${path} -> 404`);
      return { ok: false, reason: "not_found" };
    }
    if (!res.ok) {
      log.warn(`${path} -> ${res.status}`);
      return { ok: false, reason: "upstream_error" };
    }
    const body = (await res.json()) as { data?: unknown };
    if (!Array.isArray(body?.data)) {
      log.warn(`${path} -> ${res.status} without a data array`);
      return { ok: false, reason: "upstream_error" };
    }
    return { ok: true, data: body.data };
  } catch (err) {
    // The error name only: a fetch error's message or cause can carry the request URL, key included.
    log.warn(`${path} failed: ${err instanceof Error ? err.name : "unknown"}`);
    return { ok: false, reason: "upstream_error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Unconfigured check, cache, cap, fetch, map, cache: the one path every procedure takes.
 * Only ok results are cached, and only after mapping, so a failure or a throw cannot stick.
 */
async function cached<T extends object>(
  path: string,
  params: Params,
  ttlMs: number,
  map: (data: unknown[]) => T,
): Promise<FitmentResult<T>> {
  const key = apiKey();
  if (!key) return { ok: false, reason: "unconfigured" };

  const cacheKey = `${path}?${Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&")}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.value as FitmentResult<T>;
  if (hit) cache.delete(cacheKey);

  const fetched = await getData(path, params, key);
  if (!fetched.ok) return fetched;
  const value: FitmentResult<T> = { ok: true, ...map(fetched.data) };

  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey, { expiresAt: Date.now() + ttlMs, value });
  return value;
}

type Item = Record<string, unknown>;
const items = (data: unknown[]): Item[] => data.filter((d): d is Item => typeof d === "object" && d !== null);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function options(data: unknown[]): FitmentOption[] {
  return items(data)
    .map((i) => ({ slug: str(i.slug), name: str(i.name) }))
    .filter((o) => SLUG_RE.test(o.slug) && o.name !== "");
}

/** Plain ASCII for a customer-facing label: accents folded ("Coupe"), anything else dropped. */
function ascii(s: string): string {
  return s.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * "WWW/AARDD" for metric sizes, so the chosen size feeds gatewayTire.publicSearch as is.
 * P, LT and ZR are folded away because that normaliser strips only "/", "R" and spaces,
 * and "LT245/75R16" or "225/40ZR18" would come out as a malformed size. Anything else
 * (flotation "31X10.50R15") is returned uppercased, unchanged: the customer still learns it.
 */
function normalizeTireSize(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (!s) return null;
  const m = /^(?:P|LT)?\s*(\d{3})\s*\/\s*(\d{2,3})\s*Z?R\s*(\d{2}(?:\.\d)?)/.exec(s);
  return m ? `${m[1]}/${m[2]}R${m[3]}` : s;
}

// ── Public reads (fitment v1) ───────────────────────────────────────

/** All model years for the US market, newest first. One upstream call per day. */
export function getYears(): Promise<FitmentResult<{ years: number[] }>> {
  return cached("/years/", { region: REGION }, LIST_TTL_MS, (data) => ({
    years: Array.from(new Set(items(data).map((i) => i.name)))
      .filter((y): y is number => Number.isInteger(y) && (y as number) >= MIN_YEAR && (y as number) <= MAX_YEAR)
      .sort((a, b) => b - a),
  }));
}

export function getMakes(year: number): Promise<FitmentResult<{ makes: FitmentOption[] }>> {
  return cached("/makes/", { year, region: REGION }, LIST_TTL_MS, (data) => ({ makes: options(data) }));
}

export function getModels(year: number, make: string): Promise<FitmentResult<{ models: FitmentOption[] }>> {
  return cached("/models/", { make, year, region: REGION }, LIST_TTL_MS, (data) => ({ models: options(data) }));
}

export function getTrims(year: number, make: string, model: string): Promise<FitmentResult<{ trims: FitmentTrim[] }>> {
  return cached("/modifications/", { make, model, year, region: REGION }, LIST_TTL_MS, (data) => {
    const seen = new Set<string>();
    const trims: FitmentTrim[] = [];
    for (const i of items(data)) {
      const slug = str(i.slug);
      if (!SLUG_RE.test(slug)) continue;
      const bodyTypes = Array.isArray(i.trim_body_types) ? i.trim_body_types.map(str).filter(Boolean).join(", ") : "";
      const label = ascii([str(i.trim) || str(i.name), bodyTypes || str(i.body)].filter(Boolean).join(" - ")) || "Standard";
      if (seen.has(label)) continue;
      seen.add(label);
      trims.push({ slug, label });
    }
    return { trims };
  });
}

export function getSizes(
  year: number,
  make: string,
  model: string,
  trim: string,
): Promise<FitmentResult<{ sizes: FitmentSize[] }>> {
  return cached("/search/by_model/", { make, model, year, modification: trim, region: REGION }, SIZES_TTL_MS, (data) => {
    const all: FitmentSize[] = [];
    for (const vehicle of items(data)) {
      for (const wheel of items(Array.isArray(vehicle.wheels) ? vehicle.wheels : [])) {
        const front = (wheel.front ?? {}) as Item;
        const rear = (wheel.rear ?? {}) as Item;
        const size = normalizeTireSize(str(front.tire));
        if (!size) continue;
        const rearRaw = normalizeTireSize(str(rear.tire));
        all.push({
          size,
          rimDiameter: typeof front.rim_diameter === "number" ? front.rim_diameter : null,
          isStock: wheel.is_stock === true,
          rearSize: rearRaw && rearRaw !== size ? rearRaw : null,
        });
      }
    }
    // Stock first (stable), then keep the first of each size + rear pair, so a stock
    // listing wins over an identical optional one.
    const seen = new Set<string>();
    const sizes = [...all.filter((s) => s.isStock), ...all.filter((s) => !s.isStock)].filter((s) => {
      const k = `${s.size}|${s.rearSize ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { sizes };
  });
}
