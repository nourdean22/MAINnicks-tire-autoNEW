/**
 * Canonical VIN decoding via NHTSA vPIC.
 *
 * This is the repo's single vPIC HTTP owner, mapping, validation, timeout,
 * and cache contract for the VIN enrichment path that is actually wired today.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("vin-decode");
const SINGLE_TIMEOUT_MS = 5_000;
const VPIC_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/";

export interface VinDecodeResult {
  vin: string;
  year: string | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  bodyClass: string | null;
  driveType: string | null;
  engineCylinders: string | null;
  fuelType: string | null;
  source: "vpic";
  fetchedAt: string;
  /** vPIC's own error text when the VIN failed its check digit / pattern. */
  vpicError: string | null;
}

const cache = new Map<string, VinDecodeResult | null>();

export function normalizeVinForLookup(raw: string | null | undefined): string | null {
  const value = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  // vPIC's admin lookup historically accepts partial VINs down to 11 chars.
  // I/O/Q remain forbidden by ISO 3779.
  return /^[A-HJ-NPR-Z0-9]{11,17}$/.test(value) ? value : null;
}

function normalizeVin(raw: string | null | undefined): string | null {
  const value = normalizeVinForLookup(raw);
  // Enrichment/backfill stays strict: stored-vehicle decode requires a full VIN.
  return value?.length === 17 ? value : null;
}

function cleanField(row: Record<string, string>, key: string): string | null {
  const value = (row[key] ?? "").trim();
  return value && value !== "Not Applicable" ? value : null;
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function hasHardVpicError(errorCode: string): boolean {
  if (!errorCode || errorCode === "0") return false;
  const allowed = new Set(["0", "6", "7", "8", "14"]);
  return errorCode.split(",").map((code) => code.trim()).filter(Boolean).some((code) => !allowed.has(code));
}

function mapVpicRow(vin: string, row: Record<string, string>): VinDecodeResult {
  const errorCode = (row.ErrorCode ?? "").trim();
  const hardError = hasHardVpicError(errorCode);
  const field = (key: string): string | null => hardError ? null : cleanField(row, key);
  const make = field("Make");
  return {
    vin,
    year: /^\d{4}$/.test(field("ModelYear") ?? "") ? field("ModelYear") : null,
    make: make ? titleCase(make) : null,
    model: field("Model"),
    trim: field("Trim"),
    bodyClass: field("BodyClass"),
    driveType: field("DriveType"),
    engineCylinders: field("EngineCylinders"),
    fuelType: field("FuelTypePrimary"),
    source: "vpic",
    fetchedAt: new Date().toISOString(),
    vpicError: hardError ? (row.ErrorText ?? errorCode).slice(0, 160) : null,
  };
}

async function decodeNormalizedVin(
  vin: string,
  fetchImpl: typeof fetch,
): Promise<VinDecodeResult | null> {
  if (cache.has(vin)) return cache.get(vin) ?? null;

  try {
    const res = await fetchImpl(VPIC_URL + vin + "?format=json", {
      signal: AbortSignal.timeout(SINGLE_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Transient failures are deliberately not cached.
      log.warn("vPIC non-OK response", { vinLast4: vin.slice(-4), status: res.status });
      return null;
    }
    const data = (await res.json()) as { Results?: Array<Record<string, string>> };
    const row = data.Results?.[0];
    if (!row) {
      cache.set(vin, null);
      return null;
    }
    const result = mapVpicRow(vin, row);
    cache.set(vin, result);
    return result;
  } catch (err) {
    log.warn("vPIC decode failed", {
      vinLast4: vin.slice(-4),
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function decodeVin(
  rawVin: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<VinDecodeResult | null> {
  const vin = normalizeVin(rawVin);
  return vin ? decodeNormalizedVin(vin, fetchImpl) : null;
}

/** Existing admin route compatibility: vPIC accepts partial 11-17 character VIN lookups. */
export async function decodeVinForLookup(
  rawVin: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<VinDecodeResult | null> {
  const vin = normalizeVinForLookup(rawVin);
  return vin ? decodeNormalizedVin(vin, fetchImpl) : null;
}

export function _clearVinDecodeCache(): void {
  cache.clear();
}

/** Fill ONLY empty Y/M/M fields. Human-entered values always win. */
export function mergeDecoded<
  T extends { year?: string | null; make?: string | null; model?: string | null },
>(
  vehicle: T,
  decoded: VinDecodeResult | null,
): T & { vinDecodedFrom?: "vpic" } {
  if (!decoded) return vehicle;
  const filled = { ...vehicle };
  let touched = false;
  if (!filled.year && decoded.year) { filled.year = decoded.year; touched = true; }
  if (!filled.make && decoded.make) { filled.make = decoded.make; touched = true; }
  if (!filled.model && decoded.model) { filled.model = decoded.model; touched = true; }
  return touched ? { ...filled, vinDecodedFrom: "vpic" as const } : filled;
}
