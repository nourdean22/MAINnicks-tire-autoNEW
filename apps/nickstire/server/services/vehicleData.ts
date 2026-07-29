/**
 * NHTSA vehicle data (WP-23, 2026-07-29 · audit-#12 keeper).
 *
 * Free federal APIs, no key, no vendor: vPIC for VIN decode +
 * year/make/model normalization, and the recalls API for
 * recall-awareness. Framing rules (from the register row): READ-ONLY
 * ADVISOR — this enriches quote prep, lead triage, and customer
 * comms; it never diagnoses. Every result is source-labeled and
 * carries fetchedAt; consumers must render the label.
 *
 * Ops posture: 10s timeouts, in-memory TTL cache (24h, capped) so a
 * flapping federal API can't slow the admin, and failures return a
 * typed error — never a fake-empty.
 */

const VPIC_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";
const RECALLS_BASE = "https://api.nhtsa.gov/recalls/recallsByVehicle";
const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 24 * 3_600_000;
const CACHE_MAX = 500;

const SOURCE_LABEL = "NHTSA (public federal data)";

interface CacheEntry<T> {
  at: number;
  value: T;
}
const cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

async function nhtsaFetch(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "User-Agent": "nickstire-admin/1.0 (lead enrichment)" },
  });
  if (!res.ok) throw new Error(`NHTSA ${res.status}`);
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

/** Decode a VIN via vPIC. Normalizes empty-string fields to null. */
export async function decodeVin(vinRaw: string): Promise<VinDecodeResult | VehicleDataError> {
  const vin = vinRaw.trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) {
    return { ok: false, error: "invalid VIN format", source: SOURCE_LABEL };
  }
  const key = `vin:${vin}`;
  const cached = cacheGet<VinDecodeResult>(key);
  if (cached) return cached;
  try {
    const body = (await nhtsaFetch(
      `${VPIC_BASE}/DecodeVinValues/${encodeURIComponent(vin)}?format=json`,
    )) as { Results?: Array<Record<string, string>> };
    const r = body.Results?.[0] ?? {};
    const pick = (k: string): string | null => {
      const v = (r[k] ?? "").trim();
      return v && v !== "Not Applicable" ? v : null;
    };
    const result: VinDecodeResult = {
      ok: true,
      source: SOURCE_LABEL,
      fetchedAt: new Date().toISOString(),
      vin,
      year: pick("ModelYear"),
      make: pick("Make"),
      model: pick("Model"),
      trim: pick("Trim"),
      bodyClass: pick("BodyClass"),
      driveType: pick("DriveType"),
      engineCylinders: pick("EngineCylinders"),
      fuelType: pick("FuelTypePrimary"),
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
  const key = `recalls:${year}:${make.toLowerCase()}:${model.toLowerCase()}`;
  const cached = cacheGet<RecallSummary>(key);
  if (cached) return cached;
  try {
    const url = `${RECALLS_BASE}?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`;
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
      recalls: rows.slice(0, 10).map((r) => ({
        campaign: typeof r.NHTSACampaignNumber === "string" ? r.NHTSACampaignNumber : null,
        component: typeof r.Component === "string" ? r.Component : null,
        summary: typeof r.Summary === "string" ? (r.Summary as string).slice(0, 300) : null,
        reportedDate: typeof r.ReportReceivedDate === "string" ? r.ReportReceivedDate : null,
      })),
      disclaimer:
        "Recall awareness only — advise the customer to confirm with a dealer/VIN lookup; this is not a diagnosis.",
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

/** Test hook — deterministic cache reset. */
export function _clearVehicleDataCache(): void {
  cache.clear();
}
