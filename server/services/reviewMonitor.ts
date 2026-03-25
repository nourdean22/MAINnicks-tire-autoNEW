/**
 * Review Monitor — Tracks reviews across platforms
 * Alerts on new reviews, flags low ratings for immediate response.
 * Generates AI response drafts for owner approval.
 */

import { createLogger } from "../lib/logger";
import { analyzeSentiment } from "./sentimentAnalysis";
import { emitNewReview, emitAlert } from "./realtime";

const log = createLogger("review-monitor");

interface Review {
  id: string;
  platform: "google" | "yelp" | "facebook";
  authorName: string;
  rating: number;
  text: string;
  publishedAt: Date;
  responseStatus: "pending" | "drafted" | "approved" | "posted" | "skipped";
  responseDraft?: string;
  sentiment?: ReturnType<typeof analyzeSentiment>;
}

/** Process a new review — analyze, alert, generate response draft */
export async function processNewReview(review: Review): Promise<{
  sentiment: ReturnType<typeof analyzeSentiment>;
  responseDraft: string;
  alertSent: boolean;
}> {
  // Analyze sentiment
  const sentiment = analyzeSentiment(review.text);

  // Generate response draft
  const responseDraft = generateResponseDraft(review, sentiment);

  // Emit to admin real-time feed
  emitNewReview({
    rating: review.rating,
    text: review.text.slice(0, 100),
    author: review.authorName,
  });

  // Alert on low ratings
  let alertSent = false;
  if (review.rating <= 2) {
    emitAlert({
      type: "low-review",
      message: `${review.rating}-star review from ${review.authorName}: "${review.text.slice(0, 80)}..."`,
      severity: "urgent",
    });
    alertSent = true;
    log.warn("Low rating review received", { rating: review.rating, author: review.authorName });
  }

  log.info("Review processed", {
    platform: review.platform,
    rating: review.rating,
    sentiment: sentiment.overall,
    author: review.authorName,
  });

  return { sentiment, responseDraft, alertSent };
}

/** Generate a response draft based on rating and sentiment */
function generateResponseDraft(review: Review, sentiment: ReturnType<typeof analyzeSentiment>): string {
  const firstName = review.authorName.split(" ")[0];

  if (review.rating >= 4) {
    // Positive response templates (rotate for variety)
    const positiveTemplates = [
      `Thank you so much, ${firstName}! We really appreciate you taking the time to share your experience. It means a lot to the whole team. We look forward to seeing you again! — Nour`,
      `${firstName}, thank you! Your kind words motivate our team every day. We're glad we could take care of you and your vehicle. See you next time! — The Nick's Tire Team`,
      `We appreciate you, ${firstName}! Reviews like yours help other Cleveland drivers find honest repair. Thank you for trusting us with your vehicle. — Nour & the team`,
    ];
    return positiveTemplates[(review.authorName.length + review.rating) % positiveTemplates.length];
  }

  if (review.rating === 3) {
    return `${firstName}, thank you for your honest feedback. We always want to do better. If there's anything specific we can improve, please call me directly at (216) 862-0005. We'd love the chance to earn a 5-star experience next time. — Nour, Owner`;
  }

  // Negative (1-2 stars)
  return `${firstName}, I'm sorry to hear about your experience. This isn't the standard we set for ourselves. I'd like to make this right — please call me directly at (216) 862-0005 so we can discuss what happened. We take every review seriously. — Nour, Owner`;
}

/** Get review velocity stats */
export function calculateReviewVelocity(reviews: Array<{ publishedAt: Date }>): {
  last7Days: number;
  last30Days: number;
  avgPerWeek: number;
} {
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  const month = 30 * 24 * 60 * 60 * 1000;

  const last7Days = reviews.filter(r => now - r.publishedAt.getTime() < week).length;
  const last30Days = reviews.filter(r => now - r.publishedAt.getTime() < month).length;
  const avgPerWeek = last30Days > 0 ? Math.round((last30Days / 4.3) * 10) / 10 : 0;

  return { last7Days, last30Days, avgPerWeek };
}
