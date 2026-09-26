/**
 * NHTSA vehicle-data adapter.
 *
 * VIN HTTP ownership lives in vinDecode.ts. This module keeps the admin
 * response shape stable and owns only year/make/model recall awareness.
 */
import {
  _clearVinDecodeCache,
  decodeVinForLookup as decodeCanonicalVin,
  normalizeVinForLookup,
} from "./vinDecode";

const RECALLS_BASE = "https://api.nhtsa.gov/recalls/recallsByVehicle";
const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 24 * 3_600_000;
const CACHE_MAX = 500;
const SOURCE_LABEL = "NHTSA (public federal data)";

interface CacheEntry<T> {
  at: number;
  value: T;
}

const recallCache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | null {
  const hit = recallCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    recallCache.delete(key);
    return null;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown): void {
  if (recallCache.size >= CACHE_MAX) {
    const oldest = recallCache.keys().next().value;
    if (oldest !== undefined) recallCache.delete(oldest);
  }
  recallCache.set(key, { at: Date.now(), value });
}

async function nhtsaFetch(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "User-Agent": "nickstire-admin/1.0 (lead enrichment)" },
  });
  if (!res.ok) throw new Error("NHTSA " + res.status);
  return res.json();
}

export interface VinDecodeResult {
  ok: true;
  source: string;
  fetchedAt: string;
  vin: string;
  year: string | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  bodyClass: string | null;
  driveType: string | null;
  engineCylinders: string | null;
  fuelType: string | null;
}

export interface VehicleDataError {
  ok: false;
  error: string;
  source: string;
}

/**
 * Compatibility adapter for the existing admin tRPC payload.
 * The network request and vPIC mapping are canonical in vinDecode.ts.
 */
export async function decodeVin(vinRaw: string): Promise<VinDecodeResult | VehicleDataError> {
  const vin = normalizeVinForLookup(vinRaw);
  if (!vin) {
    return { ok: false, error: "invalid VIN format", source: SOURCE_LABEL };
  }

  const decoded = await decodeCanonicalVin(vin);
  if (!decoded) {
    return { ok: false, error: "NHTSA decode unavailable", source: SOURCE_LABEL };
  }

  return {
    ok: true,
    source: SOURCE_LABEL,
    fetchedAt: decoded.fetchedAt,
    vin: decoded.vin,
    year: decoded.year,
    // Preserve the historical admin payload casing while the canonical
    // enrichment path keeps title-cased make values for stored vehicles.
    make: decoded.make?.toUpperCase() ?? null,
    model: decoded.model,
    trim: decoded.trim,
    bodyClass: decoded.bodyClass,
    driveType: decoded.driveType,
    engineCylinders: decoded.engineCylinders,
    fuelType: decoded.fuelType,
  };
}

export interface RecallSummary {
  ok: true;
  source: string;
  fetchedAt: string;
  year: string;
  make: string;
  model: string;
  recallCount: number;
  recalls: Array<{
    campaign: string | null;
    component: string | null;
    summary: string | null;
    reportedDate: string | null;
  }>;
  /** Advisor framing the UI must keep. */
  disclaimer: string;
}

/** Open-recall lookup by year/make/model. Capped at 10 newest. */
export async function recallsByVehicle(args: {
  year: string;
  make: string;
  model: string;
}): Promise<RecallSummary | VehicleDataError> {
  const year = args.year.trim();
  const make = args.make.trim();
  const model = args.model.trim();
  if (!/^\d{4}$/.test(year) || !make || !model) {
    return { ok: false, error: "year (YYYY), make, model required", source: SOURCE_LABEL };
  }

  const key = "recalls:" + year + ":" + make.toLowerCase() + ":" + model.toLowerCase();
  const cached = cacheGet<RecallSummary>(key);
  if (cached) return cached;

  try {
    const url =
      RECALLS_BASE +
      "?make=" + encodeURIComponent(make) +
      "&model=" + encodeURIComponent(model) +
      "&modelYear=" + encodeURIComponent(year);
    const body = (await nhtsaFetch(url)) as {
      Count?: number;
      results?: Array<Record<string, unknown>>;
    };
    const rows = body.results ?? [];
    const result: RecallSummary = {
      ok: true,
      source: SOURCE_LABEL,
      fetchedAt: new Date().toISOString(),
      year,
      make,
      model,
      recallCount: typeof body.Count === "number" ? body.Count : rows.length,
      recalls: rows.slice(0, 10).map((row) => ({
        campaign: typeof row.NHTSACampaignNumber === "string" ? row.NHTSACampaignNumber : null,
        component: typeof row.Component === "string" ? row.Component : null,
        summary: typeof row.Summary === "string" ? row.Summary.slice(0, 300) : null,
        reportedDate: typeof row.ReportReceivedDate === "string" ? row.ReportReceivedDate : null,
      })),
      disclaimer:
        "Recall awareness only - advise the customer to confirm with a dealer/VIN lookup; this is not a diagnosis.",
    };
    cacheSet(key, result);
    return result;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      source: SOURCE_LABEL,
    };
  }
}

/** Test hook: clear both recall and canonical VIN caches. */
export function _clearVehicleDataCache(): void {
  recallCache.clear();
  _clearVinDecodeCache();
}
