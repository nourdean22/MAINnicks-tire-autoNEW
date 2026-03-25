/**
 * AI Content Generator — Multi-format content from a single topic
 * Generates: blog posts, Instagram captions, GBP posts, email campaigns, SMS blasts
 * Uses brand voice guidelines for consistent Nick's Tire & Auto content.
 */

import { createLogger } from "../lib/logger";
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
- 1,700+ reviews at 4.9 stars — let the work speak for itself
- Phone: (216) 862-0005 | Website: nickstire.org
- Address: 17625 Euclid Ave, Euclid OH 44112`;

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
  const cta = request.includeCTA ? "\nInclude CTA: Call (216) 862-0005 or book at nickstire.org" : "";
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
      return { content: `Oil change special at Nick's! Conventional $39, synthetic $69. Walk-ins welcome. (216) 862-0005. Reply STOP to opt out` };
    }
    if (topic.includes("brake")) {
      return { content: `Brakes squealing? Free inspection at Nick's Tire & Auto. Pads from $89. (216) 862-0005. Reply STOP to opt out` };
    }
    if (topic.includes("tire")) {
      return { content: `New & used tires from $60 at Nick's. Free mounting & balancing. Walk-ins 7 days. (216) 862-0005. Reply STOP to opt out` };
    }
  }

  if (request.type === "faq-answer") {
    return { content: `For ${request.topic}, call us at (216) 862-0005 or visit nickstire.org. Walk-ins welcome Mon-Sat 8-6, Sun 9-4. Free estimates on all services.` };
  }

  return null; // Need AI for this content type
}

log.info("AI content generator loaded");
