/**
 * NHTSA vehicle-data adapter.
 *
 * VIN HTTP ownership lives in vinDecode.ts. This module keeps the admin
 * response shape stable and owns year/make/model recall and complaint
 * awareness for the work-order drawer (Q-50). Everything here is
 * information for the advisor, never a diagnosis or a defect finding.
 */
import {
  _clearVinDecodeCache,
  decodeVinForLookup as decodeCanonicalVin,
  normalizeVinForLookup,
} from "./vinDecode";

const RECALLS_BASE = "https://api.nhtsa.gov/recalls/recallsByVehicle";
const COMPLAINTS_BASE = "https://api.nhtsa.gov/complaints/complaintsByVehicle";
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
    /** Remedy text, trimmed. */
    remedy: string | null;
    /** Manufacturer says do not drive until repaired. */
    parkIt: boolean;
    /** Manufacturer says park outside (fire risk) until repaired. */
    parkOutside: boolean;
  }>;
  /** Advisor framing the UI must keep. */
  disclaimer: string;
}

/**
 * NHTSA dates arrive as dd/mm/yyyy (recalls). ISO strings are accepted too.
 * Unparseable dates sort last rather than throwing.
 */
function reportedAt(value: unknown): number {
  if (typeof value !== "string") return 0;
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  const ms = dmy ? Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])) : Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function vehicleArgs(args: { year: string; make: string; model: string }) {
  const year = args.year.trim();
  const make = args.make.trim();
  const model = args.model.trim();
  const valid = /^\d{4}$/.test(year) && make.length > 0 && model.length > 0;
  return { year, make, model, valid };
}

function vehicleQuery(year: string, make: string, model: string): string {
  return (
    "?make=" + encodeURIComponent(make) +
    "&model=" + encodeURIComponent(model) +
    "&modelYear=" + encodeURIComponent(year)
  );
}

/** Recall campaigns by year/make/model, newest 10 first. */
export async function recallsByVehicle(args: {
  year: string;
  make: string;
  model: string;
}): Promise<RecallSummary | VehicleDataError> {
  const { year, make, model, valid } = vehicleArgs(args);
  if (!valid) {
    return { ok: false, error: "year (YYYY), make, model required", source: SOURCE_LABEL };
  }

  const key = "recalls:" + year + ":" + make.toLowerCase() + ":" + model.toLowerCase();
  const cached = cacheGet<RecallSummary>(key);
  if (cached) return cached;

  try {
    const url = RECALLS_BASE + vehicleQuery(year, make, model);
    const body = (await nhtsaFetch(url)) as {
      Count?: number;
      results?: Array<Record<string, unknown>>;
    };
    // A 200 without the array is a changed or broken response, not "no recalls".
    if (!Array.isArray(body.results)) throw new Error("NHTSA recalls: no results array");
    const rows = body.results;
    const result: RecallSummary = {
      ok: true,
      source: SOURCE_LABEL,
      fetchedAt: new Date().toISOString(),
      year,
      make,
      model,
      recallCount: typeof body.Count === "number" ? body.Count : rows.length,
      recalls: [...rows]
        .sort((a, b) => reportedAt(b.ReportReceivedDate) - reportedAt(a.ReportReceivedDate))
        .slice(0, 10)
        .map((row) => ({
          campaign: typeof row.NHTSACampaignNumber === "string" ? row.NHTSACampaignNumber : null,
          component: typeof row.Component === "string" ? row.Component : null,
          summary: typeof row.Summary === "string" ? row.Summary.slice(0, 300) : null,
          reportedDate: typeof row.ReportReceivedDate === "string" ? row.ReportReceivedDate : null,
          remedy: typeof row.Remedy === "string" ? row.Remedy.slice(0, 300) : null,
          parkIt: row.parkIt === true,
          parkOutside: row.parkOutSide === true,
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

export interface ComplaintSummary {
  ok: true;
  source: string;
  fetchedAt: string;
  year: string;
  make: string;
  model: string;
  complaintCount: number;
  crashCount: number;
  fireCount: number;
  /** Complaints reporting at least one injury or death. */
  injuryCount: number;
  /** Most-named components, highest first (a complaint can name several). */
  topComponents: Array<{ component: string; count: number }>;
  /** Advisor framing the UI must keep. */
  disclaimer: string;
}

/**
 * Owner complaint COUNTS by year/make/model. The narratives are never passed
 * on: they are unverified allegations and can carry owner details.
 */
export async function complaintsByVehicle(args: {
  year: string;
  make: string;
  model: string;
}): Promise<ComplaintSummary | VehicleDataError> {
  const { year, make, model, valid } = vehicleArgs(args);
  if (!valid) {
    return { ok: false, error: "year (YYYY), make, model required", source: SOURCE_LABEL };
  }

  const key = "complaints:" + year + ":" + make.toLowerCase() + ":" + model.toLowerCase();
  const cached = cacheGet<ComplaintSummary>(key);
  if (cached) return cached;

  try {
    const body = (await nhtsaFetch(COMPLAINTS_BASE + vehicleQuery(year, make, model))) as {
      count?: number;
      results?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(body.results)) throw new Error("NHTSA complaints: no results array");
    const rows = body.results;
    const byComponent = new Map<string, number>();
    let crashCount = 0;
    let fireCount = 0;
    let injuryCount = 0;
    for (const row of rows) {
      if (row.crash === true) crashCount++;
      if (row.fire === true) fireCount++;
      const hurt = Number(row.numberOfInjuries ?? 0) + Number(row.numberOfDeaths ?? 0);
      if (hurt > 0) injuryCount++;
      const components = typeof row.components === "string" ? row.components.split(",") : [];
      for (const raw of new Set(components.map((c) => c.trim()).filter(Boolean))) {
        byComponent.set(raw, (byComponent.get(raw) ?? 0) + 1);
      }
    }
    const result: ComplaintSummary = {
      ok: true,
      source: SOURCE_LABEL,
      fetchedAt: new Date().toISOString(),
      year,
      make,
      model,
      complaintCount: typeof body.count === "number" ? body.count : rows.length,
      crashCount,
      fireCount,
      injuryCount,
      topComponents: [...byComponent.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([component, count]) => ({ component, count })),
      disclaimer:
        "Owner complaints are unverified reports filed with NHTSA - a pattern to ask about, not a diagnosis or a defect finding.",
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

/** Test hook: clear the recall/complaint and canonical VIN caches. */
export function _clearVehicleDataCache(): void {
  recallCache.clear();
  _clearVinDecodeCache();
}
