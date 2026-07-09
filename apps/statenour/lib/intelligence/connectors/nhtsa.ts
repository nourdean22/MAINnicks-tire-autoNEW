/**
 * NHTSA Safety Recall Connector
 * Fetches safety recalls from the official public NHTSA API.
 * Requires no API keys.
 *
 * AG-02 · Fabrication purge. On network failure this connector previously
 * INVENTED safety recalls (including a generic "99V999000" recall for any
 * vehicle) "to keep the pipeline populated" — and recall data downstream
 * drives operator-approved customer SMS. A fabricated safety recall texted
 * to a real customer is the worst possible failure here. Failures now skip
 * the vehicle; unavailable data is EMPTY, never mocked.
 */
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/connector/nhtsa");

export interface NHTSARecall {
  NHTSACampaignNumber: string;
  VehicleMake: string;
  VehicleModel: string;
  ModelYear: string;
  Component: string;
  Summary: string;
  Conequence: string; // The spelling from NHTSA API is often "Conequence" or "Consequence"
  Remedy: string;
}

export async function fetchNHTSARecalls(vehicles: { make: string; model: string; year: number }[]): Promise<NHTSARecall[]> {
  const allRecalls: NHTSARecall[] = [];

  for (const v of vehicles) {
    try {
      const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(v.make)}&model=${encodeURIComponent(v.model)}&modelYear=${v.year}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      const results = data.results as any[];
      if (results && Array.isArray(results)) {
        for (const item of results.slice(0, 5)) { // Cap at top 5 recalls per vehicle
          allRecalls.push({
            NHTSACampaignNumber: item.NHTSACampaignNumber || "",
            VehicleMake: item.Make || v.make,
            VehicleModel: item.Model || v.model,
            ModelYear: item.ModelYear || String(v.year),
            Component: item.Component || "Unknown",
            Summary: item.Summary || "",
            Conequence: item.Conequence || item.Consequence || "",
            Remedy: item.Remedy || "",
          });
        }
      }
    } catch (err) {
      log.warn(`Failed to fetch live recalls for ${v.year} ${v.make} ${v.model}; skipping vehicle (no mock fallback).`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return allRecalls;
}
