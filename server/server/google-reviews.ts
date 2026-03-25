/**
 * Google Business Profile Integration
 * Fetches live review data from Google Places API via the Manus proxy.
 * Uses text search as primary lookup (more reliable than Place ID through proxy).
 * Caches results for 1 hour to avoid excessive API calls.
 */

import { makeRequest, type PlaceDetailsResult, type PlacesSearchResult } from "./_core/map";

// Cache configuration
let cachedData: GoogleReviewData | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
let failCount = 0;
const MAX_FAIL_BACKOFF = 5 * 60 * 1000; // After repeated failures, wait 5 min before retrying

export interface GoogleReview {
  authorName: string;
  rating: number;
  text: string;
  relativeTime: string;
  time: number;
}

export interface GoogleReviewData {
  placeId: string;
  name: string;
  rating: number;
  totalReviews: number;
  reviews: GoogleReview[];
  address: string;
  phone: string;
  website: string;
  openNow: boolean | null;
  hours: string[];
  lastUpdated: number;
}

/**
 * Fetch live review data from Google Places API.
 * Primary: text search → get Place ID → fetch details.
 * This is more reliable through the Manus proxy than direct Place ID lookup.
 */
export async function getGoogleReviews(): Promise<GoogleReviewData | null> {
  // Return cached data if fresh
  if (cachedData && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedData;
  }

  // If we've been failing repeatedly, back off to avoid log spam
  if (failCount >= 3 && cachedData && Date.now() - cacheTimestamp < MAX_FAIL_BACKOFF * failCount) {
    return cachedData;
  }

  try {
    // Step 1: Find the business via text search
    const search = await makeRequest<PlacesSearchResult>(
      "/maps/api/place/textsearch/json",
      {
        query: "Nick's Tire And Auto 17625 Euclid Ave Cleveland OH 44112",
      }
    );

    if (search.status !== "OK" || !search.results?.length) {
      console.warn("[GoogleReviews] Text search returned:", search.status);
      failCount++;
      return cachedData || null;
    }

    const placeId = search.results[0].place_id;

    // Step 2: Get full details using the discovered Place ID
    const details = await makeRequest<PlaceDetailsResult>(
      "/maps/api/place/details/json",
      {
        place_id: placeId,
        fields: "name,rating,user_ratings_total,reviews,formatted_address,formatted_phone_number,website,opening_hours,geometry",
      }
    );

    if (details.status !== "OK" || !details.result) {
      console.warn("[GoogleReviews] Place details failed for ID", placeId, ":", details.status);
      failCount++;
      return cachedData || null;
    }

    const r = details.result;

    const reviewData: GoogleReviewData = {
      placeId,
      name: r.name || "Nick's Tire & Auto",
      rating: r.rating || 4.9,
      totalReviews: r.user_ratings_total || 0,
      reviews: (r.reviews || []).map((rev) => ({
        authorName: rev.author_name,
        rating: rev.rating,
        text: rev.text,
        relativeTime: getRelativeTime(rev.time),
        time: rev.time,
      })),
      address: r.formatted_address || "17625 Euclid Ave, Cleveland, OH 44112",
      phone: r.formatted_phone_number || "(216) 862-0005",
      website: r.website || "",
      openNow: r.opening_hours?.open_now ?? null,
      hours: r.opening_hours?.weekday_text || [],
      lastUpdated: Date.now(),
    };

    // Update cache and reset fail count
    cachedData = reviewData;
    cacheTimestamp = Date.now();
    failCount = 0;

    // Reviews fetched successfully
    return reviewData;
  } catch (error) {
    console.error("[GoogleReviews] Failed to fetch:", error);
    failCount++;
    // Return cached data even if stale, or null
    return cachedData || null;
  }
}

function getRelativeTime(unixTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixTimestamp;

  if (diff < 3600) return "just now";
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)} weeks ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)} months ago`;
  return `${Math.floor(diff / 31536000)} years ago`;
}
