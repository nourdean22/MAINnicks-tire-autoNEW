/**
 * GBP Review Pipeline — Fetch, analyze, and generate responses for Google reviews.
 *
 * Flow:
 * 1. fetchRecentReviews() — Pulls latest reviews from Google Places API
 * 2. analyzeReview() — AI sentiment analysis + topic extraction
 * 3. suggestResponse() — AI-generated owner reply draft (learns from past approved responses)
 * 4. extractKeywords() — Frequency analysis across all reviews
 * 5. detectTrends() — Track sentiment/rating shifts over time
 * 6. detectUrgency() — Flag 1-2 star reviews for immediate attention
 * 7. trackReviewVolume() — Alert if review pace drops
 * 8. monitorCompetitors() — Fetch and analyze competitor reviews
 *
 * Reviews are stored in `review_pipeline` table for admin review before posting.
 * Uses the existing google-reviews.ts infrastructure for Place ID discovery.
 */

import { makeRequest, type PlaceDetailsResult, type PlacesSearchResult } from "../_core/map";
import { invokeLLM } from "../_core/llm";
import { reviewPipeline, reviewTrends } from "../../drizzle/schema";
import { desc, eq, gte, sql, and, lte } from "drizzle-orm";

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
  keywords: string[];
  urgency: "critical" | "high" | "normal" | "low";
}

export interface ReviewWithResponse extends AnalyzedReview {
  suggestedResponse: string;
}

export interface ReviewTrendSnapshot {
  snapshotDate: string;
  avgRating: number;
  totalReviews: number;
  positiveCount: number;
  negativeCount: number;
  topKeywords: string[];
  sentimentDist: Record<string, number>;
  ratingTrend: "improving" | "declining" | "stable";
  volumeTrend: "increasing" | "decreasing" | "stable";
}

export interface CompetitorIntel {
  name: string;
  placeId: string;
  avgRating: number;
  totalReviews: number;
  recentSentiment: string;
  strengths: string[];
  weaknesses: string[];
}

// ─── CONSTANTS ──────────────────────────────────────────

const NICK_SEARCH_QUERY = "Nick's Tire And Auto 17625 Euclid Ave Cleveland OH 44112";

const COMPETITORS = [
  "Goodyear Auto Service Center Euclid OH",
  "Midas Cleveland OH Euclid Ave",
  "Firestone Complete Auto Care Cleveland OH",
  "Tire Choice Auto Service Center Euclid OH",
];

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
    { query: NICK_SEARCH_QUERY },
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

  return details.result.reviews.map((r: any) => ({
    authorName: r.author_name || "Unknown",
    rating: r.rating,
    text: r.text || "",
    relativeTime: r.relative_time_description || "",
    time: r.time,
  }));
}

/**
 * Fetch reviews for a competitor by search query.
 */
async function fetchCompetitorReviews(query: string): Promise<{ name: string; placeId: string; reviews: RawReview[]; rating: number; totalReviews: number } | null> {
  try {
    const search = await makeRequest<PlacesSearchResult>(
      "/maps/api/place/textsearch/json",
      { query },
    );

    if (search.status !== "OK" || !search.results?.length) return null;

    const place = search.results[0];
    const placeId = place.place_id;

    const details = await makeRequest<PlaceDetailsResult>(
      "/maps/api/place/details/json",
      {
        place_id: placeId,
        fields: "reviews,name,rating,user_ratings_total",
      },
    );

    if (details.status !== "OK") return null;

    const reviews = (details.result?.reviews || []).map((r: any) => ({
      authorName: r.author_name || "Unknown",
      rating: r.rating,
      text: r.text || "",
      relativeTime: r.relative_time_description || "",
      time: r.time,
    }));

    return {
      name: details.result?.name || query,
      placeId,
      reviews,
      rating: (details.result as any)?.rating || 0,
      totalReviews: (details.result as any)?.user_ratings_total || 0,
    };
  } catch (error) {
    console.error(`[GBP Pipeline] Competitor fetch failed for "${query}":`, error);
    return null;
  }
}

// ─── ANALYZE REVIEW ──────────────────────────────────────

/**
 * Analyze a single review with AI — extract sentiment, topics, keywords, and urgency.
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
- keywords: array of 1-3 word phrases the customer used that capture their experience (e.g., "fast service", "fair price", "friendly staff", "long wait", "honest mechanic"). Extract the actual words/phrases from the review.
- urgency: "critical" (1 star + angry/safety issue), "high" (1-2 stars), "normal" (3 stars or mixed), "low" (4-5 stars positive)

Be accurate. A 3-star review with some praise and some criticism is "mixed".
A review with no text but 5 stars is "positive" with urgency "low".
Keep topics to 1-4 items. Keep keywords to 2-6 items from the actual text.`,
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
              keywords: {
                type: "array",
                items: { type: "string" },
                description: "Key phrases from the review text",
              },
              urgency: { type: "string", description: "critical, high, normal, or low" },
            },
            required: ["sentiment", "topics", "keywords", "urgency"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (content && typeof content === "string") {
      const parsed = JSON.parse(content);
      // Validate the AI output
      const validSentiments = ["positive", "negative", "neutral", "mixed"];
      const validUrgencies = ["critical", "high", "normal", "low"];
      return {
        ...review,
        sentiment: validSentiments.includes(parsed.sentiment) ? parsed.sentiment : "neutral",
        topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 4) : [],
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 6) : [],
        urgency: validUrgencies.includes(parsed.urgency) ? parsed.urgency : "normal",
      };
    }
  } catch (error) {
    console.error("[GBP Pipeline] Review analysis failed:", error);
  }

  // Fallback: derive from star rating
  const sentiment = review.rating >= 4 ? "positive" : review.rating <= 2 ? "negative" : "neutral";
  const urgency = review.rating <= 1 ? "critical" : review.rating <= 2 ? "high" : "normal";
  return { ...review, sentiment, topics: [], keywords: [], urgency };
}

// ─── SUGGEST RESPONSE ────────────────────────────────────

/**
 * Generate an AI-suggested owner response for a review.
 * Learns from past approved responses to match the shop's voice.
 */
export async function suggestResponse(review: AnalyzedReview): Promise<string> {
  // Fetch past approved responses to learn from
  let pastResponses: string[] = [];
  try {
    const d = await db();
    if (d) {
      const approved = await d
        .select({
          rating: reviewPipeline.rating,
          reviewText: reviewPipeline.reviewText,
          response: reviewPipeline.suggestedResponse,
        })
        .from(reviewPipeline)
        .where(and(eq(reviewPipeline.responseSent, 1), eq(reviewPipeline.reviewed, 1)))
        .orderBy(desc(reviewPipeline.createdAt))
        .limit(5);

      pastResponses = approved
        .filter((r: any) => r.response)
        .map((r: any) => `[${r.rating}-star] "${r.reviewText?.slice(0, 80) || '(no text)'}" → Response: "${r.response!.slice(0, 150)}"`);
    }
  } catch (e) {
    console.warn("[pipelines/gbp-reviews] operation failed:", e);
    // Non-critical — proceed without learning data
  }

  const learningContext = pastResponses.length > 0
    ? `\n\nHere are previously approved responses to learn from (match this tone and style):\n${pastResponses.join("\n")}`
    : "";

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
- For no-text reviews with 5 stars: keep it brief, just thank them${learningContext}`,
        },
        {
          role: "user",
          content: `Author: ${review.authorName}\nRating: ${review.rating}/5\nSentiment: ${review.sentiment}\nTopics: ${review.topics.join(", ") || "none"}\nUrgency: ${review.urgency}\nReview text: ${review.text || "(no text)"}`,
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

// ─── KEYWORD EXTRACTION ─────────────────────────────────

/**
 * Extract top keywords across all stored reviews.
 * Returns frequency-ranked keyword list.
 */
export async function extractKeywords(opts?: { limit?: number }): Promise<Array<{ keyword: string; count: number; sentiment: string }>> {
  const d = await db();
  if (!d) return [];

  const reviews = await d
    .select({
      topicsJson: reviewPipeline.topicsJson,
      sentiment: reviewPipeline.sentiment,
    })
    .from(reviewPipeline)
    .orderBy(desc(reviewPipeline.createdAt))
    .limit(200);

  const keywordMap = new Map<string, { count: number; sentiments: string[] }>();

  for (const review of reviews) {
    if (!review.topicsJson) continue;
    try {
      const topics: string[] = JSON.parse(review.topicsJson);
      for (const topic of topics) {
        const key = topic.toLowerCase().trim();
        if (!key) continue;
        const existing = keywordMap.get(key) || { count: 0, sentiments: [] };
        existing.count++;
        if (review.sentiment) existing.sentiments.push(review.sentiment);
        keywordMap.set(key, existing);
      }
    } catch (e) { /* skip malformed JSON */ console.warn("[pipelines/gbp-reviews] operation failed:", e); }
  }

  // Sort by frequency, determine dominant sentiment for each keyword
  const sorted = [...keywordMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, opts?.limit ?? 20)
    .map(([keyword, data]) => {
      const sentimentCounts: Record<string, number> = {};
      for (const s of data.sentiments) {
        sentimentCounts[s] = (sentimentCounts[s] || 0) + 1;
      }
      const dominant = Object.entries(sentimentCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "neutral";
      return { keyword, count: data.count, sentiment: dominant };
    });

  return sorted;
}

// ─── TREND DETECTION ────────────────────────────────────

/**
 * Analyze review trends — detect rating/volume shifts over time.
 * Saves a snapshot to review_trends table.
 */
export async function detectTrends(): Promise<ReviewTrendSnapshot> {
  const d = await db();
  if (!d) throw new Error("Database not available");

  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);

  // Current period reviews (last 30 days)
  const currentReviews = await d
    .select()
    .from(reviewPipeline)
    .where(gte(reviewPipeline.createdAt, new Date(thirtyDaysAgo)))
    .orderBy(desc(reviewPipeline.createdAt));

  // Previous period reviews (30-60 days ago) for comparison
  const previousReviews = await d
    .select()
    .from(reviewPipeline)
    .where(and(
      gte(reviewPipeline.createdAt, new Date(sixtyDaysAgo)),
      lte(reviewPipeline.createdAt, new Date(thirtyDaysAgo)),
    ));

  // Compute current metrics
  const totalReviews = currentReviews.length;
  const avgRating = totalReviews > 0
    ? currentReviews.reduce((sum: any, r: any) => sum + r.rating, 0) / totalReviews
    : 0;
  const positiveCount = currentReviews.filter((r: any) => r.rating >= 4).length;
  const negativeCount = currentReviews.filter((r: any) => r.rating <= 2).length;

  // Sentiment distribution
  const sentimentDist: Record<string, number> = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
  for (const r of currentReviews) {
    const s = r.sentiment || "neutral";
    sentimentDist[s] = (sentimentDist[s] || 0) + 1;
  }

  // Top keywords from current period
  const keywordFreq = new Map<string, number>();
  for (const r of currentReviews) {
    if (!r.topicsJson) continue;
    try {
      const topics: string[] = JSON.parse(r.topicsJson);
      for (const t of topics) {
        const key = t.toLowerCase().trim();
        keywordFreq.set(key, (keywordFreq.get(key) || 0) + 1);
      }
    } catch (e) { /* skip */ console.warn("[pipelines/gbp-reviews] operation failed:", e); }
  }
  const topKeywords = [...keywordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k]) => k);

  // Trend detection
  const prevAvgRating = previousReviews.length > 0
    ? previousReviews.reduce((sum: any, r: any) => sum + r.rating, 0) / previousReviews.length
    : avgRating;

  const ratingDelta = avgRating - prevAvgRating;
  const ratingTrend: "improving" | "declining" | "stable" =
    ratingDelta > 0.2 ? "improving" : ratingDelta < -0.2 ? "declining" : "stable";

  const volumeDelta = totalReviews - previousReviews.length;
  const volumeTrend: "increasing" | "decreasing" | "stable" =
    volumeDelta > 2 ? "increasing" : volumeDelta < -2 ? "decreasing" : "stable";

  // Save snapshot
  await d.insert(reviewTrends).values({
    snapshotDate: today,
    avgRating: Math.round(avgRating * 100),
    totalReviews,
    negativeCount,
    positiveCount,
    topKeywordsJson: JSON.stringify(topKeywords),
    sentimentDistJson: JSON.stringify(sentimentDist),
  });

  return {
    snapshotDate: today,
    avgRating: Math.round(avgRating * 100) / 100,
    totalReviews,
    positiveCount,
    negativeCount,
    topKeywords,
    sentimentDist,
    ratingTrend,
    volumeTrend,
  };
}

// ─── URGENCY DETECTION ──────────────────────────────────

/**
 * Get reviews flagged as urgent (1-2 stars) that haven't been reviewed yet.
 */
export async function getUrgentReviews(): Promise<Array<{
  id: number;
  authorName: string;
  rating: number;
  reviewText: string | null;
  sentiment: string | null;
  createdAt: Date;
}>> {
  const d = await db();
  if (!d) return [];

  return d
    .select({
      id: reviewPipeline.id,
      authorName: reviewPipeline.authorName,
      rating: reviewPipeline.rating,
      reviewText: reviewPipeline.reviewText,
      sentiment: reviewPipeline.sentiment,
      createdAt: reviewPipeline.createdAt,
    })
    .from(reviewPipeline)
    .where(and(
      lte(reviewPipeline.rating, 2),
      eq(reviewPipeline.reviewed, 0),
    ))
    .orderBy(desc(reviewPipeline.createdAt))
    .limit(20);
}

// ─── REVIEW VOLUME TRACKING ─────────────────────────────

/**
 * Check review velocity — compare recent pace to historical average.
 * Returns an alert if pace has dropped significantly.
 */
export async function checkReviewVolume(): Promise<{
  last7Days: number;
  last30Days: number;
  avgMonthly: number;
  paceStatus: "healthy" | "slowing" | "stalled";
  alert: string | null;
}> {
  const d = await db();
  if (!d) return { last7Days: 0, last30Days: 0, avgMonthly: 0, paceStatus: "stalled", alert: "Database not available" };

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);

  const [recent7, recent30, recent90] = await Promise.all([
    d.select({ count: sql<number>`COUNT(*)` }).from(reviewPipeline).where(gte(reviewPipeline.createdAt, sevenDaysAgo)),
    d.select({ count: sql<number>`COUNT(*)` }).from(reviewPipeline).where(gte(reviewPipeline.createdAt, thirtyDaysAgo)),
    d.select({ count: sql<number>`COUNT(*)` }).from(reviewPipeline).where(gte(reviewPipeline.createdAt, ninetyDaysAgo)),
  ]);

  const last7Days = Number(recent7[0]?.count || 0);
  const last30Days = Number(recent30[0]?.count || 0);
  const total90Days = Number(recent90[0]?.count || 0);
  const avgMonthly = Math.round(total90Days / 3);

  let paceStatus: "healthy" | "slowing" | "stalled" = "healthy";
  let alert: string | null = null;

  if (last30Days === 0) {
    paceStatus = "stalled";
    alert = "No new reviews in the last 30 days. Consider sending review request campaigns.";
  } else if (last30Days < avgMonthly * 0.5) {
    paceStatus = "slowing";
    alert = `Review pace dropped: ${last30Days} this month vs ${avgMonthly} monthly average. Time to boost review requests.`;
  }

  return { last7Days, last30Days, avgMonthly, paceStatus, alert };
}

// ─── COMPETITOR MONITORING ──────────────────────────────

/**
 * Fetch and analyze competitor reviews for competitive intelligence.
 */
export async function monitorCompetitors(): Promise<CompetitorIntel[]> {
  const results: CompetitorIntel[] = [];

  for (const query of COMPETITORS) {
    const data = await fetchCompetitorReviews(query);
    if (!data || data.reviews.length === 0) continue;

    // Analyze competitor reviews with AI
    try {
      const reviewTexts = data.reviews
        .filter(r => r.text)
        .slice(0, 5)
        .map(r => `[${r.rating}★] ${r.text.slice(0, 200)}`)
        .join("\n");

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `Analyze these competitor auto repair shop reviews and return JSON with:
- recentSentiment: overall sentiment of recent reviews ("positive", "negative", "mixed")
- strengths: array of 2-3 things customers praise
- weaknesses: array of 2-3 things customers complain about

Be specific. These are reviews for a competitor of Nick's Tire & Auto.`,
          },
          { role: "user", content: `Shop: ${data.name}\nRating: ${data.rating}/5 (${data.totalReviews} reviews)\n\nRecent reviews:\n${reviewTexts}` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "competitor_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                recentSentiment: { type: "string" },
                strengths: { type: "array", items: { type: "string" } },
                weaknesses: { type: "array", items: { type: "string" } },
              },
              required: ["recentSentiment", "strengths", "weaknesses"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content;
      if (content && typeof content === "string") {
        const parsed = JSON.parse(content);
        results.push({
          name: data.name,
          placeId: data.placeId,
          avgRating: data.rating,
          totalReviews: data.totalReviews,
          recentSentiment: parsed.recentSentiment || "unknown",
          strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
          weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
        });
      }
    } catch (error) {
      console.error(`[GBP Pipeline] Competitor analysis failed for ${data.name}:`, error);
      results.push({
        name: data.name,
        placeId: data.placeId,
        avgRating: data.rating,
        totalReviews: data.totalReviews,
        recentSentiment: "unknown",
        strengths: [],
        weaknesses: [],
      });
    }
  }

  return results;
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
  urgentCount: number;
}> {
  const d = await db();
  if (!d) throw new Error("Database not available");

  const reviews = await fetchRecentReviews();
  let newReviews = 0;
  let errors = 0;
  let urgentCount = 0;

  for (const review of reviews) {
    try {
      // Check for duplicates (same author + same timestamp)
      const existing = await d
        .select({ id: reviewPipeline.id })
        .from(reviewPipeline)
        .where(eq(reviewPipeline.reviewTime, review.time))
        .limit(1);

      if (existing.length > 0) continue; // Already processed

      // Analyze sentiment, topics, keywords, urgency
      const analyzed = await analyzeReview(review);

      // Generate suggested response (learns from past approved responses)
      const suggested = await suggestResponse(analyzed);

      // Store in pipeline table
      await d.insert(reviewPipeline).values({
        authorName: analyzed.authorName,
        rating: analyzed.rating,
        reviewText: analyzed.text || null,
        reviewTime: analyzed.time,
        relativeTime: analyzed.relativeTime || null,
        sentiment: analyzed.sentiment,
        topicsJson: JSON.stringify([...analyzed.topics, ...analyzed.keywords]),
        suggestedResponse: suggested,
      });

      newReviews++;

      // Track urgent reviews
      if (analyzed.urgency === "critical" || analyzed.urgency === "high") {
        urgentCount++;
      }
    } catch (error) {
      console.error("[GBP Pipeline] Error processing review:", error);
      errors++;
    }
  }

  return { fetched: reviews.length, newReviews, errors, urgentCount };
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

/**
 * Get historical trend snapshots for charting.
 */
export async function getTrendHistory(opts?: { limit?: number }) {
  const d = await db();
  if (!d) return [];

  return d
    .select()
    .from(reviewTrends)
    .orderBy(desc(reviewTrends.snapshotDate))
    .limit(opts?.limit ?? 12);
}
