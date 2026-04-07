/**
 * Competitor Monitor — Tracks competitor ratings and review counts
 * Uses Google Places API to fetch competitor data on a schedule.
 * Alerts when competitors gain/lose significant reviews.
 *
 * Requires: GOOGLE_PLACES_API_KEY env var
 */

import { createLogger } from "../lib/logger";
import { alertSystem } from "./telegram";

const log = createLogger("competitor-monitor");

const API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

interface CompetitorData {
  name: string;
  placeId: string;
  rating: number;
  reviewCount: number;
  address?: string;
  fetchedAt: Date;
}

// Cleveland-area competitors
// Place IDs resolved via Google Places text search at runtime if not cached.
// To get exact Place IDs manually: search on Google Maps → share → extract from URL,
// or use: https://developers.google.com/maps/documentation/places/web-service/place-id
const COMPETITORS: Array<{ name: string; placeId: string; searchQuery: string }> = [
  {
    name: "Firestone Complete Auto Care (Euclid Ave)",
    placeId: "", // resolved at runtime via searchQuery
    searchQuery: "Firestone Complete Auto Care Euclid Ave Cleveland OH",
  },
  {
    name: "Midas (Euclid Ave)",
    placeId: "",
    searchQuery: "Midas Euclid Ave Cleveland OH",
  },
  {
    name: "Pep Boys Cleveland",
    placeId: "",
    searchQuery: "Pep Boys Cleveland OH",
  },
  {
    name: "Meineke Car Care Center Cleveland",
    placeId: "",
    searchQuery: "Meineke Car Care Center Cleveland OH",
  },
  {
    name: "Goodyear Auto Service Cleveland",
    placeId: "",
    searchQuery: "Goodyear Auto Service Center Cleveland OH",
  },
];

// In-memory cache of resolved Place IDs (survives across cron runs within same process)
const resolvedPlaceIds: Record<string, string> = {};

// Nick's Tire place ID
const NICKS_PLACE_ID = process.env.GOOGLE_PLACE_ID || "";

/** Resolve a business name to a Google Place ID via text search */
async function findPlaceFromText(query: string): Promise<string | null> {
  if (!API_KEY) return null;

  // Check cache first
  if (resolvedPlaceIds[query]) return resolvedPlaceIds[query];

  try {
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id&key=${API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const data = await res.json() as any;
    if (data.status !== "OK" || !data.candidates?.length) return null;

    const placeId = data.candidates[0].place_id;
    resolvedPlaceIds[query] = placeId; // cache it
    log.info("Resolved Place ID", { query, placeId });
    return placeId;
  } catch (err) {
    log.warn("Place text search failed", { query, err });
    return null;
  }
}

/** Fetch place details from Google Places API */
async function fetchPlaceDetails(
  placeId: string
): Promise<{ rating: number; reviewCount: number; name: string } | null> {
  if (!API_KEY || !placeId) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,rating,user_ratings_total&key=${API_KEY}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const data = await res.json() as any;
    if (data.status !== "OK" || !data.result) return null;

    return {
      name: data.result.name || "Unknown",
      rating: data.result.rating || 0,
      reviewCount: data.result.user_ratings_total || 0,
    };
  } catch (err) {
    log.warn("Places API fetch failed", { placeId, err });
    return null;
  }
}

/** Fetch all competitor data (call from cron) */
export async function fetchCompetitorSnapshot(): Promise<CompetitorData[]> {
  if (!API_KEY) {
    log.debug("GOOGLE_PLACES_API_KEY not configured, skipping competitor monitor");
    return [];
  }

  const results: CompetitorData[] = [];
  const now = new Date();

  // Fetch Nick's own data first
  if (NICKS_PLACE_ID) {
    const own = await fetchPlaceDetails(NICKS_PLACE_ID);
    if (own) {
      results.push({
        name: "Nick's Tire & Auto (You)",
        placeId: NICKS_PLACE_ID,
        rating: own.rating,
        reviewCount: own.reviewCount,
        fetchedAt: now,
      });
    }
  }

  // Fetch competitors — resolve Place IDs via text search if not already cached
  for (const c of COMPETITORS) {
    let placeId = c.placeId || resolvedPlaceIds[c.searchQuery];
    if (!placeId) {
      placeId = await findPlaceFromText(c.searchQuery) || "";
    }
    if (!placeId) {
      log.warn("Could not resolve Place ID for competitor", { name: c.name, query: c.searchQuery });
      continue;
    }

    const data = await fetchPlaceDetails(placeId);
    if (data) {
      results.push({
        name: c.name,
        placeId,
        rating: data.rating,
        reviewCount: data.reviewCount,
        fetchedAt: now,
      });
    }
  }

  log.info("Competitor snapshot fetched", {
    count: results.length,
    timestamp: now.toISOString(),
  });

  return results;
}

/** Compare two snapshots and detect significant changes */
export function detectChanges(
  previous: CompetitorData[],
  current: CompetitorData[]
): Array<{ name: string; change: string; severity: "info" | "warning" }> {
  const changes: Array<{ name: string; change: string; severity: "info" | "warning" }> = [];

  for (const curr of current) {
    const prev = previous.find((p) => p.placeId === curr.placeId);
    if (!prev) continue;

    const reviewDiff = curr.reviewCount - prev.reviewCount;
    const ratingDiff = curr.rating - prev.rating;

    if (reviewDiff >= 10) {
      changes.push({
        name: curr.name,
        change: `+${reviewDiff} reviews (${prev.reviewCount} → ${curr.reviewCount})`,
        severity: "warning",
      });
    }

    if (Math.abs(ratingDiff) >= 0.2) {
      changes.push({
        name: curr.name,
        change: `Rating ${ratingDiff > 0 ? "up" : "down"} ${prev.rating} → ${curr.rating}`,
        severity: ratingDiff > 0 ? "info" : "warning",
      });
    }
  }

  // Alert via Telegram if there are significant changes
  if (changes.length > 0) {
    const summary = changes
      .map((c) => `${c.name}: ${c.change}`)
      .join("\n");
    alertSystem("Competitor Changes Detected", summary).catch(() => {});
  }

  return changes;
}

/** Build a competitive position report */
export function buildPositionReport(
  data: CompetitorData[]
): {
  nicks: CompetitorData | null;
  competitors: CompetitorData[];
  ratingRank: number;
  reviewRank: number;
  summary: string;
} {
  const nicks = data.find((d) => d.placeId === NICKS_PLACE_ID) || null;
  const competitors = data.filter((d) => d.placeId !== NICKS_PLACE_ID);

  const allByRating = [...data].sort((a, b) => b.rating - a.rating);
  const allByReviews = [...data].sort((a, b) => b.reviewCount - a.reviewCount);

  const ratingRank = nicks
    ? allByRating.findIndex((d) => d.placeId === NICKS_PLACE_ID) + 1
    : 0;
  const reviewRank = nicks
    ? allByReviews.findIndex((d) => d.placeId === NICKS_PLACE_ID) + 1
    : 0;

  const summary = nicks
    ? `Nick's: ${nicks.rating}★ (${nicks.reviewCount} reviews) — Rank #${ratingRank} by rating, #${reviewRank} by volume`
    : "No data for Nick's Tire";

  return { nicks, competitors, ratingRank, reviewRank, summary };
}
