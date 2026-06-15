/**
 * AI Content Generator — Multi-format content from a single topic
 * Generates: blog posts, Instagram captions, GBP posts, email campaigns, SMS blasts
 * Uses brand voice guidelines for consistent Nick's Tire & Auto content.
 */

import { createLogger } from "../lib/logger";
import { BUSINESS } from "@shared/business";
import { OIL_PRICE, BRAKE_PRICE } from "@shared/pricing";

const log = createLogger("content-gen");

export type ContentType = "blog-post" | "instagram-caption" | "gbp-post" | "email-campaign" | "sms-blast" | "faq-answer" | "service-description" | "city-page-intro";

export interface ContentRequest {
  type: ContentType;
  topic: string;
  tone?: "professional" | "casual" | "urgent" | "educational" | "promotional";
  includeKeywords?: string[];
  includeCTA?: boolean;
  maxLength?: number;
}

export interface ContentOutput {
  content: string;
  title?: string;
  metaDescription?: string;
  hashtags?: string[];
  suggestedImage?: string;
}

// Brand voice for prompt construction
const BRAND_VOICE = `Nick's Tire & Auto brand voice:
- Trustworthy, no-BS, straight-talk
- Protective of customers (we tell you what you DON'T need)
- Local Cleveland pride — reference neighborhoods, weather, roads
- Working-class respect — we treat every car like it's our own
- Not salesy, not corporate, not fake
- Confident without being arrogant
- ${BUSINESS.reviews.countDisplay} reviews at ${BUSINESS.reviews.rating} stars — let the work speak for itself
- Phone: ${BUSINESS.phone.display} | Website: ${BUSINESS.urls.website.replace("https://", "")}
- Address: ${BUSINESS.address.full}`;

const TYPE_SPECS: Record<ContentType, { maxWords: number; format: string }> = {
  "blog-post": { maxWords: 800, format: "600-800 words with H2 subheadings. SEO-friendly. Internal links to /tires, /brakes, /oil-change, /diagnostics." },
  "instagram-caption": { maxWords: 50, format: "150-250 characters. Punchy, visual. Include 5-8 hashtags." },
  "gbp-post": { maxWords: 100, format: "100-300 words. Clear CTA. Professional but approachable." },
  "email-campaign": { maxWords: 250, format: "Subject line (50 chars) + body (150-250 words). One clear CTA. Tokens: {{firstName}}, {{vehicleMake}}." },
  "sms-blast": { maxWords: 30, format: "Max 160 characters. Direct. Include phone or URL. Must include 'Reply STOP to opt out'." },
  "faq-answer": { maxWords: 60, format: "2-4 sentences. Clear, specific. Include contact info." },
  "service-description": { maxWords: 200, format: "150-200 words. SEO-friendly, benefits-focused." },
  "city-page-intro": { maxWords: 150, format: "150 words. Mention drive time, local context, trust signals." },
};

/**
 * Build a Gemini prompt for content generation.
 * The actual Gemini call should be made by the caller using the existing Gemini integration.
 */
export function buildContentPrompt(request: ContentRequest): string {
  const spec = TYPE_SPECS[request.type];
  const cta = request.includeCTA ? `\nInclude CTA: Call ${BUSINESS.phone.display} or book at ${BUSINESS.urls.website.replace("https://", "")}` : "";
  const keywords = request.includeKeywords?.length ? `\nTarget keywords: ${request.includeKeywords.join(", ")}` : "";

  return `${BRAND_VOICE}

Format: ${spec.format}
Topic: ${request.topic}
Tone: ${request.tone || "professional"}${keywords}${cta}
Max length: ${request.maxLength || spec.maxWords} words

Generate the content. Be authentic — write like a real person, not AI.`;
}

/**
 * Generate content using static templates (no AI required).
 * For common content types where AI isn't necessary.
 */
export function generateStaticContent(request: ContentRequest): ContentOutput | null {
  if (request.type === "sms-blast") {
    const topic = request.topic.toLowerCase();
    if (topic.includes("oil change")) {
      // keep in sync with OIL_PRICE
      return { content: `Oil change special at Nick's! Conventional $${OIL_PRICE.conventional}, synthetic $${OIL_PRICE.fullSynthetic}. Walk-ins welcome. ${BUSINESS.phone.display}. Reply STOP to opt out` };
    }
    if (topic.includes("brake")) {
      return { content: `Brakes squealing? Free inspection at Nick's Tire & Auto. Pads from $${BRAKE_PRICE.padsStarting}. ${BUSINESS.phone.display}. Reply STOP to opt out` };
    }
    if (topic.includes("tire")) {
      return { content: `New tires ${BUSINESS.newTires.priceDisplay}. Used tires ${BUSINESS.usedTires.priceDisplay} (${BUSINESS.usedTires.typicalBand}). Walk-ins 7 days. ${BUSINESS.phone.display}. Reply STOP to opt out` };
    }
  }

  if (request.type === "faq-answer") {
    return { content: `For ${request.topic}, call us at ${BUSINESS.phone.display} or visit ${BUSINESS.urls.website.replace("https://", "")}. Walk-ins welcome ${BUSINESS.hours.shortDisplay}. Free estimates on all services.` };
  }

  return null; // Need AI for this content type
}

log.info("AI content generator loaded");
