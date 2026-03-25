/**
 * Sentiment Analysis — Lightweight keyword-based sentiment scoring
 * No external API needed. Falls back to neutral for ambiguous text.
 * Used on: reviews, inbound SMS, chat transcripts, survey responses.
 */

import { createLogger } from "../lib/logger";
const log = createLogger("sentiment");

interface SentimentResult {
  overall: "positive" | "negative" | "neutral" | "mixed";
  score: number; // -1 to 1
  themes: Array<{ theme: string; sentiment: "positive" | "negative" | "neutral" }>;
  actionRequired: boolean;
  suggestedAction?: string;
}

const POSITIVE_WORDS = new Set([
  "great", "excellent", "amazing", "awesome", "fantastic", "wonderful", "perfect",
  "best", "love", "honest", "trust", "trustworthy", "fair", "quick", "fast",
  "friendly", "professional", "recommend", "thank", "thanks", "appreciate",
  "impressed", "reliable", "helpful", "clean", "affordable", "quality",
  "satisfied", "happy", "pleased", "outstanding", "exceptional",
]);

const NEGATIVE_WORDS = new Set([
  "terrible", "horrible", "awful", "worst", "bad", "poor", "rude",
  "expensive", "overpriced", "slow", "wait", "waited", "hours",
  "dishonest", "scam", "ripoff", "rip-off", "never", "disappointed",
  "frustrated", "angry", "upset", "unprofessional", "dirty", "broken",
  "wrong", "mistake", "problem", "issue", "complaint", "refund",
]);

const THEME_KEYWORDS: Record<string, string[]> = {
  pricing: ["price", "cost", "expensive", "cheap", "affordable", "overpriced", "fair", "quote", "estimate", "charge"],
  wait_time: ["wait", "waited", "hours", "long", "slow", "fast", "quick", "time"],
  quality: ["quality", "work", "job", "repair", "fixed", "broken", "right", "wrong"],
  friendliness: ["friendly", "nice", "rude", "kind", "helpful", "staff", "team", "service"],
  honesty: ["honest", "trust", "trustworthy", "dishonest", "scam", "transparent", "upfront"],
  communication: ["explain", "explained", "told", "call", "update", "informed", "communication"],
  cleanliness: ["clean", "dirty", "neat", "organized", "shop"],
};

export function analyzeSentiment(text: string): SentimentResult {
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) positiveCount++;
    if (NEGATIVE_WORDS.has(word)) negativeCount++;
  }

  // Calculate score (-1 to 1)
  const total = positiveCount + negativeCount;
  let score = 0;
  if (total > 0) {
    score = (positiveCount - negativeCount) / total;
  }

  // Determine overall sentiment
  let overall: SentimentResult["overall"];
  if (positiveCount > 0 && negativeCount > 0) overall = "mixed";
  else if (score > 0.2) overall = "positive";
  else if (score < -0.2) overall = "negative";
  else overall = "neutral";

  // Extract themes
  const themes: SentimentResult["themes"] = [];
  const lower = text.toLowerCase();
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    const found = keywords.some(k => lower.includes(k));
    if (found) {
      // Determine theme sentiment based on surrounding words
      const themeSentiment = score > 0.1 ? "positive" : score < -0.1 ? "negative" : "neutral";
      themes.push({ theme, sentiment: themeSentiment });
    }
  }

  const actionRequired = overall === "negative" || overall === "mixed";
  const suggestedAction = actionRequired
    ? negativeCount > positiveCount
      ? "Follow up immediately — customer is unhappy. Call to resolve."
      : "Mixed feedback — review details and consider follow-up."
    : undefined;

  return { overall, score: Math.round(score * 100) / 100, themes, actionRequired, suggestedAction };
}
