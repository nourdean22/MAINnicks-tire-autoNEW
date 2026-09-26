/**
 * Canonical VIN decoding via NHTSA vPIC.
 *
 * Single-VIN enrichment and backfill batches both live here so the repo has
 * exactly one vPIC mapping, validation, timeout and cache contract.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("vin-decode");
const SINGLE_TIMEOUT_MS = 5_000;
const BATCH_TIMEOUT_MS = 10_000;
const VPIC_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/";
const VPIC_BATCH_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/";
const BATCH_MAX = 50;

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

export interface VinBatchInput {
  vin: string;
  modelYear?: string | number | null;
}

export interface VinBatchDecodeResult {
  input: VinBatchInput;
  decoded: VinDecodeResult | null;
}

const cache = new Map<string, VinDecodeResult | null>();

export function normalizeVin(raw: string | null | undefined): string | null {
  const value = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Full VIN only; I/O/Q are forbidden by ISO 3779.
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(value) ? value : null;
}

function normalizeModelYear(raw: VinBatchInput["modelYear"]): string {
  const value = String(raw ?? "").trim();
  return /^\d{4}$/.test(value) ? value : "";
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

export async function decodeVin(
  rawVin: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<VinDecodeResult | null> {
  const vin = normalizeVin(rawVin);
  if (!vin) return null;
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

/**
 * Decode backfill inputs through vPIC's official batch endpoint.
 *
 * - invalid VINs stay in-place with decoded=null and never hit the network;
 * - valid uncached VINs are posted in chunks of at most 50;
 * - output order exactly matches input order;
 * - a failed chunk returns nulls for that chunk and never throws.
 */
export async function decodeVinBatch(
  inputs: VinBatchInput[],
  fetchImpl: typeof fetch = fetch,
): Promise<VinBatchDecodeResult[]> {
  const output: VinBatchDecodeResult[] = inputs.map((input) => ({ input, decoded: null }));
  const pending: Array<{ index: number; vin: string; modelYear: string }> = [];

  inputs.forEach((input, index) => {
    const vin = normalizeVin(input.vin);
    if (!vin) return;
    if (cache.has(vin)) {
      output[index] = { input, decoded: cache.get(vin) ?? null };
      return;
    }
    pending.push({ index, vin, modelYear: normalizeModelYear(input.modelYear) });
  });

  for (let offset = 0; offset < pending.length; offset += BATCH_MAX) {
    const chunk = pending.slice(offset, offset + BATCH_MAX);
    const params = new URLSearchParams({
      format: "json",
      data: chunk.map((entry) => entry.vin + "," + entry.modelYear).join(";"),
    });

    try {
      const res = await fetchImpl(VPIC_BATCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: AbortSignal.timeout(BATCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        log.warn("vPIC batch non-OK response", { count: chunk.length, status: res.status });
        continue;
      }

      const data = (await res.json()) as { Results?: Array<Record<string, string>> };
      const rows = data.Results ?? [];
      chunk.forEach((entry, chunkIndex) => {
        const row = rows[chunkIndex];
        if (!row) return;
        const decoded = mapVpicRow(entry.vin, row);
        cache.set(entry.vin, decoded);
        output[entry.index] = { input: inputs[entry.index], decoded };
      });
    } catch (err) {
      log.warn("vPIC batch decode failed", {
        count: chunk.length,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return output;
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
