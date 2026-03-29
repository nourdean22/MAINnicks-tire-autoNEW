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
const COMPETITORS: Array<{ name: string; placeId: string }> = [
  { name: "Firestone Complete Auto Care (Euclid)", placeId: "ChIJ-firestone-euclid" },
  { name: "Midas (Euclid Ave)", placeId: "ChIJ-midas-euclid" },
  { name: "Pep Boys (Euclid)", placeId: "ChIJ-pepboys-euclid" },
  { name: "Meineke (E 185th)", placeId: "ChIJ-meineke-185th" },
];

// Nick's Tire place ID
const NICKS_PLACE_ID = process.env.GOOGLE_PLACE_ID || "";

/** Fetch place details from Google Places API */
async function fetchPlaceDetails(
  placeId: string
): Promise<{ rating: number; reviewCount: number; name: string } | null> {
  if (!API_KEY) return null;

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

  // Fetch competitors
  for (const c of COMPETITORS) {
    const data = await fetchPlaceDetails(c.placeId);
    if (data) {
      results.push({
        name: c.name,
        placeId: c.placeId,
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
