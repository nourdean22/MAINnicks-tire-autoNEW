/**
 * Structured Claims Extraction Engine
 * Takes raw source text and extracts structured intelligence claims.
 */
import { getModel } from "@/lib/ai/provider";
import { generateText } from "ai";
import { extractStructured } from "@/lib/ai/extract-structured";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/extraction");

export interface ExtractedClaim {
  text: string;
  category: "research_claim" | "research_contradiction" | "research_action" | "research_question";
  confidence: number;
  narrativeStatus: "emerging" | "peak" | "declining" | "stable";
}

export async function extractClaimsFromText(rawContent: string): Promise<ExtractedClaim[]> {
  if (!rawContent || rawContent.trim().length < 10) {
    log.info("Content too short or empty. Skipping extraction.");
    return [];
  }

  const model = getModel("reason");
  const systemPrompt = `You are an elite intelligence analyst. Your job is to extract specific, highly factual, and actionable claims from the provided raw text source.
Exclude generic statements, marketing fluff, or obvious platitudes. Focus on numbers, recalls, trend shifts, competitor moves, and macro-economic data.

For each claim, categorize it as:
- 'research_claim': A factual assertion or data point (e.g. "Interest rates rose to 5.33%").
- 'research_contradiction': A statement directly opposing previous assumptions or standard metrics.
- 'research_action': A specific, immediate recommendation or instruction (e.g. "Replace the Accord fuel pump immediately").
- 'research_question': An unresolved issue or critical gap that requires investigation.

Provide a confidence score (0.0 to 1.0) indicating how verifiable and strong the source's assertion is.

Additionally, assess the narrative status of the claim:
- 'emerging': Early-stage signals or novel announcements (e.g., brand new AI models, early weather warnings).
- 'peak': Highly active/current events or major trends (e.g., current logistics freight price surges).
- 'declining': Fading trends, dated recall reports, or resolving/passed events.
- 'stable': Constant, baseline business or economic facts.

Respond ONLY with a JSON array of objects. Do not include markdown code blocks, preamble, or postamble.
JSON Schema:
[
  {
    "text": "The exact factual claim",
    "category": "research_claim | research_contradiction | research_action | research_question",
    "confidence": 0.95,
    "narrativeStatus": "emerging | peak | declining | stable"
  }
]`;

  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: `Raw Text Source:\n${rawContent}\n\nExtract all key intelligence claims now.`,
    });

    const textOutput = result.text || "";
    const parsed = extractStructured<ExtractedClaim[]>(textOutput, "array");

    if (!parsed.ok) {
      log.warn("Failed to parse claims JSON directly from LLM text output.", {
        error: parsed.error,
        raw: textOutput.slice(0, 200),
      });
      return [];
    }

    // Filter and sanitize the extracted claims
    const validCategories = ["research_claim", "research_contradiction", "research_action", "research_question"];
    const validNarratives = ["emerging", "peak", "declining", "stable"];
    const claims = parsed.value.filter((c) => {
      return (
        c &&
        typeof c.text === "string" &&
        c.text.trim().length > 5 &&
        validCategories.includes(c.category) &&
        typeof c.confidence === "number" &&
        c.confidence >= 0 &&
        c.confidence <= 1 &&
        typeof c.narrativeStatus === "string" &&
        validNarratives.includes(c.narrativeStatus)
      );
    });

    log.info(`Successfully extracted ${claims.length} claims.`);
    return claims;
  } catch (err) {
    log.error("Error during claims extraction:", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
