import { invokeLLM } from "../_core/llm";
import { z } from "zod";
import { createLogger } from "../lib/logger";
import { detectForbiddenClaims, detectOverdiagnosis, detectFearmongering } from "../../client/src/lib/igCarouselStudio";
import { sanitizeText } from "../sanitize";

const log = createLogger("services:socialIntelligence");

export const GBP_ARCHETYPES = ["proof", "anti", "math", "seasonal"] as const;
export type GbpArchetype = typeof GBP_ARCHETYPES[number];

export const CREATIVE_TERRITORIES = [
  "Mechanic Translation", "Tiny World", "Abstract Concept", "Before/After",
  "Process Transparency", "Debunking", "Cost Breakdown", "Local Tie-in"
] as const;

export interface AdvancedCaptionResult {
  caption: string;
  hashtags: string[];
  archetypeUsed: string;
  rationale: string;
  score: number;
}

export interface AdvancedCarouselResult {
  concept: string;
  territory: string;
  slides: { imagePrompt: string; text: string }[];
  score: number;
}

/**
 * Validates text against the strict pattern banks. Returns score deductions.
 */
function validateContentSafety(text: string): number {
  let deduction = 0;
  if (detectForbiddenClaims(text).length > 0) deduction += 20;
  if (detectOverdiagnosis(text).length > 0) deduction += 15;
  if (detectFearmongering(text).length > 0) deduction += 10;
  return deduction;
}

/**
 * AI as elite strategist: generates a post caption based on 4 Archetypes,
 * strictly scores itself against VOICE.md constraints, and ensures safety.
 */
export async function orchestrateAdvancedCaption(topic: string): Promise<AdvancedCaptionResult> {
  const prompt = `You are the elite strategist and copywriter for Nick's Tire & Auto.
Topic: "${topic}"

Select one of the 4 Archetypes (Proof, Anti, Math, Seasonal).
Write a caption strictly adhering to the shop's VOICE constraints.
NO use of: trusted, expert, quality, premium, hassle-free. Use concrete numbers.
DO NOT use repair prices, only advertisable prices (e.g., $49 oil change).

Output strictly in JSON:
{
  "caption": "...",
  "hashtags": ["cleveland", ...],
  "archetypeUsed": "proof",
  "rationale": "...",
  "selfScore": 100 // Deduct points for generic writing or violating constraints
}`;

  let result: AdvancedCaptionResult | null = null;
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await invokeLLM({
        messages: [{ role: "user", content: prompt }],
        maxTokens: 1024,
      });

      const content = response.choices?.[0]?.message?.content || "{}";
      const contentStr = typeof content === "string" ? content : (content as any)[0]?.text || "{}";
      const cleaned = contentStr.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      
      const safetyDeduction = validateContentSafety(parsed.caption);
      const finalScore = (parsed.selfScore || 100) - safetyDeduction;

      if (finalScore >= 80) {
        result = {
          caption: sanitizeText(parsed.caption),
          hashtags: parsed.hashtags || [],
          archetypeUsed: parsed.archetypeUsed || "proof",
          rationale: parsed.rationale || "",
          score: finalScore,
        };
        break; // Good enough, break out of retry loop
      } else {
        log.warn(`Caption failed safety/score check (score: ${finalScore}). Retrying...`);
      }
    } catch (e) {
      log.error(`orchestrateAdvancedCaption attempt ${attempt} failed:`, e);
    }
  }

  if (!result) {
    throw new Error("Failed to generate a compliant advanced caption after 3 attempts.");
  }

  return result;
}

/**
 * AI as elite strategist: Generates a 5-slide carousel structure based on the
 * 13 Creative Territories. Evaluates out of 60 points.
 */
export async function orchestrateAdvancedCarouselConcept(topic: string): Promise<AdvancedCarouselResult> {
  const prompt = `You are the elite creative director for Nick's Tire & Auto.
Topic: "${topic}"

Select one of the 13 Creative Territories (e.g., Mechanic Translation, Abstract Concept).
Design a 5-slide carousel structure: Pattern Interrupt, Truth, Clue, What To Do, Recap.
For each slide, provide the text and a highly detailed image generation prompt.

Output strictly in JSON:
{
  "concept": "A 1-sentence summary of the hook",
  "territory": "Mechanic Translation",
  "slides": [
    { "imagePrompt": "...", "text": "..." },
    { "imagePrompt": "...", "text": "..." },
    { "imagePrompt": "...", "text": "..." },
    { "imagePrompt": "...", "text": "..." },
    { "imagePrompt": "...", "text": "..." }
  ],
  "selfScore60": 58 // Score out of 60 based on Hook, Truth, Local fit
}`;

  let result: AdvancedCarouselResult | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await invokeLLM({
        messages: [{ role: "user", content: prompt }],
        maxTokens: 2048,
      });

      const content = response.choices?.[0]?.message?.content || "{}";
      const contentStr = typeof content === "string" ? content : (content as any)[0]?.text || "{}";
      const cleaned = contentStr.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      
      let safetyDeduction = 0;
      for (const slide of parsed.slides || []) {
        safetyDeduction += validateContentSafety(slide.text);
      }
      
      const finalScore = (parsed.selfScore60 || 60) - (safetyDeduction / 5); // Average deduction

      if (finalScore >= 57) {
        result = {
          concept: parsed.concept || "",
          territory: parsed.territory || "Mechanic Translation",
          slides: parsed.slides || [],
          score: finalScore,
        };
        break; // Passed threshold
      } else {
        log.warn(`Carousel concept failed safety/score check (score: ${finalScore}). Retrying...`);
      }
    } catch (e) {
      log.error(`orchestrateAdvancedCarouselConcept attempt ${attempt} failed:`, e);
    }
  }

  if (!result) {
    throw new Error("Failed to generate a compliant carousel concept after 3 attempts.");
  }

  return result;
}
