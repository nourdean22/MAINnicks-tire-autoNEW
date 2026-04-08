/**
 * Review Monitor — Tracks reviews across platforms
 * Alerts on new reviews, flags low ratings for immediate response.
 * Generates AI response drafts for owner approval.
 */

import { createLogger } from "../lib/logger";
import { analyzeSentiment } from "./sentimentAnalysis";
import { emitNewReview, emitAlert } from "./realtime";
import { alertLowReview } from "./telegram";

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
  trustTags: string[];
  service: string;
  isProof: boolean;
}> {
  // Analyze sentiment
  const sentiment = analyzeSentiment(review.text);

  // Detect trust tags & service type for marketing intelligence
  const trustTags = detectTrustTags(review.text);
  const service = detectService(review.text);
  const isProof = isProofCandidate(review);

  // Generate response draft
  const responseDraft = generateResponseDraft(review, sentiment);

  // Emit to admin real-time feed with intelligence data
  emitNewReview({
    rating: review.rating,
    text: review.text.slice(0, 100),
    author: review.authorName,
    trustTags,
    service,
    isProof,
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
    // Push to Telegram
    alertLowReview({ rating: review.rating, author: review.authorName, text: review.text, platform: review.platform }).catch((e) => { console.warn("[services/reviewMonitor] fire-and-forget failed:", e); });
    log.warn("Low rating review received", { rating: review.rating, author: review.authorName });
  }

  log.info("Review processed", {
    platform: review.platform,
    rating: review.rating,
    sentiment: sentiment.overall,
    author: review.authorName,
    trustTags,
    service,
    isProof,
  });

  return { sentiment, responseDraft, alertSent, trustTags, service, isProof };
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

// ─── Trust Tag Auto-Detection ────────────────────────
// Automatically detects trust signals in review text for marketing proof
export function detectTrustTags(text: string): string[] {
  const lower = text.toLowerCase();
  const tags: string[] = [];
  if (/honest|told me|didn.t need|truth|straightforward|upfront/.test(lower)) tags.push("honesty");
  if (/fair|reasonable|price|value|affordable|worth|good deal/.test(lower)) tags.push("fair_price");
  if (/no pressure|no.pressure|pushy|forced|my decision|no hassle|didn.t push/.test(lower)) tags.push("no_pressure");
  if (/woman|female|comfortable|respected|welcoming|wife|daughter|mom|lady/.test(lower)) tags.push("women_safe");
  if (/fast|quick|same.day|right away|immediately|in and out/.test(lower)) tags.push("speed");
  if (/found|diagnosed|missed|caught|figured out|other shop|couldn.t find/.test(lower)) tags.push("diagnostic_skill");
  if (/explained|showed|understood|clear|walked me through|told me what/.test(lower)) tags.push("transparency");
  if (/always|years|every time|keep coming|go.to|regular|loyal/.test(lower)) tags.push("repeat_customer");
  return tags;
}

// Detect which service a review references
export function detectService(text: string): string {
  const lower = text.toLowerCase();
  if (/brake|brakes|rotor|pads|stopping/.test(lower)) return "brakes";
  if (/tire|tires|flat|alignment|rotation/.test(lower)) return "tires";
  if (/check engine|diagnostic|code|light|scan/.test(lower)) return "diagnostics";
  if (/oil change|\boil\b|\blube\b/.test(lower)) return "oil_change";
  if (/emission|e.check|inspection|smog/.test(lower)) return "emissions";
  if (/\bac\b|a\/c|air condition|cooling|heat/.test(lower)) return "ac_repair";
  if (/transmission|trans/.test(lower)) return "transmission";
  return "general";
}

// Check if a review qualifies as proof material
export function isProofCandidate(review: { rating: number; text: string }): boolean {
  return review.rating >= 4 && !!review.text && review.text.length > 30;
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
