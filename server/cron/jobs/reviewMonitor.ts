/**
 * Review Monitor — Periodically fetches Google reviews and alerts on low ratings.
 * Uses the existing reviewReplies system to store new reviews with AI-drafted replies.
 */

import { createLogger } from "../../lib/logger";
import { buildPlaceDetailsUrl } from "@shared/const";

const log = createLogger("review-monitor");

export async function processReviewMonitor(): Promise<{ recordsProcessed: number; details?: string }> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { recordsProcessed: 0, details: "GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY not configured — skipping" };
  }

  try {
    const response = await fetch(
      buildPlaceDetailsUrl(apiKey, "reviews,rating,user_ratings_total"),
      { signal: AbortSignal.timeout(10000) }
    );

    if (!response.ok) {
      return { recordsProcessed: 0, details: `Google API error: ${response.status}` };
    }

    const data = await response.json();
    const reviews: any[] = data.result?.reviews || [];

    if (!reviews.length) {
      return { recordsProcessed: 0, details: "No reviews returned from API" };
    }

    // Store new reviews in the reviewReplies table (same as manual fetch)
    const { getDb } = await import("../../db");
    const { reviewReplies } = await import("../../../drizzle/schema");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "Database unavailable" };

    const { eq } = await import("drizzle-orm");
    const { sanitizeText } = await import("../../sanitize");

    let newCount = 0;
    let lowRatingCount = 0;

    for (const review of reviews) {
      const reviewId = review.time?.toString() || `${review.author_name}_${Date.now()}`;

      // Check if already exists
      const existing = await db
        .select()
        .from(reviewReplies)
        .where(eq(reviewReplies.reviewId, reviewId))
        .limit(1);

      if (existing.length > 0) continue;

      // Insert new review
      await db.insert(reviewReplies).values({
        reviewId,
        reviewerName: review.author_name || "Anonymous",
        reviewRating: review.rating || 3,
        reviewText: sanitizeText(review.text || ""),
        reviewDate: review.time ? new Date(review.time * 1000) : new Date(),
        draftReply: await getDefaultDraft(review.rating, review.author_name, review.text),
        status: "draft",
      });

      newCount++;

      // Dispatch through event bus (reaches NOUR OS bridge, Telegram, learning, statenour, feedback loop)
      import("../../services/eventBus").then(({ dispatch }) =>
        dispatch("review_detected", {
          rating: review.rating || 3,
          reviewText: review.text || "",
          customerName: review.author_name || "Anonymous",
        }, { priority: review.rating <= 3 ? "critical" : "normal", source: "review_monitor" })
      ).catch(err => {
        log.warn("Review event dispatch failed", { error: err instanceof Error ? err.message : String(err) });
      });

      if (review.rating <= 3) {
        lowRatingCount++;
      }
    }

    // Alert on low ratings
    if (lowRatingCount > 0) {
      try {
        const { notifySystemAlert } = await import("../../email-notify");
        await notifySystemAlert({
          title: "Low Rating Review Alert",
          message: `⚠️ ${lowRatingCount} new review(s) with 3 stars or below detected. Check admin → Review Replies to respond.`,
        });
      } catch (err) {
        log.error("Failed to send low-rating alert", { error: err instanceof Error ? err.message : String(err) });
      }
    }

    return {
      recordsProcessed: newCount,
      details: newCount > 0
        ? `${newCount} new review(s) found${lowRatingCount > 0 ? `, ${lowRatingCount} low-rating` : ""}`
        : "No new reviews",
    };
  } catch (err) {
    log.error("Review monitor failed", { error: err instanceof Error ? err.message : String(err) });
    return { recordsProcessed: 0, details: `Error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function getDefaultDraft(rating: number, authorName: string, reviewText?: string): Promise<string> {
  const name = authorName?.split(" ")[0] || "there";

  // For negative reviews (≤3 stars), use AI to craft a professional response
  if (rating <= 3 && reviewText && reviewText.length > 10) {
    try {
      const { invokeLLM } = await import("../../_core/llm");
      const result = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are Nick's Tire & Auto's review response writer. Write a professional, empathetic response to a negative Google review.

Rules:
- Address the reviewer by first name
- Acknowledge their specific concern (reference what they wrote)
- Apologize without being defensive
- Invite them to call (216) 862-0005 to resolve
- Keep it under 100 words
- Tone: warm, professional, takes ownership
- Never blame the customer
- Business name: Nick's Tire & Auto`,
          },
          {
            role: "user",
            content: `${rating} star review from ${authorName}:\n"${reviewText}"`,
          },
        ],
      });
      const aiResponse = typeof result.choices?.[0]?.message?.content === "string" ? result.choices[0].message.content : "";
      if (aiResponse && aiResponse.length > 20) return aiResponse;
    } catch (err) {
      log.warn("AI review draft failed, using template", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Fallback templates
  if (rating >= 4) {
    return `Thank you so much, ${name}! We're glad you had a great experience. We look forward to seeing you again!`;
  }
  if (rating === 3) {
    return `Thank you for your feedback, ${name}. We'd love to make your next visit even better. Please call us at (216) 862-0005 — we want to get it right.`;
  }
  return `We're sorry about your experience, ${name}. This isn't our standard. Please call us at (216) 862-0005 so we can make it right.`;
}
