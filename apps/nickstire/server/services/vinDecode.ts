/**
 * VIN decode via NHTSA vPIC (2026-09-01 admin audit, artifact 3 §7 P2-2).
 *
 * The public, licence-free decoder. Used to fill year / make / model on a
 * customer vehicle when a VIN is present and those fields are empty — never
 * to overwrite what a human typed. Provenance is explicit: the caller stores
 * the values, this module only returns them plus `source: "vpic"`.
 *
 * Contract: never throws, never blocks longer than TIMEOUT_MS, caches per VIN
 * for the process lifetime (vPIC answers do not change).
 */
import { createLogger } from "../lib/logger";

const log = createLogger("vin-decode");
const TIMEOUT_MS = 5000;
const VPIC_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/";

export interface VinDecodeResult {
  vin: string;
  year: string | null;
  make: string | null;
  model: string | null;
  source: "vpic";
  /** vPIC's own error text when the VIN failed its check digit / pattern. */
  vpicError: string | null;
}

const cache = new Map<string, VinDecodeResult | null>();

function normalizeVin(raw: string | null | undefined): string | null {
  const v = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  // 17 chars, no I/O/Q per ISO 3779.
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(v) ? v : null;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export async function decodeVin(rawVin: string | null | undefined, fetchImpl: typeof fetch = fetch): Promise<VinDecodeResult | null> {
  const vin = normalizeVin(rawVin);
  if (!vin) return null;
  if (cache.has(vin)) return cache.get(vin) ?? null;

  try {
    const res = await fetchImpl(`${VPIC_URL}${vin}?format=json`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      log.warn("vPIC non-OK response", { vin: vin.slice(-6), status: res.status });
      cache.set(vin, null);
      return null;
    }
    const data = (await res.json()) as { Results?: Array<Record<string, string>> };
    const r = data.Results?.[0];
    if (!r) { cache.set(vin, null); return null; }
    const errorCode = (r.ErrorCode ?? "").trim();
    // vPIC returns "0" (clean) or a comma list; codes other than 0/6/7/8/14 mean
    // the VIN itself is bad — decode text may still be partial but not trusted.
    const hardError = errorCode !== "" && errorCode !== "0" && !/^(6|7|8|14)(,|$)/.test(errorCode);
    const result: VinDecodeResult = {
      vin,
      year: !hardError && /^\d{4}$/.test(r.ModelYear ?? "") ? r.ModelYear : null,
      make: !hardError && r.Make ? titleCase(r.Make) : null,
      model: !hardError && r.Model ? r.Model : null,
      source: "vpic",
      vpicError: hardError ? (r.ErrorText ?? errorCode).slice(0, 160) : null,
    };
    cache.set(vin, result);
    return result;
  } catch (err) {
    log.warn("vPIC decode failed", { vin: vin.slice(-6), err: err instanceof Error ? err.message : String(err) });
    return null; // not cached: a transient failure may succeed later
  }
}

/**
 * Fill ONLY the empty fields from a decode. Human-entered values always win.
 */
export function mergeDecoded<T extends { year?: string | null; make?: string | null; model?: string | null }>(
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
