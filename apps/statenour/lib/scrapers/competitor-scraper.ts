/**
 * Competitor analysis scraper for Nick's Tire & Auto.
 * Scrapes Google Places data for nearby auto shops to track reviews/ratings.
 */

import { prisma } from "@/lib/prisma";

const API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

interface CompetitorData {
  name: string;
  placeId: string;
  address: string;
  rating: number;
  totalReviews: number;
  priceLevel?: number;
  website?: string;
  phone?: string;
}

export async function scrapeCompetitors(
  lat = 41.5931,
  lng = -81.5268,
  radiusMeters = 8000,
): Promise<CompetitorData[]> {
  if (!API_KEY) throw new Error("GOOGLE_PLACES_API_KEY required for competitor scraping");

  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&type=car_repair&key=${API_KEY}`;
  // 2026-06-01 · 10s timeout so a hung Places API call can't stall the
  // whole cron slot (matches the pattern in lib/integrations/google-reviews.ts).
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const data = await res.json();

  const competitors: CompetitorData[] = (data.results || [])
    .filter((r: Record<string, unknown>) => r.name !== "Nick's Tire & Auto")
    .map((r: Record<string, unknown>) => ({
      name: r.name as string,
      placeId: r.place_id as string,
      address: r.vicinity as string,
      rating: (r.rating as number) || 0,
      totalReviews: (r.user_ratings_total as number) || 0,
      priceLevel: r.price_level as number | undefined,
    }));

  return competitors;
}

export async function getCompetitorDetails(placeId: string): Promise<CompetitorData & { reviews: Array<{ author: string; rating: number; text: string }> }> {
  if (!API_KEY) throw new Error("GOOGLE_PLACES_API_KEY required");

  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_phone_number,website,rating,user_ratings_total,reviews&key=${API_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const { result } = await res.json();

  return {
    name: result.name,
    placeId,
    address: "",
    rating: result.rating || 0,
    totalReviews: result.user_ratings_total || 0,
    website: result.website,
    phone: result.formatted_phone_number,
    reviews: (result.reviews || []).map((r: Record<string, unknown>) => ({
      author: r.author_name as string,
      rating: r.rating as number,
      text: r.text as string,
    })),
  };
}

export async function compareWithNicks(): Promise<{
  nicks: { rating: number; totalReviews: number };
  competitors: CompetitorData[];
  advantages: string[];
  threats: string[];
}> {
  // v10.0.59 · Wave A part 2 · Nick's reviews now live as BrainMemory
  // category="google_review" (per the v10.0.59 google-reviews.ts
  // rewrite). The competitor compare can finally read real ratings
  // instead of always seeing 0/0.
  const { prisma } = await import("@/lib/prisma");
  const nicksReviewRows = await prisma.brainMemory
    .findMany({
      where: { category: "google_review", deletedAt: null },
      select: { content: true },
    })
    .catch((): Array<{ content: string }> => []);
  const nicksReviews: Array<{ rating: number }> = [];
  for (const row of nicksReviewRows) {
    try {
      const parsed = JSON.parse(row.content) as { rating?: number };
      if (typeof parsed.rating === "number") nicksReviews.push({ rating: parsed.rating });
    } catch {
      /* skip malformed */
    }
  }
  const nicksRating = nicksReviews.length > 0
    ? nicksReviews.reduce((s, r) => s + r.rating, 0) / nicksReviews.length
    : 0;

  const competitors = await scrapeCompetitors();
  const avgCompetitorRating = competitors.length > 0
    ? competitors.reduce((s, c) => s + c.rating, 0) / competitors.length
    : 0;

  const advantages: string[] = [];
  const threats: string[] = [];

  if (nicksRating > avgCompetitorRating) {
    advantages.push(`Higher average rating (${nicksRating.toFixed(1)} vs ${avgCompetitorRating.toFixed(1)} avg)`);
  } else if (nicksRating < avgCompetitorRating) {
    threats.push(`Lower rating than average competitor (${nicksRating.toFixed(1)} vs ${avgCompetitorRating.toFixed(1)})`);
  }

  if (nicksReviews.length > 1500) {
    advantages.push(`Strong review volume (${nicksReviews.length} reviews)`);
  }

  const higherRated = competitors.filter((c) => c.rating > nicksRating);
  if (higherRated.length > 0) {
    threats.push(`${higherRated.length} competitors have higher ratings: ${higherRated.map((c) => `${c.name} (${c.rating})`).join(", ")}`);
  }

  const moreReviews = competitors.filter((c) => c.totalReviews > nicksReviews.length);
  if (moreReviews.length > 0) {
    threats.push(`${moreReviews.length} competitors have more reviews`);
  } else {
    advantages.push("Highest review count in the area");
  }

  return {
    nicks: { rating: Math.round(nicksRating * 10) / 10, totalReviews: nicksReviews.length },
    competitors: competitors.sort((a, b) => b.rating - a.rating).slice(0, 15),
    advantages,
    threats,
  };
}
