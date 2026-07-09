/**
 * FRED Macro Indicator Connector
 * Fetches CPI, UNRATE, and FEDFUNDS series from St. Louis Fed API.
 * Falls back to high-fidelity mock data if FRED_API_KEY is not defined.
 */
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/connector/fred");

export interface FREDIndicator {
  seriesId: string;
  name: string;
  value: number;
  date: string;
  unit: string;
}

export async function fetchFREDIndicators(): Promise<FREDIndicator[]> {
  const apiKey = process.env.FRED_API_KEY;
  const seriesToFetch = [
    { id: "CPIAUCSL", name: "Consumer Price Index", unit: "Index" },
    { id: "UNRATE", name: "Unemployment Rate", unit: "%" },
    { id: "FEDFUNDS", name: "Effective Federal Funds Rate", unit: "%" },
  ];

  if (!apiKey) {
    // AG-02 · Fabrication purge. Previously returned invented CPI/UNRATE/
    // FEDFUNDS values stamped with the CURRENT month — indistinguishable
    // from real data downstream. Unavailable data is EMPTY, never mocked.
    log.info("FRED_API_KEY not configured; emitting no indicators rather than mock macro data.");
    return [];
  }

  const results: FREDIndicator[] = [];

  for (const series of seriesToFetch) {
    try {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series.id}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      const obs = data.observations?.[0];
      if (obs) {
        results.push({
          seriesId: series.id,
          name: series.name,
          value: parseFloat(obs.value),
          date: obs.date,
          unit: series.unit,
        });
      }
    } catch (err) {
      log.error(`Failed to fetch FRED series ${series.id}:`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // AG-02 · The old fallback here recursed into fetchFREDIndicators() with
  // the key still set — infinite recursion when the API was down — and its
  // stated goal was to serve mock data. Failures now return empty.
  if (results.length === 0) {
    log.warn("All FRED API calls failed; emitting no indicators rather than mock data.");
  }

  return results;
}
