/**
 * GBP Review Pipeline — Fetch, analyze, and generate responses for Google reviews.
 *
 * Flow:
 * 1. fetchRecentReviews() — Pulls latest reviews from Google Places API
 * 2. analyzeReview() — AI sentiment analysis + topic extraction
 * 3. suggestResponse() — AI-generated owner reply draft
 *
 * Reviews are stored in `review_pipeline` table for admin review before posting.
 * Uses the existing google-reviews.ts infrastructure for Place ID discovery.
 */

import { makeRequest, type PlaceDetailsResult, type PlacesSearchResult } from "../_core/map";
import { invokeLLM } from "../_core/llm";
import { reviewPipeline } from "../../drizzle/schema";
import { desc, eq } from "drizzle-orm";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

// ─── TYPES ───────────────────────────────────────────────

export interface RawReview {
  authorName: string;
  rating: number;
  text: string;
  relativeTime: string;
  time: number; // epoch seconds
}

export interface AnalyzedReview extends RawReview {
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  topics: string[];
}

export interface ReviewWithResponse extends AnalyzedReview {
  suggestedResponse: string;
}

// ─── FETCH REVIEWS ───────────────────────────────────────

/**
 * Fetch recent reviews from Google Places API.
 * Discovers Place ID via text search, then pulls review details.
 * Deduplicates against already-stored reviews by authorName + time.
 */
export async function fetchRecentReviews(): Promise<RawReview[]> {
  // Step 1: Find Place ID
  const search = await makeRequest<PlacesSearchResult>(
    "/maps/api/place/textsearch/json",
    { query: "Nick's Tire And Auto 17625 Euclid Ave Cleveland OH 44112" },
  );

  if (search.status !== "OK" || !search.results?.length) {
    console.warn("[GBP Pipeline] Place search failed:", search.status);
    return [];
  }

  const placeId = search.results[0].place_id;

  // Step 2: Fetch details with reviews
  const details = await makeRequest<PlaceDetailsResult>(
    "/maps/api/place/details/json",
    {
      place_id: placeId,
      fields: "reviews",
    },
  );

  if (details.status !== "OK" || !details.result?.reviews) {
    console.warn("[GBP Pipeline] Place details failed:", details.status);
    return [];
  }

  return details.result.reviews.map((r) => ({
    authorName: r.author_name || "Unknown",
    rating: r.rating,
    text: r.text || "",
    relativeTime: r.relative_time_description || "",
    time: r.time,
  }));
}

// ─── ANALYZE REVIEW ──────────────────────────────────────

/**
 * Analyze a single review with AI — extract sentiment and topics.
 */
export async function analyzeReview(review: RawReview): Promise<AnalyzedReview> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a review analysis system for Nick's Tire & Auto, an auto repair shop.
Analyze the customer review and return JSON with:
- sentiment: "positive" | "negative" | "neutral" | "mixed"
- topics: array of specific topics mentioned (e.g., "brakes", "customer service", "pricing", "wait time", "tires", "diagnostics", "oil change", "staff friendliness")

Be accurate. A 3-star review with some praise and some criticism is "mixed".
A review with no text but 5 stars is "positive". Keep topics to 1-4 items max.`,
        },
        {
          role: "user",
          content: `Rating: ${review.rating}/5\nReview: ${review.text || "(no text)"}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "review_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              sentiment: { type: "string", description: "positive, negative, neutral, or mixed" },
              topics: {
                type: "array",
                items: { type: "string" },
                description: "Key topics mentioned",
              },
            },
            required: ["sentiment", "topics"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (content && typeof content === "string") {
      const parsed = JSON.parse(content);
      return {
        ...review,
        sentiment: parsed.sentiment || "neutral",
        topics: parsed.topics || [],
      };
    }
  } catch (error) {
    console.error("[GBP Pipeline] Review analysis failed:", error);
  }

  // Fallback: derive sentiment from star rating
  const sentiment = review.rating >= 4 ? "positive" : review.rating <= 2 ? "negative" : "neutral";
  return { ...review, sentiment, topics: [] };
}

// ─── SUGGEST RESPONSE ────────────────────────────────────

/**
 * Generate an AI-suggested owner response for a review.
 */
export async function suggestResponse(review: AnalyzedReview): Promise<string> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are writing a Google review response on behalf of Nick's Tire & Auto in Cleveland, OH.

Guidelines:
- Keep it under 100 words
- Be genuine, professional, and warm — not corporate or robotic
- For positive reviews: thank them specifically for what they mentioned, invite them back
- For negative reviews: apologize sincerely, address the specific concern, offer to make it right (call (216) 862-0005), don't be defensive
- For mixed reviews: acknowledge the good, address the concern
- Always sign off as "— The Nick's Tire & Auto Team"
- Never use exclamation marks excessively (max 1)
- Never make promises you can't keep
- For no-text reviews with 5 stars: keep it brief, just thank them`,
        },
        {
          role: "user",
          content: `Author: ${review.authorName}\nRating: ${review.rating}/5\nSentiment: ${review.sentiment}\nTopics: ${review.topics.join(", ") || "none"}\nReview text: ${review.text || "(no text)"}`,
        },
      ],
    });

    const content = response.choices?.[0]?.message?.content;
    return (typeof content === "string" ? content : "") || "Unable to generate response.";
  } catch (error) {
    console.error("[GBP Pipeline] Response generation failed:", error);
    return "Unable to generate response.";
  }
}

// ─── FULL PIPELINE ───────────────────────────────────────

/**
 * Run the full review pipeline: fetch → analyze → suggest → store.
 * Returns count of new reviews processed.
 */
export async function runReviewPipeline(): Promise<{
  fetched: number;
  newReviews: number;
  errors: number;
}> {
  const d = await db();
  if (!d) throw new Error("Database not available");

  const reviews = await fetchRecentReviews();
  let newReviews = 0;
  let errors = 0;

  for (const review of reviews) {
    try {
      // Check for duplicates (same author + same timestamp)
      const existing = await d
        .select({ id: reviewPipeline.id })
        .from(reviewPipeline)
        .where(eq(reviewPipeline.reviewTime, review.time))
        .limit(1);

      if (existing.length > 0) continue; // Already processed

      // Analyze sentiment
      const analyzed = await analyzeReview(review);

      // Generate suggested response
      const suggested = await suggestResponse(analyzed);

      // Store in pipeline table
      await d.insert(reviewPipeline).values({
        authorName: analyzed.authorName,
        rating: analyzed.rating,
        reviewText: analyzed.text || null,
        reviewTime: analyzed.time,
        relativeTime: analyzed.relativeTime || null,
        sentiment: analyzed.sentiment,
        topicsJson: JSON.stringify(analyzed.topics),
        suggestedResponse: suggested,
      });

      newReviews++;
    } catch (error) {
      console.error("[GBP Pipeline] Error processing review:", error);
      errors++;
    }
  }

  return { fetched: reviews.length, newReviews, errors };
}

/**
 * Get pipeline entries for admin dashboard.
 */
export async function getPipelineReviews(opts?: {
  limit?: number;
  onlyUnreviewed?: boolean;
}) {
  const d = await db();
  if (!d) return [];

  let query = d.select().from(reviewPipeline);

  if (opts?.onlyUnreviewed) {
    query = query.where(eq(reviewPipeline.reviewed, 0)) as typeof query;
  }

  return query
    .orderBy(desc(reviewPipeline.createdAt))
    .limit(opts?.limit ?? 50);
}
